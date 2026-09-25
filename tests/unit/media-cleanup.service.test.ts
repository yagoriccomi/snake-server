import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  MotivoDaFila,
  TipoDeRecurso,
} from '../../src/jobs/media-cleanup/media-cleanup.constants.js';
import {
  processarLote,
  type DependenciasDoWorker,
  type ExclusorDeMidia,
  type ItemDaFila,
  type RepositorioDaFila,
  type ResultadoDaExclusao,
} from '../../src/jobs/media-cleanup/media-cleanup.service.js';
import { logger } from '../../src/jobs/media-cleanup/media-cleanup.logger.js';

/**
 * A regra do worker: consumir a fila de eliminação sem deixar um item ruim
 * travar os outros, e sem perder de vista o que falhou. A maior parte dos
 * casos ataca falha — é para isso que este worker existe. [Regra de Ouro nº 3]
 */

const TITULAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OUTRO_TITULAR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REGISTRO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** Caminho no formato do contrato (§ 13.3): `<pasta>/<uuid do dono>/<uuid do registro>`. */
function caminho(pasta: string, registro = REGISTRO): string {
  return `${pasta}/${TITULAR}/${registro}`;
}

function itemCloudinary(overrides: Partial<ItemDaFila> = {}): ItemDaFila {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    provider: 'cloudinary',
    asset_ref: caminho('comprovantes'),
    motivo: 'comprovante_recusado',
    tentativas: 0,
    ...overrides,
  };
}

function itemStorage(overrides: Partial<ItemDaFila> = {}): ItemDaFila {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    provider: 'supabase_storage',
    asset_ref: 'aluno-1/pagamento-2_recibo.jpg',
    motivo: 'migrado_de_provedor',
    tentativas: 0,
    ...overrides,
  };
}

function criarCenario(itens: ItemDaFila[]) {
  const chamadasCloudinary: string[] = [];
  const tiposPedidos: TipoDeRecurso[] = [];
  const chamadasStorage: string[] = [];
  const processados: string[] = [];
  const falhas: { id: string; tentativas: number; erro: string }[] = [];

  // Guardados como consts próprias (não como acesso `midia.metodo` depois),
  // porque o lint não permite extrair referência de método de um objeto
  // literal — poderia perder o `this` se fosse um método de verdade em vez
  // de um dublê. [@typescript-eslint/unbound-method]
  const apagarDaCloudinaryMock = vi.fn(
    async (publicId: string, tipo: TipoDeRecurso): Promise<ResultadoDaExclusao> => {
      chamadasCloudinary.push(publicId);
      tiposPedidos.push(tipo);
      return 'apagado';
    },
  );
  const apagarDoStorageMock = vi.fn(async (caminhoNoStorage: string) => {
    chamadasStorage.push(caminhoNoStorage);
  });
  const listarPendentesMock = vi.fn(async () => itens);
  const marcarProcessadoMock = vi.fn(async (id: string) => {
    processados.push(id);
  });
  const marcarFalhaMock = vi.fn(async (id: string, tentativas: number, erro: string) => {
    falhas.push({ id, tentativas, erro });
  });
  const marcarInvalidoMock = vi.fn(async (_id: string, _erro: string) => {});

  const midia: ExclusorDeMidia = {
    apagarDaCloudinary: apagarDaCloudinaryMock,
    apagarDoStorage: apagarDoStorageMock,
  };

  const fila: RepositorioDaFila = {
    listarPendentes: listarPendentesMock,
    marcarProcessado: marcarProcessadoMock,
    marcarFalha: marcarFalhaMock,
    marcarInvalido: marcarInvalidoMock,
  };

  const deps: DependenciasDoWorker = { midia, fila };
  return {
    deps,
    chamadasCloudinary,
    tiposPedidos,
    chamadasStorage,
    processados,
    falhas,
    apagarDaCloudinaryMock,
    apagarDoStorageMock,
    listarPendentesMock,
    marcarProcessadoMock,
    marcarFalhaMock,
    marcarInvalidoMock,
  };
}

