import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TipoDeRecurso } from '../../src/jobs/media-cleanup/media-cleanup.constants.js';
import {
  varrerOrfaos,
  type AssetListado,
  type DependenciasDaVarredura,
  type PaginaDeAssets,
} from '../../src/jobs/media-cleanup/media-cleanup.orfaos.js';
import type { ResultadoDaExclusao } from '../../src/jobs/media-cleanup/media-cleanup.service.js';
import { logger } from '../../src/lib/logger.js';

/**
 * A varredura de órfãos (contrato § 13.3, item 4.5). O que ela NUNCA pode
 * fazer é apagar um anexo que tem dono: por isso a maior parte dos casos
 * ataca o que deve ficar, e a falha de consulta que precisa parar tudo.
 */

const AGORA = Date.parse('2026-09-25T03:00:00Z');
const HA_DOIS_DIAS = '2026-09-23T03:00:00Z';
const HA_UMA_HORA = '2026-09-25T02:00:00Z';

const DONO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function caminho(pasta: string, registro: string): string {
  return `${pasta}/${DONO}/${registro}`;
}

const ORFAO = caminho('motivos', '11111111-1111-4111-8111-111111111111');
const REFERENCIADO = caminho('motivos', '22222222-2222-4222-8222-222222222222');

type Acervo = Partial<Record<string, AssetListado[][]>>;

/** Chave do acervo falso: prefixo + tipo, com uma página por item do array. */
function chave(prefixo: string, tipo: TipoDeRecurso): string {
  return `${prefixo}|${tipo}`;
}

function criarCenario(acervo: Acervo, referenciados: string[] = []) {
  const apagados: { caminho: string; tipo: TipoDeRecurso }[] = [];
  const listagens: { prefixo: string; tipo: TipoDeRecurso; cursor: string | null }[] = [];
  const consultas: string[][] = [];

  const apagarDaCloudinaryMock = vi.fn(
    async (publicId: string, tipo: TipoDeRecurso): Promise<ResultadoDaExclusao> => {
      apagados.push({ caminho: publicId, tipo });
      return 'apagado';
    },
  );
  const listarAssetsMock = vi.fn(
    async (
      prefixo: string,
      tipo: TipoDeRecurso,
      cursor: string | null,
    ): Promise<PaginaDeAssets> => {
      listagens.push({ prefixo, tipo, cursor });
      const paginas = acervo[chave(prefixo, tipo)] ?? [[]];
      const indice = cursor === null ? 0 : Number(cursor);
      const proximo = indice + 1 < paginas.length ? String(indice + 1) : null;
      return { assets: paginas[indice] ?? [], proximoCursor: proximo };
    },
  );
  const caminhosReferenciadosMock = vi.fn(async (caminhos: string[]) => {
    consultas.push(caminhos);
    return new Set(caminhos.filter((c) => referenciados.includes(c)));
  });

  const deps: DependenciasDaVarredura = {
    midia: { apagarDaCloudinary: apagarDaCloudinaryMock, apagarDoStorage: vi.fn() },
    acervo: { listarAssets: listarAssetsMock },
    referencias: { caminhosReferenciados: caminhosReferenciadosMock },
    agoraEmMs: () => AGORA,
  };

  return {
    deps,
    apagados,
    listagens,
    consultas,
    apagarDaCloudinaryMock,
    listarAssetsMock,
    caminhosReferenciadosMock,
  };
}

function asset(publicId: string, criadoEm = HA_DOIS_DIAS): AssetListado {
  return { public_id: publicId, created_at: criadoEm };
}

