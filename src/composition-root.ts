import { env } from './config/env.js';
import { criarClienteSupabase } from './lib/supabase.js';
import type { ClienteSupabase } from './lib/supabase.js';
import { criarAssinadorCloudinary } from './modules/proofs/proofs.cloudinary.js';
import { criarRepositorioDePagamentos } from './modules/proofs/proofs.repository.js';
import type { DependenciasDoRouterDeProofs } from './modules/proofs/proofs.routes.js';

/**
 * Composition root: o ÚNICO ponto da aplicação que conhece implementações
 * concretas. Todo o resto conversa por interfaces. [#20][#21][#30]
 *
 * Concentrar a montagem aqui é o que permite `criarApp(deps)` receber um
 * conjunto inteiramente falso nos testes — sem interceptar módulo, sem
 * variável de ambiente de mentira, sem rede. [#45]
 */

export interface DependenciasDaApi {
  supabase: ClienteSupabase;
  proofs: DependenciasDoRouterDeProofs;
}

/** Monta as dependências reais a partir da configuração validada. */
export function montarDependencias(): DependenciasDaApi {
  const supabase = criarClienteSupabase(env.supabase);

  return {
    supabase,
    proofs: {
      supabase,
      midia: criarAssinadorCloudinary(env.cloudinary),
      pagamentos: criarRepositorioDePagamentos(supabase),
      agoraEmSegundos: () => Math.round(Date.now() / 1000),
      politicaDeAcesso: env.politicaDeAcessoAComprovante,
    },
  };
}
