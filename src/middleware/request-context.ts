import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { logger } from '../lib/logger.js';

const HEADER_TRACE = 'x-request-id';

/**
 * Formato aceito para um id vindo do cliente: só o que serve como
 * identificador de correlação. Restringir o alfabeto impede que texto
 * arbitrário seja ecoado de volta num header de resposta. [#51]
 */
const TRACE_DO_CLIENTE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Dá a cada requisição um identificador único e o devolve no header.
 *
 * Sem isso, investigar um erro relatado pelo usuário é procurar agulha no
 * palheiro: com ele, um único id amarra todos os logs daquela chamada —
 * inclusive os das dependências externas. [#94]
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  // O servidor SEMPRE gera o próprio id. Ele é a fonte da verdade da
  // correlação e nada que venha do cliente pode substituí-lo: dois
  // chamadores podiam mandar o mesmo valor e embaralhar a investigação
  // de um incidente — exatamente quando ela mais importa.
  req.traceId = randomUUID();
  res.setHeader(HEADER_TRACE, req.traceId);

  // O id do cliente é registrado à parte, como DADO, para permitir amarrar
  // o log do app ao log do servidor. Ele nunca vira a identidade da
  // requisição nem é ecoado de volta.
  const recebido = req.header(HEADER_TRACE);
  if (recebido && TRACE_DO_CLIENTE.test(recebido)) {
    req.traceIdDoCliente = recebido;
  }

  const inicio = process.hrtime.bigint();

  res.on('finish', () => {
    const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1_000_000;

    // 5xx é falha nossa; 4xx é comportamento esperado do cliente. [#92]
    const nivel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[nivel]('requisição concluída', {
      traceId: req.traceId,
      ...(req.traceIdDoCliente ? { traceIdDoCliente: req.traceIdDoCliente } : {}),
      metodo: req.method,
      // `originalUrl` traria a query string — que pode carregar identificadores.
      rota: req.baseUrl + req.path,
      status: res.statusCode,
      duracaoMs: Math.round(duracaoMs),
    });
  });

  next();
}
