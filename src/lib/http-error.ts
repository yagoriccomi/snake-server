/**
 * Erro de aplicação com contrato HTTP explícito.
 *
 * Todo erro que o cliente pode ver nasce aqui. `classificarErro` traduz isto
 * em `{ error, code, traceId }` com o status certo; qualquer outra exceção
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

/*
 * Nota: `requisicaoInvalida` (400) foi removida — a validação de entrada é
 * inteiramente do Zod, que `classificarErro` já traduz em 400 `bad_input`.
 * Um atalho sem nenhum chamador é código morto, não conveniência. [#12]
 * Se um módulo futuro precisar de um 400 fora do Zod, `new HttpError(400, ...)`
 * resolve sem reintroduzir a duplicata.
 */
