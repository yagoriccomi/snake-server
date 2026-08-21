import { describe, expect, it } from 'vitest';
import type { ZodError } from 'zod';
import { z } from 'zod';

import { dependenciaIndisponivel, naoAutenticado, semAcesso } from '../../src/lib/http-error.js';
import { classificarErro } from '../../src/middleware/error-handler.js';

/**
 * `classificarErro` é a decisão que define o que o mundo externo vê quando
 * algo dá errado. Um deslize aqui vaza detalhe interno em TODAS as rotas —
 * por isso os testes atacam o que ela pode entregar de mais, não de menos. [#93]
 */
describe('classificarErro', () => {
  describe('erros de aplicação (HttpError)', () => {
    it('devePreservarStatusECodigoQuandoErroEhHttpError', () => {
      const resultado = classificarErro(semAcesso());

      expect(resultado.status).toBe(403);
      expect(resultado.code).toBe('forbidden');
      expect(resultado.mensagem).toBe('Sem acesso');
    });

    it('deveClassificarComoAvisoQuandoStatusEh4xx', () => {
      // 4xx é o cliente errando: não polui o canal de erro do operador. [#92]
      expect(classificarErro(naoAutenticado()).nivel).toBe('warn');
    });

    it('deveClassificarComoErroQuandoStatusEh5xx', () => {
      expect(classificarErro(dependenciaIndisponivel()).nivel).toBe('error');
    });

    it('deveLevarACausaApenasParaOContextoDeLogQuandoErroTemCause', () => {
      const causaInterna = new Error('ECONNREFUSED 10.0.0.5:5432');
      const resultado = classificarErro(
        dependenciaIndisponivel('Serviço indisponível', 'upstream', { cause: causaInterna }),
      );

      // A causa técnica é para o log; a mensagem exposta continua limpa.
      expect(resultado.contexto?.causa).toBe(causaInterna);
      expect(resultado.mensagem).not.toContain('ECONNREFUSED');
      expect(resultado.mensagem).not.toContain('10.0.0.5');
    });
  });

  describe('entrada inválida', () => {
    it('deveRetornar400ComCodigoBadInputQuandoErroEhZodError', () => {
      const schema = z.object({ paymentId: z.string().uuid() });
      const falha = schema.safeParse({ paymentId: 'nao-e-uuid' });

      expect(falha.success).toBe(false);
      const resultado = classificarErro((falha as { error: ZodError }).error);

      expect(resultado.status).toBe(400);
      expect(resultado.code).toBe('bad_input');
      expect(resultado.nivel).toBe('warn');
    });

    it('naoDeveExporOsDetalhesDoZodNaMensagemDoCliente', () => {
      // Os `issues` ajudam o operador, mas descrevem a estrutura interna
      // esperada — não vão para quem chamou.
      const schema = z.object({ segredoInterno: z.string().min(10) });
      const falha = schema.safeParse({ segredoInterno: 'x' });
      const resultado = classificarErro((falha as { error: ZodError }).error);

      expect(resultado.mensagem).toBe('Dados inválidos na requisição');
      expect(resultado.mensagem).not.toContain('segredoInterno');
      expect(resultado.contexto?.problemas).toBeDefined();
    });
  });

  describe('erros do parser de corpo', () => {
    it('deveRetornar400QuandoJsonEstaMalformado', () => {
      const erro = Object.assign(new SyntaxError('Unexpected token {'), {
        type: 'entity.parse.failed',
      });

      const resultado = classificarErro(erro);

      expect(resultado.status).toBe(400);
      expect(resultado.code).toBe('malformed_json');
    });

    it('deveRetornar413QuandoCorpoExcedeOLimite', () => {
      const erro = Object.assign(new Error('request entity too large'), {
        type: 'entity.too.large',
      });

      const resultado = classificarErro(erro);

      expect(resultado.status).toBe(413);
      expect(resultado.code).toBe('payload_too_large');
    });

    it('naoDeveConfundirErroComPropriedadeTypeNaoTextual', () => {
      // `type` numérico não pode ser tratado como marcador do body-parser.
      const erro = Object.assign(new Error('qualquer'), { type: 42 });

      expect(classificarErro(erro).status).toBe(500);
    });
  });

  describe('erros desconhecidos — o caso mais perigoso', () => {
    it('deveRetornarMensagemGenericaQuandoErroEhDesconhecido', () => {
      const resultado = classificarErro(
        new Error('falha ao conectar em postgres://user:senha@host'),
      );

      expect(resultado.status).toBe(500);
      expect(resultado.code).toBe('internal_error');
      expect(resultado.mensagem).toBe('Erro interno');
    });

    it('naoDeveVazarStackTraceNaMensagemExposta', () => {
      const erro = new Error('boom');

      const resultado = classificarErro(erro);

      expect(resultado.mensagem).not.toContain('at ');
      expect(resultado.mensagem).not.toContain('.ts');
      expect(resultado.mensagem).not.toContain(erro.message);
    });

    it('naoDeveVazarCredencialQueVeioNaMensagemDoErroOriginal', () => {
      const resultado = classificarErro(new Error('apiSecret=abc123 invalido'));

      expect(resultado.mensagem).not.toContain('abc123');
      expect(resultado.mensagem).not.toContain('apiSecret');
    });

    it('deveDiferenciarMensagemDeLogDaMensagemDoCliente', () => {
      // O operador precisa de "Erro não tratado"; o usuário recebe "Erro interno".
      const resultado = classificarErro(new Error('qualquer'));

      expect(resultado.mensagemDeLog).toBe('Erro não tratado');
      expect(resultado.mensagem).toBe('Erro interno');
    });

    it.each([
      ['string solta', 'apenas um texto'],
      ['número', 42],
      ['null', null],
      ['undefined', undefined],
      ['objeto qualquer', { qualquer: 'coisa' }],
      ['array', [1, 2, 3]],
    ])('deveRetornar500SeguroQuandoLancaramUm%s', (_rotulo, valorLancado) => {
      // JavaScript deixa lançar qualquer coisa; nada disso pode derrubar
      // o handler nem produzir resposta fora do contrato.
      const resultado = classificarErro(valorLancado);

      expect(resultado.status).toBe(500);
      expect(resultado.code).toBe('internal_error');
      expect(resultado.mensagem).toBe('Erro interno');
    });
  });
});
