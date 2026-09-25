import type { RequestHandler } from 'express';

import { logger } from '../../lib/logger.js';
import { usuarioDaRequisicao } from '../../middleware/require-user.js';
import type {
  CorpoDeAssinaturaDeJustificativa,
  CorpoDeVisualizacaoDeJustificativa,
} from './justifications.schema.js';
import type { JustificationsService } from './justifications.service.js';

/**
 * Camada HTTP: traduz requisição em chamada de serviço e resultado em
 * resposta. Zero regra de negócio aqui. [#22]
 */
type HandlerDeAssinatura = RequestHandler<
  Record<string, never>,
  unknown,
  CorpoDeAssinaturaDeJustificativa
>;
type HandlerDeVisualizacao = RequestHandler<
  Record<string, never>,
  unknown,
  CorpoDeVisualizacaoDeJustificativa
>;

export function criarJustificationsController(service: JustificationsService) {
  /** POST /v1/justifications/sign-upload — `{ classId }` (legado) ou `{ justificationId }`. */
  const assinarUpload: HandlerDeAssinatura = async (req, res) => {
    const corpo = req.body;
    const { id: userId, authorization } = usuarioDaRequisicao(req);

    if ('classId' in corpo) {
      const assinatura = service.assinarUpload(userId, corpo.classId);
      logger.info('upload de anexo de justificativa assinado', {
        traceId: req.traceId,
        user_id: userId,
        class_id: corpo.classId,
      });
      res.json(assinatura);
      return;
    }

    const assinatura = await service.assinarUploadDaJustificativa(
      { userId, authorization, traceId: req.traceId },
      corpo.justificationId,
    );
    logger.info('upload de anexo de justificativa assinado', {
      traceId: req.traceId,
      user_id: userId,
      justification_id: corpo.justificationId,
    });
    res.json(assinatura);
  };

  /** POST /v1/justifications/view-url */
  const obterUrlDeVisualizacao: HandlerDeVisualizacao = async (req, res) => {
    const { justificationId, pagina } = req.body;
    const { id: userId, authorization } = usuarioDaRequisicao(req);

    const anexo = await service.obterUrlDeVisualizacao(
      justificationId,
      { userId, authorization, traceId: req.traceId },
      pagina,
    );

    logger.info('url de anexo de justificativa emitida', {
      traceId: req.traceId,
      user_id: userId,
      justification_id: justificationId,
      paginas: anexo.paginas,
    });

    // A URL assinada é o próprio segredo: vai na resposta, jamais no log.
    res.json(anexo);
  };

  return { assinarUpload, obterUrlDeVisualizacao };
}
