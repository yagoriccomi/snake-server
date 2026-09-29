import { describe, expect, it } from 'vitest';

import { HttpError } from '../../src/lib/http-error.js';
import {
  criarMotivosService,
  type RegistroDeAnexoDeMotivo,
  type RepositorioDeMotivos,
} from '../../src/modules/motivos/motivos.service.js';
import type {
  AssinadorDeMidia,
  ParametrosDeUpload,
} from '../../src/modules/proofs/proofs.service.js';

/**
 * A regra dos anexos de motivo (contrato § 13.1). Os invariantes:
 *
 *  1. Nenhuma assinatura sai sem o `true` de `pode_anexar_ao_motivo`.
 *  2. A pasta do upload vem do TOKEN; o nome do arquivo é o `anexoId`.
 *  3. `overwrite = false` e `allowed_formats` vão DENTRO da assinatura.
 *  4. Quem decide a leitura é a RLS; linha ausente é 403.
 *  5. O caminho visualizado é DERIVADO de `uploaded_by` + `id`, nunca do
 *     `public_id` gravado.
 */

const USUARIO_DO_TOKEN = '11111111-2222-4333-8444-555555555555';
const OUTRA_PESSOA = '99999999-8888-4777-a666-000000000000';
const MOTIVO = '4c3d2e1f-0a9b-4c8d-9e7f-6a5b4c3d2e1f';
const ANEXO = '1f0a9b8c-7d6e-4f5a-8b4c-3d2e1f0a9b8c';
const AUTORIZACAO = 'Bearer token-do-chamador';
const AGORA = 1_700_000_000;

const CHAMADOR = { userId: USUARIO_DO_TOKEN, authorization: AUTORIZACAO, traceId: 'trace' };

interface Cenario {
  podeAnexar?: boolean;
  anexo?: RegistroDeAnexoDeMotivo | null;
  paginas?: number;
}

