import { describe, expect, it } from 'vitest';

import type { ClienteSupabase, UsuarioAutenticado } from '../../src/lib/supabase.js';
import { criarRepositorioDeJustificativas } from '../../src/modules/justifications/justifications.repository.js';
import { criarConferenciaDeAdmin } from '../../src/modules/proofs/proofs.repository.js';

/**
 * As duas RPCs da segunda barreira (contrato § 13.5), pelos repositórios
 * REAIS sobre um cliente Supabase simulado. O que se prova: o nome e o corpo
 * de cada chamada, o token de quem pede e que só o booleano `true` libera —
 * a barreira nunca abre por recusa, função ausente ou formato estranho. [#45][#55]
 */

const JUSTIFICATIVA = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const AUTORIZACAO = 'Bearer token-de-quem-pede';

interface ChamadaDeRpc {
  funcao: string;
  argumentos: Record<string, unknown>;
  authorization: string;
}

function criarCliente(respostaDaRpc: unknown, falha?: Error) {
  const rpcs: ChamadaDeRpc[] = [];

  const cliente: ClienteSupabase = {
    buscarUsuarioPeloToken(): Promise<UsuarioAutenticado | null> {
      throw new Error('A barreira não resolve identidade.');
    },
    consultarComoChamador<T>(): Promise<T[]> {
      throw new Error('A barreira não lê tabela.');
    },
    chamarRpcComoChamador<T>(
      funcao: string,
      argumentos: Record<string, unknown>,
      authorization: string,
    ): Promise<T | null> {
      rpcs.push({ funcao, argumentos, authorization });
      if (falha) return Promise.reject(falha);
      return Promise.resolve(respostaDaRpc as T | null);
    },
  };

  return { cliente, rpcs };
}

// `null` é o que o cliente devolve para um 4xx, inclusive a função que não
// existe num banco antigo.
const RESPOSTAS_QUE_NEGAM = [false, null, 'true', 1, {}, [true]];

describe('criarConferenciaDeAdmin', () => {
  it('deveChamarIsAdminComCorpoVazioEOTokenDeQuemPede', async () => {
    const { cliente, rpcs } = criarCliente(true);

    await criarConferenciaDeAdmin(cliente).ehAdmin(AUTORIZACAO);

    expect(rpcs).toEqual([{ funcao: 'is_admin', argumentos: {}, authorization: AUTORIZACAO }]);
  });

  it('deveConfirmarSoQuandoOBancoRespondeTrue', async () => {
    const { cliente } = criarCliente(true);

    await expect(criarConferenciaDeAdmin(cliente).ehAdmin(AUTORIZACAO)).resolves.toBe(true);
  });

  it.each(RESPOSTAS_QUE_NEGAM)('deveNegarQuandoOBancoResponde_%j', async (resposta) => {
    const { cliente } = criarCliente(resposta);

    await expect(criarConferenciaDeAdmin(cliente).ehAdmin(AUTORIZACAO)).resolves.toBe(false);
  });

  it('devePropagarAFalhaDoUpstreamEmVezDeLiberar', async () => {
    // 5xx ou rede viram 503 no cliente: a barreira não abre, e a falha não se
    // disfarça de "sem permissão".
    const { cliente } = criarCliente(null, new Error('supabase_error'));

    await expect(criarConferenciaDeAdmin(cliente).ehAdmin(AUTORIZACAO)).rejects.toThrow(
      'supabase_error',
    );
  });
});

describe('criarRepositorioDeJustificativas — podeDecidir', () => {
  it('deveChamarPodeDecidirJustificativaComPIdEOTokenDeQuemPede', async () => {
    const { cliente, rpcs } = criarCliente(true);

    await criarRepositorioDeJustificativas(cliente).podeDecidir(JUSTIFICATIVA, AUTORIZACAO);

    expect(rpcs).toEqual([
      {
        funcao: 'pode_decidir_justificativa',
        argumentos: { p_id: JUSTIFICATIVA },
        authorization: AUTORIZACAO,
      },
    ]);
  });

  it('deveConfirmarSoQuandoOBancoRespondeTrue', async () => {
    const { cliente } = criarCliente(true);

    await expect(
      criarRepositorioDeJustificativas(cliente).podeDecidir(JUSTIFICATIVA, AUTORIZACAO),
    ).resolves.toBe(true);
  });

  it.each(RESPOSTAS_QUE_NEGAM)('deveNegarQuandoOBancoResponde_%j', async (resposta) => {
    const { cliente } = criarCliente(resposta);

    await expect(
      criarRepositorioDeJustificativas(cliente).podeDecidir(JUSTIFICATIVA, AUTORIZACAO),
    ).resolves.toBe(false);
  });
});
