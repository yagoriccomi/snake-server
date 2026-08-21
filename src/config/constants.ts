/**
 * Constantes da APLICAÇÃO — o que vale para o servidor inteiro.
 * Nenhum número solto no código: todo limite tem nome e justificativa. [#3]
 *
 * Constantes de um domínio específico moram no módulo dele
 * (ex.: `modules/proofs/proofs.constants.ts`), não aqui. [#13]
 */

/**
 * Teto do corpo JSON aceito. Arquivos NÃO passam por este servidor
 * (o app envia direto para a Cloudinary), então qualquer payload maior
 * que isso é abuso, não uso legítimo. Protege contra esgotamento de memória. [#65]
 */
export const LIMITE_CORPO_JSON = '32kb';

/** Janela e teto do rate limiting GLOBAL por IP. [#58] */
export const RATE_LIMIT_JANELA_MS = 60_000;
export const RATE_LIMIT_MAX_REQUISICOES = 60;

/**
 * Teto mais apertado para as rotas que assinam credencial ou emitem URL de
 * dado financeiro. Um uso legítimo do app envia um comprovante por vez, com
 * intervalo humano entre eles; dezenas por minuto no mesmo IP é varredura,
 * não aluno. Camada extra sobre o limite global. [#55][#58]
 */
export const RATE_LIMIT_MAX_COMPROVANTES = 20;

/**
 * Timeout das chamadas de saída (Supabase, Cloudinary).
 * Curto de propósito: o cold start é do NOSSO servidor, não dos terceiros —
 * uma dependência lenta não pode segurar a requisição do app indefinidamente.
 */
export const TIMEOUT_REQUISICAO_EXTERNA_MS = 10_000;

/** Prazo para conexões em voo terminarem antes de o processo morrer (SIGTERM da Render). */
export const TIMEOUT_SHUTDOWN_MS = 10_000;
