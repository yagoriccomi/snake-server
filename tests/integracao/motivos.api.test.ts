import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarApp } from '../../src/app.js';
import {
  AGORA_EM_SEGUNDOS,
  ANEXO_DE_MOTIVO_INVISIVEL,
  ANEXO_DE_MOTIVO_VISIVEL,
  MOTIVO_NEGADO,
  MOTIVO_PERMITIDO,
  TOKEN_RECUSADO,
  TOKEN_VALIDO,
  URL_ASSINADA_FALSA,
  USUARIO_DONO,
  criarDependenciasFalsas,
  criarEspioes,
  type Espioes,
} from '../ajudantes/dependencias-falsas.js';

/**
 * Integração do módulo motivos (contrato § 13.1): a aplicação inteira sobe
 * com Supabase e Cloudinary substituídos por dublês. Sem rede. [#42][#45]
 */

/** O uuid das conferências do G2 (contrato § 14). */
const UUID_DO_G2 = '00000000-0000-4000-8000-000000000000';
const ANEXO_NOVO = '5e4d3c2b-1a0f-4e9d-8c7b-6a5f4e3d2c1b';

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

describe('POST /v1/motivos/sign-upload', () => {
  it('deveAssinarNaPastaDoUsuarioDoTokenQuandoOBancoLibera', async () => {
    const resposta = await request(app)
      .post('/v1/motivos/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send({ motivoId: MOTIVO_PERMITIDO, anexoId: ANEXO_NOVO });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({
      folder: `motivos/${USUARIO_DONO.id}`,
      public_id: ANEXO_NOVO,
      type: 'authenticated',
      timestamp: AGORA_EM_SEGUNDOS,
      overwrite: false,
      allowed_formats: 'jpg,png,webp,heic,pdf',
    });
    expect(espioes.perguntasDePermissao).toEqual([
      { motivoId: MOTIVO_PERMITIDO, authorization: TOKEN_VALIDO },
    ]);
  });

  it('deveNegarComForbiddenQuandoOBancoNaoLibera', async () => {
    const resposta = await request(app)
      .post('/v1/motivos/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send({ motivoId: MOTIVO_NEGADO, anexoId: ANEXO_NOVO });

    expect(resposta.status).toBe(403);
    expect(resposta.body).not.toHaveProperty('signature');
  });

  it('deveResponder401NoTokenSemTokenComoNaConferenciaDoG2', async () => {
    const resposta = await request(app)
      .post('/v1/motivos/sign-upload')
      .send({ motivoId: UUID_DO_G2, anexoId: UUID_DO_G2 });

    expect(resposta.status).toBe(401);
    expect(resposta.body.code).toBe('no_token');
    expect(espioes.perguntasDePermissao).toHaveLength(0);
  });

  it('deveResponder401QuandoOTokenNaoEhReconhecido', async () => {
    const resposta = await request(app)
      .post('/v1/motivos/sign-upload')
      .set('Authorization', TOKEN_RECUSADO)
      .send({ motivoId: MOTIVO_PERMITIDO, anexoId: ANEXO_NOVO });

    expect(resposta.status).toBe(401);
  });

  it.each([
    ['sem anexoId', { motivoId: MOTIVO_PERMITIDO }],
    ['sem motivoId', { anexoId: ANEXO_NOVO }],
    ['anexoId que tenta mudar de pasta', { motivoId: MOTIVO_PERMITIDO, anexoId: '../outro' }],
    ['motivoId que não é UUID', { motivoId: 'x', anexoId: ANEXO_NOVO }],
  ])('deveRecusar400SemConsultarOSupabaseQuandoOCorpoVem %s', async (_caso, corpo) => {
    const resposta = await request(app)
      .post('/v1/motivos/sign-upload')
      .set('Authorization', TOKEN_VALIDO)
      .send(corpo);

    expect(resposta.status).toBe(400);
    expect(espioes.tokensVerificados).toHaveLength(0);
  });
});

describe('POST /v1/motivos/view-url', () => {
  it('deveEntregarAUrlDoAnexoQuandoARlsLibera', async () => {
    const resposta = await request(app)
      .post('/v1/motivos/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ anexoId: ANEXO_DE_MOTIVO_VISIVEL });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ url: URL_ASSINADA_FALSA, paginas: 1, pagina: 1 });
    expect(espioes.buscasPorAnexoDeMotivo).toEqual([
      { anexoId: ANEXO_DE_MOTIVO_VISIVEL, authorization: TOKEN_VALIDO },
    ]);
  });

  it('deveNegarComForbiddenQuandoARlsNaoLibera', async () => {
    const resposta = await request(app)
      .post('/v1/motivos/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ anexoId: ANEXO_DE_MOTIVO_INVISIVEL });

    expect(resposta.status).toBe(403);
  });

  it('deveResponder401SemToken', async () => {
    const resposta = await request(app)
      .post('/v1/motivos/view-url')
      .send({ anexoId: ANEXO_DE_MOTIVO_VISIVEL });

    expect(resposta.status).toBe(401);
  });

  it('deveRecusar400QuandoAPaginaPassaDoTeto', async () => {
    const resposta = await request(app)
      .post('/v1/motivos/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ anexoId: ANEXO_DE_MOTIVO_VISIVEL, pagina: 1000 });

    expect(resposta.status).toBe(400);
  });

  it('naoDeveVazarDetalheInternoNaRespostaDeErro', async () => {
    const resposta = await request(app)
      .post('/v1/motivos/view-url')
      .set('Authorization', TOKEN_VALIDO)
      .send({ anexoId: ANEXO_DE_MOTIVO_INVISIVEL });

    expect(JSON.stringify(resposta.body)).not.toContain('action_reason_attachments');
    expect(resposta.body).not.toHaveProperty('stack');
  });
});
