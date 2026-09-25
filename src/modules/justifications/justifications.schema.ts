import { z } from 'zod';

/**
 * Validação de entrada do módulo. Nada vindo do cliente é usado antes de
 * passar por aqui. [#51]
 *
 * Os ids são validados como UUID sempre: `justificationId` é interpolado num
 * filtro do PostgREST, e `classId` vira parte do caminho do arquivo na
 * Cloudinary. Um valor arbitrário, nos dois casos, é uma porta aberta. [#51][#52]
 */
function uuidObrigatorio(campo: string) {
  return z
    .string({ required_error: `${campo} é obrigatório` })
    .trim()
    .uuid(`${campo} precisa ser um UUID válido`);
}

/**
 * Assinatura do upload: EXATAMENTE uma de duas formas (contrato § 13.2).
 *
 *  - `{ classId }`: o legado do APK 1.8 e da web atual, que vale até a Fase B;
 *  - `{ justificationId }`: a forma nova, que confere a linha no banco.
 *
 * Os dois juntos, ou nenhum, é 400: adivinhar qual o cliente quis dizer
 * escolheria entre duas regras de autorização diferentes. O resultado já sai
 * separado nas duas formas, para o controller não reinterpretar o corpo.
 */
export const corpoDeAssinaturaDeJustificativa = z
  .object({
    classId: uuidObrigatorio('classId').optional(),
    justificationId: uuidObrigatorio('justificationId').optional(),
  })
  .transform((corpo, contexto) => {
    if (corpo.classId !== undefined && corpo.justificationId === undefined) {
      return { classId: corpo.classId };
    }
    if (corpo.justificationId !== undefined && corpo.classId === undefined) {
      return { justificationId: corpo.justificationId };
    }
    contexto.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Envie exatamente um: classId ou justificationId',
    });
    return z.NEVER;
  });

export type CorpoDeAssinaturaDeJustificativa = z.infer<typeof corpoDeAssinaturaDeJustificativa>;

/**
 * Visualização do anexo. O teto de 999 páginas pelo mesmo motivo dos
 * comprovantes: sem ele, uma página inexistente seria renderizada (e cobrada)
 * pela Cloudinary a cada requisição. [#65]
 */
export const corpoDeVisualizacaoDeJustificativa = z.object({
  justificationId: uuidObrigatorio('justificationId'),
  pagina: z.coerce.number().int().min(1).max(999).optional(),
});

export type CorpoDeVisualizacaoDeJustificativa = z.infer<typeof corpoDeVisualizacaoDeJustificativa>;
