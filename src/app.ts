import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import {
  LIMITE_CORPO_JSON,
  RATE_LIMIT_JANELA_MS,
  RATE_LIMIT_MAX_REQUISICOES,
} from './config/constants.js';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestContext } from './middleware/request-context.js';
import { v1 } from './routes/v1.js';

/**
 * Monta a aplicação Express. Separado do `server.ts` de propósito: assim os
 * testes de integração levantam o app em memória, sem abrir porta. [#42]
 */
export function criarApp(): Express {
  const app = express();

  // A Render fica atrás de um proxy: sem isto, todo cliente parece ter o
  // mesmo IP e o rate limiting vira ou inútil ou um bloqueio coletivo. [#58]
  app.set('trust proxy', 1);

  // Não anunciar o framework — reconhecimento gratuito para quem sonda.
  app.disable('x-powered-by');

  app.use(requestContext);

  // Headers de segurança (HSTS, noSniff, frameguard...). [#59]
  app.use(helmet());

  // CORS restrito: o app nativo não precisa, então a lista nasce vazia e
  // só abre para as origens explicitamente cadastradas. [#57]
  app.use(
    cors({
      origin: env.origensPermitidas.length > 0 ? env.origensPermitidas : false,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      maxAge: 86_400,
    }),
  );

  /**
   * `/health` vem ANTES do rate limiter e do parser de JSON, e não faz I/O.
   *
   * Ele tem dois clientes legítimos e frequentes: o health check da Render e
   * o pré-aquecimento do app (que o chama para acordar o servidor hibernado).
   * Contá-los no rate limit puniria exatamente o comportamento que a gente
   * pediu para o app ter. [#82]
   */
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Teto de payload: arquivos não passam por aqui, então 32kb é folga. [#65]
  app.use(express.json({ limit: LIMITE_CORPO_JSON }));

  app.use(
    rateLimit({
      windowMs: RATE_LIMIT_JANELA_MS,
      max: RATE_LIMIT_MAX_REQUISICOES,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Muitas requisições. Tente de novo em instantes.', code: 'rate_limited' },
    }),
  );

  app.use('/v1', v1);

  // A ordem importa: 404 primeiro, handler de erro por último. [#93]
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
