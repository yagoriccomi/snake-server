/**
 * Única camada que fala PostgREST sobre a `media_deletion_queue`. [#22]
 *
 * Usa `service_role`: essa fila está fechada para `authenticated` de
 * propósito (ver a migration do contrato) — ninguém além deste worker tem
 * negócio nela. [#55]
 */

import {
  MOTIVOS_DA_FILA,
  REFERENCIAS_DE_ANEXO,
  type MotivoDaFila,
} from './media-cleanup.constants.js';
import type { ConsultaDeReferencias } from './media-cleanup.orfaos.js';
import type { ItemDaFila, RepositorioDaFila } from './media-cleanup.service.js';

export interface ConfigDoRepositorio {
  supabaseUrl: string;
  serviceRoleKey: string;
}

interface LinhaDaFila {
  id: string;
  provider: string;
  asset_ref: string;
  motivo: string;
  tentativas: number;
}

function ehProvedorConhecido(valor: string): valor is ItemDaFila['provider'] {
  return valor === 'cloudinary' || valor === 'supabase_storage';
}

function ehMotivoConhecido(valor: string): valor is MotivoDaFila {
  return (MOTIVOS_DA_FILA as readonly string[]).includes(valor);
}

export function criarRepositorioDaFila(config: ConfigDoRepositorio): RepositorioDaFila {
  const cabecalhos = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  return {
    async listarPendentes(limite) {
      const parametros = new URLSearchParams({
        select: 'id,provider,asset_ref,motivo,tentativas',
        processado_em: 'is.null',
        order: 'enfileirado_em.asc',
        limit: String(limite),
      });

      const resposta = await fetch(
        `${config.supabaseUrl}/rest/v1/media_deletion_queue?${parametros.toString()}`,
        { headers: cabecalhos },
      );
      if (!resposta.ok) {
        throw new Error(`Falha ao listar a fila: HTTP ${String(resposta.status)}`);
      }

      const linhas = (await resposta.json()) as LinhaDaFila[];

      // Provedor ou motivo fora do enum conhecido (schema divergente de uma
      // versão futura) é motivo de PARAR, não de adivinhar qual API chamar
      // com um identificador que pode não ser dele — nem qual pasta o motivo
      // novo pode apagar. [#9]
      for (const linha of linhas) {
        if (!ehProvedorConhecido(linha.provider)) {
          throw new Error(`Provedor desconhecido na fila: "${linha.provider}" (item ${linha.id})`);
        }
        if (!ehMotivoConhecido(linha.motivo)) {
          throw new Error(`Motivo desconhecido na fila: "${linha.motivo}" (item ${linha.id})`);
        }
      }

      return linhas as ItemDaFila[];
    },

    async marcarProcessado(id) {
      const resposta = await fetch(
        `${config.supabaseUrl}/rest/v1/media_deletion_queue?id=eq.${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: cabecalhos,
          body: JSON.stringify({ processado_em: new Date().toISOString() }),
        },
      );
      if (!resposta.ok) {
        throw new Error(`Falha ao marcar item processado: HTTP ${String(resposta.status)}`);
      }
    },

    async marcarFalha(id, tentativas, erro) {
      const resposta = await fetch(
        `${config.supabaseUrl}/rest/v1/media_deletion_queue?id=eq.${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: cabecalhos,
          // `ultimo_erro` é truncado: é diagnóstico, não é para acumular um
          // stack trace inteiro numa coluna de texto lida por humano depois.
          body: JSON.stringify({ tentativas, ultimo_erro: erro.slice(0, 500) }),
        },
      );
      if (!resposta.ok) {
        throw new Error(`Falha ao marcar item com erro: HTTP ${String(resposta.status)}`);
      }
    },

    async marcarInvalido(id, erro) {
      const resposta = await fetch(
        `${config.supabaseUrl}/rest/v1/media_deletion_queue?id=eq.${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: cabecalhos,
          // A fila não tem coluna de estado: `processado_em` é o que tira o
          // item da listagem, e `ultimo_erro` diz que ele saiu SEM ser
          // apagado. `tentativas` fica como estava — não houve tentativa.
          body: JSON.stringify({ processado_em: new Date().toISOString(), ultimo_erro: erro }),
        },
      );
      if (!resposta.ok) {
        throw new Error(`Falha ao marcar item inválido: HTTP ${String(resposta.status)}`);
      }
    },
  };
}

/**
 * Quais caminhos o banco ainda referencia, nas três colunas que guardam anexo
 * (contrato § 8 e § 9.1). Usa a `service_role`: a varredura precisa ver TODAS
 * as linhas, não só as que a RLS de alguém liberaria.
 *
 * Qualquer resposta que não seja 2xx LANÇA — inclusive a tabela que ainda não
 * existe num banco anterior às migrations. Devolver "nenhuma referência" nesse
 * caso mandaria apagar anexos que têm dono. [#9]
 */
export function criarConsultaDeReferencias(config: ConfigDoRepositorio): ConsultaDeReferencias {
  const cabecalhos = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  };

  return {
    async caminhosReferenciados(caminhos) {
      const referenciados = new Set<string>();
      if (caminhos.length === 0) return referenciados;

      // Cada valor entre aspas: o `in.(...)` do PostgREST separa por vírgula,
      // e um valor sem aspas com vírgula ou parêntese mudaria a lista. [#52]
      const lista = `in.(${caminhos.map((c) => `"${c.replaceAll('"', '')}"`).join(',')})`;

      for (const { tabela, coluna } of REFERENCIAS_DE_ANEXO) {
        const parametros = new URLSearchParams({ select: coluna, [coluna]: lista });
        const resposta = await fetch(
          `${config.supabaseUrl}/rest/v1/${encodeURIComponent(tabela)}?${parametros.toString()}`,
          { headers: cabecalhos },
        );
        if (!resposta.ok) {
          throw new Error(`Falha ao consultar ${tabela}: HTTP ${String(resposta.status)}`);
        }

        const linhas = (await resposta.json()) as Record<string, unknown>[];
        for (const linha of linhas) {
          const valor = linha[coluna];
          if (typeof valor === 'string') referenciados.add(valor);
        }
      }

      return referenciados;
    },
  };
}
