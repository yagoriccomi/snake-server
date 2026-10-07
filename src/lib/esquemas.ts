import { z, type ZodRawShape } from 'zod';

/**
 * Peças de validação comuns às rotas. O 400 `bad_input` responde com a frase
 * do primeiro problema (contrato § 13.6), então TODO problema possível de um
 * campo precisa de frase própria em português — inclusive o tipo errado, que
 * sem isso sairia na frase padrão do zod, em inglês. [#1][#51]
 */

/** Teto da página do documento: sem ele, a Cloudinary renderiza (e cobra) páginas que não existem. [#65] */
export const PAGINA_MAXIMA = 999;

const MENSAGEM_DA_PAGINA = `pagina precisa estar entre 1 e ${PAGINA_MAXIMA}`;

/** O corpo é uma lista ou outro valor que não um objeto. */
const MENSAGEM_DO_CORPO = 'O corpo precisa ser um objeto JSON';

/** O corpo da requisição: um objeto com os campos da rota. */
export function corpoJson<T extends ZodRawShape>(campos: T) {
  return z.object(campos, { invalid_type_error: MENSAGEM_DO_CORPO });
}

/**
 * Um id obrigatório. Ausente é "obrigatório"; de outro tipo ou fora do
 * formato, "precisa ser um UUID válido" — para o aluno, os dois são o mesmo
 * erro de digitação.
 */
export function uuidObrigatorio(campo: string) {
  const formatoInvalido = `${campo} precisa ser um UUID válido`;
  return z
    .string({ required_error: `${campo} é obrigatório`, invalid_type_error: formatoInvalido })
    .trim()
    .uuid(formatoInvalido);
}

/** A página do documento, de 1 a 999; texto numérico é aceito, como antes. */
export const paginaDoDocumento = z.coerce
  .number({ invalid_type_error: MENSAGEM_DA_PAGINA })
  .int(MENSAGEM_DA_PAGINA)
  .min(1, MENSAGEM_DA_PAGINA)
  .max(PAGINA_MAXIMA, MENSAGEM_DA_PAGINA)
  .optional();
