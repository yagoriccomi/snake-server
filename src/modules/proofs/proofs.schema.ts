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