function criarCenario({ podeAnexar = true, anexo = null, paginas = 1 }: Cenario = {}) {
  const registro = {
    assinados: [] as ParametrosDeUpload[],
    publicIdsVisualizados: [] as string[],
    perguntas: [] as { motivoId: string; authorization: string }[],
    buscas: [] as { anexoId: string; authorization: string }[],
  };

  const midia: AssinadorDeMidia = {
    assinarUpload(parametros) {
      registro.assinados.push(parametros);
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
    contarPaginas: () => Promise.resolve(paginas),
  };

  const motivos: RepositorioDeMotivos = {
    async podeAnexar(motivoId, authorization) {
      registro.perguntas.push({ motivoId, authorization });
      return podeAnexar;
    },
    async buscarAnexo(anexoId, authorization) {
      registro.buscas.push({ anexoId, authorization });
      return anexo;
    },
  };

  const service = criarMotivosService({ midia, motivos, agoraEmSegundos: () => AGORA });
  return { service, registro };
}

function anexoDe(overrides: Partial<RegistroDeAnexoDeMotivo> = {}): RegistroDeAnexoDeMotivo {
  return {
    id: ANEXO,
    uploaded_by: OUTRA_PESSOA,
    provider: 'cloudinary',
    public_id: `motivos/${OUTRA_PESSOA}/${ANEXO}`,
    ...overrides,
  };
}

describe('motivos.service — assinarUpload', () => {
  it('deveAssinarNaPastaDoUsuarioDoTokenComOAnexoIdComoNome', async () => {
    const { service } = criarCenario();

    const assinatura = await service.assinarUpload(CHAMADOR, MOTIVO, ANEXO);

    expect(assinatura).toMatchObject({
      folder: `motivos/${USUARIO_DO_TOKEN}`,
      public_id: ANEXO,
      type: 'authenticated',
      timestamp: AGORA,
    });
  });

  it('deveLevarOverwriteFalsoEOsFormatosDoContratoParaDentroDaAssinatura', async () => {
    // O que o adaptador recebe é o que ele assina (ver proofs.cloudinary.test).
    const { service, registro } = criarCenario();

    await service.assinarUpload(CHAMADOR, MOTIVO, ANEXO);

    expect(registro.assinados[0]).toMatchObject({
      overwrite: false,
      allowed_formats: 'jpg,png,webp,heic,pdf',
    });
  });

  it('devePerguntarAoBancoComOTokenDoChamadorAntesDeAssinar', async () => {
    const { service, registro } = criarCenario();

    await service.assinarUpload(CHAMADOR, MOTIVO, ANEXO);

    expect(registro.perguntas).toEqual([{ motivoId: MOTIVO, authorization: AUTORIZACAO }]);
  });

  it('deveNegarComForbiddenSemAssinarQuandoOBancoNaoLibera', async () => {
    // Cobre também o banco antigo: sem a função, o repositório responde
    // `false` e o servidor devolve 403, nunca 5xx.
    const { service, registro } = criarCenario({ podeAnexar: false });

    const promessa = service.assinarUpload(CHAMADOR, MOTIVO, ANEXO);

    await expect(promessa).rejects.toBeInstanceOf(HttpError);
    await expect(promessa).rejects.toMatchObject({ status: 403 });
    expect(registro.assinados).toEqual([]);
  });
});

describe('motivos.service — obterUrlDeVisualizacao', () => {
  it('deveNegarComForbiddenQuandoARlsNaoDevolveALinha', async () => {
    const { service, registro } = criarCenario({ anexo: null });

    await expect(service.obterUrlDeVisualizacao(ANEXO, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
    expect(registro.publicIdsVisualizados).toEqual([]);
  });

  it.each([['supabase_storage'], [null]])(
    'deveNegarQuandoOProvedorNaoEhCloudinary (%s)',
    async (provider) => {
      const { service } = criarCenario({ anexo: anexoDe({ provider }) });

      await expect(service.obterUrlDeVisualizacao(ANEXO, CHAMADOR)).rejects.toMatchObject({
        status: 403,
      });
    },
  );

  it('deveRepassarOTokenDoChamadorParaARlsDecidir', async () => {
    const { service, registro } = criarCenario({ anexo: anexoDe() });

    await service.obterUrlDeVisualizacao(ANEXO, CHAMADOR);

    expect(registro.buscas).toEqual([{ anexoId: ANEXO, authorization: AUTORIZACAO }]);
  });

  it('deveDerivarOCaminhoDoAutorDoAnexoQuandoOutraPessoaLe', async () => {
    // O professor (ou quem decide a troca permanente) lê o atestado do aluno:
    // o caminho é o do AUTOR, não o de quem chama.
    const { service, registro } = criarCenario({ anexo: anexoDe() });

    const visualizacao = await service.obterUrlDeVisualizacao(ANEXO, CHAMADOR);

    expect(registro.publicIdsVisualizados).toEqual([`motivos/${OUTRA_PESSOA}/${ANEXO}`]);
    expect(visualizacao).toEqual({
      url: `https://url-assinada/motivos/${OUTRA_PESSOA}/${ANEXO}`,
      paginas: 1,
      pagina: 1,
    });
  });

  it('naoDeveUsarOPublicIdGravadoMesmoQuandoEleApontaParaOutroArquivo', async () => {
    const adulterado = anexoDe({ public_id: `comprovantes/${USUARIO_DO_TOKEN}/pagamento-9` });
    const { service, registro } = criarCenario({ anexo: adulterado });

    await service.obterUrlDeVisualizacao(ANEXO, CHAMADOR);

    expect(registro.publicIdsVisualizados).toEqual([`motivos/${OUTRA_PESSOA}/${ANEXO}`]);
  });

  it('deveLimitarAPaginaPedidaAoTotalDoDocumento', async () => {
    const { service } = criarCenario({ anexo: anexoDe(), paginas: 3 });

    const visualizacao = await service.obterUrlDeVisualizacao(ANEXO, CHAMADOR, 7);

    expect(visualizacao.pagina).toBe(3);
    expect(visualizacao.paginas).toBe(3);
  });
});
