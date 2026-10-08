import type { RequestHandler } from 'express';

import { formaRetirada } from '../../lib/http-error.js';
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

/**
 * A forma `{ classId }` do `sign-upload`, do APK 1.8/1.9, saiu na 2.0.0 (D42
 * revista). Quem ainda a manda recebe 410 com código próprio, e não o 400 do
 * schema: o corpo está certo para o app antigo, e só atualizar o app resolve.
 *
 * Vem antes do `validarCorpo` e do `requireUser`: a recusa não depende de quem
 * pede, e não deve custar uma ida ao Supabase.
 */
export const recusarAssinaturaLegada: RequestHandler = (req, _res, next) => {
  const corpo: unknown = req.body;
  if (typeof corpo === 'object' && corpo !== null && 'classId' in corpo) {
    next(
      formaRetirada(
        'Atualize o aplicativo para enviar o anexo da justificativa',
        'legacy_upload_removed',
      ),
    );
    return;
  }
  next();
};

export function criarJustificationsController(service: JustificationsService) {
  /** POST /v1/justifications/sign-upload — `{ justificationId }`. */
  const assinarUpload: HandlerDeAssinatura = async (req, res) => {
    const { justificationId } = req.body;
    const { id: userId, authorization } = usuarioDaRequisicao(req);

    const assinatura = await service.assinarUploadDaJustificativa(
      { userId, authorization, traceId: req.traceId },
      justificationId,
    );
    logger.info('upload de anexo de justificativa assinado', {
      traceId: req.traceId,
      user_id: userId,
      justification_id: justificationId,
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
