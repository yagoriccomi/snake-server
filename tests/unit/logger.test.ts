import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger, mascarar } from '../../src/lib/logger.js';

/**
 * `mascarar` é a última barreira antes de um dado sair do processo e virar
 * linha permanente num coletor de logs. Este servidor lida com comprovante de
 * PIX — dado financeiro pessoal — e com o token de sessão do aluno.
 *
 * Um furo aqui não derruba o servidor: ele vaza em silêncio, por meses. [#63]
 */
describe('mascarar', () => {
  describe('chaves sensíveis', () => {
    it.each([
      'authorization',
      'Authorization',
      'token',
      'jwt',
      'refresh_token',
      'access_token',
      'api_secret',
      'apiSecret',
      'secret',
      'signature',
      'password',
      'senha',
      'cookie',
      'apikey',
      'anon_key',
      'cpf',
      'cnpj',
      'email',
      'telefone',
      'proof_url',
      'proofUrl',
      'comprovante',
    ])('deveRedigirOValorQuandoAChaveEh_%s', (chave) => {
      const resultado = mascarar({ [chave]: 'valor-secreto-de-verdade' });

      expect(resultado[chave]).toBe('[REDIGIDO]');
      expect(JSON.stringify(resultado)).not.toContain('valor-secreto-de-verdade');
    });

    it('deveRedigirChaveSensivelAninhadaEmObjeto', () => {
      const resultado = mascarar({
        requisicao: { headers: { authorization: 'Bearer abc.def.ghi' } },
      });

      expect(JSON.stringify(resultado)).not.toContain('abc.def.ghi');
    });

    it('deveRedigirChaveSensivelDentroDeArray', () => {
      const resultado = mascarar({
        tentativas: [{ signature: 'assinatura-real' }, { signature: 'outra-assinatura' }],
      });

      expect(JSON.stringify(resultado)).not.toContain('assinatura-real');
      expect(JSON.stringify(resultado)).not.toContain('outra-assinatura');
    });
  });

  describe('identificadores', () => {
    it('deveTruncarIdentificadorLongoParaPermitirCorrelacaoSemEntregarOValor', () => {
      const uuid = '11111111-2222-4333-8444-555555555555';

      const resultado = mascarar({ user_id: uuid });

      expect(resultado.user_id).toBe('11111111…');
      expect(resultado.user_id).not.toBe(uuid);
    });

    it('deveRedigirIdentificadorCurtoDemaisParaTerPrefixoUtil', () => {
      // Com 8 caracteres ou menos, o "prefixo" seria o valor inteiro.
      expect(mascarar({ id: 'abc123' }).id).toBe('[REDIGIDO]');
      expect(mascarar({ id: '12345678' }).id).toBe('[REDIGIDO]');
    });

    it.each(['user_id', 'userId', 'payment_id', 'paymentId', 'public_id', 'id'])(
      'deveTruncarAChaveIdentificadora_%s',
      (chave) => {
        const resultado = mascarar({ [chave]: 'abcdefghijklmnop' });
        expect(resultado[chave]).toBe('abcdefgh…');
      },
    );
  });

  describe('padrões em texto livre — o vazamento acidental', () => {
    it('deveRemoverJwtDeDentroDeUmaMensagemQualquer', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';

      const resultado = mascarar({ detalhe: `falhou com o token ${jwt} do usuario` });

      expect(resultado.detalhe).not.toContain(jwt);
      expect(resultado.detalhe).toContain('[REDIGIDO]');
    });

    it('deveRemoverEmailDeDentroDeUmaMensagemQualquer', () => {
      const resultado = mascarar({ detalhe: 'usuario aluno@exemplo.com nao encontrado' });

      expect(resultado.detalhe).not.toContain('aluno@exemplo.com');
    });

    it.each(['123.456.789-00', '12345678900'])(
      'deveRemoverCpfNoFormato_%s_DeDentroDeUmaMensagem',
      (cpf) => {
        const resultado = mascarar({ detalhe: `documento ${cpf} invalido` });

        expect(resultado.detalhe).not.toContain(cpf);
      },
    );

    it('deveRemoverOValorDepoisDeBearerMantendoOPrefixo', () => {
      const resultado = mascarar({ detalhe: 'header: Bearer segredo-do-token' });

      expect(resultado.detalhe).not.toContain('segredo-do-token');
      expect(resultado.detalhe).toContain('Bearer [REDIGIDO]');
    });
  });

  describe('estruturas que poderiam derrubar o logger', () => {
    it('naoDeveEstourarAPilhaQuandoOObjetoEhCircular', () => {
      const circular: Record<string, unknown> = { nome: 'raiz' };
      circular.euMesmo = circular;

      expect(() => mascarar(circular)).not.toThrow();
      expect(JSON.stringify(mascarar(circular))).toContain('PROFUNDO_DEMAIS');
    });

    it('deveCortarAProfundidadeApos6Niveis', () => {
      const fundo = { n1: { n2: { n3: { n4: { n5: { n6: { n7: 'muito fundo' } } } } } } };

      const texto = JSON.stringify(mascarar(fundo));

      expect(texto).not.toContain('muito fundo');
      expect(texto).toContain('PROFUNDO_DEMAIS');
    });

    it('deveConverterErroEmObjetoPlanoSemQuebrarASerializacao', () => {
      const resultado = mascarar({ erro: new TypeError('algo quebrou') });
      const erro = resultado.erro as Record<string, unknown>;

      expect(erro.nome).toBe('TypeError');
      expect(erro.mensagem).toBe('algo quebrou');
    });

    it('deveLimparPiiDeDentroDaMensagemDoErro', () => {
      const resultado = mascarar({ erro: new Error('falhou para aluno@exemplo.com') });
      const erro = resultado.erro as Record<string, unknown>;

      expect(erro.mensagem).not.toContain('aluno@exemplo.com');
    });

    it.each([
      ['função', () => 'algo'],
      ['symbol', Symbol('x')],
    ])('deveRedigirValorDoTipo_%s', (_rotulo, valor) => {
      expect(mascarar({ campo: valor }).campo).toBe('[REDIGIDO]');
    });

    it('devePreservarTiposSimplesQueNaoSaoSensiveis', () => {
      const resultado = mascarar({ status: 200, ok: true, nada: null, ausente: undefined });

      expect(resultado.status).toBe(200);
      expect(resultado.ok).toBe(true);
      expect(resultado.nada).toBeNull();
      expect(resultado.ausente).toBeUndefined();
    });

    it('deveSerializarDataComoIso', () => {
      expect(mascarar({ quando: new Date('2026-08-21T12:00:00.000Z') }).quando).toBe(
        '2026-08-21T12:00:00.000Z',
      );
    });

    it('deveConverterBigIntEmTextoParaNaoQuebrarOJson', () => {
      expect(() => JSON.stringify(mascarar({ contador: 10n }))).not.toThrow();
    });
  });
});

