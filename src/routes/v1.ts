import { Router } from 'express';

import { proofs } from '../modules/proofs/proofs.routes.js';

/**
 * Registro dos módulos da API, todos sob `/v1`.
 *
 * Versionar desde o primeiro dia é o que permite uma quebra futura virar
 * `/v2` sem derrubar os apps já instalados na mão dos alunos. [#28]
 *
 * ── Como adicionar um módulo novo ────────────────────────────
 *  1. Crie `src/modules/<dominio>/` com routes/controller/service.
 *  2. Reuse `requireUser`; autorize dados pela RLS (repassando o token)
 *     ou, se o módulo exigir, por um segredo próprio vindo do env.
 *  3. Acrescente UMA linha aqui.
 *  4. Cadastre os segredos do módulo na Render (nunca no Git).
 *  5. Documente o contrato no README e no docs/BACKEND.md.
 * ─────────────────────────────────────────────────────────────
 */
export const v1 = Router();

v1.use('/proofs', proofs);

// v1.use('/notifications', notifications);   // futuro: push de vencimento
// v1.use('/reports', reports);               // futuro: inadimplência em PDF/CSV
// v1.use('/webhooks', webhooks);             // futuro: eventos de terceiros
