import type { NextFunction, Request, Response } from 'express';

import { naoAutenticado } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';
import { buscarUsuarioPeloToken } from '../lib/supabase.js';

const PREFIXO_BEARER = /^Bearer\s+\S+$/i;

/**
 * Middleware de autenticação herdado por TODO módulo.
 *
 * Valida o token uma única vez, na borda, e injeta o usuário na requisição.
 * Nenhum controller precisa saber como a identidade é verificada — e nenhum
 * módulo novo pode esquecer de verificá-la, porque a rota não sobe sem ele. [#13]
 *
 * O Express 5 propaga rejeições de handlers async para o error handler
 * automaticamente; por isso o `throw` aqui é seguro. [#93]
 */
export async function requireUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authorization = req.header('authorization');

  if (!authorization) {
    return next(naoAutenticado('Não autenticado', 'no_token'));
  }

  if (!PREFIXO_BEARER.test(authorization)) {
    return next(naoAutenticado('Formato de token inválido', 'bad_token_format'));
  }

  const usuario = await buscarUsuarioPeloToken(authorization);

  if (!usuario) {
    logger.warn('Token recusado pelo Supabase', { traceId: req.traceId });
    return next(naoAutenticado('Sessão inválida', 'bad_token'));
  }

  req.usuario = usuario;
  req.authorizationHeader = authorization;

  next();
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
