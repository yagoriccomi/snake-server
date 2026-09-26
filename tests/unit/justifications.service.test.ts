import { describe, expect, it } from 'vitest';

import { HttpError } from '../../src/lib/http-error.js';
import {
  criarJustificationsService,
  type JustificativaParaAssinar,
  type LeitorDeJustificativas,
  type RegistroDeJustificativa,
} from '../../src/modules/justifications/justifications.service.js';
import type {
  AssinadorDeMidia,
  ParametrosDeUpload,
} from '../../src/modules/proofs/proofs.service.js';

/**
 * A regra dos anexos de justificativa (contrato § 13.2). Os invariantes:
 *
 *  1. A pasta do upload vem do TOKEN, nunca do corpo.
 *  2. O legado `{ classId }` assina o mesmo que hoje, sem campo a mais.
 *  3. A forma `{ justificationId }` só assina a justificativa do próprio
 *     chamador, pendente e sem anexo, com o nome da tentativa, `overwrite =
 *     false` e `allowed_formats`.
 *  4. Quem decide a leitura é a RLS; lista vazia é 403.
 *  5. O caminho visualizado é sempre um dos DERIVADOS; o `proof_public_id`
 *     gravado só escolhe entre eles.
 */

const USUARIO_DO_TOKEN = '11111111-2222-4333-8444-555555555555';
const OUTRO_ALUNO = '99999999-8888-4777-a666-000000000000';
const AULA = '5b4c3d2e-1f0a-4b9c-8d7e-6f5a4b3c2d1e';
const JUSTIFICATIVA = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const AUTORIZACAO = 'Bearer token-do-chamador';
const AGORA = 1_700_000_000;

const CHAMADOR = { userId: USUARIO_DO_TOKEN, authorization: AUTORIZACAO, traceId: 'trace' };

interface Cenario {
  paraVisualizar?: RegistroDeJustificativa | null;
  paraAssinar?: JustificativaParaAssinar | null;
  paginas?: number;
}

