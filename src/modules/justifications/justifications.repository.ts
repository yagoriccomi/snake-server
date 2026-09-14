import type { ClienteSupabase } from '../../lib/supabase.js';
import { COLUNAS_DA_JUSTIFICATIVA, TABELA_JUSTIFICATIVAS } from './justifications.constants.js';
import type { LeitorDeJustificativas, RegistroDeJustificativa } from './justifications.service.js';

/**
 * Única camada que sabe QUE tabela guarda a justificativa e COMO consultá-la. [#22]
 *
 * Não há decisão de permissão aqui: a consulta vai com o token do chamador e a
 * RLS filtra. Lista vazia significa "a RLS não liberou" — quem interpreta isso
 * é o service.
 */
export function criarRepositorioDeJustificativas(
  supabase: ClienteSupabase,
): LeitorDeJustificativas {
  return {
    async buscarPorId(justificationId, authorization) {
      const linhas = await supabase.consultarComoChamador<RegistroDeJustificativa>(
        TABELA_JUSTIFICATIVAS,
        { id: `eq.${justificationId}` },
        COLUNAS_DA_JUSTIFICATIVA,
        authorization,
      );

      return linhas[0] ?? null;
    },
  };
}
