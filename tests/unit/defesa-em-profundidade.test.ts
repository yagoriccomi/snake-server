import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  criarProofsService,
  type AssinadorDeMidia,
  type ConferenciaDeAdmin,
  type LeitorDePagamentos,
  type PoliticaDeAcesso,
  type RegistroDePagamento,
} from '../../src/modules/proofs/proofs.service.js';

/**
 * A SEGUNDA barreira de autorização.
 *
 * A trava principal é a RLS do Supabase — e ela mora em outro sistema. Uma
 * migration distraída, uma política renomeada ou uma tabela recriada sem
 * `ENABLE ROW LEVEL SECURITY` bastam para este endpoint virar um vazamento
 * silencioso de dado financeiro.
 *
 * Estes testes simulam exatamente esse cenário: a RLS **falhou** e devolveu o
 * pagamento de outra pessoa. O que o servidor faz então? Desde o 5.5, ele
 * pergunta ao banco, pela mesma `is_admin()` da RLS, se quem pede é admin
 * (contrato § 13.5). [#55]
 */

const DONO = '11111111-2222-4333-8444-555555555555';
const INVASOR = '99999999-8888-4777-a666-000000000000';
const PAYMENT_ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const midia: AssinadorDeMidia = {
  assinarUpload: (p) => ({
    ...p,
    cloudName: 'n',
    apiKey: 'k',
    signature: 's',
    uploadUrl: 'u',
  }),
  gerarUrlDeVisualizacao: (id) => `https://url-assinada/${id}`,
  contarPaginas: () => Promise.resolve(1),
};

/** Simula uma RLS QUEBRADA: devolve o pagamento independentemente de quem pede. */
function rlsQuebrada(pagamento: RegistroDePagamento): LeitorDePagamentos {
  return { buscarPorId: async () => pagamento };
}

/** Responde `is_admin` como mandado e anota cada pergunta. */
function conferenciaDeAdmin(resposta: boolean) {
  const perguntas: string[] = [];
  const admin: ConferenciaDeAdmin = {
    ehAdmin: (authorization) => {
      perguntas.push(authorization);
      return Promise.resolve(resposta);
    },
  };
  return { admin, perguntas };
}

function montar(
  politicaDeAcesso: PoliticaDeAcesso,
  pagamento: RegistroDePagamento,
  admin: ConferenciaDeAdmin = conferenciaDeAdmin(false).admin,
) {
  return criarProofsService({
    midia,
    pagamentos: rlsQuebrada(pagamento),
    agoraEmSegundos: () => 1_700_000_000,
    politicaDeAcesso,
    admin,
  });
}

function chamador(userId: string) {
  return { userId, authorization: 'Bearer token', traceId: 'trace-de-teste' };
}

/** Captura o que foi escrito em stderr — é onde o alarme aparece. */
function capturarStderr(): string[] {
  const escritas: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((texto: unknown) => {
    escritas.push(String(texto));
    return true;
  });
  return escritas;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('política `somente-dono` — postura mais dura', () => {
  const pagamentoAlheio: RegistroDePagamento = {
    user_id: DONO,
    proof_provider: 'cloudinary',
    proof_public_id: 'comprovantes/a/b',
  };

  it('deveNegarComForbiddenQuandoARlsLiberaComprovanteDeOutroUsuario', async () => {
    capturarStderr();
    const service = montar('somente-dono', pagamentoAlheio);

    await expect(
      service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR)),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('naoDeveEmitirAUrlAssinadaQuandoBloqueiaOAcesso', async () => {
    capturarStderr();
    const urlsEmitidas: string[] = [];
    const service = criarProofsService({
      midia: {
        ...midia,
        gerarUrlDeVisualizacao: (id) => {
          urlsEmitidas.push(id);
          return 'https://nunca-deveria-chegar-aqui';
        },
        contarPaginas: () => Promise.resolve(1),
      },
      pagamentos: rlsQuebrada(pagamentoAlheio),
      agoraEmSegundos: () => 1,
      politicaDeAcesso: 'somente-dono',
      admin: conferenciaDeAdmin(true).admin,
    });

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR))).rejects.toThrow();

    expect(urlsEmitidas).toHaveLength(0);
  });

  it('naoDevePerguntarAoBancoNemServirAoAdmin', async () => {
    // A postura mais dura: nem o admin passa, e o banco nem é consultado.
    capturarStderr();
    const { admin, perguntas } = conferenciaDeAdmin(true);
    const service = montar('somente-dono', pagamentoAlheio, admin);

    await expect(
      service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR)),
    ).rejects.toMatchObject({ status: 403 });
    expect(perguntas).toEqual([]);
  });

  it('devePermitirNormalmenteQuandoOChamadorEhODono', async () => {
    const service = montar('somente-dono', pagamentoAlheio);

    await expect(
      service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(DONO)).then((c) => c.url),
    ).resolves.toContain('url-assinada');
  });
});

