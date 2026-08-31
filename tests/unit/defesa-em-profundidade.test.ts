import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  criarProofsService,
  type AssinadorDeMidia,
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
 * pagamento de outra pessoa. O que o servidor faz então? [#55]
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
};

/** Simula uma RLS QUEBRADA: devolve o pagamento independentemente de quem pede. */
function rlsQuebrada(pagamento: RegistroDePagamento): LeitorDePagamentos {
  return { buscarPorId: async () => pagamento };
}

function montar(politicaDeAcesso: PoliticaDeAcesso, pagamento: RegistroDePagamento) {
  return criarProofsService({
    midia,
    pagamentos: rlsQuebrada(pagamento),
    agoraEmSegundos: () => 1_700_000_000,
    politicaDeAcesso,
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
      },
      pagamentos: rlsQuebrada(pagamentoAlheio),
      agoraEmSegundos: () => 1,
      politicaDeAcesso: 'somente-dono',
    });

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR))).rejects.toThrow();

    expect(urlsEmitidas).toHaveLength(0);
  });

  it('devePermitirNormalmenteQuandoOChamadorEhODono', async () => {
    const service = montar('somente-dono', pagamentoAlheio);

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(DONO))).resolves.toContain(
      'url-assinada',
    );
  });
});

describe('política `rls` — padrão, preserva o administrador previsto na spec', () => {
  const pagamentoAlheio: RegistroDePagamento = {
    user_id: DONO,
    proof_provider: 'cloudinary',
    proof_public_id: 'comprovantes/a/b',
  };

  it('devePermitirOAcessoQuandoARlsLiberouPorqueOChamadorPodeSerAdmin', async () => {
    // A spec (docs/BACKEND.md §6) prevê o admin vendo comprovante alheio.
    // Bloquear por padrão quebraria esse caso legítimo.
    capturarStderr();
    const service = montar('rls', pagamentoAlheio);

    await expect(service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR))).resolves.toContain(
      'url-assinada',
    );
  });

  it('deveEmitirAlarmeEmNivelErrorQuandoOChamadorNaoEhODono', async () => {
    // Permitir em silêncio seria pior do que não ter a barreira: se a RLS
    // cair, ninguém fica sabendo. O alarme é a entrega desta política.
    const escritas = capturarStderr();
    const service = montar('rls', pagamentoAlheio);

    await service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR));

    const saida = escritas.join('');
    expect(saida).toContain('RLS liberou comprovante de outro usuário');
    expect(saida).toContain('"nivel":"error"');
  });

  it('naoDeveEmitirAlarmeNoFluxoNormalDoProprioDono', async () => {
    // Alarme que dispara todo dia vira ruído e para de ser lido.
    const escritas = capturarStderr();
    const service = montar('rls', pagamentoAlheio);

    await service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(DONO));

    expect(escritas.join('')).not.toContain('RLS liberou comprovante');
  });

  it('naoDeveVazarOsIdentificadoresInteirosNoAlarme', async () => {
    // O alarme é log: mesmo sendo um alerta, respeita o mascaramento de PII. [#63]
    const escritas = capturarStderr();
    const service = montar('rls', pagamentoAlheio);

    await service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR));

    const saida = escritas.join('');
    expect(saida).not.toContain(DONO);
    expect(saida).not.toContain(INVASOR);
  });

  it('deveRegistrarQualPoliticaEstavaAtivaParaFacilitarODiagnostico', async () => {
    const escritas = capturarStderr();
    const service = montar('rls', pagamentoAlheio);

    await service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR));

    expect(escritas.join('')).toContain('permitido-por-politica');
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
      });

      await expect(
        service.obterUrlDeVisualizacao(PAYMENT_ID, chamador(INVASOR)),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
});
