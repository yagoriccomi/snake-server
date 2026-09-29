import { describe, expect, it } from 'vitest';

import type { ClienteSupabase, UsuarioAutenticado } from '../../src/lib/supabase.js';
import { criarRepositorioDeMotivos } from '../../src/modules/motivos/motivos.repository.js';

/**
 * O repositório REAL do módulo motivos, sobre um cliente Supabase simulado.
 * O que se prova aqui é a tradução do que o banco respondeu — em especial o
 * banco antigo, que ainda não tem `pode_anexar_ao_motivo`. [#45][#48]
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

function criarCliente(respostaDaRpc: unknown, linhas: unknown[] = []) {
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
    chamarRpcComoChamador<T>(
      funcao: string,
      argumentos: Record<string, unknown>,
      authorization: string,
    ): Promise<T | null> {
      registro.rpcs.push({ funcao, argumentos, authorization });
      return Promise.resolve(respostaDaRpc as T | null);
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

  it('deveNegarQuandoOBancoAntigoAindaNaoTemAFuncao', async () => {
    // O cliente devolve `null` para a recusa 4xx (PGRST202). O servidor vai
    // ao ar antes das migrations (contrato § 14): isto é 403, não 5xx.
    const { repositorio } = criarCliente(null);

    expect(await repositorio.podeAnexar(MOTIVO, AUTORIZACAO)).toBe(false);
  });

  it.each([[false], ['true'], [1], [[true]], [{ pode: true }]])(
    'deveNegarQualquerRespostaQueNaoSejaOBooleanoTrue (%j)',
    async (resposta) => {
      const { repositorio } = criarCliente(resposta);

      expect(await repositorio.podeAnexar(MOTIVO, AUTORIZACAO)).toBe(false);
    },
  );
});

describe('criarRepositorioDeMotivos — buscarAnexo', () => {
  it('deveConsultarATabelaEAsColunasDoContratoComOTokenDoChamador', async () => {
    const { repositorio, registro } = criarCliente(null, []);

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
    const { repositorio } = criarCliente(null, []);

    expect(await repositorio.buscarAnexo(ANEXO, AUTORIZACAO)).toBeNull();
  });
});
