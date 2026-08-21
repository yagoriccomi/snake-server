import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { logger } from '../lib/logger.js';

const HEADER_TRACE = 'x-request-id';

/**
 * Dá a cada requisição um identificador único e o devolve no header.
 *
 * Sem isso, investigar um erro relatado pelo usuário é procurar agulha no
 * palheiro: com ele, um único id amarra todos os logs daquela chamada —
 * inclusive os das dependências externas. [#94]
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const recebido = req.header(HEADER_TRACE);
  // Aceitar um id vindo do cliente ajuda a correlacionar com o log do app,
  // mas ele é só um rótulo: nada de decisão de segurança depende dele.
  req.traceId = recebido && recebido.length <= 64 ? recebido : randomUUID();
  res.setHeader(HEADER_TRACE, req.traceId);

  const inicio = process.hrtime.bigint();

  res.on('finish', () => {
    const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1_000_000;

    // 5xx é falha nossa; 4xx é comportamento esperado do cliente. [#92]
    const nivel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[nivel]('requisição concluída', {
      traceId: req.traceId,
      metodo: req.method,
      // `originalUrl` traria a query string — que pode carregar identificadores.
      rota: req.baseUrl + req.path,
      status: res.statusCode,
      duracaoMs: Math.round(duracaoMs),
    });
  });

  next();
}
