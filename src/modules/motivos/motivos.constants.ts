/**
 * Constantes do domínio "anexos de motivo" (contrato § 13.1). Os valores são
 * nomes de fronteira com o banco do `snake-thai`: copiados do contrato, não
 * escolhidos aqui. [#3][#13]
 *
 * O tipo de entrega privado, o provedor e os formatos aceitos vêm do módulo de
 * comprovantes, onde mora a decisão "mídia de aluno" que os três módulos
 * compartilham. [#6]
 */

/** Raiz das pastas de anexo de motivo na Cloudinary. O `userId` verificado é anexado a ela. */
export const PASTA_MOTIVOS = 'motivos';

/** Tabela lida via PostgREST, com a RLS decidindo o acesso. */
export const TABELA_ANEXOS_DE_MOTIVO = 'action_reason_attachments';

/**
 * `uploaded_by` e `id` entram porque o caminho do anexo é DERIVADO deles; o
 * `public_id` gravado nunca é a fonte do caminho (achado C-2).
 */
export const COLUNAS_DO_ANEXO_DE_MOTIVO = 'id,uploaded_by,provider,public_id';

/** Única RPC que este módulo chama, antes de assinar o upload. */
export const RPC_PODE_ANEXAR = 'pode_anexar_ao_motivo';
