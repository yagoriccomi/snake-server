import { afterEach, describe, expect, it, vi } from 'vitest';

import { criarConsultaDeReferencias } from '../../src/jobs/media-cleanup/media-cleanup.repository.js';

/**
 * A consulta REAL de referências da varredura de órfãos, com o `fetch`
 * substituído. O que se prova: as três colunas do contrato, o filtro montado
 * sem concatenação solta, e a falha que LANÇA em vez de responder "nenhuma
 * referência". [#45][#52]
 */

const SUPABASE_URL = 'https://projeto-de-teste.supabase.co';
const CAMINHO_A =
  'motivos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/11111111-1111-4111-8111-111111111111';
const CAMINHO_B =
  'justificativas/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/22222222-2222-4222-8222-222222222222';

function criarConsulta() {
  return criarConsultaDeReferencias({
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: 'chave-service-role-ficticia',
  });
}

function substituirFetch(respostas: Record<string, { status: number; corpo: unknown }>) {
  const fetchFalso = vi.fn(async (url: string) => {
    const tabela = new URL(url).pathname.split('/').pop() ?? '';
    const resposta = respostas[tabela] ?? { status: 200, corpo: [] };
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status });
  });
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

describe('criarConsultaDeReferencias', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deveConsultarAsTresColunasDoContratoComOsCaminhosEntreAspas', async () => {
    const fetchFalso = substituirFetch({});

    await criarConsulta().caminhosReferenciados([CAMINHO_A, CAMINHO_B]);

    const pedidas = fetchFalso.mock.calls.map(([url]) => {
      const u = new URL(url);
      const coluna = u.searchParams.get('select') ?? '';
      return { tabela: u.pathname, coluna, filtro: u.searchParams.get(coluna) };
    });
    const filtro = `in.("${CAMINHO_A}","${CAMINHO_B}")`;
    expect(pedidas).toEqual([
      { tabela: '/rest/v1/action_reason_attachments', coluna: 'public_id', filtro },
      { tabela: '/rest/v1/absence_justifications', coluna: 'proof_public_id', filtro },
      { tabela: '/rest/v1/absence_justification_attempts', coluna: 'proof_public_id', filtro },
    ]);
  });

  it('deveDevolverOsCaminhosQueAlgumaTabelaReferencia', async () => {
    substituirFetch({
      action_reason_attachments: { status: 200, corpo: [{ public_id: CAMINHO_A }] },
      absence_justification_attempts: { status: 200, corpo: [{ proof_public_id: CAMINHO_B }] },
    });

    const referenciados = await criarConsulta().caminhosReferenciados([CAMINHO_A, CAMINHO_B]);

    expect([...referenciados].sort()).toEqual([CAMINHO_B, CAMINHO_A].sort());
  });

  it('deveLancarQuandoUmaTabelaAindaNaoExisteNoBancoAntigo', async () => {
    // Responder "nenhuma referência" aqui mandaria apagar anexos com dono.
    substituirFetch({ absence_justification_attempts: { status: 404, corpo: {} } });

    await expect(criarConsulta().caminhosReferenciados([CAMINHO_A])).rejects.toThrow('HTTP 404');
  });

  it('naoDeveConsultarQuandoNaoHaCaminhos', async () => {
    const fetchFalso = substituirFetch({});

    expect(await criarConsulta().caminhosReferenciados([])).toEqual(new Set());
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});