describe('processarLote', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deveApagarNaCloudinaryQuandoOProvedorEhCloudinary', async () => {
    const item = itemCloudinary();
    const { deps, chamadasCloudinary, processados } = criarCenario([item]);

    await processarLote(deps, 100);

    expect(chamadasCloudinary).toEqual([item.asset_ref]);
    expect(processados).toEqual([item.id]);
  });

  it('deveApagarNoStorageQuandoOProvedorEhSupabaseStorage', async () => {
    const item = itemStorage();
    const { deps, chamadasStorage, processados } = criarCenario([item]);

    await processarLote(deps, 100);

    expect(chamadasStorage).toEqual([item.asset_ref]);
    expect(processados).toEqual([item.id]);
  });

  it('naoDeveChamarOOutroProvedorQuandoProcessaUmItem', async () => {
    // Um item da Cloudinary jamais deve disparar uma chamada de exclusão no
    // Storage — misturar provedores apagaria (ou tentaria apagar) o arquivo
    // errado, ou o caminho errado no provedor errado.
    const item = itemCloudinary();
    const { deps, apagarDoStorageMock } = criarCenario([item]);

    await processarLote(deps, 100);

    expect(apagarDoStorageMock).not.toHaveBeenCalled();
  });

  it('umItemComFalhaNaoDeveImpedirOProcessamentoDosDemais', async () => {
    // O caso mais importante deste worker: um asset problemático (já
    // deletado manualmente, permissão mudou, o que for) não pode travar a
    // fila inteira. Os outros itens têm que seguir sendo processados. [#9]
    const caminhoRuim = caminho('comprovantes', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    const bomAntes = itemCloudinary({ id: 'a' });
    const ruim = itemCloudinary({ id: 'b', asset_ref: caminhoRuim });
    const bomDepois = itemCloudinary({ id: 'c' });

    const { deps, apagarDaCloudinaryMock, processados, falhas } = criarCenario([
      bomAntes,
      ruim,
      bomDepois,
    ]);
    apagarDaCloudinaryMock.mockImplementation(async (publicId: string) => {
      if (publicId === caminhoRuim) {
        throw new Error('Cloudinary indisponível');
      }
      return 'apagado';
    });

    const resultado = await processarLote(deps, 100);

    expect(processados).toEqual(['a', 'c']);
    expect(falhas).toHaveLength(1);
    expect(falhas[0]?.id).toBe('b');
    expect(resultado).toEqual({ processados: 2, falhas: 1, recusados: 0 });
  });

  it('naoDeveMarcarComoProcessadoQuandoAExclusaoFalha', async () => {
    // Marcar sucesso sobre uma exclusão que não aconteceu é o pior desfecho
    // possível aqui: o item sai da fila e o arquivo continua existindo,
    // órfão — a obrigação da LGPD fica "cumprida" no papel e não no fato.
    const item = itemCloudinary();
    const { deps, apagarDaCloudinaryMock, marcarProcessadoMock, marcarFalhaMock } = criarCenario([
      item,
    ]);
    apagarDaCloudinaryMock.mockRejectedValue(new Error('timeout'));

    await processarLote(deps, 100);

    expect(marcarProcessadoMock).not.toHaveBeenCalled();
    expect(marcarFalhaMock).toHaveBeenCalledWith(item.id, 1, 'timeout');
  });

  it('deveIncrementarOContadorDeTentativasACadaNovaFalha', async () => {
    const item = itemCloudinary({ tentativas: 3 });
    const { deps, apagarDaCloudinaryMock, marcarFalhaMock } = criarCenario([item]);
    apagarDaCloudinaryMock.mockRejectedValue(new Error('falhou'));

    await processarLote(deps, 100);

    expect(marcarFalhaMock).toHaveBeenCalledWith(item.id, 4, 'falhou');
  });

  it('naoDeveProcessarMaisItensDoQueOLimitePedido', async () => {
    const { deps, listarPendentesMock } = criarCenario([]);

    await processarLote(deps, 37);

    expect(listarPendentesMock).toHaveBeenCalledWith(37);
  });

  it('deveDevolverZeroSemErroQuandoAFilaEstaVazia', async () => {
    const { deps } = criarCenario([]);

    const resultado = await processarLote(deps, 100);

    expect(resultado).toEqual({ processados: 0, falhas: 0, recusados: 0 });
  });

  it('naoDevePropagarErroDeUmItemParaForaDoLote', async () => {
    // O chamador (o entrypoint do worker) não deve precisar de try/catch ao
    // redor de processarLote por causa de UM item ruim — a função absorve
    // a falha por item e devolve um resultado, nunca lança por isso.
    const item = itemCloudinary();
    const { deps, apagarDaCloudinaryMock } = criarCenario([item]);
    apagarDaCloudinaryMock.mockRejectedValue(new Error('boom'));

    await expect(processarLote(deps, 100)).resolves.toEqual({
      processados: 0,
      falhas: 1,
      recusados: 0,
    });
  });
});

