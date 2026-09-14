import { z } from 'zod';

/**
 * Validação de entrada do módulo. Nada vindo do cliente é usado antes de
 * passar por aqui. [#51]
 *
 * Os ids são validados como UUID sempre: `justificationId` é interpolado num
 * filtro do PostgREST, e `classId` vira parte do caminho do arquivo na
 * Cloudinary. Um valor arbitrário, nos dois casos, é uma porta aberta. [#51][#52]
 */
export const corpoComClassId = z.object({
  classId: z
    .string({ required_error: 'classId é obrigatório' })
    .trim()
    .uuid('classId precisa ser um UUID válido'),
});

export type CorpoComClassId = z.infer<typeof corpoComClassId>;

/**
 * Visualização do anexo. O teto de 999 páginas pelo mesmo motivo dos
 * comprovantes: sem ele, uma página inexistente seria renderizada (e cobrada)
 * pela Cloudinary a cada requisição. [#65]
 */
export const corpoDeVisualizacaoDeJustificativa = z.object({
  justificationId: z
    .string({ required_error: 'justificationId é obrigatório' })
    .trim()
    .uuid('justificationId precisa ser um UUID válido'),
  pagina: z.coerce.number().int().min(1).max(999).optional(),
});

export type CorpoDeVisualizacaoDeJustificativa = z.infer<typeof corpoDeVisualizacaoDeJustificativa>;
