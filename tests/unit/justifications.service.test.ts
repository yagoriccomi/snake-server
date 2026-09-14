import { describe, expect, it } from 'vitest';

import { HttpError } from '../../src/lib/http-error.js';
import {
  criarJustificationsService,
  type LeitorDeJustificativas,
  type RegistroDeJustificativa,
} from '../../src/modules/justifications/justifications.service.js';
import type { AssinadorDeMidia } from '../../src/modules/proofs/proofs.service.js';

/**
 * A regra dos anexos de justificativa. Os invariantes de segurança:
 *
 *  1. A pasta do upload vem do TOKEN, nunca do corpo.
 *  2. Quem decide o acesso é a RLS; lista vazia é 403.
 *  3. O caminho visualizado é DERIVADO de (user_id, class_id), nunca lido do
 *     `proof_public_id` gravado — que o aluno pode alterar enquanto pendente.
 */

const USUARIO_DO_TOKEN = '11111111-2222-4333-8444-555555555555';
const OUTRO_ALUNO = '99999999-8888-4777-a666-000000000000';
const AULA = '5b4c3d2e-1f0a-4b9c-8d7e-6f5a4b3c2d1e';
const JUSTIFICATIVA = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const AUTORIZACAO = 'Bearer token-do-chamador';
const AGORA = 1_700_000_000;

const CHAMADOR = { userId: USUARIO_DO_TOKEN, authorization: AUTORIZACAO, traceId: 'trace' };

function criarCenario(justificativa: RegistroDeJustificativa | null, paginas = 1) {
  const registro = {
    publicIdsVisualizados: [] as string[],
    buscas: [] as { justificationId: string; authorization: string }[],
  };

  const midia: AssinadorDeMidia = {
    assinarUpload(parametros) {
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

  const justificativas: LeitorDeJustificativas = {
    async buscarPorId(justificationId, authorization) {
      registro.buscas.push({ justificationId, authorization });
      return justificativa;
    },
  };

  const service = criarJustificationsService({
    midia,
    justificativas,
    agoraEmSegundos: () => AGORA,
  });

  return { service, registro };
}

describe('justifications.service — assinarUpload', () => {
  it('deveDerivarAPastaDoUsuarioDoTokenENaoDoCorpo', () => {
    const { service } = criarCenario(null);
    const resultado = service.assinarUpload(USUARIO_DO_TOKEN, AULA);

    expect(resultado.folder).toBe(`justificativas/${USUARIO_DO_TOKEN}`);
    expect(resultado.folder).not.toContain(OUTRO_ALUNO);
  });

  it('deveUsarOClassIdComoNomeParaReenvioSubstituirOAnexoDaMesmaAula', () => {
    const { service } = criarCenario(null);
    expect(service.assinarUpload(USUARIO_DO_TOKEN, AULA).public_id).toBe(AULA);
  });

  it('deveMarcarOAnexoComoPrivado', () => {
    // Atestado médico é dado sensível: nunca entrega pública. [#63]
    const { service } = criarCenario(null);
    expect(service.assinarUpload(USUARIO_DO_TOKEN, AULA).type).toBe('authenticated');
  });

  it('naoDevePermitirQueOClassIdReposicioneAPasta', () => {
    const { service } = criarCenario(null);
    expect(service.assinarUpload(USUARIO_DO_TOKEN, '../../outro').folder).toBe(
      `justificativas/${USUARIO_DO_TOKEN}`,
    );
  });

  it('deveUsarORelogioInjetado', () => {
    const { service } = criarCenario(null);
    expect(service.assinarUpload(USUARIO_DO_TOKEN, AULA).timestamp).toBe(AGORA);
  });
});

describe('justifications.service — obterUrlDeVisualizacao', () => {
  it('deveNegarComForbiddenQuandoARlsNaoDevolveuALinha', async () => {
    const { service } = criarCenario(null);

    await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toBeInstanceOf(
      HttpError,
    );
    await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('deveNegarQuandoAJustificativaNaoTemAnexo', async () => {
    // Justificativa só com texto é válida — mas não há arquivo para entregar.
    const { service } = criarCenario({
      user_id: USUARIO_DO_TOKEN,
      class_id: AULA,
      proof_provider: null,
      proof_public_id: null,
    });

    await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('deveRecusarProvedorQueNaoEhCloudinary', async () => {
    const { service, registro } = criarCenario({
      user_id: USUARIO_DO_TOKEN,
      class_id: AULA,
      proof_provider: 'supabase_storage',
      proof_public_id: 'algo',
    });

    await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
    expect(registro.publicIdsVisualizados).toHaveLength(0);
  });

  it('deveRepassarOTokenDoChamadorParaARlsDecidir', async () => {
    const { service, registro } = criarCenario({
      user_id: USUARIO_DO_TOKEN,
      class_id: AULA,
      proof_provider: 'cloudinary',
      proof_public_id: `justificativas/${USUARIO_DO_TOKEN}/${AULA}`,
    });

    await service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR);

    expect(registro.buscas).toEqual([
      { justificationId: JUSTIFICATIVA, authorization: AUTORIZACAO },
    ]);
  });

  it('naoDeveAssinarOAnexoDeOutroAlunoQuandoOPonteiroFoiAdulterado', async () => {
    // Regressão do padrão C-2: enquanto pendente, o aluno altera
    // proof_public_id. Apontar para o anexo alheio não pode ter efeito.
    const { service, registro } = criarCenario({
      user_id: USUARIO_DO_TOKEN,
      class_id: AULA,
      proof_provider: 'cloudinary',
      proof_public_id: `justificativas/${OUTRO_ALUNO}/atestado-alheio`,
    });

    const anexo = await service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR);

    expect(registro.publicIdsVisualizados).toEqual([`justificativas/${USUARIO_DO_TOKEN}/${AULA}`]);
    expect(anexo.url).not.toContain(OUTRO_ALUNO);
  });

  it('deveDerivarOCaminhoDoDonoQuandoOProfessorRevisa', async () => {
    // O professor abre o anexo do ALUNO: o caminho é o do dono da linha, não
    // o de quem está olhando — e isso não é tratado como anomalia.
    const { service, registro } = criarCenario({
      user_id: OUTRO_ALUNO,
      class_id: AULA,
      proof_provider: 'cloudinary',
      proof_public_id: 'ignorado',
    });

    await service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR);

    expect(registro.publicIdsVisualizados).toEqual([`justificativas/${OUTRO_ALUNO}/${AULA}`]);
  });

  it('deveLimitarAPaginaPedidaAoTotalDoDocumento', async () => {
    const { service } = criarCenario(
      {
        user_id: USUARIO_DO_TOKEN,
        class_id: AULA,
        proof_provider: 'cloudinary',
        proof_public_id: 'x',
      },
      2,
    );

    const anexo = await service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR, 50);

    expect(anexo).toMatchObject({ paginas: 2, pagina: 2 });
  });
});
