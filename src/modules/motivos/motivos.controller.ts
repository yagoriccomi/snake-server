import type { RequestHandler } from 'express';

import { logger } from '../../lib/logger.js';
import { usuarioDaRequisicao } from '../../middleware/require-user.js';
import type { CorpoDeAssinaturaDeMotivo, CorpoDeVisualizacaoDeMotivo } from './motivos.schema.js';
import type { MotivosService } from './motivos.service.js';

/**
 * Camada HTTP: traduz requisição em chamada de serviço e resultado em
 * resposta. Zero regra de negócio aqui. [#22]
 */
type HandlerDeAssinatura = RequestHandler<
  Record<string, never>,
  unknown,
  CorpoDeAssinaturaDeMotivo
>;
type HandlerDeVisualizacao = RequestHandler<
  Record<string, never>,
  unknown,
  CorpoDeVisualizacaoDeMotivo
>;

export function criarMotivosController(service: MotivosService) {
  /** POST /v1/motivos/sign-upload */
  const assinarUpload: HandlerDeAssinatura = async (req, res) => {
    const { motivoId, anexoId } = req.body;
    const { id: userId, authorization } = usuarioDaRequisicao(req);

    const assinatura = await service.assinarUpload(
      { userId, authorization, traceId: req.traceId },
      motivoId,
      anexoId,
    );

    logger.info('upload de anexo de motivo assinado', {
      traceId: req.traceId,
      user_id: userId,
      motivo_id: motivoId,
      anexo_id: anexoId,
    });

    res.json(assinatura);
  };

  /** POST /v1/motivos/view-url */
  const obterUrlDeVisualizacao: HandlerDeVisualizacao = async (req, res) => {
    const { anexoId, pagina } = req.body;
    const { id: userId, authorization } = usuarioDaRequisicao(req);

    const anexo = await service.obterUrlDeVisualizacao(
      anexoId,
      { userId, authorization, traceId: req.traceId },
      pagina,
    );

    logger.info('url de anexo de motivo emitida', {
      traceId: req.traceId,
      user_id: userId,
      anexo_id: anexoId,
      paginas: anexo.paginas,
    });

    // A URL assinada é o próprio segredo: vai na resposta, jamais no log.
    res.json(anexo);
  };

  return { assinarUpload, obterUrlDeVisualizacao };
}
