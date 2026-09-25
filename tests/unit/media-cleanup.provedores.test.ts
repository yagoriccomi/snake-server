import { afterEach, describe, expect, it, vi } from 'vitest';

import { criarExclusorDeMidia } from '../../src/jobs/media-cleanup/media-cleanup.provedores.js';

/**
 * O adaptador REAL de exclusão, sem rede: o `fetch` é substituído e o que se
 * confere é a URL que ele montaria. Credenciais fictícias. [#37][#45]
 */

const SUPABASE_URL = 'https://projeto-de-teste.supabase.co';
const PREFIXO_DO_BUCKET = `${SUPABASE_URL}/storage/v1/object/payment_proofs/`;

function criarExclusor() {
  return criarExclusorDeMidia({
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: 'chave-service-role-ficticia',
    cloudinary: { cloudName: 'nuvem-de-teste', apiKey: '000', apiSecret: 'segredo-ficticio' },
  });
}

function substituirFetch(status: number) {
  const fetchFalso = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(null, { status }),
  );
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

describe('criarExclusorDeMidia — Storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deveEscaparCadaSegmentoEManterABarraEntreEles', async () => {
    // `encodeURI` deixaria `?` e `#` mudarem a URL: `?` viraria query string e
    // `#` cortaria o resto do caminho, apagando outro objeto (ou nenhum).
    const fetchFalso = substituirFetch(200);

    await criarExclusor().apagarDoStorage('aluno 1/recibo?x=1#parte%20.jpg');

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(fetchFalso.mock.calls[0]?.[0]).toBe(
      `${PREFIXO_DO_BUCKET}aluno%201/recibo%3Fx%3D1%23parte%2520.jpg`,
    );
  });

  it('deveConsiderarApagadoQuandoOStorageRespondeNaoEncontrado', async () => {
    substituirFetch(404);

    await expect(criarExclusor().apagarDoStorage('aluno-1/recibo.jpg')).resolves.toBeUndefined();
  });

  it('deveLancarQuandoOStorageRecusaAExclusao', async () => {
    substituirFetch(403);

    await expect(criarExclusor().apagarDoStorage('aluno-1/recibo.jpg')).rejects.toThrow('HTTP 403');
  });
});