function criarCenario({ paraVisualizar = null, paraAssinar = null, paginas = 1 }: Cenario = {}) {
  const registro = {
    assinados: [] as ParametrosDeUpload[],
    publicIdsVisualizados: [] as string[],
    buscas: [] as { justificationId: string; authorization: string }[],
    buscasParaAssinar: [] as { justificationId: string; authorization: string }[],
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

  const justificativas: LeitorDeJustificativas = {
    async buscarPorId(justificationId, authorization) {
      registro.buscas.push({ justificationId, authorization });
      return paraVisualizar;
    },
    async buscarParaAssinar(justificationId, authorization) {
      registro.buscasParaAssinar.push({ justificationId, authorization });
      return paraAssinar;
    },
  };

  const service = criarJustificationsService({
    midia,
    justificativas,
    agoraEmSegundos: () => AGORA,
  });

  return { service, registro };
}

function pendente(overrides: Partial<JustificativaParaAssinar> = {}): JustificativaParaAssinar {
  return {
    id: JUSTIFICATIVA,
    user_id: USUARIO_DO_TOKEN,
    status: 'pending',
    attempt: 1,
    proof_public_id: null,
    ...overrides,
  };
}

function comAnexo(overrides: Partial<RegistroDeJustificativa> = {}): RegistroDeJustificativa {
  return {
    id: JUSTIFICATIVA,
    user_id: USUARIO_DO_TOKEN,
    class_id: AULA,
    attempt: 1,
    proof_provider: 'cloudinary',
    proof_public_id: `justificativas/${USUARIO_DO_TOKEN}/${JUSTIFICATIVA}`,
    ...overrides,
  };
}

describe('justifications.service — assinarUpload (legado { classId })', () => {
  it('deveDerivarAPastaDoUsuarioDoTokenENaoDoCorpo', () => {
    const { service } = criarCenario();
    const resultado = service.assinarUpload(USUARIO_DO_TOKEN, AULA);

    expect(resultado.folder).toBe(`justificativas/${USUARIO_DO_TOKEN}`);
    expect(resultado.folder).not.toContain(OUTRO_ALUNO);
  });

  it('deveUsarOClassIdComoNomeParaReenvioSubstituirOAnexoDaMesmaAula', () => {
    const { service } = criarCenario();
    expect(service.assinarUpload(USUARIO_DO_TOKEN, AULA).public_id).toBe(AULA);
  });

  it('deveMarcarOAnexoComoPrivado', () => {
    // Atestado médico é dado sensível: nunca entrega pública. [#63]
    const { service } = criarCenario();
    expect(service.assinarUpload(USUARIO_DO_TOKEN, AULA).type).toBe('authenticated');
  });

  it('naoDevePermitirQueOClassIdReposicioneAPasta', () => {
    const { service } = criarCenario();
    expect(service.assinarUpload(USUARIO_DO_TOKEN, '../../outro').folder).toBe(
      `justificativas/${USUARIO_DO_TOKEN}`,
    );
  });

  it('deveUsarORelogioInjetado', () => {
    const { service } = criarCenario();
    expect(service.assinarUpload(USUARIO_DO_TOKEN, AULA).timestamp).toBe(AGORA);
  });

  it('deveAssinarExatamenteOsCamposDeHojeSemOverwriteNemAllowedFormats', () => {
    // O APK 1.8 não envia os campos novos: com eles na assinatura, o upload
    // dele passaria a ser recusado pela Cloudinary (contrato § 13.2).
    const { service, registro } = criarCenario();

    service.assinarUpload(USUARIO_DO_TOKEN, AULA);

    expect(registro.assinados).toEqual([
      {
        folder: `justificativas/${USUARIO_DO_TOKEN}`,
        public_id: AULA,
        timestamp: AGORA,
        type: 'authenticated',
      },
    ]);
  });
});

describe('justifications.service — assinarUploadDaJustificativa ({ justificationId })', () => {
  it('deveAssinarComOIdComoNomeNaPrimeiraTentativa', async () => {
    const { service, registro } = criarCenario({ paraAssinar: pendente({ attempt: 1 }) });

    await service.assinarUploadDaJustificativa(CHAMADOR, JUSTIFICATIVA);

    expect(registro.assinados).toEqual([
      {
        folder: `justificativas/${USUARIO_DO_TOKEN}`,
        public_id: JUSTIFICATIVA,
        timestamp: AGORA,
        type: 'authenticated',
        overwrite: false,
        allowed_formats: 'jpg,png,webp,heic,pdf',
      },
    ]);
  });

  it('deveAssinarComOSufixoDaSegundaTentativa', async () => {
    const { service } = criarCenario({ paraAssinar: pendente({ attempt: 2 }) });

    const assinatura = await service.assinarUploadDaJustificativa(CHAMADOR, JUSTIFICATIVA);

    expect(assinatura.public_id).toBe(`${JUSTIFICATIVA}-2`);
  });

  it('deveLerComOTokenDoChamador', async () => {
    const { service, registro } = criarCenario({ paraAssinar: pendente() });

    await service.assinarUploadDaJustificativa(CHAMADOR, JUSTIFICATIVA);

    expect(registro.buscasParaAssinar).toEqual([
      { justificationId: JUSTIFICATIVA, authorization: AUTORIZACAO },
    ]);
  });

  it.each<[string, JustificativaParaAssinar | null]>([
    ['a RLS não libera a linha (ou o banco antigo recusa a leitura)', null],
    [
      'a justificativa é de outra pessoa (o professor lê, mas não anexa)',
      pendente({ user_id: OUTRO_ALUNO }),
    ],
    ['a justificativa já foi aprovada', pendente({ status: 'approved' })],
    ['a justificativa já foi negada', pendente({ status: 'rejected' })],
    [
      'a justificativa já tem anexo',
      pendente({ proof_public_id: `justificativas/${USUARIO_DO_TOKEN}/${JUSTIFICATIVA}` }),
    ],
    ['a tentativa está fora de 1 e 2', pendente({ attempt: 3 })],
  ])('deveNegarComForbiddenSemAssinarQuando %s', async (_caso, linha) => {
    const { service, registro } = criarCenario({ paraAssinar: linha });

    const promessa = service.assinarUploadDaJustificativa(CHAMADOR, JUSTIFICATIVA);

    await expect(promessa).rejects.toBeInstanceOf(HttpError);
    await expect(promessa).rejects.toMatchObject({ status: 403 });
    expect(registro.assinados).toEqual([]);
  });
});

describe('justifications.service — obterUrlDeVisualizacao', () => {
  it('deveNegarComForbiddenQuandoARlsNaoDevolveuALinha', async () => {
    // Inclui o banco antigo: sem a coluna `attempt`, a leitura é recusada e
    // volta vazia — 403 até as migrations (decisão do dono, 25/09).
    const { service } = criarCenario({ paraVisualizar: null });

    await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('deveNegarQuandoAJustificativaNaoTemAnexo', async () => {
    // Justificativa só com texto é válida — mas não há arquivo para entregar.
    const { service } = criarCenario({
      paraVisualizar: comAnexo({ proof_provider: null, proof_public_id: null }),
    });

    await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('deveRecusarProvedorQueNaoEhCloudinary', async () => {
    const { service, registro } = criarCenario({
      paraVisualizar: comAnexo({ proof_provider: 'supabase_storage' }),
    });

    await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
    expect(registro.publicIdsVisualizados).toHaveLength(0);
  });

  it('deveRepassarOTokenDoChamadorParaARlsDecidir', async () => {
    const { service, registro } = criarCenario({ paraVisualizar: comAnexo() });

    await service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR);

    expect(registro.buscas).toEqual([
      { justificationId: JUSTIFICATIVA, authorization: AUTORIZACAO },
    ]);
  });

  it.each([
    ['primeira tentativa', `justificativas/${USUARIO_DO_TOKEN}/${JUSTIFICATIVA}`],
    ['segunda tentativa', `justificativas/${USUARIO_DO_TOKEN}/${JUSTIFICATIVA}-2`],
    ['legado por aula', `justificativas/${USUARIO_DO_TOKEN}/${AULA}`],
  ])('deveAssinarOCaminhoDerivadoIgualAoGravado (%s)', async (_caso, gravado) => {
    const { service, registro } = criarCenario({
      paraVisualizar: comAnexo({ proof_public_id: gravado }),
    });

    const anexo = await service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR);

    expect(registro.publicIdsVisualizados).toEqual([gravado]);
    expect(anexo.url).toBe(`https://url-assinada/${gravado}`);
  });

  it.each([
    ['o anexo de outro aluno', `justificativas/${OUTRO_ALUNO}/${JUSTIFICATIVA}`],
    ['outra pasta do mesmo aluno', `comprovantes/${USUARIO_DO_TOKEN}/${JUSTIFICATIVA}`],
    ['uma tentativa que não existe', `justificativas/${USUARIO_DO_TOKEN}/${JUSTIFICATIVA}-3`],
    ['um nome qualquer', 'ignorado'],
  ])('deveNegarQuandoOPonteiroGravadoApontaPara %s', async (_caso, gravado) => {
    // Regressão do padrão C-2: enquanto pendente, o aluno altera
    // proof_public_id. Nenhum valor fora dos derivados é assinado.
    const { service, registro } = criarCenario({
      paraVisualizar: comAnexo({ proof_public_id: gravado }),
    });

    await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
    expect(registro.publicIdsVisualizados).toEqual([]);
  });

  it('naoDeveAceitarOCaminhoPorAulaQuandoAJustificativaEhDaSemana', async () => {
    // Justificativa da semana não tem aula: `justificativas/<uid>/null` não
    // pode virar um caminho válido por acidente.
    const { service } = criarCenario({
      paraVisualizar: comAnexo({
        class_id: null,
        proof_public_id: `justificativas/${USUARIO_DO_TOKEN}/null`,
      }),
    });

    await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('deveDerivarOCaminhoDoDonoQuandoOProfessorRevisa', async () => {
    // O professor abre o anexo do ALUNO: o caminho é o do dono da linha, não
    // o de quem está olhando — e isso não é tratado como anomalia.
    const gravado = `justificativas/${OUTRO_ALUNO}/${JUSTIFICATIVA}`;
    const { service, registro } = criarCenario({
      paraVisualizar: comAnexo({ user_id: OUTRO_ALUNO, proof_public_id: gravado }),
    });

    await service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR);

    expect(registro.publicIdsVisualizados).toEqual([gravado]);
  });

  it('deveLimitarAPaginaPedidaAoTotalDoDocumento', async () => {
    const { service } = criarCenario({ paraVisualizar: comAnexo(), paginas: 2 });

    const anexo = await service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR, 50);

    expect(anexo).toMatchObject({ paginas: 2, pagina: 2 });
  });
});
