/**
 * Erro de aplicação com contrato HTTP explícito.
 *
 * Todo erro que o cliente pode ver nasce aqui. O handler global traduz
 * isto em `{ error, code }` com o status certo; qualquer outra exceção
 * vira 500 genérico, sem stack trace. [#93]
 */
export class HttpError extends Error {
  readonly status: number;

  /** Código estável, legível por máquina. O app decide o que fazer por ele. */
  readonly code: string;

  constructor(status: number, code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    Error.captureStackTrace?.(this, HttpError);
  }
}

/** Entrada malformada ou ausente. Falha do chamador, não do servidor. [#51] */
export const requisicaoInvalida = (mensagem: string, code = 'bad_input'): HttpError =>
  new HttpError(400, code, mensagem);

/** Sem token, ou token que o Supabase não reconhece. */
export const naoAutenticado = (mensagem = 'Não autenticado', code = 'no_token'): HttpError =>
  new HttpError(401, code, mensagem);

/**
 * Autenticado, mas sem direito ao recurso.
 * A mensagem é deliberadamente vaga: distinguir "não existe" de "não é seu"
 * entrega ao atacante um oráculo de enumeração. [#55]
 */
export const semAcesso = (mensagem = 'Sem acesso', code = 'forbidden'): HttpError =>
  new HttpError(403, code, mensagem);

export const naoEncontrado = (mensagem = 'Recurso não encontrado', code = 'not_found'): HttpError =>
  new HttpError(404, code, mensagem);

/** Dependência externa (Supabase, Cloudinary) fora do ar ou lenta demais. */
export const dependenciaIndisponivel = (
  mensagem = 'Serviço temporariamente indisponível',
  code = 'upstream_unavailable',
  options?: { cause?: unknown },
): HttpError => new HttpError(503, code, mensagem, options);

export function ehHttpError(valor: unknown): valor is HttpError {
  return valor instanceof HttpError;
}
