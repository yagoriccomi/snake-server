import type { ClienteSupabase } from '../../lib/supabase.js';
import {
  COLUNAS_DA_JUSTIFICATIVA,
  COLUNAS_DA_JUSTIFICATIVA_ANTES_DO_G4,
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
 *
 * `migrationsDoG4EmProducao` vem do composition root, e não da constante
 * importada aqui, para o teste provar os dois estados sem trocar módulo. [#45]
 */
export function criarRepositorioDeJustificativas(
  supabase: ClienteSupabase,
  migrationsDoG4EmProducao: boolean,
): LeitorDeJustificativas {
  const colunasDaJustificativa = migrationsDoG4EmProducao
    ? COLUNAS_DA_JUSTIFICATIVA
    : COLUNAS_DA_JUSTIFICATIVA_ANTES_DO_G4;

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
        colunasDaJustificativa,
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
