import { env } from './config/env.js';
import { criarClienteSupabase } from './lib/supabase.js';
import type { ClienteSupabase } from './lib/supabase.js';
import { MIGRATIONS_DO_G4_EM_PRODUCAO } from './modules/justifications/justifications.constants.js';
import { criarRepositorioDeJustificativas } from './modules/justifications/justifications.repository.js';
import type { DependenciasDoRouterDeJustificativas } from './modules/justifications/justifications.routes.js';
import { criarRepositorioDeMotivos } from './modules/motivos/motivos.repository.js';
import type { DependenciasDoRouterDeMotivos } from './modules/motivos/motivos.routes.js';
import { criarAssinadorCloudinary } from './modules/proofs/proofs.cloudinary.js';
import {
  criarConferenciaDeAdmin,
  criarRepositorioDePagamentos,
} from './modules/proofs/proofs.repository.js';
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
  justifications: DependenciasDoRouterDeJustificativas;
  motivos: DependenciasDoRouterDeMotivos;
}

/** Monta as dependências reais a partir da configuração validada. */
export function montarDependencias(): DependenciasDaApi {
  const supabase = criarClienteSupabase(env.supabase);
  // Um único adaptador de mídia para os três módulos: mesma conta, mesma
  // configuração. Duas instâncias só dariam a chance de divergirem.
  const midia = criarAssinadorCloudinary(env.cloudinary);
  const agoraEmSegundos = (): number => Math.round(Date.now() / 1000);
  // Uma só conferência de admin para comprovante e justificativa (§ 13.5).
  const admin = criarConferenciaDeAdmin(supabase);

  return {
    supabase,
    proofs: {
      supabase,
      midia,
      pagamentos: criarRepositorioDePagamentos(supabase),
      agoraEmSegundos,
      politicaDeAcesso: env.politicaDeAcessoAComprovante,
      admin,
    },
    justifications: {
      supabase,
      midia,
      justificativas: criarRepositorioDeJustificativas(supabase, MIGRATIONS_DO_G4_EM_PRODUCAO),
      admin,
      migrationsDoG4EmProducao: MIGRATIONS_DO_G4_EM_PRODUCAO,
      agoraEmSegundos,
    },
    motivos: {
      supabase,
      midia,
      motivos: criarRepositorioDeMotivos(supabase),
      agoraEmSegundos,
    },
  };
}
