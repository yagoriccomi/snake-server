import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { montarDependencias, type DependenciasDaApi } from './composition-root.js';
import {
  LIMITE_CORPO_JSON,
  RATE_LIMIT_JANELA_MS,
  RATE_LIMIT_MAX_COMPROVANTES,
  RATE_LIMIT_MAX_REQUISICOES,
} from './config/constants.js';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestContext } from './middleware/request-context.js';
import { criarV1Router } from './routes/v1.js';

/**
 * Monta a aplicação Express.
 *
 * Separado do `server.ts` de propósito: os testes de integração levantam o app
 * em memória, sem abrir porta. E as dependências entram por parâmetro, então a
 * mesma montagem roda com Supabase e Cloudinary falsos. [#21][#42][#45]
 */
export function criarApp(deps: DependenciasDaApi = montarDependencias()): Express {
  const app = express();

  // A Render fica atrás de um proxy: sem isto, todo cliente parece ter o
  // mesmo IP e o rate limiting vira ou inútil ou um bloqueio coletivo.
  // O valor 1 confia em UM salto de proxy — confiar em mais permitiria ao
  // cliente forjar o IP de origem pelo X-Forwarded-For. [#58]
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
   * pediu para o app ter. Fica sem limite de propósito — o custo de um flood
   * aqui é desprezível, porque a rota não toca rede, disco nem banco. [#82]
   */
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Teto de payload: arquivos não passam por aqui, então 32kb é folga. [#65]
  app.use(express.json({ limit: LIMITE_CORPO_JSON }));

  /**
   * Rate limiting em DUAS camadas: um teto global e outro, mais apertado,
   * nas rotas que assinam credencial ou emitem URL de dado financeiro. [#58]
   *
   * ⚠️ LIMITAÇÃO CONHECIDA — armazenamento em memória.
   * Sem `store` configurado, o `express-rate-limit` conta em memória, e isso
   * tem duas consequências reais neste ambiente:
   *
   *   1. O plano free da Render HIBERNA após ~15 min sem tráfego. Ao acordar,
   *      o processo é novo e todos os contadores estão zerados — quem
   *      respeitar o intervalo de hibernação recupera a cota inteira.
   *   2. Com mais de uma instância, cada uma conta a própria cota, e o limite
   *      efetivo vira N × o configurado.
   *
   * Hoje isso é aceitável: há uma instância só e todo endpoint sob `/v1`
   * exige token válido do Supabase, então não existe superfície de força
   * bruta anônima. Ao sair do free tier ou escalar horizontalmente, migre
   * para um store compartilhado (Redis) — senão o limite é decorativo. [#27]
   */
  const limitadorGlobal = rateLimit({
    windowMs: RATE_LIMIT_JANELA_MS,
    max: RATE_LIMIT_MAX_REQUISICOES,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Tente de novo em instantes.', code: 'rate_limited' },
  });

  const limitadorDeComprovantes = rateLimit({
    windowMs: RATE_LIMIT_JANELA_MS,
    max: RATE_LIMIT_MAX_COMPROVANTES,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Tente de novo em instantes.', code: 'rate_limited' },
  });

  app.use(limitadorGlobal);
  app.use('/v1/proofs', limitadorDeComprovantes);

  app.use('/v1', criarV1Router(deps));

  // A ordem importa: 404 primeiro, handler de erro por último. [#93]
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
