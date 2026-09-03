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

export interface ItemDaFila {
  id: string;
  provider: 'cloudinary' | 'supabase_storage';
  asset_ref: string;
  tentativas: number;
}

/** Contrato de quem sabe apagar um asset em cada provedor. */
export interface ExclusorDeMidia {
  apagarDaCloudinary(publicId: string): Promise<void>;
  apagarDoStorage(caminho: string): Promise<void>;
}

/** Contrato de leitura/escrita da fila — a única camada que fala PostgREST. */
export interface RepositorioDaFila {
  listarPendentes(limite: number): Promise<ItemDaFila[]>;
  marcarProcessado(id: string): Promise<void>;
  marcarFalha(id: string, tentativas: number, erro: string): Promise<void>;
}

export interface DependenciasDoWorker {
  midia: ExclusorDeMidia;
  fila: RepositorioDaFila;
}

export interface ResultadoDoLote {
  processados: number;
  falhas: number;
}

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
 * Apaga UM item, seja qual for o provedor. Nunca lança: o chamador precisa
 * seguir para o próximo item do lote mesmo se este falhar — um asset preso
 * não pode travar a fila inteira. [#9]
 */
async function processarItem(item: ItemDaFila, deps: DependenciasDoWorker): Promise<boolean> {
  try {
    if (item.provider === 'cloudinary') {
      await deps.midia.apagarDaCloudinary(item.asset_ref);
    } else {
      await deps.midia.apagarDoStorage(item.asset_ref);
    }
    await deps.fila.marcarProcessado(item.id);
    return true;
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
    return false;
  }
}

/** Processa um lote da fila, um item de cada vez, sem parar no primeiro erro. */
export async function processarLote(
  deps: DependenciasDoWorker,
  limite: number,
): Promise<ResultadoDoLote> {
  const pendentes = await deps.fila.listarPendentes(limite);

  let processados = 0;
  let falhas = 0;

  for (const item of pendentes) {
    const sucesso = await processarItem(item, deps);
    if (sucesso) {
      processados += 1;
    } else {
      falhas += 1;
    }
  }

  return { processados, falhas };
}
