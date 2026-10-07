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
    podeAnexar(motivoId, authorization) {
      // Só o booleano do banco decide. Função ausente (banco antes do G3),
      // resposta fora do formato e queda viram 502, 503 ou 504 no cliente:
      // falha nunca se passa por "não pode" (contrato § 13.6). [#9]
      return supabase.confirmarPermissaoComoChamador(
        RPC_PODE_ANEXAR,
        { p_motivo_id: motivoId },
        authorization,
      );
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
