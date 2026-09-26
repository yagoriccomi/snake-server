/**
 * Constantes do domínio "justificativas de falta".
 *
 * O tipo de entrega privado e o provedor NÃO são redefinidos aqui: vêm do
 * módulo de comprovantes, que é onde mora a decisão "mídia de aluno é sempre
 * privada". Duas cópias dessa decisão acabariam divergindo. [#6]
 */

/** Raiz das pastas de anexo de justificativa na Cloudinary. O `userId` verificado é anexado a ela. */
export const PASTA_JUSTIFICATIVAS = 'justificativas';

/** Tabela lida via PostgREST, com a RLS decidindo o acesso. */
export const TABELA_JUSTIFICATIVAS = 'absence_justifications';

/**
 * Leitura do `view-url` (contrato § 13.2). `id`, `user_id` e `class_id` entram
 * porque os caminhos possíveis do anexo são DERIVADOS deles; o
 * `proof_public_id` gravado só escolhe entre esses caminhos. Ver o service.
 *
 * `attempt` só existe depois das migrations da v3: num banco antigo esta
 * leitura é recusada e o `view-url` responde 403 até as migrations rodarem.
 * Decisão do dono em 25/09 (seguir o contrato como está).
 */
export const COLUNAS_DA_JUSTIFICATIVA =
  'id,user_id,class_id,attempt,proof_provider,proof_public_id';

/**
 * Leitura do `sign-upload` com `{ justificationId }` (contrato § 13.2): o
 * suficiente para conferir dono, estado e anexo, e escolher o nome do
 * arquivo pela tentativa.
 */
export const COLUNAS_PARA_ASSINAR_JUSTIFICATIVA = 'id,user_id,status,attempt,proof_public_id';

/** Único estado em que a justificativa aceita anexo novo. */
export const STATUS_PENDENTE = 'pending';

/** A segunda tentativa (reenvio, D42) grava o anexo com este sufixo no nome. */
export const SUFIXO_DA_SEGUNDA_TENTATIVA = '-2';
