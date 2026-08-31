import { beforeEach, describe, expect, it } from 'vitest';

import { HttpError } from '../../src/lib/http-error.js';
import {
  criarProofsService,
  type AssinadorDeMidia,
  type LeitorDePagamentos,
  type PoliticaDeAcesso,
  type ProofsService,
  type RegistroDePagamento,
} from '../../src/modules/proofs/proofs.service.js';

/**
 * A regra dos comprovantes. Dois invariantes de segurança moram aqui:
 *
 *  1. O destino do upload vem do TOKEN, nunca do corpo da requisição.
 *  2. Quem decide o acesso é a RLS; lista vazia significa "não é seu" — 403.
 *
 * Testado sem Express, sem SDK e sem rede: a injeção de dependência já
 * garante isso. [#41][#45]
 */

const USUARIO_DO_TOKEN = '11111111-2222-4333-8444-555555555555';
const OUTRO_USUARIO = '99999999-8888-4777-a666-000000000000';
const PAYMENT_ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const AUTORIZACAO = 'Bearer token-do-chamador';
const AGORA = 1_700_000_000;

interface Registro {
  chamadasDeAssinatura: unknown[];
  publicIdsExtraidos: string[];
  publicIdsVisualizados: string[];
  buscas: { paymentId: string; authorization: string }[];
}

const CHAMADOR = {
  userId: USUARIO_DO_TOKEN,
  authorization: AUTORIZACAO,
  traceId: 'trace-de-teste',
};

function criarCenario(
  pagamento: RegistroDePagamento | null,
  politicaDeAcesso: PoliticaDeAcesso = 'rls',
) {
  const registro: Registro = {
    chamadasDeAssinatura: [],
    publicIdsExtraidos: [],
    publicIdsVisualizados: [],
    buscas: [],
  };

  const midia: AssinadorDeMidia = {
    assinarUpload(parametros) {
      registro.chamadasDeAssinatura.push(parametros);
      return {
        ...parametros,
        cloudName: 'nuvem',
        apiKey: 'chave',
        signature: 'assinatura',
        uploadUrl: 'https://upload',
      };
    },
    gerarUrlDeVisualizacao(publicId) {
      registro.publicIdsVisualizados.push(publicId);
      return `https://url-assinada/${publicId}`;
    },
    extrairPublicId(valorGravado) {
      registro.publicIdsExtraidos.push(valorGravado);
      return valorGravado;
    },
  };

  const pagamentos: LeitorDePagamentos = {
    async buscarPorId(paymentId, authorization) {
      registro.buscas.push({ paymentId, authorization });
      return pagamento;
    },
  };

  const service: ProofsService = criarProofsService({
    midia,
    pagamentos,
    agoraEmSegundos: () => AGORA,
    politicaDeAcesso,
  });

  return { service, registro };
}

describe('proofs.service — assinarUpload', () => {
  let cenario: ReturnType<typeof criarCenario>;

  beforeEach(() => {
    cenario = criarCenario(null);
  });

  it('deveDerivarAPastaDoUsuarioDoTokenENaoDeQualquerOutroValor', () => {
    // O invariante que impede um aluno de assinar upload na pasta de outro. [#55]
    const resultado = cenario.service.assinarUpload(USUARIO_DO_TOKEN, PAYMENT_ID);

    expect(resultado.folder).toBe(`comprovantes/${USUARIO_DO_TOKEN}`);
    expect(resultado.folder).not.toContain(OUTRO_USUARIO);
  });

  it('naoDevePermitirQueOPaymentIdEscapeDaPastaComTravessiaDeCaminho', () => {
    // Ainda que um paymentId estranho passasse pela validação, ele não pode
    // reposicionar a pasta — ela é montada com o id do token, à esquerda.
    const resultado = cenario.service.assinarUpload(USUARIO_DO_TOKEN, '../../outro-aluno');

    expect(resultado.folder).toBe(`comprovantes/${USUARIO_DO_TOKEN}`);
  });

  it('deveMarcarOAssetComoAutenticadoPorqueComprovanteEhDadoFinanceiro', () => {
    // `authenticated` = privado. `upload` deixaria o comprovante público. [#63]
    expect(cenario.service.assinarUpload(USUARIO_DO_TOKEN, PAYMENT_ID).type).toBe('authenticated');
  });

  it('deveUsarOPaymentIdComoPublicIdParaQueOComprovanteSejaIdempotente', () => {
    expect(cenario.service.assinarUpload(USUARIO_DO_TOKEN, PAYMENT_ID).public_id).toBe(PAYMENT_ID);
  });

  it('deveUsarORelogioInjetadoEmVezDoRelogioDoSistema', () => {
    expect(cenario.service.assinarUpload(USUARIO_DO_TOKEN, PAYMENT_ID).timestamp).toBe(AGORA);
  });
});

