import { describe, expect, it } from 'vitest';

import { HttpError } from '../../src/lib/http-error.js';
import type { ClienteSupabase, UsuarioAutenticado } from '../../src/lib/supabase.js';
import { criarRepositorioDeJustificativas } from '../../src/modules/justifications/justifications.repository.js';
import { criarConferenciaDeAdmin } from '../../src/modules/proofs/proofs.repository.js';

/**
 * As duas RPCs da segunda barreira (contrato § 13.5), pelos repositórios
 * REAIS sobre um cliente Supabase simulado. O que se prova: o nome e o corpo
 * de cada chamada, o token de quem pede, que a resposta do banco passa
 * intacta e que a falha do Supabase sobe em vez de virar "pode" ou "não
 * pode". A classificação 502/503/504 é testada no cliente real
 * (`supabase.test.ts`). [#45][#55]
 */

const JUSTIFICATIVA = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const AUTORIZACAO = 'Bearer token-de-quem-pede';

interface ChamadaDeRpc {
  funcao: string;
  argumentos: Record<string, unknown>;
  authorization: string;
}

function criarCliente(permitido: boolean, falha?: HttpError) {
  const rpcs: ChamadaDeRpc[] = [];

  const cliente: ClienteSupabase = {
    buscarUsuarioPeloToken(): Promise<UsuarioAutenticado | null> {
      throw new Error('A barreira não resolve identidade.');
    },
    consultarComoChamador<T>(): Promise<T[]> {
      throw new Error('A barreira não lê tabela.');
    },
    confirmarPermissaoComoChamador(funcao, argumentos, authorization) {
      rpcs.push({ funcao, argumentos, authorization });
      if (falha) return Promise.reject(falha);
      return Promise.resolve(permitido);
    },
  };

  return { cliente, rpcs };
}

const FALHAS_DO_SUPABASE = [
  new HttpError(502, 'supabase_invalid_response', 'resposta inválida'),
  new HttpError(503, 'supabase_unreachable', 'fora do ar'),
  new HttpError(504, 'supabase_timeout', 'tempo esgotado'),
];

describe('criarConferenciaDeAdmin', () => {
  it('deveChamarIsAdminComCorpoVazioEOTokenDeQuemPede', async () => {
    const { cliente, rpcs } = criarCliente(true);

    await criarConferenciaDeAdmin(cliente).ehAdmin(AUTORIZACAO);

    expect(rpcs).toEqual([{ funcao: 'is_admin', argumentos: {}, authorization: AUTORIZACAO }]);
  });

  it.each([true, false])('deveDevolverARespostaDoBanco_%s', async (permitido) => {
    const { cliente } = criarCliente(permitido);

    await expect(criarConferenciaDeAdmin(cliente).ehAdmin(AUTORIZACAO)).resolves.toBe(permitido);
  });

  it.each(FALHAS_DO_SUPABASE)('devePropagarAFalha_$status_EmVezDeLiberarOuNegar', async (falha) => {
    const { cliente } = criarCliente(true, falha);

    await expect(criarConferenciaDeAdmin(cliente).ehAdmin(AUTORIZACAO)).rejects.toBe(falha);
  });
});

// A chave do G4 só escolhe as colunas do `view-url`; `podeDecidir` não depende dela.
const G4_EM_PRODUCAO = true;

describe('criarRepositorioDeJustificativas — podeDecidir', () => {
  it('deveChamarPodeDecidirJustificativaComPIdEOTokenDeQuemPede', async () => {
    const { cliente, rpcs } = criarCliente(true);

    await criarRepositorioDeJustificativas(cliente, G4_EM_PRODUCAO).podeDecidir(
      JUSTIFICATIVA,
      AUTORIZACAO,
    );

    expect(rpcs).toEqual([
      {
        funcao: 'pode_decidir_justificativa',
        argumentos: { p_id: JUSTIFICATIVA },
        authorization: AUTORIZACAO,
      },
    ]);
  });

  it.each([true, false])('deveDevolverARespostaDoBanco_%s', async (permitido) => {
    const { cliente } = criarCliente(permitido);

    await expect(
      criarRepositorioDeJustificativas(cliente, G4_EM_PRODUCAO).podeDecidir(
        JUSTIFICATIVA,
        AUTORIZACAO,
      ),
    ).resolves.toBe(permitido);
  });

  it.each(FALHAS_DO_SUPABASE)('devePropagarAFalha_$status_EmVezDeLiberarOuNegar', async (falha) => {
    const { cliente } = criarCliente(true, falha);

    await expect(
      criarRepositorioDeJustificativas(cliente, G4_EM_PRODUCAO).podeDecidir(
        JUSTIFICATIVA,
        AUTORIZACAO,
      ),
    ).rejects.toBe(falha);
  });
});
