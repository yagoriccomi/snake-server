import type { RequestHandler } from 'express';

import { logger } from '../../lib/logger.js';
import { usuarioDaRequisicao } from '../../middleware/require-user.js';
import type { CorpoComPaymentId, CorpoDeVisualizacao } from './proofs.schema.js';
import type { ProofsService } from './proofs.service.js';

/**
 * Camada HTTP: traduz requisição em chamada de serviço e resultado em
 * resposta. Zero regra de negócio aqui. [#22]
 *
 * O corpo chega já validado pelo `validarCorpo` — o genérico do
 * `RequestHandler` carrega esse tipo até aqui, então nada de cast.
 */
type HandlerComPaymentId = RequestHandler<Record<string, never>, unknown, CorpoComPaymentId>;
type HandlerDeVisualizacao = RequestHandler<Record<string, never>, unknown, CorpoDeVisualizacao>;

export function criarProofsController(service: ProofsService) {
  /** POST /v1/proofs/sign-upload */
  const assinarUpload: HandlerComPaymentId = (req, res) => {
    const { paymentId } = req.body;
    const { id: userId } = usuarioDaRequisicao(req);

    const assinatura = service.assinarUpload(userId, paymentId);

    logger.info('upload de comprovante assinado', {
      traceId: req.traceId,
      user_id: userId,
      payment_id: paymentId,
    });

    res.json(assinatura);
  };

  /** POST /v1/proofs/view-url */
  const obterUrlDeVisualizacao: HandlerDeVisualizacao = async (req, res) => {
    const { paymentId, pagina } = req.body;
    const { id: userId, authorization } = usuarioDaRequisicao(req);

    const comprovante = await service.obterUrlDeVisualizacao(
      paymentId,
      { userId, authorization, traceId: req.traceId },
      pagina,
    );

    logger.info('url de comprovante emitida', {
      traceId: req.traceId,
      user_id: userId,
      payment_id: paymentId,
      paginas: comprovante.paginas,
    });

    // A URL assinada é o próprio segredo: vai na resposta, jamais no log.
    res.json(comprovante);
  };

  return { assinarUpload, obterUrlDeVisualizacao };
}
