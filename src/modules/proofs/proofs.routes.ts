import { Router } from 'express';

import type { ClienteSupabase } from '../../lib/supabase.js';
import { criarRequireUser } from '../../middleware/require-user.js';
import { validarCorpo } from '../../middleware/validate.js';
import { criarProofsController } from './proofs.controller.js';
import { corpoComPaymentId } from './proofs.schema.js';
import { criarProofsService, type DependenciasDeProofs } from './proofs.service.js';

export interface DependenciasDoRouterDeProofs extends DependenciasDeProofs {
  supabase: ClienteSupabase;
}

/**
 * Monta o router do módulo a partir de dependências RECEBIDAS.
 *
 * Antes, o service era instanciado no escopo do módulo: importar este arquivo
 * já amarrava Cloudinary e Supabase reais, e um teste de integração só
 * conseguia isolar interceptando o módulo. Como factory, o mesmo router sobe
 * com implementações falsas sem nenhum truque. [#21][#45]
 */
export function criarProofsRouter(deps: DependenciasDoRouterDeProofs): Router {
  const service = criarProofsService(deps);
  const controller = criarProofsController(service);
  const requireUser = criarRequireUser(deps.supabase);

  const proofs = Router();

  /**
   * Ordem dos middlewares — ela é a regra de segurança, não detalhe:
   *   1. `validarCorpo`  rejeita entrada malformada SEM custar ida à rede.
   *   2. `requireUser`   valida o token no Supabase e injeta o usuário.
   *   3. controller      só roda com entrada sã e identidade verificada.
   *
   * `requireUser` está em TODAS as rotas do módulo: nenhuma escapa por
   * esquecimento — o que não for `/health` é autenticado.
   */
  proofs.post(
    '/sign-upload',
    validarCorpo(corpoComPaymentId),
    requireUser,
    controller.assinarUpload,
  );

  proofs.post(
    '/view-url',
    validarCorpo(corpoComPaymentId),
    requireUser,
    controller.obterUrlDeVisualizacao,
  );

  return proofs;
}