/**
 * O mascaramento vive DENTRO do logger de propósito: quem chama não pode
 * esquecer. Este teste prova a garantia no ponto de saída real. [#63]
 */
describe('logger — saída real do processo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('naoDeveEscreverOTokenNoStderrMesmoQuandoElePassaNoContexto', () => {
    const escritas: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((texto: unknown) => {
      escritas.push(String(texto));
      return true;
    });

    logger.error('falha na autenticação', {
      authorization: 'Bearer token-super-secreto',
      proof_url: 'comprovantes/aluno/pagamento-1',
    });

    const saida = escritas.join('');
    expect(saida).not.toContain('token-super-secreto');
    expect(saida).not.toContain('comprovantes/aluno/pagamento-1');
    expect(saida).toContain('[REDIGIDO]');
  });

  it('deveEmitirUmaLinhaJsonValidaPorEvento', () => {
    const escritas: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((texto: unknown) => {
      escritas.push(String(texto));
      return true;
    });

    logger.error('mensagem de teste', { status: 500 });

    const linhas = escritas.join('').trim().split('\n');
    expect(linhas).toHaveLength(1);

    const registro = JSON.parse(linhas[0] as string) as Record<string, unknown>;
    expect(registro.nivel).toBe('error');
    expect(registro.mensagem).toBe('mensagem de teste');
    expect(registro.status).toBe(500);
    expect(typeof registro.horario).toBe('string');
  });

  it('naoDeveEmitirNadaQuandoONivelEstaAbaixoDoConfigurado', () => {
    // LOG_LEVEL do ambiente de teste é `error`.
    const escritas: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((texto: unknown) => {
      escritas.push(String(texto));
      return true;
    });

    logger.debug('não deve aparecer');
    logger.info('nem isto');
    logger.warn('nem isto tampouco');

    expect(escritas).toHaveLength(0);
  });
});
