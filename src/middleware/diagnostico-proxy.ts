import type { NextFunction, Request, Response } from 'express';

import { logger } from '../lib/logger.js';

const HEADER_ENCAMINHADO_PARA = 'x-forwarded-for';

/**
 * Quantos saltos de proxy o `X-Forwarded-For` declara. Entradas vazias não
 * contam: um `, ,` não é um proxy a mais.
 */
export function contarEntradasEncaminhadas(valor: string | undefined): number {
  if (!valor) return 0;
  return valor.split(',').filter((entrada) => entrada.trim() !== '').length;
}

/**
 * TEMPORÁRIO (decisão D7 do dono, 29/09). Sai assim que houver a evidência:
 * plano de retirada em `docs/planos/PLANO-diagnostico-trust-proxy.md`.
 *
 * O limite de taxa não enxerga o IP do cliente (achado da auditoria 5.7), e
 * subir o `trust proxy` às cegas abre a falsificação pelo `X-Forwarded-For`.
 * Antes de mexer, é preciso saber quantas entradas chegam de verdade. Por
 * isso o log leva só a CONTAGEM: o endereço é dado pessoal e nunca entra. [#58][#63]
 */
export function diagnosticoDeProxy(req: Request, _res: Response, next: NextFunction): void {
  logger.info('diagnóstico do proxy', {
    traceId: req.traceId,
    entradasNoXForwardedFor: contarEntradasEncaminhadas(req.header(HEADER_ENCAMINHADO_PARA)),
  });
  next();
}
