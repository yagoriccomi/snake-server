import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';

import {
  corpoDeAssinaturaDeJustificativa,
  corpoDeVisualizacaoDeJustificativa,
} from '../../src/modules/justifications/justifications.schema.js';
import {
  corpoDeAssinaturaDeMotivo,
  corpoDeVisualizacaoDeMotivo,
} from '../../src/modules/motivos/motivos.schema.js';
import { corpoComPaymentId, corpoDeVisualizacao } from '../../src/modules/proofs/proofs.schema.js';

/**
 * As frases do `bad_input`, uma por problema, como nas tabelas das rotas do
 * contrato (§ 13.6). O cliente decide pelo `code`; a frase é o que o aluno lê,
 * e por isso nunca pode sair a padrão do zod, em inglês. [#1][#46]
 */

const UUID = '6f1c2a4e-8b3d-4e5f-9a7b-1c2d3e4f5a6b';

/** A frase que o `bad_input` levaria: a do primeiro problema. */
function primeiraFrase(esquema: ZodTypeAny, corpo: unknown): string | undefined {
  const resultado = esquema.safeParse(corpo);
  return resultado.success ? undefined : resultado.error.issues[0]?.message;
}

describe('frases do bad_input — comprovantes', () => {
  it.each([
    ['ausente', {}, 'paymentId é obrigatório'],
    ['que não é UUID', { paymentId: 'abc' }, 'paymentId precisa ser um UUID válido'],
    ['de outro tipo', { paymentId: 42 }, 'paymentId precisa ser um UUID válido'],
    ['nulo', { paymentId: null }, 'paymentId precisa ser um UUID válido'],
  ])('deveDizerOProblemaDoPaymentId_%s', (_rotulo, corpo, frase) => {
    expect(primeiraFrase(corpoComPaymentId, corpo)).toBe(frase);
    expect(primeiraFrase(corpoDeVisualizacao, corpo)).toBe(frase);
  });

  it.each([[0], [1000], [1.5], ['abc'], [null], [-1]])(
    'deveDizerAFaixaDaPaginaQuandoElaVem_%j',
    (pagina) => {
      expect(primeiraFrase(corpoDeVisualizacao, { paymentId: UUID, pagina })).toBe(
        'pagina precisa estar entre 1 e 999',
      );
    },
  );

  it.each([[1], [999], ['3']])('deveAceitarAPagina_%j', (pagina) => {
    expect(corpoDeVisualizacao.safeParse({ paymentId: UUID, pagina }).success).toBe(true);
  });

  it.each([[[]], ['texto'], [null]])('deveDizerQueOCorpoPrecisaSerUmObjeto_%j', (corpo) => {
    expect(primeiraFrase(corpoComPaymentId, corpo)).toBe('O corpo precisa ser um objeto JSON');
  });
});

describe('frases do bad_input — justificativas', () => {
  it.each([
    ['nenhum dos dois', {}],
    ['os dois', { classId: UUID, justificationId: UUID }],
  ])('deveExigirExatamenteUmIdNaAssinatura_%s', (_rotulo, corpo) => {
    expect(primeiraFrase(corpoDeAssinaturaDeJustificativa, corpo)).toBe(
      'Envie exatamente um: classId ou justificationId',
    );
  });

  it.each([
    [{ classId: 'abc' }, 'classId precisa ser um UUID válido'],
    [{ classId: null }, 'classId precisa ser um UUID válido'],
    [{ justificationId: 'abc' }, 'justificationId precisa ser um UUID válido'],
  ])('deveDizerQualIdEstaForaDoFormato_%j', (corpo, frase) => {
    expect(primeiraFrase(corpoDeAssinaturaDeJustificativa, corpo)).toBe(frase);
  });

  it.each([
    [{}, 'justificationId é obrigatório'],
    [{ justificationId: 'abc' }, 'justificationId precisa ser um UUID válido'],
    [{ justificationId: UUID, pagina: 0 }, 'pagina precisa estar entre 1 e 999'],
  ])('deveDizerOProblemaDaVisualizacao_%j', (corpo, frase) => {
    expect(primeiraFrase(corpoDeVisualizacaoDeJustificativa, corpo)).toBe(frase);
  });
});

describe('frases do bad_input — motivos', () => {
  it.each([
    [{ anexoId: UUID }, 'motivoId é obrigatório'],
    [{ motivoId: 'abc', anexoId: UUID }, 'motivoId precisa ser um UUID válido'],
    [{ motivoId: UUID }, 'anexoId é obrigatório'],
    [{ motivoId: UUID, anexoId: 7 }, 'anexoId precisa ser um UUID válido'],
  ])('deveDizerOProblemaDaAssinatura_%j', (corpo, frase) => {
    expect(primeiraFrase(corpoDeAssinaturaDeMotivo, corpo)).toBe(frase);
  });

  it.each([
    [{}, 'anexoId é obrigatório'],
    [{ anexoId: 'abc' }, 'anexoId precisa ser um UUID válido'],
    [{ anexoId: UUID, pagina: 1000 }, 'pagina precisa estar entre 1 e 999'],
  ])('deveDizerOProblemaDaVisualizacao_%j', (corpo, frase) => {
    expect(primeiraFrase(corpoDeVisualizacaoDeMotivo, corpo)).toBe(frase);
  });
});
