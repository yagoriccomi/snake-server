/**
 * A regra do worker de eliminação (LGPD art. 15, I; art. 18, VI).
 *
 * Sem SDK, sem rede, sem Express — recebe as dependências prontas e devolve
 * um resultado puro. Mesmo desenho do `proofs.service.ts`: o que é testável
 * sem contêiner sobe primeiro sem contêiner. [#21][#30][#45]
 *
 * ESCOPO DELIBERADAMENTE LIMITADO: este worker consome o que já está na
 * fila — os itens que os gatilhos do banco e `eliminar_comprovantes_do_titular`
 * já enfileiraram (conta excluída, comprovante recusado, migração de provedor).
 *
 * Ele NÃO decide sozinho o que entra na fila por tempo de retenção
 * (`motivo = 'retencao_expirada'`). Isso depende de um prazo em dias que é
 * decisão de negócio — falta o número. Enquanto ele não vier, este worker
 * processa o que existe e não inventa um prazo. Ver P-11 em `docs/PENDENCIAS.md`.
 */

import { logger } from '../../lib/logger.js';
import { PASTA_COMPROVANTES } from '../../modules/proofs/proofs.constants.js';

import {
  ERRO_PREFIXO_INVALIDO,
  FORMATO_DO_ASSET_NA_CLOUDINARY,
  PASTAS_ACEITAS_POR_MOTIVO,
  TIPOS_DE_RECURSO_DO_COMPROVANTE,
  TIPOS_DE_RECURSO_DOS_ANEXOS,
  type MotivoDaFila,
  type TipoDeRecurso,
} from './media-cleanup.constants.js';

export interface ItemDaFila {
  id: string;
  provider: 'cloudinary' | 'supabase_storage';
  asset_ref: string;
  motivo: MotivoDaFila;
  tentativas: number;
}

/**
 * O que a Cloudinary respondeu a um `destroy` bem-sucedido. Qualquer outra
 * resposta é falha, e o adaptador lança.
 */
export type ResultadoDaExclusao = 'apagado' | 'inexistente';

/** Contrato de quem sabe apagar um asset em cada provedor. */
export interface ExclusorDeMidia {
  apagarDaCloudinary(publicId: string, tipo: TipoDeRecurso): Promise<ResultadoDaExclusao>;
  apagarDoStorage(caminho: string): Promise<void>;
}

/** Contrato de leitura/escrita da fila — a única camada que fala PostgREST. */
export interface RepositorioDaFila {
  listarPendentes(limite: number): Promise<ItemDaFila[]>;
  marcarProcessado(id: string): Promise<void>;
  marcarFalha(id: string, tentativas: number, erro: string): Promise<void>;
  /** Fecha o item sem apagar e sem nova tentativa, com o motivo em `ultimo_erro`. */
  marcarInvalido(id: string, erro: string): Promise<void>;
}

export interface DependenciasDoWorker {
  midia: ExclusorDeMidia;
  fila: RepositorioDaFila;
}

export interface ResultadoDoLote {
  processados: number;
  falhas: number;
  /** Itens fechados sem apagar porque o caminho não passou na validação. */
  recusados: number;
}

type DesfechoDoItem = 'processado' | 'falha' | 'recusado';

/**
 * Depois de quantas tentativas o erro vira alarme (`error`) em vez de aviso
 * (`warn`). Não abandonamos o item — abandonar silenciosamente seria voltar a
 * ter uma promessa de exclusão da LGPD que não se cumpre, só que agora
 * escondida atrás de um worker "funcionando". O item continua na fila, e o
 * alarme sobe de nível para alguém notar. [#92]
 */
const TENTATIVAS_PARA_ALARME = 5;

/** Normaliza qualquer coisa lançada para uma mensagem de log. */
function mensagemDeErro(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa);
}

/**
 * O worker apaga com `service_role`, fora da RLS: o `asset_ref` precisa provar
 * que aponta para onde o motivo diz, antes de qualquer chamada ao provedor.
 * Na Cloudinary, o formato do contrato e a pasta do motivo; no Storage (só o
 * legado dos comprovantes), nenhum `..` que suba de pasta. [#51][#55]
 */