describe('varrerOrfaos', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deveListarAsDuasPastasNosTresTiposDeRecurso', async () => {
    const { deps, listagens } = criarCenario({});

    await varrerOrfaos(deps);

    expect(listagens.map(({ prefixo, tipo }) => `${prefixo}${tipo}`)).toEqual([
      'justificativas/image',
      'justificativas/raw',
      'justificativas/video',
      'motivos/image',
      'motivos/raw',
      'motivos/video',
    ]);
  });

  it('deveApagarOArquivoSemLinhaComMaisDe24hNoTipoEmQueFoiListado', async () => {
    const { deps, apagados } = criarCenario({ [chave('motivos/', 'raw')]: [[asset(ORFAO)]] });

    const resultado = await varrerOrfaos(deps);

    expect(apagados).toEqual([{ caminho: ORFAO, tipo: 'raw' }]);
    expect(resultado).toEqual({ apagados: 1, falhas: 0, interrompida: false });
  });

  it('naoDeveApagarOArquivoQueOBancoReferencia', async () => {
    const { deps, apagados } = criarCenario(
      { [chave('motivos/', 'image')]: [[asset(ORFAO), asset(REFERENCIADO)]] },
      [REFERENCIADO],
    );

    await varrerOrfaos(deps);

    expect(apagados.map((a) => a.caminho)).toEqual([ORFAO]);
  });

  it('naoDeveApagarOArquivoComMenosDe24hPorqueOEnvioPodeEstarEmCurso', async () => {
    // O cliente envia o arquivo ANTES de gravar a linha: sem a folga, a
    // varredura apagaria um anexo no meio do envio.
    const { deps, apagados, consultas } = criarCenario({
      [chave('motivos/', 'image')]: [[asset(ORFAO, HA_UMA_HORA)]],
    });

    await varrerOrfaos(deps);

    expect(apagados).toEqual([]);
    expect(consultas).toEqual([]);
  });

  it.each([
    ['data ilegível', asset(ORFAO, 'ontem')],
    ['caminho fora do formato do contrato', asset('motivos/pasta-estranha/arquivo')],
    ['segmento a mais', asset(`${ORFAO}/extra`)],
  ])('naoDeveApagarQuandoOAssetTem %s', async (_caso, listado) => {
    const { deps, apagados } = criarCenario({ [chave('motivos/', 'image')]: [[listado]] });

    await varrerOrfaos(deps);

    expect(apagados).toEqual([]);
  });

  it('deveSeguirOCursorAteAUltimaPagina', async () => {
    const segundo = caminho('justificativas', '33333333-3333-4333-8333-333333333333');
    const primeiro = caminho('justificativas', '44444444-4444-4444-8444-444444444444');
    const { deps, apagados, listagens } = criarCenario({
      [chave('justificativas/', 'image')]: [[asset(primeiro)], [asset(segundo)]],
    });

    await varrerOrfaos(deps);

    expect(apagados.map((a) => a.caminho)).toEqual([primeiro, segundo]);
    expect(listagens.filter((l) => l.prefixo === 'justificativas/' && l.tipo === 'image')).toEqual([
      { prefixo: 'justificativas/', tipo: 'image', cursor: null },
      { prefixo: 'justificativas/', tipo: 'image', cursor: '1' },
    ]);
  });

  it('deveConsultarAsReferenciasEmLotesDe100', async () => {
    const muitos = Array.from({ length: 250 }, (_, i) =>
      asset(caminho('motivos', `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)),
    );
    const { deps, consultas } = criarCenario({ [chave('motivos/', 'image')]: [muitos] });

    await varrerOrfaos(deps);

    expect(consultas.map((lote) => lote.length)).toEqual([100, 100, 50]);
  });

  it('deveInterromperSemApagarNadaQuandoAConsultaAoBancoFalha', async () => {
    // "Não consegui ver a referência" nunca pode virar "não há referência":
    // num banco sem as tabelas novas, a varredura para aqui, todo dia.
    const { deps, apagados, caminhosReferenciadosMock } = criarCenario({
      [chave('justificativas/', 'image')]: [[asset(ORFAO.replace('motivos', 'justificativas'))]],
      [chave('motivos/', 'image')]: [[asset(ORFAO)]],
    });
    caminhosReferenciadosMock.mockRejectedValue(new Error('HTTP 404'));

    const resultado = await varrerOrfaos(deps);

    expect(apagados).toEqual([]);
    expect(resultado).toEqual({ apagados: 0, falhas: 0, interrompida: true });
  });

  it('deveInterromperQuandoAListagemFalha', async () => {
    const { deps, apagados, listarAssetsMock } = criarCenario({
      [chave('motivos/', 'image')]: [[asset(ORFAO)]],
    });
    listarAssetsMock.mockRejectedValueOnce(new Error('rate limited'));

    const resultado = await varrerOrfaos(deps);

    expect(apagados).toEqual([]);
    expect(resultado.interrompida).toBe(true);
  });

  it('umaExclusaoQueFalhaNaoDeveImpedirAsDemais', async () => {
    const outro = caminho('motivos', '55555555-5555-4555-8555-555555555555');
    const { deps, apagarDaCloudinaryMock } = criarCenario({
      [chave('motivos/', 'image')]: [[asset(ORFAO), asset(outro)]],
    });
    apagarDaCloudinaryMock.mockRejectedValueOnce(new Error('Cloudinary indisponível'));

    const resultado = await varrerOrfaos(deps);

    expect(apagarDaCloudinaryMock).toHaveBeenCalledTimes(2);
    expect(resultado).toEqual({ apagados: 1, falhas: 1, interrompida: false });
  });
});
