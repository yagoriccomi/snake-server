import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../../src/lib/http-error.js';
import { criarClienteSupabase } from '../../src/lib/supabase.js';

/**
 * O cliente REAL do Supabase, com `fetch` substituído por um dublê. [#45]
 *
 * É a camada que monta a URL enviada ao PostgREST — e é ali que uma
 * concatenação descuidada viraria injeção de query. Testar a URL montada é
 * testar a defesa. [#51][#52]
 */

const CONFIG = { url: 'https://projeto.supabase.co', anonKey: 'chave-anon' };
const AUTORIZACAO = 'Bearer token-do-chamador';

const cliente = criarClienteSupabase(CONFIG);

function respostaFalsa(corpo: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  } as Response;
}

let fetchFalso: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchFalso = vi.fn();
  vi.stubGlobal('fetch', fetchFalso);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Extrai a URL que o cliente realmente pediu ao `fetch`. */
function urlChamada(): URL {
  return new URL(String(fetchFalso.mock.calls[0]?.[0]));
}

describe('buscarUsuarioPeloToken', () => {
  it('deveDevolverOUsuarioQuandoOProvedorConfirmaOToken', async () => {
    fetchFalso.mockResolvedValue(
      respostaFalsa({ id: 'abc-123', email: 'a@b.test', role: 'aluno' }),
    );

    const usuario = await cliente.buscarUsuarioPeloToken(AUTORIZACAO);

    expect(usuario).toEqual({ id: 'abc-123', email: 'a@b.test', role: 'aluno' });
  });

  it('deveRepassarOTokenDoChamadorEAChaveAnonimaNosHeaders', async () => {
    fetchFalso.mockResolvedValue(respostaFalsa({ id: 'abc-123' }));

    await cliente.buscarUsuarioPeloToken(AUTORIZACAO);

    const opcoes = fetchFalso.mock.calls[0]?.[1] as RequestInit;
    const headers = opcoes.headers as Record<string, string>;
    expect(headers.Authorization).toBe(AUTORIZACAO);
    expect(headers.apikey).toBe(CONFIG.anonKey);
  });

  it('deveDevolverNuloQuandoOProvedorRecusaOToken', async () => {
    fetchFalso.mockResolvedValue(respostaFalsa({ msg: 'invalid' }, 401));

    expect(await cliente.buscarUsuarioPeloToken(AUTORIZACAO)).toBeNull();
  });

  it('deveDevolverNuloQuandoARespostaVem200MasSemIdDeUsuario', async () => {
    // Sem id verificado não há usuário: é o id que deriva o destino do upload.
    fetchFalso.mockResolvedValue(respostaFalsa({ email: 'a@b.test' }));

    expect(await cliente.buscarUsuarioPeloToken(AUTORIZACAO)).toBeNull();
  });

  it.each([
    ['id numérico', { id: 12345 }],
    ['id nulo', { id: null }],
    ['id vazio', { id: '' }],
    ['corpo vazio', {}],
  ])('deveDevolverNuloQuandoARespostaTem_%s', async (_rotulo, corpo) => {
    fetchFalso.mockResolvedValue(respostaFalsa(corpo));

    expect(await cliente.buscarUsuarioPeloToken(AUTORIZACAO)).toBeNull();
  });

  it('deveOmitirEmailERoleQuandoNaoVieremComoTexto', async () => {
    fetchFalso.mockResolvedValue(respostaFalsa({ id: 'abc-123', email: 42, role: null }));

    expect(await cliente.buscarUsuarioPeloToken(AUTORIZACAO)).toEqual({ id: 'abc-123' });
  });

  it('deveLancar503QuandoARedeFalha', async () => {
    // Falha de rede não pode virar 500 genérico: é indisponibilidade de
    // dependência, e o app precisa saber que vale a pena tentar de novo.
    fetchFalso.mockRejectedValue(new TypeError('fetch failed'));

    await expect(cliente.buscarUsuarioPeloToken(AUTORIZACAO)).rejects.toMatchObject({
      status: 503,
      code: 'supabase_unreachable',
    });
  });

  it('naoDeveVazarODetalheDeRedeNaMensagemDoErro', async () => {
    fetchFalso.mockRejectedValue(new Error('getaddrinfo ENOTFOUND interno.rede.local'));

    const erro = await cliente.buscarUsuarioPeloToken(AUTORIZACAO).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(HttpError);
    expect((erro as HttpError).message).not.toContain('interno.rede.local');
  });

  it('deveEnviarUmSinalDeTimeoutParaNaoSegurarAConexaoIndefinidamente', async () => {
    fetchFalso.mockResolvedValue(respostaFalsa({ id: 'abc-123' }));

    await cliente.buscarUsuarioPeloToken(AUTORIZACAO);

    const opcoes = fetchFalso.mock.calls[0]?.[1] as RequestInit;
    expect(opcoes.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('consultarComoChamador — onde a injeção seria possível', () => {
  beforeEach(() => {
    fetchFalso.mockResolvedValue(respostaFalsa([]));
  });

  it('deveMontarAUrlDaTabelaComOFiltroEAsColunasPedidas', async () => {
    await cliente.consultarComoChamador(
      'payments',
      { id: 'eq.abc' },
      'user_id,proof_url',
      AUTORIZACAO,
    );

    const url = urlChamada();
    expect(url.pathname).toBe('/rest/v1/payments');
    expect(url.searchParams.get('id')).toBe('eq.abc');
    expect(url.searchParams.get('select')).toBe('user_id,proof_url');
  });

  it('deveEscaparOperadoresDoPostgrestEmVezDeDeixaLosVirarParametro', async () => {
    // Se o filtro fosse concatenado, o `&` abriria um novo parâmetro e o
    // atacante controlaria a query. Com URLSearchParams ele vira texto. [#51][#52]
    const ataque = 'eq.abc&id=neq.0&select=*';

    await cliente.consultarComoChamador('payments', { id: ataque }, 'user_id', AUTORIZACAO);

    const url = urlChamada();
    // Continua UM filtro `id`, com o valor inteiro preservado como texto.
    expect(url.searchParams.getAll('id')).toEqual([ataque]);
    expect(url.searchParams.get('select')).toBe('user_id');
  });

  it('naoDevePermitirQueOFiltroTroqueATabelaConsultada', async () => {
    await cliente.consultarComoChamador('payments', { id: 'eq.1' }, 'user_id', AUTORIZACAO);

    expect(urlChamada().pathname).toBe('/rest/v1/payments');
  });

  it('deveCodificarONomeDaTabelaParaNaoPermitirTravessiaDeCaminho', async () => {
    await cliente.consultarComoChamador('../auth/v1/users', {}, '*', AUTORIZACAO);

    expect(urlChamada().pathname).not.toContain('/auth/v1/users');
  });

  it('deveRepassarOTokenDoChamadorParaQueARlsFiltre', async () => {
    await cliente.consultarComoChamador('payments', { id: 'eq.1' }, 'user_id', AUTORIZACAO);

    const opcoes = fetchFalso.mock.calls[0]?.[1] as RequestInit;
    expect((opcoes.headers as Record<string, string>).Authorization).toBe(AUTORIZACAO);
  });

  it('deveDevolverListaVaziaQuandoARlsRecusaComStatus4xx', async () => {
    // 401/403 do PostgREST = o token não passa na RLS. Quem interpreta
    // isso como 403 é a camada de regra, não esta.
    fetchFalso.mockResolvedValue(respostaFalsa({ msg: 'permission denied' }, 403));

    expect(await cliente.consultarComoChamador('payments', {}, '*', AUTORIZACAO)).toEqual([]);
  });

  it('deveLancar503QuandoOPostgrestRespondeErroDeServidor', async () => {
    fetchFalso.mockResolvedValue(respostaFalsa({ msg: 'boom' }, 500));

    await expect(
      cliente.consultarComoChamador('payments', {}, '*', AUTORIZACAO),
    ).rejects.toMatchObject({ status: 503, code: 'supabase_error' });
  });

  it('deveDevolverListaVaziaQuandoORetornoNaoEhUmArray', async () => {
    // Contrato quebrado do upstream não pode virar `undefined.length` aqui.
    fetchFalso.mockResolvedValue(respostaFalsa({ inesperado: true }));

    expect(await cliente.consultarComoChamador('payments', {}, '*', AUTORIZACAO)).toEqual([]);
  });

  it('deveNormalizarBarraFinalDaUrlBaseParaNaoGerarCaminhoDuplicado', async () => {
    const clienteComBarra = criarClienteSupabase({ ...CONFIG, url: 'https://projeto.supabase.co' });

    await clienteComBarra.consultarComoChamador('payments', {}, '*', AUTORIZACAO);

    expect(urlChamada().pathname).not.toContain('//');
  });
});
