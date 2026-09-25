/**
 * Única camada que fala PostgREST sobre a `media_deletion_queue`. [#22]
 *
 * Usa `service_role`: essa fila está fechada para `authenticated` de
 * propósito (ver a migration do contrato) — ninguém além deste worker tem
 * negócio nela. [#55]
 */

import { MOTIVOS_DA_FILA, type MotivoDaFila } from './media-cleanup.constants.js';
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