describe('política `rls` — padrão: o admin passa, confirmado pelo banco (§ 13.5)', () => {
  const pagamentoAlheio: RegistroDePagamento = {
    user_id: DONO,
    proof_provider: 'cloudinary',
    proof_public_id: 'comprovantes/a/b',
  };

  it('deveServirAoAdminConfirmadoPorIsAdminComOTokenDeQuemPede', async () => {
    // A spec (política `payments_select_own_or_admin`) prevê o admin vendo
    // comprovante alheio. Quem confirma é o banco, não o servidor.
    const { admin, perguntas } = conferenciaDeAdmin(true);
    const service = montar('rls', pagamentoAlheio, admin);

    await expect(
      service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR)).then((c) => c.url),
    ).resolves.toContain('url-assinada');
    expect(perguntas).toEqual(['Bearer token']);
  });

  it('naoDeveEmitirAlarmeQuandoOAdminAbreOComprovante', async () => {
    // Alarme que dispara a cada conferência do Financeiro vira ruído.
    const escritas = capturarStderr();
    const service = montar('rls', pagamentoAlheio, conferenciaDeAdmin(true).admin);

    await service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR));

    expect(escritas.join('')).not.toContain('RLS liberou');
  });

  it('deveNegarComForbiddenQuandoARlsLiberaAQuemNaoEhAdmin', async () => {
    // Antes do 5.5, aqui o servidor servia e só alarmava. Agora a RLS
    // quebrada não entrega mais nada. [#55]
    capturarStderr();
    const service = montar('rls', pagamentoAlheio, conferenciaDeAdmin(false).admin);

    await expect(
      service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR)),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('deveEmitirAlarmeEmNivelErrorQuandoBloqueia', async () => {
    const escritas = capturarStderr();
    const service = montar('rls', pagamentoAlheio);

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR))).rejects.toThrow();

    const saida = escritas.join('');
    expect(saida).toContain('RLS liberou comprovante de outro usuário');
    expect(saida).toContain('"nivel":"error"');
    expect(saida).toContain('bloqueado');
  });

  it('naoDevePerguntarAoBancoNoFluxoNormalDoProprioDono', async () => {
    // O dono não paga chamada a mais, nem dispara alarme.
    const escritas = capturarStderr();
    const { admin, perguntas } = conferenciaDeAdmin(false);
    const service = montar('rls', pagamentoAlheio, admin);

    await service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(DONO));

    expect(perguntas).toEqual([]);
    expect(escritas.join('')).not.toContain('RLS liberou comprovante');
  });

  it('naoDeveVazarOsIdentificadoresInteirosNoAlarme', async () => {
    // O alarme é log: mesmo sendo um alerta, respeita o mascaramento de PII. [#63]
    const escritas = capturarStderr();
    const service = montar('rls', pagamentoAlheio);

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR))).rejects.toThrow();

    const saida = escritas.join('');
    expect(saida).not.toContain(DONO);
    expect(saida).not.toContain(INVASOR);
  });

  it('deveRegistrarQualPoliticaEstavaAtivaParaFacilitarODiagnostico', async () => {
    const escritas = capturarStderr();
    const service = montar('rls', pagamentoAlheio);

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR))).rejects.toThrow();

    expect(escritas.join('')).toContain('"politica":"rls"');
  });
});

describe('a barreira não substitui a RLS — apenas a complementa', () => {
  it.each([['rls'], ['somente-dono']] as const)(
    'deveNegarComForbiddenQuandoARlsDevolveVazio_politica_%s',
    async (politica) => {
      // Primeira barreira funcionando: nem chega a haver dono para comparar.
      const service = criarProofsService({
        midia,
        pagamentos: { buscarPorId: async () => null },
        agoraEmSegundos: () => 1,
        politicaDeAcesso: politica,
        admin: conferenciaDeAdmin(true).admin,
      });

      await expect(
        service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR)),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
});
