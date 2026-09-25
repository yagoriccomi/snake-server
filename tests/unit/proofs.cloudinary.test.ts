import { v2 as cloudinary } from 'cloudinary';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../src/lib/logger.js';
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

describe('assinarUpload — campos dos anexos novos (contrato § 13.1)', () => {
  const parametros = {
    folder: 'motivos/aluno-1',
    public_id: 'anexo-9',
    timestamp: 1_700_000_000,
    type: 'authenticated',
  };
  const doAnexo = { ...parametros, overwrite: false, allowed_formats: 'jpg,png,webp,heic,pdf' };

  it('deveAssinarOsMesmosCamposQueVoltamAoCliente', () => {
    // O cliente reenvia à Cloudinary exatamente o que recebeu. Se a
    // assinatura cobrisse outro conjunto de campos, o upload seria recusado.
    const { cloudName, apiKey, signature, uploadUrl, ...camposEnviados } =
      assinador.assinarUpload(doAnexo);
    void cloudName;
    void apiKey;
    void uploadUrl;

    expect(camposEnviados).toEqual(doAnexo);
    expect(signature).toBe(cloudinary.utils.api_sign_request(camposEnviados, CONFIG.apiSecret));
  });

  it('deveMudarAAssinaturaQuandoOverwriteEAllowedFormatsEntram', () => {
    // Prova que os dois campos estão DENTRO da assinatura: um cliente que os
    // retirasse (para sobrescrever um anexo ou mandar um .docx) invalidaria
    // o upload.
    expect(assinador.assinarUpload(doAnexo).signature).not.toBe(
      assinador.assinarUpload(parametros).signature,
    );
  });

  it('naoDeveAcrescentarOsCamposQuandoNaoForamPedidos', () => {
    // O comprovante e o `{classId}` legado continuam assinando o que o APK
    // instalado envia — nada a mais.
    const resultado = assinador.assinarUpload(parametros);

    expect(resultado).not.toHaveProperty('overwrite');
    expect(resultado).not.toHaveProperty('allowed_formats');
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

  it('deveEntregarEmJpgParaContornarATravaDePdfDaConta', () => {
    /*
     * O formato de entrega não é preferência estética. A conta da Cloudinary
     * vem com a entrega de PDF DESABILITADA por padrão, e sem esta conversão
     * todo comprovante enviado em PDF responde 401 — verificado contra a conta
     * real. Converter na saída contorna a trava sem tocar em configuração.
     */
    const url = assinador.gerarUrlDeVisualizacao('comprovantes/aluno-1/pagamento-9');
    const caminho = url.split('?')[0] ?? '';

    expect(caminho).toMatch(/\/comprovantes\/aluno-1\/pagamento-9\.jpg$/);
  });

  it('naoDeveConverterNaEntradaPorqueIssoDestroiPaginasDoDocumento', () => {
    // A conversão vive na URL de ENTREGA. Se ela migrasse para o upload, um
    // PDF de várias páginas viraria um JPG só, com a primeira — em silêncio,
    // e sem volta. Comprovante é prova de pagamento. [#63]
    const parametros = {
      folder: 'comprovantes/aluno-1',
      public_id: 'pagamento-9',
      timestamp: 1_700_000_000,
      type: 'authenticated',
    };
    const assinado = assinador.assinarUpload(parametros);

    expect(assinado).not.toHaveProperty('format');
    expect(JSON.stringify(assinado)).not.toContain('jpg');
  });

  it('devePedirUmaPaginaEspecificaQuandoODocumentoTemMaisDeUma', () => {
    const url = assinador.gerarUrlDeVisualizacao('comprovantes/aluno-1/pagamento-9', 2);

    expect(url).toContain('pg_2');
  });

  it('naoDeveSujarAUrlComPaginaQuandoOArquivoTemUmaSo', () => {
    // Página não pedida é página que não entra na URL: num arquivo de página
    // única ela é ruído, e a Cloudinary já entrega o que existe.
    const url = assinador.gerarUrlDeVisualizacao('comprovantes/aluno-1/pagamento-9');

    expect(url).not.toContain('pg_');
  });

  it('naoDeveExpirarAUrlQuandoNaoHaChaveDeAuthTokenConfigurada', () => {
    // Comportamento anterior preservado: enquanto a conta não tiver a chave
    // cadastrada, a URL segue funcionando exatamente como hoje. [#9]
    const url = assinador.gerarUrlDeVisualizacao('comprovantes/aluno-1/pagamento-9');

    expect(url).not.toContain('__cld_token__');
  });

  it('deveExpirarAUrlQuandoAContaTemAChaveDeAuthTokenConfigurada', () => {
    const comAuthToken = criarAssinadorCloudinary({
      ...CONFIG,
      authTokenKey: 'aa'.repeat(16),
    });

    const url = comAuthToken.gerarUrlDeVisualizacao('comprovantes/aluno-1/pagamento-9');

    expect(url).toContain('__cld_token__=');
    expect(url).toMatch(/__cld_token__=exp=\d+~hmac=[0-9a-f]+/);
  });

  it('naoDeveVazarAChaveDeAuthTokenNaUrlGerada', () => {
    // A chave alimenta um HMAC; ela mesma nunca pode aparecer em texto claro
    // no link que sai para o app. [#55]
    const chave = 'bb'.repeat(16);
    const comAuthToken = criarAssinadorCloudinary({ ...CONFIG, authTokenKey: chave });

    const url = comAuthToken.gerarUrlDeVisualizacao('comprovantes/aluno-1/pagamento-9');

    expect(url).not.toContain(chave);
  });

  it('deveGerarTokensDiferentesParaPaginasDiferentesDoMesmoDocumento', () => {
    // Cada página é um recurso distinto entregue; o token amarra a
    // verificação ao caminho exato — inclusive ao parâmetro de página.
    const comAuthToken = criarAssinadorCloudinary({ ...CONFIG, authTokenKey: 'cc'.repeat(16) });

    const pagina1 = comAuthToken.gerarUrlDeVisualizacao('comprovantes/aluno-1/pagamento-9', 1);
    const pagina2 = comAuthToken.gerarUrlDeVisualizacao('comprovantes/aluno-1/pagamento-9', 2);

    const tokenDe = (url: string) => /__cld_token__=([^&]+)/.exec(url)?.[1];
    expect(tokenDe(pagina1)).not.toBe(tokenDe(pagina2));
  });
});

describe('contarPaginas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deveDevolverOTotalDePaginasDoDocumento', async () => {
    vi.spyOn(cloudinary.api, 'resource').mockResolvedValue({ pages: 3 });

    expect(await assinador.contarPaginas('comprovantes/a/b')).toBe(3);
  });

  it('deveDegradarPara1ELogarAMensagemQuandoASdkRejeitaComObjetoSimples', async () => {
    // O SDK rejeita com `{ error: { message, http_code } }`, não com Error:
    // antes, o log gravava "desconhecido" e ninguém sabia o motivo. [#92]
    vi.spyOn(cloudinary.api, 'resource').mockRejectedValue({
      error: { message: 'Rate Limit Exceeded', http_code: 420 },
    });
    const aviso = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    expect(await assinador.contarPaginas('comprovantes/a/b')).toBe(1);
    expect(aviso).toHaveBeenCalledWith(expect.any(String), {
      erro: 'Rate Limit Exceeded (HTTP 420)',
    });
  });

  it('naoDeveLogarOIdDoTitularQueAMensagemDoProvedorCita', async () => {
    const titular = '11111111-2222-4333-8444-555555555555';
    vi.spyOn(cloudinary.api, 'resource').mockRejectedValue({
      error: { message: `Resource not found - comprovantes/${titular}/x`, http_code: 404 },
    });
    const aviso = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await assinador.contarPaginas(`comprovantes/${titular}/x`);

    expect(JSON.stringify(aviso.mock.calls)).not.toContain(titular);
  });
});
