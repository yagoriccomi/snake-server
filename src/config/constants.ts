/**
 * Constantes de configuração do servidor.
 * Nenhum número solto no código — todo limite tem nome e justificativa. [#3]
 */

/**
 * Teto do corpo JSON aceito. Arquivos NÃO passam por este servidor
 * (o app envia direto para a Cloudinary), então qualquer payload maior
 * que isso é abuso, não uso legítimo. Protege contra esgotamento de memória. [#65]
 */
export const LIMITE_CORPO_JSON = '32kb';

/** Janela e teto do rate limiting por IP. [#58] */
export const RATE_LIMIT_JANELA_MS = 60_000;
export const RATE_LIMIT_MAX_REQUISICOES = 60;

/**
 * Timeout das chamadas de saída (Supabase, Cloudinary).
 * Curto de propósito: o cold start é do NOSSO servidor, não dos terceiros —
 * uma dependência lenta não pode segurar a requisição do app indefinidamente.
 */
export const TIMEOUT_REQUISICAO_EXTERNA_MS = 10_000;

/** Prazo para conexões em voo terminarem antes de o processo morrer (SIGTERM da Render). */
export const TIMEOUT_SHUTDOWN_MS = 10_000;

/** Raiz das pastas de comprovante na Cloudinary. O `userId` verificado é anexado a ela. */
export const PASTA_COMPROVANTES = 'comprovantes';

/** Tipo de entrega da Cloudinary: `authenticated` = privado, só por URL assinada. */
export const TIPO_ENTREGA_PRIVADO = 'authenticated';