/**
 * Item 4.1 do ROADMAP (contrato § 13.3): o worker apaga com `service_role`,
 * fora da RLS. Um `asset_ref` forjado na fila não pode virar a exclusão do
 * arquivo de outra pessoa — e a recusa é terminal, sem apagar nada.
 */
describe('processarLote — validação do caminho antes de apagar', () => {
  // A recusa alarma em `error` de propósito; aqui o alarme é esperado e só
  // poluiria a saída da suíte.
  let erroNoLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    erroNoLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const PASTAS_ACEITAS: [MotivoDaFila, string][] = [
    ['comprovante_recusado', 'comprovantes'],
    ['migrado_de_provedor', 'comprovantes'],
    ['retencao_expirada', 'comprovantes'],
    ['justificativa_removida', 'justificativas'],
    ['anexo_de_motivo_removido', 'motivos'],
    ['anexo_expirado', 'justificativas'],
    ['anexo_expirado', 'motivos'],
    ['conta_excluida', 'comprovantes'],
    ['conta_excluida', 'justificativas'],
    ['conta_excluida', 'motivos'],
  ];

  const PASTAS_RECUSADAS: [MotivoDaFila, string][] = [
    ['comprovante_recusado', 'justificativas'],
    ['migrado_de_provedor', 'motivos'],
    ['retencao_expirada', 'justificativas'],
    ['justificativa_removida', 'comprovantes'],
    ['justificativa_removida', 'motivos'],
    ['anexo_de_motivo_removido', 'justificativas'],
    ['anexo_de_motivo_removido', 'comprovantes'],
    ['anexo_expirado', 'comprovantes'],
  ];

  it.each(PASTAS_ACEITAS)('deveApagarQuandoOMotivo %s apontaPara %s/', async (motivo, pasta) => {
    const item = itemCloudinary({ motivo, asset_ref: caminho(pasta) });
    const { deps, chamadasCloudinary, processados, marcarInvalidoMock } = criarCenario([item]);

    await processarLote(deps, 100);

    expect(chamadasCloudinary).toEqual([item.asset_ref]);
    expect(processados).toEqual([item.id]);
    expect(marcarInvalidoMock).not.toHaveBeenCalled();
  });

  it.each(PASTAS_RECUSADAS)(
    'deveRecusarSemApagarQuandoOMotivo %s apontaPara %s/',
    async (motivo, pasta) => {
      const item = itemCloudinary({ motivo, asset_ref: caminho(pasta) });
      const { deps, apagarDaCloudinaryMock, marcarInvalidoMock, marcarProcessadoMock } =
        criarCenario([item]);

      const resultado = await processarLote(deps, 100);

      expect(apagarDaCloudinaryMock).not.toHaveBeenCalled();
      expect(marcarProcessadoMock).not.toHaveBeenCalled();
      expect(marcarInvalidoMock).toHaveBeenCalledWith(item.id, 'prefixo_invalido');
      expect(resultado).toEqual({ processados: 0, falhas: 0, recusados: 1 });
    },
  );

  const CAMINHOS_FORJADOS: [string, string][] = [
    [
      'subida de pasta até o arquivo de outra pessoa',
      `${caminho('comprovantes')}/../../${OUTRO_TITULAR}/${REGISTRO}`,
    ],
    [
      'segmento a mais apontando para outra pessoa',
      `comprovantes/${TITULAR}/${OUTRO_TITULAR}/${REGISTRO}`,
    ],
    ['pasta fora da lista do contrato', caminho('amostras')],
    ['caminho sem o dono', `comprovantes/${REGISTRO}`],
    ['sufixo diferente do -2 da segunda tentativa', `${caminho('comprovantes')}-3`],
    ['extensão no public_id', `${caminho('comprovantes')}.jpg`],
    ['prefixo antes da pasta', `x/${caminho('comprovantes')}`],
    ['uuid em maiúsculas', caminho('comprovantes', REGISTRO.toUpperCase())],
    ['quebra de linha no fim', `${caminho('comprovantes')}\n`],
  ];

  it.each(CAMINHOS_FORJADOS)(
    'deveRecusarSemApagarQuandoOCaminhoForjadoTem %s',
    async (_caso, assetRef) => {
      const item = itemCloudinary({ motivo: 'conta_excluida', asset_ref: assetRef });
      const { deps, apagarDaCloudinaryMock, marcarInvalidoMock } = criarCenario([item]);

      await processarLote(deps, 100);

      expect(apagarDaCloudinaryMock).not.toHaveBeenCalled();
      expect(marcarInvalidoMock).toHaveBeenCalledWith(item.id, 'prefixo_invalido');
    },
  );

  it('deveAceitarOSufixoDaSegundaTentativaDaJustificativa', async () => {
    const item = itemCloudinary({
      motivo: 'anexo_expirado',
      asset_ref: `${caminho('justificativas')}-2`,
    });
    const { deps, chamadasCloudinary } = criarCenario([item]);

    await processarLote(deps, 100);

    expect(chamadasCloudinary).toEqual([item.asset_ref]);
  });

  it('deveRecusarSemApagarQuandoOCaminhoDoStorageTemPontoPonto', async () => {
    const item = itemStorage({ asset_ref: `${TITULAR}/../${OUTRO_TITULAR}/recibo.jpg` });
    const { deps, apagarDoStorageMock, marcarInvalidoMock } = criarCenario([item]);

    await processarLote(deps, 100);

    expect(apagarDoStorageMock).not.toHaveBeenCalled();
    expect(marcarInvalidoMock).toHaveBeenCalledWith(item.id, 'prefixo_invalido');
  });

  it('naoDeveContarARecusaComoTentativaNemComoFalha', async () => {
    // Recusa não é falha passageira: `marcarFalha` incrementaria `tentativas`
    // e deixaria o item aberto para a próxima execução tentar de novo.
    const item = itemCloudinary({ asset_ref: caminho('motivos'), tentativas: 2 });
    const { deps, marcarFalhaMock } = criarCenario([item]);

    await processarLote(deps, 100);

    expect(marcarFalhaMock).not.toHaveBeenCalled();
  });

  it('umItemRecusadoNaoDeveImpedirOProcessamentoDosDemais', async () => {
    const forjado = itemCloudinary({ id: 'forjado', asset_ref: caminho('justificativas') });
    const legitimo = itemCloudinary({ id: 'legitimo' });
    const { deps, processados } = criarCenario([forjado, legitimo]);

    const resultado = await processarLote(deps, 100);

    expect(processados).toEqual(['legitimo']);
    expect(resultado).toEqual({ processados: 1, falhas: 0, recusados: 1 });
  });

  it('deveAlarmarSemGravarOCaminhoNoLogQuandoRecusa', async () => {
    // O caminho carrega o id do titular. O log leva o id do item da fila, que
    // basta para achar a linha, e nada do titular. [#63][#92]
    const item = itemCloudinary({ asset_ref: caminho('motivos') });
    const { deps } = criarCenario([item]);

    await processarLote(deps, 100);

    expect(erroNoLog).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(erroNoLog.mock.calls)).not.toContain(TITULAR);
  });
});

