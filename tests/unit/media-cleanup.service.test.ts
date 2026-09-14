import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  processarLote,
  type DependenciasDoWorker,
  type ExclusorDeMidia,
  type ItemDaFila,
  type RepositorioDaFila,
} from '../../src/jobs/media-cleanup/media-cleanup.service.js';

/**
 * A regra do worker: consumir a fila de eliminação sem deixar um item ruim
 * travar os outros, e sem perder de vista o que falhou. A maior parte dos
 * casos ataca falha — é para isso que este worker existe. [Regra de Ouro nº 3]
 */

function itemCloudinary(overrides: Partial<ItemDaFila> = {}): ItemDaFila {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    provider: 'cloudinary',
    asset_ref: 'comprovantes/aluno-1/pagamento-1',
    tentativas: 0,
    ...overrides,
  };
}

function itemStorage(overrides: Partial<ItemDaFila> = {}): ItemDaFila {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    provider: 'supabase_storage',
    asset_ref: 'aluno-1/pagamento-2_recibo.jpg',
    tentativas: 0,
    ...overrides,
  };
}

function criarCenario(itens: ItemDaFila[]) {
  const chamadasCloudinary: string[] = [];
  const chamadasStorage: string[] = [];
  const processados: string[] = [];
  const falhas: { id: string; tentativas: number; erro: string }[] = [];

  // Guardados como consts próprias (não como acesso `midia.metodo` depois),
  // porque o lint não permite extrair referência de método de um objeto
  // literal — poderia perder o `this` se fosse um método de verdade em vez
  // de um dublê. [@typescript-eslint/unbound-method]
  const apagarDaCloudinaryMock = vi.fn(async (publicId: string) => {
    chamadasCloudinary.push(publicId);
  });
  const apagarDoStorageMock = vi.fn(async (caminho: string) => {
    chamadasStorage.push(caminho);
  });
  const listarPendentesMock = vi.fn(async () => itens);
  const marcarProcessadoMock = vi.fn(async (id: string) => {
    processados.push(id);
  });
  const marcarFalhaMock = vi.fn(async (id: string, tentativas: number, erro: string) => {
    falhas.push({ id, tentativas, erro });
  });

  const midia: ExclusorDeMidia = {
    apagarDaCloudinary: apagarDaCloudinaryMock,
    apagarDoStorage: apagarDoStorageMock,
  };

  const fila: RepositorioDaFila = {
    listarPendentes: listarPendentesMock,
    marcarProcessado: marcarProcessadoMock,
    marcarFalha: marcarFalhaMock,
  };

  const deps: DependenciasDoWorker = { midia, fila };
  return {
    deps,
    chamadasCloudinary,
    chamadasStorage,
    processados,
    falhas,
    apagarDaCloudinaryMock,
    apagarDoStorageMock,
    listarPendentesMock,
    marcarProcessadoMock,
    marcarFalhaMock,
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
    const bomAntes = itemCloudinary({ id: 'a', asset_ref: 'comprovantes/x/1' });
    const ruim = itemCloudinary({ id: 'b', asset_ref: 'comprovantes/x/2' });
    const bomDepois = itemCloudinary({ id: 'c', asset_ref: 'comprovantes/x/3' });

    const { deps, apagarDaCloudinaryMock, processados, falhas } = criarCenario([
      bomAntes,
      ruim,
      bomDepois,
    ]);
    apagarDaCloudinaryMock.mockImplementation(async (publicId: string) => {
      if (publicId === 'comprovantes/x/2') {
        throw new Error('Cloudinary indisponível');
      }
    });

    const resultado = await processarLote(deps, 100);

    expect(processados).toEqual(['a', 'c']);
    expect(falhas).toHaveLength(1);
    expect(falhas[0]?.id).toBe('b');
    expect(resultado).toEqual({ processados: 2, falhas: 1 });
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

    expect(resultado).toEqual({ processados: 0, falhas: 0 });
  });

  it('naoDevePropagarErroDeUmItemParaForaDoLote', async () => {
    // O chamador (o entrypoint do worker) não deve precisar de try/catch ao
    // redor de processarLote por causa de UM item ruim — a função absorve
    // a falha por item e devolve um resultado, nunca lança por isso.
    const item = itemCloudinary();
    const { deps, apagarDaCloudinaryMock } = criarCenario([item]);
    apagarDaCloudinaryMock.mockRejectedValue(new Error('boom'));

    await expect(processarLote(deps, 100)).resolves.toEqual({ processados: 0, falhas: 1 });
  });
});
