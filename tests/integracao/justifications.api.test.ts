import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarApp } from '../../src/app.js';
import {
  AGORA_EM_SEGUNDOS,
  AULA_DA_JUSTIFICATIVA,
  JUSTIFICATIVA_INVISIVEL,
  JUSTIFICATIVA_PENDENTE,
  JUSTIFICATIVA_REENVIADA,
  JUSTIFICATIVA_VISIVEL,
  TOKEN_VALIDO,
  URL_ASSINADA_FALSA,
  USUARIO_DONO,
  criarDependenciasFalsas,
  criarEspioes,
  type Espioes,
} from '../ajudantes/dependencias-falsas.js';

/**
 * Integração do módulo de justificativas: a aplicação inteira sobe com
 * Supabase e Cloudinary substituídos por dublês. Sem rede. [#42][#45]
 */

let app: Express;
let espioes: Espioes;

beforeEach(() => {
  espioes = criarEspioes();
  app = criarApp(criarDependenciasFalsas(espioes));
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /v1/justifications/sign-upload', () => {
  it('deveAssinarNaPastaDoUsuarioDoToken', async () => {
    const resposta = await request(app)
      .post('/v1/justifications/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send({ classId: AULA_DA_JUSTIFICATIVA });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({
      folder: `justificativas/${USUARIO_DONO.id}`,
      public_id: AULA_DA_JUSTIFICATIVA,
      type: 'authenticated',
      timestamp: AGORA_EM_SEGUNDOS,
    });
  });

  it('deveRecusarSemTokenAntesDeAssinar', async () => {
    const resposta = await request(app)
      .post('/v1/justifications/sign-upload')
      .send({ classId: AULA_DA_JUSTIFICATIVA });

    expect(resposta.status).toBe(401);
  });

  it('deveRejeitarClassIdMalformadoSemConsultarOSupabase', async () => {
    // Validação antes da autenticação: lixo no corpo não custa ida à rede.
    const resposta = await request(app)
      .post('/v1/justifications/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send({ classId: '../../outro-aluno' });

    expect(resposta.status).toBe(400);
    expect(espioes.tokensVerificados).toHaveLength(0);
  });
});

describe('POST /v1/justifications/sign-upload — as duas formas (contrato § 13.2)', () => {
  /** O uuid das conferências do G2 (contrato § 14). */
  const UUID_DO_G2 = '00000000-0000-4000-8000-000000000000';

  it('deveManterOLegadoSemOverwriteNemAllowedFormats', async () => {
    const resposta = await request(app)
      .post('/v1/justifications/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send({ classId: AULA_DA_JUSTIFICATIVA });

    expect(resposta.status).toBe(200);
    expect(resposta.body).not.toHaveProperty('overwrite');
    expect(resposta.body).not.toHaveProperty('allowed_formats');
    expect(espioes.buscasPorJustificativa).toHaveLength(0);
  });

  it('deveAssinarAPrimeiraTentativaComOIdComoNome', async () => {
    const resposta = await request(app)
      .post('/v1/justifications/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send({ justificationId: JUSTIFICATIVA_PENDENTE });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({
      folder: `justificativas/${USUARIO_DONO.id}`,
      public_id: JUSTIFICATIVA_PENDENTE,
      type: 'authenticated',
      overwrite: false,
      allowed_formats: 'jpg,png,webp,heic,pdf',
    });
  });

  it('deveAssinarASegundaTentativaComOSufixo', async () => {
    const resposta = await request(app)
      .post('/v1/justifications/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send({ justificationId: JUSTIFICATIVA_REENVIADA });

    expect(resposta.status).toBe(200);
    expect(resposta.body.public_id).toBe(`${JUSTIFICATIVA_REENVIADA}-2`);
  });

  it('deveNegarComForbiddenQuandoAJustificativaJaTemAnexo', async () => {
    const resposta = await request(app)
      .post('/v1/justifications/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send({ justificationId: JUSTIFICATIVA_VISIVEL });

    expect(resposta.status).toBe(403);
  });

  it('deveNegarComForbiddenQuandoARlsNaoLiberaALinha', async () => {
    const resposta = await request(app)
      .post('/v1/justifications/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send({ justificationId: JUSTIFICATIVA_INVISIVEL });

    expect(resposta.status).toBe(403);
  });

  it('deveResponder401SemTokenComoNaConferenciaDoG2', async () => {
    // O servidor antigo respondia 400 a este corpo; o novo, 401 (contrato § 14).
    const resposta = await request(app)
      .post('/v1/justifications/sign-upload')
      .send({ justificationId: UUID_DO_G2 });

    expect(resposta.status).toBe(401);
    expect(resposta.body.code).toBe('no_token');
  });

  it.each([
    [
      'os dois campos juntos',
      { classId: AULA_DA_JUSTIFICATIVA, justificationId: JUSTIFICATIVA_PENDENTE },
    ],
    ['nenhum dos dois', {}],
    ['justificationId que não é UUID', { justificationId: '../x' }],
  ])('deveRecusar400SemConsultarOSupabaseQuandoOCorpoTem %s', async (_caso, corpo) => {
    const resposta = await request(app)
      .post('/v1/justifications/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send(corpo);

    expect(resposta.status).toBe(400);
    expect(espioes.tokensVerificados).toHaveLength(0);
  });
});

describe('POST /v1/justifications/view-url', () => {
  it('deveEntregarAUrlDoAnexoQuandoARlsLibera', async () => {
    const resposta = await request(app)
      .post('/v1/justifications/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ justificationId: JUSTIFICATIVA_VISIVEL });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ url: URL_ASSINADA_FALSA, paginas: 1, pagina: 1 });
    expect(espioes.buscasPorJustificativa).toEqual([
      { justificationId: JUSTIFICATIVA_VISIVEL, authorization: TOKEN_VALIDO },
    ]);
  });

  it('deveNegarComForbiddenQuandoARlsNaoLibera', async () => {
    const resposta = await request(app)
      .post('/v1/justifications/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ justificationId: JUSTIFICATIVA_INVISIVEL });

    expect(resposta.status).toBe(403);
  });

  it('naoDeveVazarDetalheInternoNaRespostaDeErro', async () => {
    const resposta = await request(app)
      .post('/v1/justifications/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ justificationId: JUSTIFICATIVA_INVISIVEL });

    expect(JSON.stringify(resposta.body)).not.toContain('absence_justifications');
    expect(resposta.body).not.toHaveProperty('stack');
  });
});
