import type { ClienteSupabase } from '../../lib/supabase.js';
import { COLUNAS_DO_PAGAMENTO, TABELA_PAGAMENTOS } from './proofs.constants.js';
import type { LeitorDePagamentos, RegistroDePagamento } from './proofs.service.js';

/**
 * Única camada que sabe QUE tabela guarda o pagamento e COMO consultá-la. [#22]
 *
 * Estava embutida no arquivo de rotas — acesso a dados disfarçado de
 * transporte. Separado, o service continua sem saber que existe PostgREST,
 * e trocar a origem do dado não toca em regra de negócio. [#20]
 *
 * Não há decisão de permissão aqui: a consulta vai com o token do chamador e
 * a RLS filtra. Lista vazia significa "a RLS não liberou" — quem interpreta
 * isso é o service.
 */
export function criarRepositorioDePagamentos(supabase: ClienteSupabase): LeitorDePagamentos {
  return {
    async buscarPorId(paymentId, authorization) {
      const linhas = await supabase.consultarComoChamador<RegistroDePagamento>(
        TABELA_PAGAMENTOS,
        { id: `eq.${paymentId}` },
        COLUNAS_DO_PAGAMENTO,
        authorization,
      );

      return linhas[0] ?? null;
    },
  };
}
