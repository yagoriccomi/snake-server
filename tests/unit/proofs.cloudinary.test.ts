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

  it('deveEntregarPdfPelaMesmaRotaDeImagemPorqueEhAssimQueOProvedorOClassifica', () => {
    /*
     * O app aceita comprovante em PDF, e a URL é montada com
     * `resource_type: 'image'` fixo. Isso PARECE errado e não é: a Cloudinary
     * armazena PDF sob o resource_type `image` (é o que permite renderizar
     * páginas como imagem), e o upload com `resource_type: 'auto'` — usado
     * pelo script de migração — cai exatamente nesse mesmo bucket.
     *
     * Este teste trava o alinhamento entre as duas pontas. Se alguém "corrigir"
     * a entrega para `raw` achando que PDF não é imagem, todo comprovante em
     * PDF passa a devolver 404 — e o teste avisa antes do usuário.
     *
     * ⚠️ O que este teste NÃO prova: a entrega de PDF depende também de uma
     * chave de conta na Cloudinary ("Allow delivery of PDF and ZIP files"),
     * desligada por padrão. Ver P-18 em `docs/PENDENCIAS.md`.
     */
    const url = assinador.gerarUrlDeVisualizacao('comprovantes/aluno-1/pagamento-em-pdf');

    expect(url).toContain('/image/authenticated/');
    expect(url).not.toContain('/raw/');
  });

  it('naoDeveAnexarExtensaoAoPublicIdPorqueOContratoNaoGuardaUma', () => {
    // `proof_public_id` é gravado sem extensão. Se a URL acrescentasse uma, o
    // asset procurado deixaria de existir.
    //
    // O caminho é comparado sem a query string: o SDK anexa um `?_a=...`
    // próprio (telemetria dele). Ancorar o regex no fim da URL inteira
    // quebraria por causa desse parâmetro, não por causa de extensão.
    const url = assinador.gerarUrlDeVisualizacao('comprovantes/aluno-1/pagamento-9');
    const caminho = url.split('?')[0] ?? '';

    expect(caminho).toMatch(/\/comprovantes\/aluno-1\/pagamento-9$/);
  });
});
