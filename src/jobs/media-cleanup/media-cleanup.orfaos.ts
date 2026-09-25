/**
 * Varredura diária de órfãos (contrato § 13.3, item 4.5 do ROADMAP).
 *
 * Um anexo de motivo ou de justificativa é enviado à Cloudinary ANTES de a
 * linha que o referencia existir. Se o cliente cai entre as duas coisas, o
 * arquivo fica lá sem dono — e fora do alcance da fila, que só conhece o que
 * o banco enfileirou. Esta varredura acha esses arquivos e os apaga.
 *
 * Mesmo desenho do lote da fila: sem SDK, sem rede, dependências por contrato.
 * [#21][#30][#45]
 *
 * FALHA FECHADA: se a listagem ou a consulta ao banco falhar, a varredura
 * para sem apagar nada. "Não consegui ver a referência" nunca pode virar
 * "não há referência". [#9]
 */

import { logger } from '../../lib/logger.js';

import {
  FORMATO_DO_ASSET_NA_CLOUDINARY,
  IDADE_MINIMA_DO_ORFAO_MS,
  PASTAS_VARRIDAS,
  TAMANHO_DO_LOTE_DE_REFERENCIAS,
  TIPOS_DE_RECURSO_DOS_ANEXOS,
  type TipoDeRecurso,
} from './media-cleanup.constants.js';
import type { ExclusorDeMidia } from './media-cleanup.service.js';

export interface AssetListado {
  public_id: string;
  /** ISO 8601, como a Admin API da Cloudinary devolve. */
  created_at: string;
}

export interface PaginaDeAssets {
  assets: AssetListado[];
  /** `null` na última página. */
  proximoCursor: string | null;
}

/** Contrato de quem lista o que existe na Cloudinary. */
export interface ListadorDeMidia {
  listarAssets(
    prefixo: string,
    tipo: TipoDeRecurso,
    cursor: string | null,
  ): Promise<PaginaDeAssets>;
}

/** Contrato de quem sabe quais caminhos o banco ainda referencia. */
export interface ConsultaDeReferencias {
  /** Devolve, dentre os caminhos pedidos, os que têm linha. Lança se não conseguir saber. */
  caminhosReferenciados(caminhos: string[]): Promise<Set<string>>;
}

export interface DependenciasDaVarredura {
  midia: ExclusorDeMidia;
  acervo: ListadorDeMidia;
  referencias: ConsultaDeReferencias;
  /** Injetado para o teste congelar o tempo. */
  agoraEmMs: () => number;
}

export interface ResultadoDaVarredura {
  apagados: number;
  falhas: number;
  /** A varredura parou sem terminar: nada foi apagado depois do ponto da falha. */
  interrompida: boolean;
}

function dividirEmLotes<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    lotes.push(itens.slice(i, i + tamanho));
  }
  return lotes;
}

/**
 * Candidato a órfão: no formato do contrato (o mesmo que o worker exige para
 * apagar da fila) e com mais de 24 h. Data ilegível não é "velho o bastante".
 */
function ehCandidato(asset: AssetListado, limiteMs: number): boolean {
  if (!FORMATO_DO_ASSET_NA_CLOUDINARY.test(asset.public_id)) return false;
  const criadoEm = Date.parse(asset.created_at);
  return Number.isFinite(criadoEm) && criadoEm < limiteMs;
}

/** Apaga os candidatos de uma página que o banco não referencia. */
async function apagarOrfaosDaPagina(
  candidatos: string[],
  tipo: TipoDeRecurso,
  deps: DependenciasDaVarredura,
  resultado: ResultadoDaVarredura,
): Promise<void> {
  for (const lote of dividirEmLotes(candidatos, TAMANHO_DO_LOTE_DE_REFERENCIAS)) {
    const referenciados = await deps.referencias.caminhosReferenciados(lote);

    for (const caminho of lote.filter((c) => !referenciados.has(c))) {
      try {
        await deps.midia.apagarDaCloudinary(caminho, tipo);
        resultado.apagados += 1;
      } catch (causa) {
        // Um órfão que não apagou hoje é achado de novo amanhã: não trava os outros.
        resultado.falhas += 1;
        logger.warn('falha ao apagar anexo órfão', {
          tipo,
          erro: causa instanceof Error ? causa.message : 'desconhecido',
        });
      }
    }
  }
}

/**
 * Varre `justificativas/` e `motivos/` nos três tipos de recurso e apaga o
 * que tem mais de 24 h e nenhuma linha no banco. Nunca lança: a falha de
 * listagem ou de consulta interrompe a varredura e volta no resultado.
 */
export async function varrerOrfaos(deps: DependenciasDaVarredura): Promise<ResultadoDaVarredura> {
  const resultado: ResultadoDaVarredura = { apagados: 0, falhas: 0, interrompida: false };
  const limiteMs = deps.agoraEmMs() - IDADE_MINIMA_DO_ORFAO_MS;

  try {
    for (const pasta of PASTAS_VARRIDAS) {
      for (const tipo of TIPOS_DE_RECURSO_DOS_ANEXOS) {
        let cursor: string | null = null;
        do {
          const pagina = await deps.acervo.listarAssets(`${pasta}/`, tipo, cursor);
          const candidatos = pagina.assets
            .filter((asset) => ehCandidato(asset, limiteMs))
            .map((asset) => asset.public_id);
          await apagarOrfaosDaPagina(candidatos, tipo, deps, resultado);
          cursor = pagina.proximoCursor;
        } while (cursor !== null);
      }
    }
  } catch (causa) {
    // `warn`: nada foi apagado por engano e a próxima execução tenta de novo.
    // Num banco anterior às migrations da v3 (sem as tabelas novas), é aqui
    // que a varredura para, todo dia, até o esquema chegar. [#92]
    resultado.interrompida = true;
    logger.warn('varredura de órfãos interrompida sem apagar o restante', {
      erro: causa instanceof Error ? causa.message : 'desconhecido',
    });
  }

  return resultado;
}
