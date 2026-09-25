/**
 * Constantes do worker de eliminação — nomes e formatos do contrato
 * (`snake-thai/docs/CONTRATO.md`, § 13.3). Copiados, não inventados: quem muda
 * um valor daqui muda antes o contrato. [#3][#13]
 */

import { PASTA_JUSTIFICATIVAS } from '../../modules/justifications/justifications.constants.js';
import { PASTA_MOTIVOS } from '../../modules/motivos/motivos.constants.js';
import { PASTA_COMPROVANTES } from '../../modules/proofs/proofs.constants.js';

/** Valores de `media_deletion_reason` que este worker sabe tratar. */
export const MOTIVOS_DA_FILA = [
  'comprovante_recusado',
  'migrado_de_provedor',
  'retencao_expirada',
  'justificativa_removida',
  'anexo_de_motivo_removido',
  'anexo_expirado',
  'conta_excluida',
] as const;

export type MotivoDaFila = (typeof MOTIVOS_DA_FILA)[number];

/**
 * Único formato de `asset_ref` que o worker aceita apagar na Cloudinary:
 * `<pasta>/<uuid do dono>/<uuid do registro>`, com o `-2` da segunda tentativa
 * da justificativa. Sem segmento a mais, sem `..`, sem pasta fora da lista —
 * um valor forjado na fila não alcança o arquivo de outra pasta. [#51][#55]
 */
export const FORMATO_DO_ASSET_NA_CLOUDINARY =
  /^(comprovantes|justificativas|motivos)\/[0-9a-f-]{36}\/[0-9a-f-]{36}(-2)?$/;

/**
 * A pasta que cada motivo pode apagar. Um item de "comprovante recusado"
 * apontando para `justificativas/` não é engano inofensivo: é o sinal de que
 * alguém escreveu na fila o que o gatilho não escreveria.
 */
export const PASTAS_ACEITAS_POR_MOTIVO: Record<MotivoDaFila, readonly string[]> = {
  comprovante_recusado: [PASTA_COMPROVANTES],
  migrado_de_provedor: [PASTA_COMPROVANTES],
  retencao_expirada: [PASTA_COMPROVANTES],
  justificativa_removida: [PASTA_JUSTIFICATIVAS],
  anexo_de_motivo_removido: [PASTA_MOTIVOS],
  anexo_expirado: [PASTA_JUSTIFICATIVAS, PASTA_MOTIVOS],
  conta_excluida: [PASTA_COMPROVANTES, PASTA_JUSTIFICATIVAS, PASTA_MOTIVOS],
};

/**
 * O que vai em `ultimo_erro` quando o caminho não passa na validação. O item
 * é fechado sem apagar e sem nova tentativa: tentar de novo um caminho
 * forjado não o torna legítimo.
 */
export const ERRO_PREFIXO_INVALIDO = 'prefixo_invalido';

/** Tipos de recurso da Cloudinary (identificadores do protocolo, não traduzidos). */
export type TipoDeRecurso = 'image' | 'raw' | 'video';

/**
 * O comprovante sempre foi enviado como imagem e continua como está. Os
 * anexos de motivo e de justificativa aceitam PDF, que a Cloudinary pode
 * guardar como `raw`; o `destroy` no tipo errado responde "not found", igual a
 * um arquivo que não existe. Por isso os anexos tentam os três, nesta ordem,
 * e só o "not found" nos três prova que não há o que apagar (contrato § 13.3).
 */
export const TIPOS_DE_RECURSO_DO_COMPROVANTE: readonly TipoDeRecurso[] = ['image'];
export const TIPOS_DE_RECURSO_DOS_ANEXOS: readonly TipoDeRecurso[] = ['image', 'raw', 'video'];
