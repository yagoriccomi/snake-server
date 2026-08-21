import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { ehHttpError, naoEncontrado } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';
import type { NivelDeLog } from '../lib/logger.js';

/**
 * Contrato de erro da API. Uma única forma, para todos os módulos:
 * o app trata `code`, o humano lê `error`, o suporte usa `traceId`.
 */
interface CorpoDeErro {
  error: string;
  code: string;
  traceId: string;
}

/** O que uma exceção vira, antes de qualquer efeito colateral. */
export interface ErroClassificado {
  status: number;
  code: string;
  /** Mensagem SEGURA para o cliente — nunca carrega detalhe interno. */
  mensagem: string;
  /**
   * Mensagem para o log, quando ela deve dizer mais que a do cliente.
   * "Erro interno" serve ao usuário; o operador precisa de "Erro não tratado".
   */
  mensagemDeLog?: string;
  nivel: NivelDeLog;
  /** Contexto extra só para o log do servidor. */
  contexto?: Record<string, unknown>;
}

/** Body-parser marca seus erros com `type`; é assim que os distinguimos. */
function tipoDoErroDeParse(erro: unknown): string | undefined {
  if (erro instanceof Error && 'type' in erro) {
    const { type } = erro as { type?: unknown };
    return typeof type === 'string' ? type : undefined;
  }
  return undefined;
}

/**
 * Decide o que uma exceção vira. Função PURA: sem `res`, sem log, sem efeito.
 *
 * Estava dissolvida em cinco blocos `if` que montavam a resposta cada um por
 * si — cinco lugares para esquecer o `traceId` ou vazar detalhe. Isolada,
 * a decisão é testável sem levantar Express. [#2][#6][#41]
 */
export function classificarErro(erro: unknown): ErroClassificado {
  if (ehHttpError(erro)) {
    return {
      status: erro.status,
      code: erro.code,
      mensagem: erro.message,
      // 4xx é o cliente errando: aviso, não falha nossa. [#92]
      nivel: erro.status >= 500 ? 'error' : 'warn',
      ...(erro.cause ? { contexto: { causa: erro.cause } } : {}),
    };
  }

  if (erro instanceof ZodError) {
    return {
      status: 400,
      code: 'bad_input',
      mensagem: 'Dados inválidos na requisição',
      mensagemDeLog: 'Entrada inválida',
      nivel: 'warn',
      contexto: { problemas: erro.issues },
    };
  }

  const tipoDeParse = tipoDoErroDeParse(erro);

  if (tipoDeParse === 'entity.parse.failed') {
    return { status: 400, code: 'malformed_json', mensagem: 'JSON inválido', nivel: 'warn' };
  }

  // Payload acima do limite configurado. [#65]
  if (tipoDeParse === 'entity.too.large') {
    return {
      status: 413,
      code: 'payload_too_large',
      mensagem: 'Corpo da requisição grande demais',
      nivel: 'warn',
    };
  }

  // Desconhecido: mensagem genérica para fora, erro inteiro para o log.
  return {
    status: 500,
    code: 'internal_error',
    mensagem: 'Erro interno',
    mensagemDeLog: 'Erro não tratado',
    nivel: 'error',
    contexto: { erro },
  };
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
  // Resposta já enviada (ex.: falha durante o streaming): delegar ao Express
  // evita "headers already sent" mascarando o erro real.
  if (res.headersSent) {
    logger.error('Erro após a resposta ter começado', { traceId: req.traceId, erro });
    return;
  }

  const { status, code, mensagem, mensagemDeLog, nivel, contexto } = classificarErro(erro);

  logger[nivel](mensagemDeLog ?? mensagem, {
    traceId: req.traceId,
    code,
    status,
    ...contexto,
  });

  const corpo: CorpoDeErro = { error: mensagem, code, traceId: req.traceId };
  res.status(status).json(corpo);
}
