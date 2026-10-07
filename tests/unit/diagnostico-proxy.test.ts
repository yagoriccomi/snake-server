import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { criarApp } from '../../src/app.js';
import { logger } from '../../src/lib/logger.js';
import { contarEntradasEncaminhadas } from '../../src/middleware/diagnostico-proxy.js';
import { criarDependenciasFalsas, criarEspioes } from '../ajudantes/dependencias-falsas.js';

/**
 * Diagnóstico temporário do `trust proxy` (D7). O que importa provar: o log
 * tem o NÚMERO de entradas e nunca o endereço, que é dado pessoal. [#63]
 */

const MENSAGEM = 'diagnóstico do proxy';

// Endereços de documentação (RFC 5737): nunca são de alguém.
const CADEIA_DE_TRES = '203.0.113.7, 198.51.100.4, 192.0.2.1';

describe('contarEntradasEncaminhadas', () => {
  it.each([
    [undefined, 0],
    ['', 0],
    ['203.0.113.7', 1],
    [CADEIA_DE_TRES, 3],
    ['203.0.113.7,198.51.100.4', 2],
    ['203.0.113.7, , 198.51.100.4,', 2],
  ])('deveContar_%s_como_%i', (valor, esperado) => {
    expect(contarEntradasEncaminhadas(valor)).toBe(esperado);
  });
});

describe('diagnosticoDeProxy no app', () => {
  let espiaoDoInfo: MockInstance<typeof logger.info>;

  beforeEach(() => {
    espiaoDoInfo = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function chamadasDoDiagnostico(): Parameters<typeof logger.info>[] {
    return espiaoDoInfo.mock.calls.filter(([mensagem]) => mensagem === MENSAGEM);
  }

  it('deveGravarSoAQuantidadeDeEntradasQuandoORequisitanteChegaPorProxies', async () => {
    const app = criarApp(criarDependenciasFalsas(criarEspioes()));

    await request(app).post('/v1/proofs/sign-upload').set('X-Forwarded-For', CADEIA_DE_TRES);

    const chamadas = chamadasDoDiagnostico();
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.[1]).toEqual({
      traceId: expect.any(String),
      entradasNoXForwardedFor: 3,
    });
  });

  it('naoDeveGravarNenhumEnderecoNoLog', async () => {
    const app = criarApp(criarDependenciasFalsas(criarEspioes()));

    await request(app).post('/v1/proofs/sign-upload').set('X-Forwarded-For', CADEIA_DE_TRES);

    const gravado = JSON.stringify(chamadasDoDiagnostico());
    for (const endereco of CADEIA_DE_TRES.split(', ')) {
      expect(gravado).not.toContain(endereco);
    }
  });

  it('deveGravarZeroQuandoOCabecalhoNaoVem', async () => {
    const app = criarApp(criarDependenciasFalsas(criarEspioes()));

    await request(app).post('/v1/proofs/sign-upload');

    expect(chamadasDoDiagnostico()[0]?.[1]).toMatchObject({ entradasNoXForwardedFor: 0 });
  });

  it('naoDeveGravarNadaNoHealthCheck', async () => {
    // A Render bate no `/health` a cada poucos segundos: registrar isso só
    // enterraria as linhas que interessam.
    const app = criarApp(criarDependenciasFalsas(criarEspioes()));

    await request(app).get('/health').set('X-Forwarded-For', CADEIA_DE_TRES);

    expect(chamadasDoDiagnostico()).toHaveLength(0);
  });
});