function caminhoEhValido(item: ItemDaFila): boolean {
  if (item.provider === 'supabase_storage') {
    return !item.asset_ref.includes('..');
  }

  const pasta = FORMATO_DO_ASSET_NA_CLOUDINARY.exec(item.asset_ref)?.[1];
  if (pasta === undefined) return false;
  return PASTAS_ACEITAS_POR_MOTIVO[item.motivo].includes(pasta);
}

/**
 * Caminho recusado é terminal: tentar de novo não o torna legítimo, e deixar o
 * item aberto o traria de volta, na frente da fila, em toda execução. `error`
 * porque ninguém além dos gatilhos do banco escreve nesta fila — um caminho
 * fora do formato é sinal de adulteração ou de esquema divergente. O caminho
 * não vai para o log: carrega o id do titular. [#63][#92]
 */
async function recusarItem(item: ItemDaFila, deps: DependenciasDoWorker): Promise<void> {
  await deps.fila.marcarInvalido(item.id, ERRO_PREFIXO_INVALIDO);
  logger.error('item da fila de eliminação recusado: caminho fora do contrato', {
    itemId: item.id,
    provider: item.provider,
    motivo: item.motivo,
  });
}

/**
 * Um "não encontrado" num tipo só não prova nada: o arquivo pode estar
 * guardado como outro tipo. O item só conclui quando um tipo apaga ou quando
 * todos os tipos da pasta respondem que não há arquivo. Falha em qualquer um
 * sobe como exceção, e o item volta para nova tentativa. [#9]
 */
async function apagarNaCloudinary(assetRef: string, deps: DependenciasDoWorker): Promise<void> {
  const tipos = assetRef.startsWith(`${PASTA_COMPROVANTES}/`)
    ? TIPOS_DE_RECURSO_DO_COMPROVANTE
    : TIPOS_DE_RECURSO_DOS_ANEXOS;

  for (const tipo of tipos) {
    const resultado = await deps.midia.apagarDaCloudinary(assetRef, tipo);
    if (resultado === 'apagado') return;
  }
}

/**
 * Apaga UM item, seja qual for o provedor. Nunca lança: o chamador precisa
 * seguir para o próximo item do lote mesmo se este falhar — um asset preso
 * não pode travar a fila inteira. [#9]
 */
async function processarItem(
  item: ItemDaFila,
  deps: DependenciasDoWorker,
): Promise<DesfechoDoItem> {
  try {
    if (!caminhoEhValido(item)) {
      await recusarItem(item, deps);
      return 'recusado';
    }

    if (item.provider === 'cloudinary') {
      await apagarNaCloudinary(item.asset_ref, deps);
    } else {
      await deps.midia.apagarDoStorage(item.asset_ref);
    }
    await deps.fila.marcarProcessado(item.id);
    return 'processado';
  } catch (causa) {
    const erro = mensagemDeErro(causa);
    const tentativas = item.tentativas + 1;
    await deps.fila.marcarFalha(item.id, tentativas, erro);

    const contexto = { itemId: item.id, provider: item.provider, tentativas, erro };
    if (tentativas >= TENTATIVAS_PARA_ALARME) {
      logger.error('item da fila de eliminação falhando repetidamente', contexto);
    } else {
      logger.warn('falha ao processar item da fila de eliminação', contexto);
    }
    return 'falha';
  }
}

/** Processa um lote da fila, um item de cada vez, sem parar no primeiro erro. */
export async function processarLote(
  deps: DependenciasDoWorker,
  limite: number,
): Promise<ResultadoDoLote> {
  const pendentes = await deps.fila.listarPendentes(limite);

  const resultado: ResultadoDoLote = { processados: 0, falhas: 0, recusados: 0 };

  for (const item of pendentes) {
    const desfecho = await processarItem(item, deps);
    if (desfecho === 'processado') resultado.processados += 1;
    if (desfecho === 'falha') resultado.falhas += 1;
    if (desfecho === 'recusado') resultado.recusados += 1;
  }

  return resultado;
}
