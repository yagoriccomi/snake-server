import { describe, expect, it } from 'vitest';

import { respostaInvalidaDaDependencia } from '../../src/lib/http-error.js';
import type { ClienteSupabase, UsuarioAutenticado } from '../../src/lib/supabase.js';
import { criarRepositorioDeMotivos } from '../../src/modules/motivos/motivos.repository.js';

/**
 * O repositório REAL do módulo motivos, sobre um cliente Supabase simulado.
 * O que se prova aqui é a tradução do que o banco respondeu — e que a falha do
 * Supabase sobe como falha, nunca como "não pode". [#45][#48]
 */

const MOTIVO = '4c3d2e1f-0a9b-4c8d-9e7f-6a5b4c3d2e1f';
const ANEXO = '1f0a9b8c-7d6e-4f5a-8b4c-3d2e1f0a9b8c';
const AUTORIZACAO = 'Bearer token-do-chamador';

interface Registro {
  rpcs: { funcao: string; argumentos: Record<string, unknown>; authorization: string }[];
  consultas: {
    tabela: string;
    filtros: Record<string, string>;
    colunas: string;
    authorization: string;
  }[];
}

/** `respostaDaRpc` é o booleano do banco, ou o erro que o cliente lançaria. */
function criarCliente(respostaDaRpc: boolean | Error, linhas: unknown[] = []) {
  const registro: Registro = { rpcs: [], consultas: [] };

  const cliente: ClienteSupabase = {
    buscarUsuarioPeloToken(): Promise<UsuarioAutenticado | null> {
      throw new Error('O repositório de motivos não deve resolver identidade.');
    },
    consultarComoChamador<T>(
      tabela: string,
      filtros: Record<string, string>,
      colunas: string,
      authorization: string,
    ): Promise<T[]> {
      registro.consultas.push({ tabela, filtros, colunas, authorization });
      return Promise.resolve(linhas as T[]);
    },
    confirmarPermissaoComoChamador(
      funcao: string,
      argumentos: Record<string, unknown>,
      authorization: string,
    ): Promise<boolean> {
      registro.rpcs.push({ funcao, argumentos, authorization });
      return respostaDaRpc instanceof Error
        ? Promise.reject(respostaDaRpc)
        : Promise.resolve(respostaDaRpc);
    },
  };

  return { repositorio: criarRepositorioDeMotivos(cliente), registro };
}

describe('criarRepositorioDeMotivos — podeAnexar', () => {
  it('deveChamarARpcDoContratoComOParametroEOTokenDoChamador', async () => {
    const { repositorio, registro } = criarCliente(true);

    await repositorio.podeAnexar(MOTIVO, AUTORIZACAO);

    expect(registro.rpcs).toEqual([
      {
        funcao: 'pode_anexar_ao_motivo',
        argumentos: { p_motivo_id: MOTIVO },
        authorization: AUTORIZACAO,
      },
    ]);
  });

  it('deveLiberarSoQuandoOBancoRespondeTrue', async () => {
    const { repositorio } = criarCliente(true);

    expect(await repositorio.podeAnexar(MOTIVO, AUTORIZACAO)).toBe(true);
  });

  it('deveNegarQuandoOBancoRespondeFalse', async () => {
    const { repositorio } = criarCliente(false);

    expect(await repositorio.podeAnexar(MOTIVO, AUTORIZACAO)).toBe(false);
  });

  it('deveDeixarAFalhaDoSupabaseSubirEmVezDeNegar', async () => {
    // Função ausente (banco antes do G3) ou resposta fora do formato: o
    // cliente lança 502, e isso não pode virar o 403 de "não pode" (§ 13.6).
    const falha = respostaInvalidaDaDependencia('falhou', 'supabase_invalid_response');
    const { repositorio } = criarCliente(falha);

    await expect(repositorio.podeAnexar(MOTIVO, AUTORIZACAO)).rejects.toBe(falha);
  });
});

describe('criarRepositorioDeMotivos — buscarAnexo', () => {
  it('deveConsultarATabelaEAsColunasDoContratoComOTokenDoChamador', async () => {
    const { repositorio, registro } = criarCliente(false, []);

    await repositorio.buscarAnexo(ANEXO, AUTORIZACAO);

    expect(registro.consultas).toEqual([
      {
        tabela: 'action_reason_attachments',
        filtros: { id: `eq.${ANEXO}` },
        colunas: 'id,uploaded_by,provider,public_id',
        authorization: AUTORIZACAO,
      },
    ]);
  });

  it('deveDevolverNuloQuandoARlsNaoLiberaALinha', async () => {
    const { repositorio } = criarCliente(false, []);

    expect(await repositorio.buscarAnexo(ANEXO, AUTORIZACAO)).toBeNull();
  });
});
