import type { ClienteSupabase } from '../../lib/supabase.js';
import {
  COLUNAS_DA_JUSTIFICATIVA,
  COLUNAS_PARA_ASSINAR_JUSTIFICATIVA,
  TABELA_JUSTIFICATIVAS,
} from './justifications.constants.js';
import type {
  JustificativaParaAssinar,
  LeitorDeJustificativas,
  RegistroDeJustificativa,
} from './justifications.service.js';

/**
 * Única camada que sabe QUE tabela guarda a justificativa e COMO consultá-la. [#22]
 *
 * Não há decisão de permissão aqui: a consulta vai com o token do chamador e a
 * RLS filtra. Lista vazia significa "a RLS não liberou" (ou, num banco antigo,
 * que uma coluna pedida ainda não existe) — quem interpreta isso é o service.
 */
export function criarRepositorioDeJustificativas(
  supabase: ClienteSupabase,
): LeitorDeJustificativas {
  async function buscar<T>(justificationId: string, colunas: string, authorization: string) {
    const linhas = await supabase.consultarComoChamador<T>(
      TABELA_JUSTIFICATIVAS,
      { id: `eq.${justificationId}` },
      colunas,
      authorization,
    );

    return linhas[0] ?? null;
  }

  return {
    buscarPorId(justificationId, authorization) {
      return buscar<RegistroDeJustificativa>(
        justificationId,
        COLUNAS_DA_JUSTIFICATIVA,
        authorization,
      );
    },

    buscarParaAssinar(justificationId, authorization) {
      return buscar<JustificativaParaAssinar>(
        justificationId,
        COLUNAS_PARA_ASSINAR_JUSTIFICATIVA,
        authorization,
      );
    },
  };
}