/**
 * Item 4.8 do ROADMAP (contrato § 13.3, v3): o `destroy` num tipo de recurso
 * errado responde "not found", e antes isso contava como sucesso — um anexo
 * guardado como `raw` saía da fila sem ter sido apagado.
 */
describe('processarLote — os três tipos de recurso da Cloudinary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Os tipos pedidos, na ordem, lidos das chamadas do próprio dublê. */
  function tiposPedidos(mock: { mock: { calls: [string, TipoDeRecurso][] } }): TipoDeRecurso[] {
    return mock.mock.calls.map(([, tipo]) => tipo);
  }

  function responderPorTipo(
    respostas: Partial<Record<TipoDeRecurso, ResultadoDaExclusao | Error>>,
  ) {
    return async (_publicId: string, tipo: TipoDeRecurso): Promise<ResultadoDaExclusao> => {
      const resposta = respostas[tipo] ?? 'inexistente';
      if (resposta instanceof Error) throw resposta;
      return resposta;
    };
  }

  it.each(['motivos', 'justificativas'])(
    'deveConcluirQuandoOArquivoDe %s/ estaGuardadoComoRaw',
    async (pasta) => {
      const item = itemCloudinary({ motivo: 'conta_excluida', asset_ref: caminho(pasta) });
      const { deps, apagarDaCloudinaryMock, processados } = criarCenario([item]);
      apagarDaCloudinaryMock.mockImplementation(responderPorTipo({ raw: 'apagado' }));

      await processarLote(deps, 100);

      expect(tiposPedidos(apagarDaCloudinaryMock)).toEqual(['image', 'raw']);
      expect(processados).toEqual([item.id]);
    },
  );

  it('deveConcluirQuandoOsTresTiposRespondemQueNaoHaArquivo', async () => {
    // Reprocessar um item já apagado (crash entre apagar e marcar) tem que
    // continuar seguro: nada existe em nenhum tipo, e o item conclui.
    const item = itemCloudinary({ motivo: 'anexo_expirado', asset_ref: caminho('motivos') });
    const { deps, apagarDaCloudinaryMock, processados } = criarCenario([item]);
    apagarDaCloudinaryMock.mockImplementation(responderPorTipo({}));

    await processarLote(deps, 100);

    expect(tiposPedidos(apagarDaCloudinaryMock)).toEqual(['image', 'raw', 'video']);
    expect(processados).toEqual([item.id]);
  });

  it('devePararNoPrimeiroTipoQueApaga', async () => {
    const item = itemCloudinary({
      motivo: 'justificativa_removida',
      asset_ref: caminho('justificativas'),
    });
    const { deps, tiposPedidos: tipos } = criarCenario([item]);

    await processarLote(deps, 100);

    expect(tipos).toEqual(['image']);
  });

  it.each<TipoDeRecurso>(['image', 'raw', 'video'])(
    'deveVoltarParaNovaTentativaQuandoOTipo %s falha',
    async (tipoQueFalha) => {
      const item = itemCloudinary({
        motivo: 'anexo_de_motivo_removido',
        asset_ref: caminho('motivos'),
      });
      const { deps, apagarDaCloudinaryMock, marcarProcessadoMock, marcarFalhaMock } = criarCenario([
        item,
      ]);
      apagarDaCloudinaryMock.mockImplementation(
        responderPorTipo({ [tipoQueFalha]: new Error('Cloudinary indisponível') }),
      );

      await processarLote(deps, 100);

      expect(marcarProcessadoMock).not.toHaveBeenCalled();
      expect(marcarFalhaMock).toHaveBeenCalledWith(item.id, 1, 'Cloudinary indisponível');
    },
  );

  it('deveChamarSoImageQuandoOItemEhDeComprovantes', async () => {
    // `comprovantes/` continua como estava (contrato § 13.3): o comprovante
    // sempre foi imagem, e o "not found" em image conclui o item.
    const item = itemCloudinary({
      motivo: 'comprovante_recusado',
      asset_ref: caminho('comprovantes'),
    });
    const { deps, apagarDaCloudinaryMock, processados } = criarCenario([item]);
    apagarDaCloudinaryMock.mockImplementation(responderPorTipo({}));

    await processarLote(deps, 100);

    expect(tiposPedidos(apagarDaCloudinaryMock)).toEqual(['image']);
    expect(processados).toEqual([item.id]);
  });
});
