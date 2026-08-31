import { describe, expect, it } from 'vitest';

import type { ClienteSupabase, UsuarioAutenticado } from '../../src/lib/supabase.js';
import { criarRepositorioDePagamentos } from '../../src/modules/proofs/proofs.repository.js';
import {
  COLUNAS_DO_PAGAMENTO,
  TABELA_PAGAMENTOS,
} from '../../src/modules/proofs/proofs.constants.js';

/**
 * Fecha a pendência P-15 de `docs/PENDENCIAS.md`.
 *
 * O repositório estava com 14% de cobertura por um motivo sutil: os testes
 * existentes substituíam o REPOSITÓRIO inteiro por um dublê que imitava o
 * comportamento dele. Com isso, a montagem real do filtro e o `linhas[0] ?? null`
 * nunca executavam — um erro de digitação no nome da coluna, ou um `eq.`
 * esquecido, passaria por toda a suíte sem acender uma luz.
 *
 * Aqui o dublê é do CLIENTE SUPABASE, uma camada abaixo. O código do
 * repositório roda de verdade; o que é simulado é só a rede. [#45][#48]
 */

interface ChamadaRegistrada {
  tabela: string;
  filtros: Record<string, string>;
  colunas: string;
  authorization: string;
}

function criarClienteEspiao(resposta: unknown[] | (() => never)) {
  const chamadas: ChamadaRegistrada[] = [];

  const cliente: ClienteSupabase = {
    buscarUsuarioPeloToken(): Promise<UsuarioAutenticado | null> {
      throw new Error('O repositório de pagamentos não deve resolver identidade.');
    },
    consultarComoChamador<T>(
      tabela: string,
      filtros: Record<string, string>,
      colunas: string,
      authorization: string,
    ): Promise<T[]> {
      chamadas.push({ tabela, filtros, colunas, authorization });
      if (typeof resposta === 'function') {
        resposta();
      }
      return Promise.resolve(resposta as T[]);
    },
  };

  return { cliente, chamadas };
}

const PAGAMENTO = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const AUTORIZACAO = 'Bearer token-do-chamador';

const LINHA = {
  user_id: 'aluno-1',
  proof_provider: 'cloudinary',
  proof_public_id: 'comprovantes/aluno-1/pagamento-9',
};

describe('criarRepositorioDePagamentos', () => {
  it('deveFiltrarPorIdComOOperadorDeIgualdadeDoPostgrest', async () => {
    // Sem o prefixo `eq.`, o PostgREST não interpreta o valor como igualdade e
    // a consulta deixa de filtrar — devolvendo o que a RLS permitir de TODOS
    // os pagamentos, não o pagamento pedido.
    const { cliente, chamadas } = criarClienteEspiao([LINHA]);

    await criarRepositorioDePagamentos(cliente).buscarPorId(PAGAMENTO, AUTORIZACAO);

    expect(chamadas[0]?.filtros).toEqual({ id: `eq.${PAGAMENTO}` });
  });

  it('devePedirExatamenteAsColunasQueOContratoDeclara', async () => {
    // Se `proof_provider` sumir da projeção, o serviço perde a única forma de
    // saber que o comprovante é legado — e assina um identificador de outro
    // sistema como se fosse da Cloudinary.
    const { cliente, chamadas } = criarClienteEspiao([LINHA]);

    await criarRepositorioDePagamentos(cliente).buscarPorId(PAGAMENTO, AUTORIZACAO);

    expect(chamadas[0]?.colunas).toBe(COLUNAS_DO_PAGAMENTO);
    expect(chamadas[0]?.colunas).toContain('proof_provider');
    expect(chamadas[0]?.tabela).toBe(TABELA_PAGAMENTOS);
  });

  it('deveRepassarOTokenDoChamadorParaQueARlsDecida', async () => {
    // Sem o token, a consulta roda como anônima: a RLS não reconhece o dono e
    // a autorização inteira desmorona. [#20]
    const { cliente, chamadas } = criarClienteEspiao([LINHA]);

    await criarRepositorioDePagamentos(cliente).buscarPorId(PAGAMENTO, AUTORIZACAO);

    expect(chamadas[0]?.authorization).toBe(AUTORIZACAO);
  });

  it('deveDevolverNullQuandoARlsNaoLiberaNenhumaLinha', async () => {
    const { cliente } = criarClienteEspiao([]);

    const encontrado = await criarRepositorioDePagamentos(cliente).buscarPorId(
      PAGAMENTO,
      AUTORIZACAO,
    );

    expect(encontrado).toBeNull();
  });

  it('deveDevolverNullEmVezDeUndefinedParaOServicoNaoConfundirOsCasos', async () => {
    // `linhas[0]` de um array vazio é `undefined`. Devolver `undefined` faria
    // `!pagamento?.proof_public_id` continuar funcionando por acidente, mas o
    // contrato declara `| null` — e contrato que só funciona por acidente
    // quebra na primeira mudança.
    const { cliente } = criarClienteEspiao([]);

    const encontrado = await criarRepositorioDePagamentos(cliente).buscarPorId(
      PAGAMENTO,
      AUTORIZACAO,
    );

    expect(encontrado).not.toBeUndefined();
    expect(encontrado).toBeNull();
  });

  it('deveUsarAPrimeiraLinhaQuandoOPostgrestDevolveMaisDeUma', async () => {
    const outra = { ...LINHA, user_id: 'aluno-2' };
    const { cliente } = criarClienteEspiao([LINHA, outra]);

    const encontrado = await criarRepositorioDePagamentos(cliente).buscarPorId(
      PAGAMENTO,
      AUTORIZACAO,
    );

    expect(encontrado).toEqual(LINHA);
  });

  it('naoDeveDeixarUmIdMaliciosoEscaparDoParametroEReescreverAConsulta', async () => {
    // O id vem do corpo da requisição. Se ele fosse concatenado na query, este
    // valor acrescentaria um filtro próprio e mudaria QUAL linha volta —
    // contornando a intenção da consulta. Ele tem que continuar sendo um
    // VALOR, inteiro, dentro da chave `id`. [#51][#52]
    const malicioso = `${PAGAMENTO}&user_id=neq.qualquer`;
    const { cliente, chamadas } = criarClienteEspiao([]);

    await criarRepositorioDePagamentos(cliente).buscarPorId(malicioso, AUTORIZACAO);

    expect(chamadas[0]?.filtros).toEqual({ id: `eq.${malicioso}` });
    expect(Object.keys(chamadas[0]?.filtros ?? {})).toEqual(['id']);
  });

  it('devePropagarAFalhaDaDependenciaEmVezDeEngoliLaComoNaoEncontrado', async () => {
    // Traduzir "banco fora do ar" em "pagamento não existe" faria o serviço
    // responder 403 para uma indisponibilidade — escondendo um incidente
    // atrás de uma mensagem de permissão. [#93]
    const { cliente } = criarClienteEspiao(() => {
      throw new Error('supabase_unreachable');
    });

    await expect(
      criarRepositorioDePagamentos(cliente).buscarPorId(PAGAMENTO, AUTORIZACAO),
    ).rejects.toThrow('supabase_unreachable');
  });
});
