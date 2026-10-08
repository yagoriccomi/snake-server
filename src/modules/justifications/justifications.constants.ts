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
 * As migrations do G4 (contrato § 14: `attempt`, do 4.1, e
 * `pode_decidir_justificativa`, do 4.8) já estão em produção?
 *
 * O servidor vai ao ar antes delas. Pedir uma coluna que o banco ainda não tem
 * dá 502 a quem hoje lê o anexo pela RLS (contrato § 13.6, D27). Uma constante,
 * e não uma variável de ambiente, porque ligar é um passo de código revisado,
 * no mesmo PR que confere o G4, e não um campo esquecido no painel. [#3][#84]
 */
export const MIGRATIONS_DO_G4_EM_PRODUCAO = false;

/**
 * Leitura do `view-url` (contrato § 13.2). `id`, `user_id` e `class_id` entram
 * porque os caminhos possíveis do anexo são DERIVADOS deles; o
 * `proof_public_id` gravado só escolhe entre esses caminhos. Ver o service.
 */
export const COLUNAS_DA_JUSTIFICATIVA =
  'id,user_id,class_id,attempt,proof_provider,proof_public_id';

/**
 * A mesma leitura antes do G4, sem `attempt`. O `view-url` não usa a coluna
 * (ela não entra nos caminhos derivados), então desligar é só não pedi-la.
 */
export const COLUNAS_DA_JUSTIFICATIVA_ANTES_DO_G4 =
  'id,user_id,class_id,proof_provider,proof_public_id';

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

/**
 * Segunda barreira (contrato § 13.5): a mesma função que a RLS usa para
 * liberar a justificativa pendente a quem pode decidi-la (§ 9.1). Devolve
 * `false` para a linha já decidida — depois da decisão, só dono e admin leem.
 */
export const RPC_PODE_DECIDIR_JUSTIFICATIVA = 'pode_decidir_justificativa';
