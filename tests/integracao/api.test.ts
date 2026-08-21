import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarApp } from '../../src/app.js';
import {
  AGORA_EM_SEGUNDOS,
  PAGAMENTO_DE_OUTRO,
  PAGAMENTO_DO_DONO,
  TOKEN_RECUSADO,
  TOKEN_VALIDO,
  URL_ASSINADA_FALSA,
  USUARIO_DONO,
  criarDependenciasFalsas,
  criarEspioes,
  type Espioes,
} from '../ajudantes/dependencias-falsas.js';

/**
 * Integração de verdade: a aplicação INTEIRA sobe — middlewares, validação,
 * autenticação, rotas e handler de erro — com Supabase e Cloudinary
 * substituídos por dublês. Nenhuma chamada de rede acontece. [#42][#45]
 */

let app: Express;
let espioes: Espioes;

beforeEach(() => {
  // Cada teste começa do zero: nada de estado herdado. [#48]
  espioes = criarEspioes();
  app = criarApp(criarDependenciasFalsas(espioes));

  // O logger escreve em stderr nos casos de erro; silenciar mantém a saída
  // do runner legível sem desligar o comportamento.
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /health', () => {
  it('deveResponder200SemExigirAutenticacao', async () => {
    const resposta = await request(app).get('/health');

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ ok: true });
  });

  it('naoDeveFazerNenhumaChamadaExternaParaResponder', async () => {
    // `/health` existe para acordar o servidor hibernado: se ele tocasse
    // Supabase, o pré-aquecimento ficaria tão lento quanto o resto. [#82]
    await request(app).get('/health');

    expect(espioes.tokensVerificados).toHaveLength(0);
    expect(espioes.buscasPorPagamento).toHaveLength(0);
  });

  it('deveDevolverOHeaderDeCorrelacaoParaRastrearAChamada', async () => {
    const resposta = await request(app).get('/health');

    expect(resposta.headers['x-request-id']).toBeDefined();
  });

  it('deveReaproveitarOIdDeCorrelacaoEnviadoPeloCliente', async () => {
    const resposta = await request(app).get('/health').set('X-Request-Id', 'id-vindo-do-app');

    expect(resposta.headers['x-request-id']).toBe('id-vindo-do-app');
  });

  it('naoDeveAnunciarOFrameworkNoHeader', async () => {
    const resposta = await request(app).get('/health');

    expect(resposta.headers['x-powered-by']).toBeUndefined();
  });
});

describe('autenticação — o que acontece sem credencial válida', () => {
  const rotas = ['/v1/proofs/sign-upload', '/v1/proofs/view-url'];

  it.each(rotas)('deveResponder401SemTokenNaRota_%s', async (rota) => {
    const resposta = await request(app).post(rota).send({ paymentId: PAGAMENTO_DO_DONO });

    expect(resposta.status).toBe(401);
    expect(resposta.body.code).toBe('no_token');
  });

  it.each(rotas)('deveResponder401ComTokenSemPrefixoBearerNaRota_%s', async (rota) => {
    const resposta = await request(app)
      .post(rota)
      .set('Authorization', 'token-solto-sem-esquema')
      .send({ paymentId: PAGAMENTO_DO_DONO });

    expect(resposta.status).toBe(401);
    expect(resposta.body.code).toBe('bad_token_format');
  });

  it('naoDeveConsultarOProvedorDeIdentidadeQuandoOFormatoDoTokenEhInvalido', async () => {
    // Formato torto é rejeitado localmente: não vale gastar ida à rede. [#9]
    await request(app)
      .post('/v1/proofs/sign-upload')
      .set('Authorization', 'Basic abc')
      .send({ paymentId: PAGAMENTO_DO_DONO });

    expect(espioes.tokensVerificados).toHaveLength(0);
  });

  it('deveResponder401QuandoOProvedorDeIdentidadeRecusaOToken', async () => {
    const resposta = await request(app)
      .post('/v1/proofs/sign-upload')
      .set('Authorization', TOKEN_RECUSADO)
      .send({ paymentId: PAGAMENTO_DO_DONO });

    expect(resposta.status).toBe(401);
    expect(resposta.body.code).toBe('bad_token');
  });

  it('naoDeveVazarOTokenRecusadoNoCorpoDaResposta', async () => {
    const resposta = await request(app)
      .post('/v1/proofs/sign-upload')
      .set('Authorization', TOKEN_RECUSADO)
      .send({ paymentId: PAGAMENTO_DO_DONO });

    expect(JSON.stringify(resposta.body)).not.toContain('token-de-teste-recusado');
  });
});

