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

/** Um 200 cujo corpo não é JSON: o `json()` falha como falharia o real. */
function respostaSemJson(): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
  } as Response;
}

/** O erro que o `AbortSignal.timeout` produz quando o prazo vence. */
function erroDeTimeout(): DOMException {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

const SUPABASE_FORA_DO_AR = { status: 503, code: 'supabase_unreachable' };
const SUPABASE_LENTO = { status: 504, code: 'supabase_timeout' };
const SUPABASE_FORA_DO_FORMATO = { status: 502, code: 'supabase_invalid_response' };
const TOKEN_RECUSADO = { status: 401, code: 'bad_token' };

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

  it.each([[400], [401], [403], [422]])(
    'deveDevolverNuloQuandoOAuthRecusaOTokenCom%i',
    async (status) => {
      // Só a recusa do token vira "Sessão inválida" (contrato § 13.6).
      fetchFalso.mockResolvedValue(respostaFalsa({ msg: 'invalid' }, status));

      expect(await cliente.buscarUsuarioPeloToken(AUTORIZACAO)).toBeNull();
    },
  );

  it.each([
    [502, SUPABASE_FORA_DO_AR],
    [503, SUPABASE_FORA_DO_AR],
    [504, SUPABASE_LENTO],
    [500, SUPABASE_FORA_DO_FORMATO],
  ])('deveTratarOStatus%iDoAuthComoFalhaDoSupabaseENaoComoSessaoInvalida', async (status, erro) => {
    // Com o Supabase fora do ar, o aluno não pode ler "Sessão inválida" e
    // sair do app à toa: o problema não é o token dele.
    fetchFalso.mockResolvedValue(respostaFalsa({ msg: 'boom' }, status));

    await expect(cliente.buscarUsuarioPeloToken(AUTORIZACAO)).rejects.toMatchObject(erro);
  });

  it.each([
    ['sem id', { email: 'a@b.test' }],
    ['id numérico', { id: 12345 }],
    ['id nulo', { id: null }],
    ['id vazio', { id: '' }],
    ['corpo vazio', {}],
    ['corpo nulo', null],
  ])('deveResponder502QuandoOAuthDevolve200_%s', async (_rotulo, corpo) => {
    // Sem id verificado não há usuário: é o id que deriva o destino do upload.
    // Mas um 200 sem id é o Auth fora do contrato, não o token recusado.
    fetchFalso.mockResolvedValue(respostaFalsa(corpo));

    await expect(cliente.buscarUsuarioPeloToken(AUTORIZACAO)).rejects.toMatchObject(
      SUPABASE_FORA_DO_FORMATO,
    );
  });

  it('deveResponder502QuandoOAuthDevolveUmCorpoQueNaoEhJson', async () => {
    fetchFalso.mockResolvedValue(respostaSemJson());

    await expect(cliente.buscarUsuarioPeloToken(AUTORIZACAO)).rejects.toMatchObject(
      SUPABASE_FORA_DO_FORMATO,
    );
  });

  it('deveResponder504QuandoOPrazoDaChamadaVence', async () => {
    fetchFalso.mockRejectedValue(erroDeTimeout());

    await expect(cliente.buscarUsuarioPeloToken(AUTORIZACAO)).rejects.toMatchObject(SUPABASE_LENTO);
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

  it('deveDevolverListaVaziaQuandoARlsNaoLiberaNenhumaLinha', async () => {
    // A RLS não recusa: ela filtra. Lista vazia é a linha que o chamador não
    // vê, e quem a interpreta como 403 é a camada de regra, não esta.
    fetchFalso.mockResolvedValue(respostaFalsa([]));

    expect(await cliente.consultarComoChamador('payments', {}, '*', AUTORIZACAO)).toEqual([]);
  });

  it('deveResponder401QuandoOPostgrestRecusaOToken', async () => {
    fetchFalso.mockResolvedValue(respostaFalsa({ msg: 'JWT expired' }, 401));

    await expect(
      cliente.consultarComoChamador('payments', {}, '*', AUTORIZACAO),
    ).rejects.toMatchObject(TOKEN_RECUSADO);
  });

  it.each([
    [400, SUPABASE_FORA_DO_FORMATO],
    [403, SUPABASE_FORA_DO_FORMATO],
    [404, SUPABASE_FORA_DO_FORMATO],
    [500, SUPABASE_FORA_DO_FORMATO],
    [502, SUPABASE_FORA_DO_AR],
    [503, SUPABASE_FORA_DO_AR],
    [504, SUPABASE_LENTO],
  ])('deveTratarOStatus%iDoPostgrestComoFalhaENaoComoListaVazia', async (status, erro) => {
    // Coluna ausente ou falta de `grant` como lista vazia viraria um 403 que
    // esconde o defeito; o Supabase fora do ar, um "sem acesso" (§ 13.6).
    fetchFalso.mockResolvedValue(respostaFalsa({ msg: 'boom' }, status));

    await expect(
      cliente.consultarComoChamador('payments', {}, '*', AUTORIZACAO),
    ).rejects.toMatchObject(erro);
  });

  it.each([
    ['objeto', { inesperado: true }],
    ['nulo', null],
    ['texto', 'ok'],
  ])('deveResponder502QuandoORetornoEh_%s_EmVezDeUmaLista', async (_rotulo, corpo) => {
    fetchFalso.mockResolvedValue(respostaFalsa(corpo));

    await expect(
      cliente.consultarComoChamador('payments', {}, '*', AUTORIZACAO),
    ).rejects.toMatchObject(SUPABASE_FORA_DO_FORMATO);
  });

  it('deveResponder502QuandoOCorpoDaConsultaNaoEhJson', async () => {
    fetchFalso.mockResolvedValue(respostaSemJson());

    await expect(
      cliente.consultarComoChamador('payments', {}, '*', AUTORIZACAO),
    ).rejects.toMatchObject(SUPABASE_FORA_DO_FORMATO);
  });

  it('deveResponder504QuandoOPrazoDaConsultaVence', async () => {
    fetchFalso.mockRejectedValue(erroDeTimeout());

    await expect(
      cliente.consultarComoChamador('payments', {}, '*', AUTORIZACAO),
    ).rejects.toMatchObject(SUPABASE_LENTO);
  });

  it('deveNormalizarBarraFinalDaUrlBaseParaNaoGerarCaminhoDuplicado', async () => {
    const clienteComBarra = criarClienteSupabase({ ...CONFIG, url: 'https://projeto.supabase.co' });

    await clienteComBarra.consultarComoChamador('payments', {}, '*', AUTORIZACAO);

    expect(urlChamada().pathname).not.toContain('//');
  });

  it('deveContinuarUsandoGetSemCorpo', async () => {
    await cliente.consultarComoChamador('payments', {}, '*', AUTORIZACAO);

    const opcoes = fetchFalso.mock.calls[0]?.[1] as RequestInit;
    expect(opcoes.method).toBe('GET');
    expect(opcoes.body).toBeUndefined();
  });
});

describe('confirmarPermissaoComoChamador', () => {
  const FUNCAO = 'pode_anexar_ao_motivo';
  const ARGUMENTOS = { p_motivo_id: '00000000-0000-4000-8000-000000000000' };

  const perguntar = () => cliente.confirmarPermissaoComoChamador(FUNCAO, ARGUMENTOS, AUTORIZACAO);

  it('deveChamarARpcPorPostComOsArgumentosNoCorpo', async () => {
    fetchFalso.mockResolvedValue(respostaFalsa(true));

    await perguntar();

    const opcoes = fetchFalso.mock.calls[0]?.[1] as RequestInit;
    expect(urlChamada().pathname).toBe('/rest/v1/rpc/pode_anexar_ao_motivo');
    expect(urlChamada().search).toBe('');
    expect(opcoes.method).toBe('POST');
    expect(JSON.parse(opcoes.body as string)).toEqual(ARGUMENTOS);
    expect((opcoes.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('deveRepassarOTokenDoChamadorParaQueAFuncaoDecidaPorEle', async () => {
    fetchFalso.mockResolvedValue(respostaFalsa(true));

    await perguntar();

    const opcoes = fetchFalso.mock.calls[0]?.[1] as RequestInit;
    expect((opcoes.headers as Record<string, string>).Authorization).toBe(AUTORIZACAO);
  });

  it.each([[true], [false]])('deveDevolverOBooleanoDaFuncao (%s)', async (resposta) => {
    fetchFalso.mockResolvedValue(respostaFalsa(resposta));

    expect(await perguntar()).toBe(resposta);
  });

  it('deveResponder401QuandoOPostgrestRecusaOToken', async () => {
    fetchFalso.mockResolvedValue(respostaFalsa({ msg: 'JWT expired' }, 401));

    await expect(perguntar()).rejects.toMatchObject(TOKEN_RECUSADO);
  });

  it.each([
    ['a função ainda não existe (PGRST202)', 404, SUPABASE_FORA_DO_FORMATO],
    ['falta o grant (42501)', 403, SUPABASE_FORA_DO_FORMATO],
    ['erro interno', 500, SUPABASE_FORA_DO_FORMATO],
    ['gateway fora do ar', 502, SUPABASE_FORA_DO_AR],
    ['banco fora do ar', 503, SUPABASE_FORA_DO_AR],
    ['gateway sem resposta', 504, SUPABASE_LENTO],
  ])('naoDeveTransformarEmNaoPodeQuando_%s', async (_rotulo, status, erro) => {
    // Falha nunca se passa por "não pode": o 403 com alarme esconderia o
    // defeito e acusaria o aluno (contrato § 13.6).
    fetchFalso.mockResolvedValue(respostaFalsa({ msg: 'boom' }, status));

    await expect(perguntar()).rejects.toMatchObject(erro);
  });

  it.each([[null], ['true'], [1], [[true]], [{ pode: true }]])(
    'deveResponder502QuandoAFuncaoNaoDevolveUmBooleano (%j)',
    async (resposta) => {
      fetchFalso.mockResolvedValue(respostaFalsa(resposta));

      await expect(perguntar()).rejects.toMatchObject(SUPABASE_FORA_DO_FORMATO);
    },
  );

  it('deveResponder502QuandoOCorpoDaFuncaoNaoEhJson', async () => {
    fetchFalso.mockResolvedValue(respostaSemJson());

    await expect(perguntar()).rejects.toMatchObject(SUPABASE_FORA_DO_FORMATO);
  });

  it('deveResponder503QuandoARedeFalha', async () => {
    fetchFalso.mockRejectedValue(new TypeError('fetch failed'));

    await expect(perguntar()).rejects.toMatchObject(SUPABASE_FORA_DO_AR);
  });

  it('deveResponder504QuandoOPrazoDaFuncaoVence', async () => {
    fetchFalso.mockRejectedValue(erroDeTimeout());

    await expect(perguntar()).rejects.toMatchObject(SUPABASE_LENTO);
  });

  it('deveCodificarONomeDaFuncaoParaNaoPermitirTravessiaDeCaminho', async () => {
    fetchFalso.mockResolvedValue(respostaFalsa(true));

    await cliente.confirmarPermissaoComoChamador('../../auth/v1/admin/users', {}, AUTORIZACAO);

    expect(urlChamada().pathname).not.toContain('/auth/v1');
  });
});

describe('confirmarPermissaoComoChamador — segunda barreira (D20)', () => {
  const ARGUMENTOS = { p_id: '00000000-0000-4000-8000-000000000000' };

  function confirmar() {
    return cliente.confirmarPermissaoComoChamador(
      'pode_decidir_justificativa',
      ARGUMENTOS,
      AUTORIZACAO,
    );
  }

  it('deveChamarARpcPorPostComOsArgumentosEOTokenDoChamador', async () => {
    fetchFalso.mockResolvedValue(respostaFalsa(true));

    await confirmar();

    const opcoes = fetchFalso.mock.calls[0]?.[1] as RequestInit;
    expect(urlChamada().pathname).toBe('/rest/v1/rpc/pode_decidir_justificativa');
    expect(opcoes.method).toBe('POST');
    expect(JSON.parse(opcoes.body as string)).toEqual(ARGUMENTOS);
    expect((opcoes.headers as Record<string, string>).Authorization).toBe(AUTORIZACAO);
  });

  it.each([true, false])('deveDevolverOBooleanoQueOBancoRespondeu_%s', async (valor) => {
    fetchFalso.mockResolvedValue(respostaFalsa(valor));

    await expect(confirmar()).resolves.toBe(valor);
  });

  it('deveLancar401BadTokenQuandoOPostgrestRecusaOToken', async () => {
    // Sessão vencida não é "não pode": só o `false` leva ao 403 e ao alarme
    // (contrato § 13.5, errata da v6).
    fetchFalso.mockResolvedValue(respostaFalsa({ code: 'PGRST301' }, 401));

    await expect(confirmar()).rejects.toMatchObject({
      status: 401,
      code: 'bad_token',
      message: 'Sessão inválida',
    });
  });

  it.each(['true', 1, null, {}, [true]])(
    'deveLancar502QuandoORetornoNaoEhBooleano_%j',
    async (corpo) => {
      fetchFalso.mockResolvedValue(respostaFalsa(corpo));

      await expect(confirmar()).rejects.toMatchObject({
        status: 502,
        code: 'supabase_invalid_response',
        message: 'O servidor de dados respondeu de forma inesperada',
      });
    },
  );

  it('deveLancar502QuandoOCorpoNaoEhJson', async () => {
    fetchFalso.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    });

    await expect(confirmar()).rejects.toMatchObject({
      status: 502,
      code: 'supabase_invalid_response',
    });
  });

  it.each([
    [404, 'a função ainda não existe (PGRST202)'],
    [403, 'falta o grant de execute (42501)'],
    [400, 'argumento recusado'],
    [500, 'erro interno do banco'],
  ])('deveLancar502QuandoOPostgrestResponde_%i_%s', async (status) => {
    fetchFalso.mockResolvedValue(respostaFalsa({ code: 'qualquer' }, status));

    await expect(confirmar()).rejects.toMatchObject({
      status: 502,
      code: 'supabase_invalid_response',
    });
  });

  it.each([502, 503])('deveLancar503QuandoOGatewayAvisaQueOBancoCaiu_%i', async (status) => {
    fetchFalso.mockResolvedValue(respostaFalsa({ msg: 'down' }, status));

    await expect(confirmar()).rejects.toMatchObject({
      status: 503,
      code: 'supabase_unreachable',
      message: 'Não foi possível falar com o servidor de dados',
    });
  });

  it('deveLancar503QuandoARedeFalha', async () => {
    fetchFalso.mockRejectedValue(new TypeError('fetch failed'));

    await expect(confirmar()).rejects.toMatchObject({
      status: 503,
      code: 'supabase_unreachable',
    });
  });

  it('deveLancar504QuandoOGatewayDesisteDeEsperarOBanco', async () => {
    fetchFalso.mockResolvedValue(respostaFalsa({ msg: 'timeout' }, 504));

    await expect(confirmar()).rejects.toMatchObject({
      status: 504,
      code: 'supabase_timeout',
      message: 'O servidor de dados demorou demais para responder',
    });
  });

  it('deveLancar504QuandoOPrazoDaChamadaVence', async () => {
    fetchFalso.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

    await expect(confirmar()).rejects.toMatchObject({
      status: 504,
      code: 'supabase_timeout',
    });
  });

  it('naoDeveVazarODetalheDoUpstreamNaMensagemDoErro', async () => {
    fetchFalso.mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND projeto.supabase.co'));

    const erro = await confirmar().catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(HttpError);
    expect((erro as HttpError).message).not.toContain('ENOTFOUND');
  });
});
