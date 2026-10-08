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
 *  2. O anexo legado por aula não é mais assinado (D42 revista), mas o já
 *     gravado continua abrindo.
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

  const JA_DECIDIDA = {
    status: 409,
    code: 'justification_not_pending',
    message: 'Esta justificativa já foi decidida e não aceita anexo',
  };
  const JA_TEM_ANEXO = {
    status: 409,
    code: 'justification_already_has_attachment',
    message: 'Esta justificativa já tem anexo',
  };
  const FORA_DO_FORMATO = { status: 502, code: 'supabase_invalid_response' };

  it.each<[string, JustificativaParaAssinar | null, Record<string, unknown>]>([
    ['a RLS não libera a linha', null, { status: 403, code: 'forbidden' }],
    [
      'a justificativa é de outra pessoa (o professor lê, mas não anexa)',
      pendente({ user_id: OUTRO_ALUNO }),
      { status: 403, code: 'forbidden' },
    ],
    [
      'a justificativa de outra pessoa já foi decidida (o 409 não vaza)',
      pendente({ user_id: OUTRO_ALUNO, status: 'approved' }),
      { status: 403, code: 'forbidden' },
    ],
    ['a justificativa já foi aprovada', pendente({ status: 'approved' }), JA_DECIDIDA],
    ['a justificativa já foi negada', pendente({ status: 'rejected' }), JA_DECIDIDA],
    [
      'a justificativa já tem anexo',
      pendente({ proof_public_id: `justificativas/${USUARIO_DO_TOKEN}/${JUSTIFICATIVA}` }),
      JA_TEM_ANEXO,
    ],
    [
      'a justificativa decidida também tem anexo (decidida pesa mais)',
      pendente({ status: 'approved', proof_public_id: 'qualquer' }),
      JA_DECIDIDA,
    ],
    ['a tentativa está fora de 1 e 2', pendente({ attempt: 3 }), FORA_DO_FORMATO],
    ['a tentativa é zero', pendente({ attempt: 0 }), FORA_DO_FORMATO],
  ])('deveRecusarSemAssinarQuando %s', async (_caso, linha, erro) => {
    const { service, registro } = criarCenario({ paraAssinar: linha });

    const promessa = service.assinarUploadDaJustificativa(CHAMADOR, JUSTIFICATIVA);

    await expect(promessa).rejects.toBeInstanceOf(HttpError);
    await expect(promessa).rejects.toMatchObject(erro);
    expect(registro.assinados).toEqual([]);
  });
});

describe('justifications.service — obterUrlDeVisualizacao', () => {
  const SEM_ANEXO = {
    status: 404,
    code: 'justification_attachment_not_found',
    message: 'Esta justificativa não tem anexo',
  };
  const ARMAZENAMENTO_ANTIGO = {
    status: 409,
    code: 'justification_attachment_not_on_cloudinary',
    message: 'Este anexo está no armazenamento antigo e não abre por aqui',
  };
  const FORA_DO_LUGAR = {
    status: 409,
    code: 'justification_attachment_path_mismatch',
    message: 'O anexo desta justificativa não está no lugar esperado',
  };

  it('deveNegarComForbiddenQuandoARlsNaoDevolveuALinha', async () => {
    // "Não existe" e "não é seu" respondem igual: sem oráculo de enumeração.
    const { service } = criarCenario({ paraVisualizar: null });

    await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toMatchObject({
      status: 403,
    });
  });

  it.each([
    ['sem provedor nem public_id', null, null],
    ['na Cloudinary sem public_id', 'cloudinary', null],
    ['sem provedor, com public_id', null, `justificativas/${USUARIO_DO_TOKEN}/${JUSTIFICATIVA}`],
  ])(
    'deveResponder404QuandoAJustificativaNaoTemAnexo (%s)',
    async (_caso, proof_provider, proof_public_id) => {
      // Justificativa só com texto é válida — mas não há arquivo para entregar.
      const { service } = criarCenario({
        paraVisualizar: comAnexo({ proof_provider, proof_public_id }),
      });

      await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toMatchObject(
        SEM_ANEXO,
      );
    },
  );

  it.each([
    ['com public_id', `justificativas/${USUARIO_DO_TOKEN}/${JUSTIFICATIVA}`],
    ['sem public_id, como o legado do Storage', null],
  ])('deveResponder409AoProvedorQueNaoEhCloudinary (%s)', async (_caso, proof_public_id) => {
    const { service, registro } = criarCenario({
      paraVisualizar: comAnexo({ proof_provider: 'supabase_storage', proof_public_id }),
    });

    await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toMatchObject(
      ARMAZENAMENTO_ANTIGO,
    );
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
  ])('deveResponder409SemAssinarQuandoOPonteiroGravadoApontaPara %s', async (_caso, gravado) => {
    // Regressão do padrão C-2: enquanto pendente, o aluno altera
    // proof_public_id. Nenhum valor fora dos derivados é assinado.
    const { service, registro } = criarCenario({
      paraVisualizar: comAnexo({ proof_public_id: gravado }),
    });

    await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toMatchObject(
      FORA_DO_LUGAR,
    );
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

    await expect(service.obterUrlDeVisualizacao(JUSTIFICATIVA, CHAMADOR)).rejects.toMatchObject(
      FORA_DO_LUGAR,
    );
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
