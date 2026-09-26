import type { ClienteSupabase } from '../../lib/supabase.js';
import {
  COLUNAS_DO_ANEXO_DE_MOTIVO,
  RPC_PODE_ANEXAR,
  TABELA_ANEXOS_DE_MOTIVO,
} from './motivos.constants.js';
import type { RegistroDeAnexoDeMotivo, RepositorioDeMotivos } from './motivos.service.js';

/**
 * Única camada que sabe QUE tabela e QUE função guardam os anexos de motivo. [#22]
 *
 * Tudo vai com o token do chamador: a RPC e a RLS decidem. Não há permissão
 * decidida aqui — só a tradução do que o banco respondeu.
 */
export function criarRepositorioDeMotivos(supabase: ClienteSupabase): RepositorioDeMotivos {
  return {
    async podeAnexar(motivoId, authorization) {
      const resposta = await supabase.chamarRpcComoChamador<unknown>(
        RPC_PODE_ANEXAR,
        { p_motivo_id: motivoId },
        authorization,
      );

      // Só o booleano `true` libera. `null` (recusa, banco antigo sem a
      // função) e qualquer outro formato de resposta negam. [#9]
      return resposta === true;
    },

    async buscarAnexo(anexoId, authorization) {
      const linhas = await supabase.consultarComoChamador<RegistroDeAnexoDeMotivo>(
        TABELA_ANEXOS_DE_MOTIVO,
        { id: `eq.${anexoId}` },
        COLUNAS_DO_ANEXO_DE_MOTIVO,
        authorization,
      );

      return linhas[0] ?? null;
    },
  };
}