describe('validação de entrada — a barreira antes da rede', () => {
  it.each([
    ['uuid malformado', 'nao-e-uuid'],
    ['string vazia', ''],
    ['número disfarçado', '12345'],
    ['uuid com sufixo', '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d-extra'],
  ])('deveResponder400QuandoOPaymentIdEh_%s', async (_rotulo, valor) => {
    const resposta = await request(app)
      .post('/v1/proofs/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ paymentId: valor });

    expect(resposta.status).toBe(400);
    expect(resposta.body.code).toBe('bad_input');
  });

  it('deveResponder400QuandoOPaymentIdEstaAusente', async () => {
    const resposta = await request(app)
      .post('/v1/proofs/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send({});

    expect(resposta.status).toBe(400);
    expect(resposta.body.code).toBe('bad_input');
  });

  it.each([
    ['operador do PostgREST', "nao-e-uuid' or id=neq.0"],
    ['negação de filtro', '00000000-0000-4000-8000-000000000000&id=neq.0'],
    ['seleção de colunas extra', '00000000-0000-4000-8000-000000000000&select=*'],
  ])('deveBarrarTentativaDeInjecaoViaPaymentId_%s', async (_rotulo, ataque) => {
    // O paymentId vira filtro do PostgREST. Se um valor arbitrário passar,
    // a query pode listar pagamentos de terceiros. [#51][#52]
    const resposta = await request(app)
      .post('/v1/proofs/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ paymentId: ataque });

    expect(resposta.status).toBe(400);
    // E o mais importante: a consulta NEM CHEGOU a ser montada.
    expect(espioes.buscasPorPagamento).toHaveLength(0);
  });

  it('deveValidarAntesDeAutenticarParaNaoGastarIdaARede', async () => {
    // Entrada inválida não pode custar uma chamada ao provedor de identidade.
    await request(app)
      .post('/v1/proofs/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ paymentId: 'invalido' });

    expect(espioes.tokensVerificados).toHaveLength(0);
  });

  it('deveResponder400QuandoOJsonEstaMalformado', async () => {
    const resposta = await request(app)
      .post('/v1/proofs/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .set('Content-Type', 'application/json')
      .send('{"paymentId": ');

    expect(resposta.status).toBe(400);
    expect(resposta.body.code).toBe('malformed_json');
  });

  it('deveResponder413QuandoOCorpoUltrapassaOLimiteDe32kb', async () => {
    // Arquivos não passam por este servidor; payload gigante é abuso. [#65]
    const gigante = { paymentId: PAGAMENTO_DO_DONO, lixo: 'x'.repeat(40_000) };

    const resposta = await request(app)
      .post('/v1/proofs/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send(gigante);

    expect(resposta.status).toBe(413);
    expect(resposta.body.code).toBe('payload_too_large');
  });

  it('deveIgnorarCamposExtrasEmVezDeAceitaLosNoDestino', async () => {
    // Um `folder` no corpo não pode influenciar o destino do upload. [#51]
    const resposta = await request(app)
      .post('/v1/proofs/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send({ paymentId: PAGAMENTO_DO_DONO, folder: 'comprovantes/vitima', type: 'upload' });

    expect(resposta.status).toBe(200);
    expect(resposta.body.folder).toBe(`comprovantes/${USUARIO_DONO.id}`);
    expect(resposta.body.type).toBe('authenticated');
  });
});

describe('POST /v1/proofs/sign-upload — caminho autorizado', () => {
  it('deveResponder200ComOsDadosParaOAppEnviarDiretoAoProvedor', async () => {
    const resposta = await request(app)
      .post('/v1/proofs/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send({ paymentId: PAGAMENTO_DO_DONO });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({
      folder: `comprovantes/${USUARIO_DONO.id}`,
      public_id: PAGAMENTO_DO_DONO,
      type: 'authenticated',
      timestamp: AGORA_EM_SEGUNDOS,
    });
    expect(resposta.body.signature).toBeDefined();
    expect(resposta.body.uploadUrl).toBeDefined();
  });

  it('naoDeveDevolverSegredoDeServidorNaResposta', async () => {
    const resposta = await request(app)
      .post('/v1/proofs/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send({ paymentId: PAGAMENTO_DO_DONO });

    const corpo = JSON.stringify(resposta.body);
    expect(corpo).not.toContain('segredo-ficticio-de-teste');
    expect(corpo).not.toContain('chave-anon-ficticia-de-teste');
  });
});

describe('POST /v1/proofs/view-url — autorização decidida pela RLS', () => {
  it('deveResponder200ComAUrlAssinadaQuandoOPagamentoEhDoChamador', async () => {
    const resposta = await request(app)
      .post('/v1/proofs/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ paymentId: PAGAMENTO_DO_DONO });

    expect(resposta.status).toBe(200);
    expect(resposta.body.url).toBe(URL_ASSINADA_FALSA);
  });

  it('deveResponder403QuandoOPagamentoEhDeOutroUsuario', async () => {
    // A RLS devolve lista vazia; o servidor não reimplementa a permissão. [#20]
    const resposta = await request(app)
      .post('/v1/proofs/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ paymentId: PAGAMENTO_DE_OUTRO });

    expect(resposta.status).toBe(403);
    expect(resposta.body.code).toBe('forbidden');
  });

  it('naoDeveRevelarSeOPagamentoDeOutroExisteOuNao', async () => {
    // Mensagem idêntica para "não existe" e "não é seu": sem oráculo de
    // enumeração para quem estiver varrendo ids. [#55]
    const inexistente = '00000000-0000-4000-8000-000000000000';

    const deOutro = await request(app)
      .post('/v1/proofs/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ paymentId: PAGAMENTO_DE_OUTRO });

    const naoExiste = await request(app)
      .post('/v1/proofs/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ paymentId: inexistente });

    expect(deOutro.status).toBe(naoExiste.status);
    expect(deOutro.body.error).toBe(naoExiste.body.error);
    expect(deOutro.body.code).toBe(naoExiste.body.code);
  });

  it('deveRepassarOTokenDoChamadorAoConsultarOPagamento', async () => {
    await request(app)
      .post('/v1/proofs/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ paymentId: PAGAMENTO_DO_DONO });

    expect(espioes.buscasPorPagamento[0]?.authorization).toBe(TOKEN_VALIDO);
  });
});

describe('contrato de erro', () => {
  it('deveResponder404NoMesmoFormatoDosDemaisErrosQuandoARotaNaoExiste', async () => {
    const resposta = await request(app).get('/v1/modulo-que-nao-existe');

    expect(resposta.status).toBe(404);
    expect(resposta.body).toMatchObject({ code: 'route_not_found' });
    expect(resposta.body.traceId).toBeDefined();
  });

  it('deveIncluirTraceIdEmTodaRespostaDeErroParaPermitirSuporte', async () => {
    const resposta = await request(app).post('/v1/proofs/sign-upload').send({});

    expect(resposta.body.traceId).toBe(resposta.headers['x-request-id']);
  });

  it('deveResponder500SemVazarStackTraceQuandoUmaDependenciaQuebra', async () => {
    // O pior caso: exceção inesperada no meio do fluxo. [#93]
    const espioesLocais = criarEspioes();
    const appQuebrado = criarApp(
      criarDependenciasFalsas(espioesLocais, {
        buscarPagamento: () => {
          throw new Error('conexao recusada em postgres://usuario:senha@10.0.0.5:5432/app');
        },
      }),
    );

    const resposta = await request(appQuebrado)
      .post('/v1/proofs/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ paymentId: PAGAMENTO_DO_DONO });

    expect(resposta.status).toBe(500);
    expect(resposta.body).toEqual({
      error: 'Erro interno',
      code: 'internal_error',
      traceId: expect.any(String),
    });

    const corpo = JSON.stringify(resposta.body);
    expect(corpo).not.toContain('postgres://');
    expect(corpo).not.toContain('senha');
    expect(corpo).not.toContain('10.0.0.5');
    expect(corpo).not.toContain('at ');
    expect(corpo).not.toContain('.ts');
  });

  it('deveResponder503SemDetalheTecnicoQuandoOUpstreamEstaIndisponivel', async () => {
    const espioesLocais = criarEspioes();
    const { dependenciaIndisponivel } = await import('../../src/lib/http-error.js');

    const appIndisponivel = criarApp(
      criarDependenciasFalsas(espioesLocais, {
        buscarPagamento: () => {
          throw dependenciaIndisponivel('Servidor de dados indisponível', 'supabase_error', {
            cause: new Error('getaddrinfo ENOTFOUND interno.rede.local'),
          });
        },
      }),
    );

    const resposta = await request(appIndisponivel)
      .post('/v1/proofs/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ paymentId: PAGAMENTO_DO_DONO });

    expect(resposta.status).toBe(503);
    expect(resposta.body.code).toBe('supabase_error');
    expect(JSON.stringify(resposta.body)).not.toContain('interno.rede.local');
  });
});

describe('CORS', () => {
  it('naoDeveLiberarOrigemDeNavegadorQuandoNenhumaFoiConfigurada', async () => {
    // ALLOWED_ORIGIN vazio no ambiente de teste: o app nativo não usa CORS,
    // e nenhum site deve ganhar acesso por descuido. [#57]
    const resposta = await request(app).get('/health').set('Origin', 'https://site-invasor.test');

    expect(resposta.headers['access-control-allow-origin']).toBeUndefined();
  });
});
