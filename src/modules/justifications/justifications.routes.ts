import { Router } from 'express';

import type { ClienteSupabase } from '../../lib/supabase.js';
import { criarRequireUser } from '../../middleware/require-user.js';
import { validarCorpo } from '../../middleware/validate.js';
import { criarJustificationsController } from './justifications.controller.js';
import {
  corpoDeAssinaturaDeJustificativa,
  corpoDeVisualizacaoDeJustificativa,
} from './justifications.schema.js';
import {
  criarJustificationsService,
  type DependenciasDeJustificativas,
} from './justifications.service.js';

export interface DependenciasDoRouterDeJustificativas extends DependenciasDeJustificativas {
  supabase: ClienteSupabase;
}

/**
 * Monta o router do módulo a partir de dependências RECEBIDAS — factory, nunca
 * instância pronta. [#21][#45]
 *
 * Mesma ordem de middlewares dos comprovantes, pela mesma razão:
 * `validarCorpo` antes de `requireUser`, para entrada malformada não custar
 * uma ida ao Supabase.
 */
export function criarJustificationsRouter(deps: DependenciasDoRouterDeJustificativas): Router {
  const service = criarJustificationsService(deps);
  const controller = criarJustificationsController(service);
  const requireUser = criarRequireUser(deps.supabase);

  const justifications = Router();

  justifications.post(
    '/sign-upload',
    validarCorpo(corpoDeAssinaturaDeJustificativa),
    requireUser,
    controller.assinarUpload,
  );

  justifications.post(
    '/view-url',
    validarCorpo(corpoDeVisualizacaoDeJustificativa),
    requireUser,
    controller.obterUrlDeVisualizacao,
  );

  return justifications;
}
