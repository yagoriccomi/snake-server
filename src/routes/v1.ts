import { Router } from 'express';

import type { DependenciasDaApi } from '../composition-root.js';
import { criarProofsRouter } from '../modules/proofs/proofs.routes.js';

/**
 * Registro dos módulos da API, todos sob `/v1`.
 *
 * Versionar desde o primeiro dia é o que permite uma quebra futura virar
 * `/v2` sem derrubar os apps já instalados na mão dos alunos. [#28]
 *
 * ── Como adicionar um módulo novo ────────────────────────────
 *  1. Crie `src/modules/<dominio>/` com routes/controller/service/schema.
 *  2. Exponha `criar<Dominio>Router(deps)` — factory, nunca instância pronta.
 *  3. Acrescente as dependências dele em `composition-root.ts`.
 *  4. Acrescente UMA linha aqui.
 *  5. Cadastre os segredos do módulo na Render (nunca no Git).
 *  6. Documente o contrato no README e no docs/BACKEND.md.
 * ─────────────────────────────────────────────────────────────
 */
export function criarV1Router(deps: DependenciasDaApi): Router {
  const v1 = Router();

  v1.use('/proofs', criarProofsRouter(deps.proofs));

  // v1.use('/notifications', criarNotificationsRouter(deps.notifications));
  // v1.use('/reports', criarReportsRouter(deps.reports));

  return v1;
}
