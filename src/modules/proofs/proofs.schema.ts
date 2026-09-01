import { z } from 'zod';

/**
 * Validação de entrada do módulo. Nada vindo do cliente é usado antes
 * de passar por aqui. [#51]
 *
 * O `paymentId` é validado como UUID SEMPRE — inclusive na rota de
 * visualização. Ele é interpolado num filtro do PostgREST; um valor
 * arbitrário ali seria uma porta aberta para manipular a query. [#51][#52]
 */
export const corpoComPaymentId = z.object({
  paymentId: z
    .string({ required_error: 'paymentId é obrigatório' })
    .trim()
    .uuid('paymentId precisa ser um UUID válido'),
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
  pagina: z.coerce.number().int().min(1).max(999).optional(),
});

export type CorpoDeVisualizacao = z.infer<typeof corpoDeVisualizacao>;
