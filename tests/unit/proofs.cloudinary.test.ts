import { describe, expect, it } from 'vitest';

import { criarAssinadorCloudinary } from '../../src/modules/proofs/proofs.cloudinary.js';

/**
 * O adaptador REAL da Cloudinary — não um dublê.
 *
 * Ele não faz rede: assinar é um HMAC local e montar URL é string. Então dá
 * para testar a coisa de verdade, inclusive a garantia mais importante: que
 * a `api_secret` nunca aparece no que volta para o cliente. [#45][#55]
 */

const CONFIG = {
  cloudName: 'nuvem-de-teste',
  apiKey: '000000000000000',
  apiSecret: 'segredo-que-nunca-pode-vazar',
};

const assinador = criarAssinadorCloudinary(CONFIG);

describe('extrairPublicId', () => {
  it('deveDevolverOValorIntactoQuandoJaEhUmPublicId', () => {
    expect(assinador.extrairPublicId('comprovantes/aluno-1/pagamento-9')).toBe(
      'comprovantes/aluno-1/pagamento-9',
    );
  });

  it('deveRemoverEspacosAoRedorDoValorGravado', () => {
    expect(assinador.extrairPublicId('  comprovantes/aluno-1/x  ')).toBe('comprovantes/aluno-1/x');
  });

  it('deveExtrairOPublicIdDeUmaUrlCompletaComVersao', () => {
    const url =
      'https://res.cloudinary.com/nuvem/image/authenticated/s--AbC123--/v1700000000/comprovantes/aluno-1/pagamento-9.jpg';

    expect(assinador.extrairPublicId(url)).toBe('comprovantes/aluno-1/pagamento-9');
  });

  it('deveExtrairOPublicIdDeUmaUrlSemVersao', () => {
    const url =
      'https://res.cloudinary.com/nuvem/image/authenticated/comprovantes/aluno-1/pagamento-9.png';

    expect(assinador.extrairPublicId(url)).toBe('comprovantes/aluno-1/pagamento-9');
  });

  it('deveExtrairOPublicIdDeUmaUrlDeEntregaPublica', () => {
    // Comprovante antigo pode ter sido gravado como `upload` antes da política
    // de asset privado — o adaptador ainda precisa saber lê-lo.
    const url = 'https://res.cloudinary.com/nuvem/image/upload/v123/comprovantes/aluno-1/x.jpg';

    expect(assinador.extrairPublicId(url)).toBe('comprovantes/aluno-1/x');
  });

  it('devePreservarPontosQueNaoSaoExtensaoDeArquivo', () => {
    expect(assinador.extrairPublicId('comprovantes/aluno.silva/pagamento-9')).toBe(
      'comprovantes/aluno.silva/pagamento-9',
    );
  });

  it('deveDevolverOValorOriginalQuandoAUrlEhInvalida', () => {
    // Não pode explodir por causa de dado torto vindo do banco.
    expect(assinador.extrairPublicId('https://[url-quebrada')).toBe('https://[url-quebrada');
  });

  it('deveDevolverStringVaziaSemQuebrarQuandoOValorEhVazio', () => {
    expect(assinador.extrairPublicId('   ')).toBe('');
  });
});

describe('assinarUpload', () => {
  const parametros = {
    folder: 'comprovantes/aluno-1',
    public_id: 'pagamento-9',
    timestamp: 1_700_000_000,
    type: 'authenticated',
  };

  it('naoDeveIncluirOApiSecretNaRespostaEnviadaAoCliente', () => {
    // O teste mais importante deste arquivo: a resposta vai inteira para o
    // app, e o app é extraível. Se a secret vazar aqui, ela vaza no APK. [#55]
    const resultado = assinador.assinarUpload(parametros);

    expect(JSON.stringify(resultado)).not.toContain(CONFIG.apiSecret);
  });

  it('deveProduzirUmaAssinaturaHexadecimalNaoVazia', () => {
    const { signature } = assinador.assinarUpload(parametros);

    expect(signature).toMatch(/^[0-9a-f]{40,}$/);
  });

  it('deveProduzirAssinaturasDiferentesParaDestinosDiferentes', () => {
    // Se a assinatura não variasse com o destino, uma assinatura obtida para
    // a própria pasta serviria para escrever na pasta de outro aluno.
    const doAluno1 = assinador.assinarUpload(parametros);
    const doAluno2 = assinador.assinarUpload({ ...parametros, folder: 'comprovantes/aluno-2' });

    expect(doAluno1.signature).not.toBe(doAluno2.signature);
  });

  it('deveProduzirAssinaturasDiferentesParaTimestampsDiferentes', () => {
    const agora = assinador.assinarUpload(parametros);
    const depois = assinador.assinarUpload({ ...parametros, timestamp: 1_700_000_001 });

    expect(agora.signature).not.toBe(depois.signature);
  });

  it('deveSerDeterministicoParaOsMesmosParametros', () => {
    // Determinismo importa: sem ele, um retry do app invalidaria a assinatura.
    expect(assinador.assinarUpload(parametros).signature).toBe(
      assinador.assinarUpload(parametros).signature,
    );
  });

  it('deveDevolverOsDadosQueOAppPrecisaParaEnviarDiretoAoProvedor', () => {
    const resultado = assinador.assinarUpload(parametros);

    expect(resultado.cloudName).toBe(CONFIG.cloudName);
    expect(resultado.apiKey).toBe(CONFIG.apiKey);
    expect(resultado.uploadUrl).toContain(CONFIG.cloudName);
    expect(resultado.folder).toBe(parametros.folder);
  });
});

describe('gerarUrlDeVisualizacao', () => {
  it('deveGerarUrlAssinadaDeAssetAutenticado', () => {
    const url = assinador.gerarUrlDeVisualizacao('comprovantes/aluno-1/pagamento-9');

    expect(url).toContain('authenticated');
    expect(url).toMatch(/^https:\/\//);
    // A assinatura vem no formato `s--XXXX--`.
    expect(url).toMatch(/\/s--[^/]+--\//);
  });

  it('naoDeveIncluirOApiSecretNaUrlGerada', () => {
    const url = assinador.gerarUrlDeVisualizacao('comprovantes/aluno-1/pagamento-9');

    expect(url).not.toContain(CONFIG.apiSecret);
  });
});
