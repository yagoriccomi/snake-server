import { corpoJson, paginaDoDocumento, uuidObrigatorio } from '../../lib/esquemas.js';

/**
 * Validação de entrada do módulo. Nada vindo do cliente é usado antes de
 * passar por aqui. [#51]
 *
 * O `justificationId` é validado como UUID sempre: ele é interpolado num
 * filtro do PostgREST, e um valor arbitrário é uma porta aberta. [#51][#52]
 */

/**
 * Assinatura do upload (contrato § 13.2). A forma legada `{ classId }`, do APK
 * 1.8/1.9 e da web antiga, saiu na 2.0.0 (D42 revista) e é recusada ANTES
 * deste schema, com código próprio: ver `recusarAssinaturaLegada`.
 */
export const corpoDeAssinaturaDeJustificativa = corpoJson({
  justificationId: uuidObrigatorio('justificationId'),
});

export type CorpoDeAssinaturaDeJustificativa = typeof corpoDeAssinaturaDeJustificativa._output;

/**
 * Visualização do anexo. O teto de 999 páginas pelo mesmo motivo dos
 * comprovantes: sem ele, uma página inexistente seria renderizada (e cobrada)
 * pela Cloudinary a cada requisição. [#65]
 */
export const corpoDeVisualizacaoDeJustificativa = corpoJson({
  justificationId: uuidObrigatorio('justificationId'),
  pagina: paginaDoDocumento,
});

export type CorpoDeVisualizacaoDeJustificativa = typeof corpoDeVisualizacaoDeJustificativa._output;
