import type { z } from 'zod';

import { corpoJson, paginaDoDocumento, uuidObrigatorio } from '../../lib/esquemas.js';

/**
 * Validação de entrada do módulo. Nada vindo do cliente é usado antes de
 * passar por aqui. [#51]
 *
 * Os ids são UUID sempre: `motivoId` vai para a RPC, `anexoId` vira o nome do
 * arquivo na Cloudinary e o filtro do PostgREST. Um valor arbitrário, em
 * qualquer um dos três, é uma porta aberta. [#51][#52]
 */
export const corpoDeAssinaturaDeMotivo = corpoJson({
  motivoId: uuidObrigatorio('motivoId'),
  anexoId: uuidObrigatorio('anexoId'),
});

export type CorpoDeAssinaturaDeMotivo = z.infer<typeof corpoDeAssinaturaDeMotivo>;

/** Visualização do anexo. Teto de 999 páginas, pelo mesmo motivo dos comprovantes. [#65] */
export const corpoDeVisualizacaoDeMotivo = corpoJson({
  anexoId: uuidObrigatorio('anexoId'),
  pagina: paginaDoDocumento,
});

export type CorpoDeVisualizacaoDeMotivo = z.infer<typeof corpoDeVisualizacaoDeMotivo>;
