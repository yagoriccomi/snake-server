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
 * `class_id` entra na projeção porque o caminho do anexo é DERIVADO do par
 * (user_id, class_id) — nunca lido de `proof_public_id`. Ver o service.
 */
export const COLUNAS_DA_JUSTIFICATIVA = 'user_id,class_id,proof_provider,proof_public_id';
