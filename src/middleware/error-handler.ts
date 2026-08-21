import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { ehHttpError, naoEncontrado } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';

/**
 * Contrato de erro da API. Uma única forma, para todos os módulos:
 * o app trata `code`, o humano lê `error`.
 */
interface CorpoDeErro {
  error: string;
  code: string;
  traceId: string;
}

/** Rota inexistente — resposta no mesmo formato dos demais erros. */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(naoEncontrado('Rota não encontrada', 'route_not_found'));
}

/**
 * Handler global de erros — o ÚNICO lugar que transforma exceção em resposta. [#93]
 *
 * Regra inegociável: stack trace vai para o log do servidor, nunca para o
 * cliente. Um 500 vazando caminho de arquivo, versão de biblioteca ou trecho
 * de SQL é reconhecimento gratuito para quem estiver sondando a API.
 *
 * A assinatura precisa dos QUATRO parâmetros: é assim que o Express
 * identifica um error handler. O `_next` não é usado de propósito.
 */
export function errorHandler(
  erro: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Resposta já enviada (ex: erro durante o streaming): delegar ao Express
  // evita "headers already sent" mascarando o erro real.
  if (res.headersSent) {
    logger.error('Erro após a resposta ter começado', { traceId: req.traceId, erro });
    return;
  }

  if (ehHttpError(erro)) {
    // 4xx é o cliente errando: registrar como aviso, não como falha nossa. [#92]
    const nivel = erro.status >= 500 ? 'error' : 'warn';
    logger[nivel](erro.message, {
      traceId: req.traceId,
      code: erro.code,
      status: erro.status,
      ...(erro.cause ? { causa: erro.cause } : {}),
    });

    const corpo: CorpoDeErro = {
      error: erro.message,
      code: erro.code,
      traceId: req.traceId,
    };
    res.status(erro.status).json(corpo);
    return;
  }

  if (erro instanceof ZodError) {
    logger.warn('Entrada inválida', { traceId: req.traceId, problemas: erro.issues });
    const corpo: CorpoDeErro = {
      error: 'Dados inválidos na requisição',
      code: 'bad_input',
      traceId: req.traceId,
    };
    res.status(400).json(corpo);
    return;
  }

  // JSON malformado: o body-parser do Express marca o erro com `type`.
  if (
    erro instanceof SyntaxError &&
    'type' in erro &&
    (erro as { type?: unknown }).type === 'entity.parse.failed'
  ) {
    const corpo: CorpoDeErro = {
      error: 'JSON inválido',
      code: 'malformed_json',
      traceId: req.traceId,
    };
    res.status(400).json(corpo);
    return;
  }

  // Payload acima do limite configurado. [#65]
  if (
    erro instanceof Error &&
    'type' in erro &&
    (erro as { type?: unknown }).type === 'entity.too.large'
  ) {
    const corpo: CorpoDeErro = {
      error: 'Corpo da requisição grande demais',
      code: 'payload_too_large',
      traceId: req.traceId,
    };
    res.status(413).json(corpo);
    return;
  }

  // Desconhecido: log completo do lado de cá, mensagem genérica do lado de lá.
  logger.error('Erro não tratado', { traceId: req.traceId, erro });

  const corpo: CorpoDeErro = {
    error: 'Erro interno',
    code: 'internal_error',
    traceId: req.traceId,
  };
  res.status(500).json(corpo);
}