describe('proofs.service — obterUrlDeVisualizacao', () => {
  it('deveNegarComForbiddenQuandoARlsNaoDevolveuNenhumaLinha', async () => {
    // Lista vazia = a RLS não liberou. Nunca 404: distinguir "não existe" de
    // "não é seu" entrega um oráculo de enumeração ao atacante. [#55]
    const { service } = criarCenario(null);

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, CHAMADOR)).rejects.toThrow(HttpError);

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, CHAMADOR)).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it('deveNegarComForbiddenQuandoOPagamentoExisteMasNaoTemComprovante', async () => {
    const { service } = criarCenario({
      user_id: USUARIO_DO_TOKEN,
      proof_provider: 'cloudinary',
      proof_public_id: null,
    });

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('deveNegarComForbiddenQuandoOComprovanteEhStringVazia', async () => {
    const { service } = criarCenario({
      user_id: USUARIO_DO_TOKEN,
      proof_provider: 'cloudinary',
      proof_public_id: '',
    });

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('deveRepassarOTokenDoChamadorParaQueARlsDecidaOAcesso', async () => {
    // Se o token não for repassado, a consulta roda como anônima e a RLS
    // não tem como reconhecer o dono — a autorização inteira desmorona. [#20]
    const { service, registro } = criarCenario({
      user_id: USUARIO_DO_TOKEN,
      proof_provider: 'cloudinary',
      proof_public_id: 'comprovantes/x/y',
    });

    await service.obterUrlDeVisualizacao(PAYMENT_ID, CHAMADOR);

    expect(registro.buscas).toHaveLength(1);
    expect(registro.buscas[0]?.authorization).toBe(AUTORIZACAO);
    expect(registro.buscas[0]?.paymentId).toBe(PAYMENT_ID);
  });

  it('deveNormalizarOValorGravadoAntesDePedirAUrlAssinada', async () => {
    const { service, registro } = criarCenario({
      user_id: USUARIO_DO_TOKEN,
      proof_provider: 'cloudinary',
      proof_public_id: 'comprovantes/x/y',
    });

    const url = await service.obterUrlDeVisualizacao(PAYMENT_ID, CHAMADOR);

    expect(registro.publicIdsExtraidos).toEqual(['comprovantes/x/y']);
    expect(registro.publicIdsVisualizados).toEqual(['comprovantes/x/y']);
    expect(url).toBe('https://url-assinada/comprovantes/x/y');
  });

  it('naoDeveTentarAssinarUrlQuandoOAcessoFoiNegado', async () => {
    // Falha cedo: nada de gastar chamada ao provedor de mídia por um 403. [#9]
    const { service, registro } = criarCenario(null);

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, CHAMADOR)).rejects.toThrow();

    expect(registro.publicIdsVisualizados).toHaveLength(0);
  });

  it('deveRecusarComprovanteQueAindaViveNoSupabaseStorage', async () => {
    // Durante a convivência existem comprovantes nos DOIS provedores. Assinar
    // um path do Storage como se fosse public_id da Cloudinary devolveria um
    // link plausível e quebrado — em silêncio, para um dado financeiro.
    // Recusar é a única resposta honesta. [#9]
    const { service } = criarCenario({
      user_id: USUARIO_DO_TOKEN,
      proof_provider: 'supabase_storage',
      proof_public_id: 'comprovantes/x/y',
    });

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('naoDevePedirUrlAoProvedorQuandoOComprovanteEhDeOutroSistema', async () => {
    // Não basta responder 403: a assinatura não pode nem ser tentada. Um
    // adaptador chamado com identificador alheio pode registrar log, gastar
    // cota ou devolver uma URL que vaze da função por outro caminho.
    const { service, registro } = criarCenario({
      user_id: USUARIO_DO_TOKEN,
      proof_provider: 'supabase_storage',
      proof_public_id: 'comprovantes/x/y',
    });

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, CHAMADOR)).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(registro.publicIdsVisualizados).toHaveLength(0);
    expect(registro.publicIdsExtraidos).toHaveLength(0);
  });

  it('deveRecusarProvedorDesconhecidoEmVezDeAssumirQueEhCloudinary', async () => {
    // Um provedor que este servidor não conhece (acrescentado no futuro, ou
    // dado corrompido) não pode cair no caminho da Cloudinary por omissão.
    // O padrão seguro é negar. [#55]
    const { service } = criarCenario({
      user_id: USUARIO_DO_TOKEN,
      proof_provider: 'provedor-que-nao-existe',
      proof_public_id: 'algo',
    });

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('deveRecusarQuandoOProvedorEhNuloMesmoComPublicIdPreenchido', async () => {
    // Estado que a constraint do banco recusa, mas o servidor não pode contar
    // com isso: a linha pode vir de uma réplica antiga ou de um banco onde a
    // migration ainda não rodou. Confiar em invariante de outro sistema é
    // como confiar na RLS sem a segunda barreira. [#55]
    const { service } = criarCenario({
      user_id: USUARIO_DO_TOKEN,
      proof_provider: null,
      proof_public_id: 'comprovantes/x/y',
    });

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
  });
});
