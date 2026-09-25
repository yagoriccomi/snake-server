import { z } from 'zod';

/**
 * Validação de entrada do módulo. Nada vindo do cliente é usado antes de
 * passar por aqui. [#51]
 *
 * Os ids são UUID sempre: `motivoId` vai para a RPC, `anexoId` vira o nome do
 * arquivo na Cloudinary e o filtro do PostgREST. Um valor arbitrário, em
 * qualquer um dos três, é uma porta aberta. [#51][#52]
 */
export const corpoDeAssinaturaDeMotivo = z.object({
  motivoId: z
    .string({ required_error: 'motivoId é obrigatório' })
    .trim()
    .uuid('motivoId precisa ser um UUID válido'),
  anexoId: z
    .string({ required_error: 'anexoId é obrigatório' })
    .trim()
    .uuid('anexoId precisa ser um UUID válido'),
});

export type CorpoDeAssinaturaDeMotivo = z.infer<typeof corpoDeAssinaturaDeMotivo>;

/** Visualização do anexo. Teto de 999 páginas, pelo mesmo motivo dos comprovantes. [#65] */
export const corpoDeVisualizacaoDeMotivo = z.object({
  anexoId: z
    .string({ required_error: 'anexoId é obrigatório' })
    .trim()
    .uuid('anexoId precisa ser um UUID válido'),
  pagina: z.coerce.number().int().min(1).max(999).optional(),
});

export type CorpoDeVisualizacaoDeMotivo = z.infer<typeof corpoDeVisualizacaoDeMotivo>;
