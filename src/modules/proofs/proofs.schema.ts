import type { z } from 'zod';

import { corpoJson, paginaDoDocumento, uuidObrigatorio } from '../../lib/esquemas.js';

/**
 * Validação de entrada do módulo. Nada vindo do cliente é usado antes
 * de passar por aqui. [#51]
 *
 * O `paymentId` é validado como UUID SEMPRE — inclusive na rota de
 * visualização. Ele é interpolado num filtro do PostgREST; um valor
 * arbitrário ali seria uma porta aberta para manipular a query. [#51][#52]
 */
export const corpoComPaymentId = corpoJson({
  paymentId: uuidObrigatorio('paymentId'),
});

export type CorpoComPaymentId = z.infer<typeof corpoComPaymentId>;

/**
 * Visualização: aceita a página do documento.
 *
 * O teto de 999 não é decoração — sem ele, `pagina: 99999999` faria a
 * Cloudinary renderizar (e cobrar) por uma página inexistente a cada
 * requisição. Entrada do cliente sempre com limite. [#51][#65]
 */
export const corpoDeVisualizacao = corpoComPaymentId.extend({
  pagina: paginaDoDocumento,
});

export type CorpoDeVisualizacao = z.infer<typeof corpoDeVisualizacao>;
