import { Router } from 'express';

import type { ClienteSupabase } from '../../lib/supabase.js';
import { criarRequireUser } from '../../middleware/require-user.js';
import { validarCorpo } from '../../middleware/validate.js';
import { criarMotivosController } from './motivos.controller.js';
import { corpoDeAssinaturaDeMotivo, corpoDeVisualizacaoDeMotivo } from './motivos.schema.js';
import { criarMotivosService, type DependenciasDeMotivos } from './motivos.service.js';

export interface DependenciasDoRouterDeMotivos extends DependenciasDeMotivos {
  supabase: ClienteSupabase;
}

/**
 * Monta o router do módulo a partir de dependências RECEBIDAS — factory, nunca
 * instância pronta. [#21][#45]
 *
 * Mesma ordem de middlewares dos outros módulos: `validarCorpo` antes de
 * `requireUser`, para entrada malformada não custar uma ida ao Supabase.
 */
export function criarMotivosRouter(deps: DependenciasDoRouterDeMotivos): Router {
  const service = criarMotivosService(deps);
  const controller = criarMotivosController(service);
  const requireUser = criarRequireUser(deps.supabase);

  const motivos = Router();

  motivos.post(
    '/sign-upload',
    validarCorpo(corpoDeAssinaturaDeMotivo),
    requireUser,
    controller.assinarUpload,
  );

  motivos.post(
    '/view-url',
    validarCorpo(corpoDeVisualizacaoDeMotivo),
    requireUser,
    controller.obterUrlDeVisualizacao,
  );

  return motivos;
}
