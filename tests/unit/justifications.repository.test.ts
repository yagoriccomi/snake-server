import { describe, expect, it } from 'vitest';

import type { ClienteSupabase, UsuarioAutenticado } from '../../src/lib/supabase.js';
import { MIGRATIONS_DO_G4_EM_PRODUCAO } from '../../src/modules/justifications/justifications.constants.js';
import { criarRepositorioDeJustificativas } from '../../src/modules/justifications/justifications.repository.js';

/**
 * O repositório REAL do módulo justificativas, sobre um cliente Supabase
 * simulado. O que se prova aqui é QUE colunas cada leitura pede: antes do G4,
 * pedir `attempt` no `view-url` daria 502 a quem hoje lê o anexo (D27). [#45][#48]
 */

const JUSTIFICATIVA = '7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918';
const AUTORIZACAO = 'Bearer token-do-chamador';

interface Consulta {
  tabela: string;
  filtros: Record<string, string>;
  colunas: string;
  authorization: string;
}

function criarCliente(migrationsDoG4EmProducao: boolean) {
  const consultas: Consulta[] = [];

  const cliente: ClienteSupabase = {
    buscarUsuarioPeloToken(): Promise<UsuarioAutenticado | null> {
      throw new Error('O repositório de justificativas não deve resolver identidade.');
    },
    consultarComoChamador<T>(
      tabela: string,
      filtros: Record<string, string>,
      colunas: string,
      authorization: string,
    ): Promise<T[]> {
      consultas.push({ tabela, filtros, colunas, authorization });
      return Promise.resolve([]);
    },
    chamarRpcComoChamador<T>(): Promise<T | null> {
      throw new Error('O repositório de justificativas não chama RPC.');
    },
    confirmarPermissaoComoChamador(): Promise<boolean> {
      throw new Error('Estes testes não passam pela segunda barreira.');
    },
  };

  return {
    repositorio: criarRepositorioDeJustificativas(cliente, migrationsDoG4EmProducao),
    consultas,
  };
}

function colunasPedidas(consulta: Consulta | undefined): string[] {
  return consulta?.colunas.split(',') ?? [];
}

describe('criarRepositorioDeJustificativas — buscarPorId (view-url)', () => {
  it('deveNaoPedirAColunaAttemptAntesDasMigrationsDoG4', async () => {
    const { repositorio, consultas } = criarCliente(false);

    await repositorio.buscarPorId(JUSTIFICATIVA, AUTORIZACAO);

    expect(colunasPedidas(consultas[0])).toEqual([
      'id',
      'user_id',
      'class_id',
      'proof_provider',
      'proof_public_id',
    ]);
  });

  it('devePedirAColunaAttemptComAsMigrationsDoG4EmProducao', async () => {
    const { repositorio, consultas } = criarCliente(true);

    await repositorio.buscarPorId(JUSTIFICATIVA, AUTORIZACAO);

    expect(colunasPedidas(consultas[0])).toEqual([
      'id',
      'user_id',
      'class_id',
      'attempt',
      'proof_provider',
      'proof_public_id',
    ]);
  });

  it('deveConsultarALinhaPeloIdComOTokenDoChamador', async () => {
    const { repositorio, consultas } = criarCliente(false);

    await repositorio.buscarPorId(JUSTIFICATIVA, AUTORIZACAO);

    expect(consultas[0]).toMatchObject({
      tabela: 'absence_justifications',
      filtros: { id: `eq.${JUSTIFICATIVA}` },
      authorization: AUTORIZACAO,
    });
  });

  it('deveDevolverNuloQuandoARlsNaoLiberaALinha', async () => {
    const { repositorio } = criarCliente(false);

    expect(await repositorio.buscarPorId(JUSTIFICATIVA, AUTORIZACAO)).toBeNull();
  });
});

describe('criarRepositorioDeJustificativas — buscarParaAssinar (sign-upload novo)', () => {
  it.each([false, true])(
    'deveSemprePedirAttemptComOuSemOG4 (G4 em produção: %s)',
    async (migrationsDoG4EmProducao) => {
      // A forma `{ justificationId }` só é chamada pelo APK 2.0.0, que sai
      // depois do G4 (contrato § 13.6): ela não precisa ficar desligada.
      const { repositorio, consultas } = criarCliente(migrationsDoG4EmProducao);

      await repositorio.buscarParaAssinar(JUSTIFICATIVA, AUTORIZACAO);

      expect(colunasPedidas(consultas[0])).toContain('attempt');
    },
  );
});

describe('MIGRATIONS_DO_G4_EM_PRODUCAO', () => {
  it('deveFicarDesligadaAteODonoConfirmarOG4', () => {
    // Ligar é decisão registrada no ROADMAP (G4), no mesmo PR que troca este
    // valor e este teste. Mudar só a constante não passa.
    expect(MIGRATIONS_DO_G4_EM_PRODUCAO).toBe(false);
  });
});
