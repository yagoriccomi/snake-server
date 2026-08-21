import { Router } from 'express';

import { assinarUpload, extrairPublicId, gerarUrlDeVisualizacao } from '../../lib/cloudinary.js';
import { consultarComoChamador } from '../../lib/supabase.js';
import { requireUser } from '../../middleware/require-user.js';
import { validarCorpo } from '../../middleware/validate.js';
import { criarProofsController } from './proofs.controller.js';
import { corpoComPaymentId } from './proofs.schema.js';
import {
  criarProofsService,
  type LeitorDePagamentos,
  type RegistroDePagamento,
} from './proofs.service.js';

const TABELA_PAGAMENTOS = 'payments';
const COLUNAS_DO_PAGAMENTO = 'user_id,proof_url';

/**
 * Composition root do módulo: é AQUI que as implementações concretas
 * (Cloudinary, PostgREST) encontram os contratos do serviço. Trocar de
 * provedor de mídia amanhã é trocar este objeto, não a regra. [#21]
 */
const pagamentos: LeitorDePagamentos = {
  async buscarPorId(paymentId, authorization) {
    const linhas = await consultarComoChamador<RegistroDePagamento>(
      TABELA_PAGAMENTOS,
      { id: `eq.${paymentId}` },
      COLUNAS_DO_PAGAMENTO,
      authorization,
    );
    return linhas[0] ?? null;
  },
};

const service = criarProofsService({
  midia: { assinarUpload, gerarUrlDeVisualizacao, extrairPublicId },
  pagamentos,
  agoraEmSegundos: () => Math.round(Date.now() / 1000),
});

const controller = criarProofsController(service);

export const proofs = Router();

/**
 * Ordem dos middlewares — ela é a regra de segurança, não detalhe:
 *   1. `validarCorpo`  rejeita entrada malformada SEM custar ida à rede.
 *   2. `requireUser`   valida o token no Supabase e injeta o usuário.
 *   3. controller      só roda com entrada sã e identidade verificada.
 *
 * `requireUser` está em TODAS as rotas do módulo: nenhuma escapa por
 * esquecimento — o que não for `/health` é autenticado.
 */
proofs.post('/sign-upload', validarCorpo(corpoComPaymentId), requireUser, controller.assinarUpload);

proofs.post(
  '/view-url',
  validarCorpo(corpoComPaymentId),
  requireUser,
  controller.obterUrlDeVisualizacao,
);
