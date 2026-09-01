import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { naoAutenticado } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';
import type { ClienteSupabase } from '../lib/supabase.js';

const PREFIXO_BEARER = /^Bearer\s+\S+$/i;

/**
 * Middleware de autenticação herdado por TODO módulo.
 *
 * Valida o token uma única vez, na borda, e injeta o usuário na requisição.
 * Nenhum controller precisa saber como a identidade é verificada — e nenhum
 * módulo novo pode esquecer de verificá-la, porque a rota não sobe sem ele. [#13]
 *
 * Recebe o cliente do Supabase por injeção em vez de importá-lo: é isso que
 * permite testar o middleware com um cliente falso, sem rede. [#21][#45]
 *
 * O Express 5 propaga rejeições de handlers async para o error handler
 * automaticamente; por isso confiar no `throw` aqui é seguro. [#93]
 */
export function criarRequireUser(supabase: ClienteSupabase): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const authorization = req.header('authorization');

    if (!authorization) {
      next(naoAutenticado('Não autenticado', 'no_token'));
      return;
    }

    if (!PREFIXO_BEARER.test(authorization)) {
      next(naoAutenticado('Formato de token inválido', 'bad_token_format'));
      return;
    }

    const usuario = await supabase.buscarUsuarioPeloToken(authorization);

    if (!usuario) {
      logger.warn('Token recusado pelo Supabase', { traceId: req.traceId });
      next(naoAutenticado('Sessão inválida', 'bad_token'));
      return;
    }

    req.usuario = usuario;
    req.authorizationHeader = authorization;

    next();
  };
}

/**
 * Recupera o usuário já autenticado.
 * Se estourar, é bug de montagem de rota (faltou o `requireUser` antes) —
 * e é melhor falhar alto no desenvolvimento do que servir dado errado.
 */
export function usuarioDaRequisicao(req: Request): { id: string; authorization: string } {
  const { usuario, authorizationHeader } = req;

  if (!usuario || !authorizationHeader) {
    throw new Error('requireUser não foi aplicado a esta rota');
  }

  return { id: usuario.id, authorization: authorizationHeader };
}
