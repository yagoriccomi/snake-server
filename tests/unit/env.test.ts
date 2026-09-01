import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A configuração é a primeira linha de defesa: ela decide se o processo sobe.
 *
 * Dois comportamentos aqui são de segurança, não de conveniência:
 *  - faltar variável obrigatória DERRUBA o processo, em vez de deixar a falha
 *    aparecer no meio de uma requisição de usuário, dias depois do deploy;
 *  - a presença de `SUPABASE_JWT_SECRET` IMPEDE a inicialização, porque quem
 *    tem esse segredo consegue forjar o token de qualquer aluno. [#55][#80]
 *
 * Cada caso reimporta o módulo com um ambiente próprio — `vi.resetModules()`
 * garante que a validação rode de novo e que nenhum teste herde estado. [#48]
 */

const AMBIENTE_VALIDO = {
  NODE_ENV: 'test',
  PORT: '3000',
  LOG_LEVEL: 'error',
  SUPABASE_URL: 'https://projeto-de-teste.supabase.co',
  SUPABASE_ANON_KEY: 'chave-anon-ficticia-de-teste',
  CLOUDINARY_CLOUD_NAME: 'nuvem-de-teste',
  CLOUDINARY_API_KEY: '000000000000000',
  CLOUDINARY_API_SECRET: 'segredo-ficticio-de-teste',
};

const ambienteOriginal = { ...process.env };

/** `process.exit` vira exceção: dá para afirmar sobre a saída sem matar o runner. */
class SaidaDoProcesso extends Error {
  constructor(readonly codigo: number) {
    super(`process.exit(${codigo})`);
  }
}

let mensagensDeErro: string[];

beforeEach(() => {
  vi.resetModules();
  mensagensDeErro = [];

  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    mensagensDeErro.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    mensagensDeErro.push(args.map(String).join(' '));
  });
  // A assinatura real aceita string | number | null — respeitá-la evita um cast.
  vi.spyOn(process, 'exit').mockImplementation((codigo?: string | number | null): never => {
    throw new SaidaDoProcesso(typeof codigo === 'number' ? codigo : 0);
  });
});

afterEach(() => {
  process.env = { ...ambienteOriginal };
  vi.restoreAllMocks();
});

function definirAmbiente(sobrescritas: Record<string, string | undefined>): void {
  process.env = { ...AMBIENTE_VALIDO };
  for (const [chave, valor] of Object.entries(sobrescritas)) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
}

async function carregarConfig() {
  return import('../../src/config/env.js');
}

describe('config/env — variáveis proibidas', () => {
  it('deveImpedirAInicializacaoQuandoSupabaseJwtSecretEstaPresente', async () => {
    // Com esse segredo, o servidor poderia FORJAR o token de qualquer usuário.
    definirAmbiente({ SUPABASE_JWT_SECRET: 'segredo-de-assinatura-do-jwt' });

    await expect(carregarConfig()).rejects.toBeInstanceOf(SaidaDoProcesso);
    expect(mensagensDeErro.join('\n')).toContain('SUPABASE_JWT_SECRET');
  });

  it('naoDeveVazarOValorDoSegredoProibidoNaMensagemDeErro', async () => {
    definirAmbiente({ SUPABASE_JWT_SECRET: 'valor-secretissimo-do-jwt' });

    await expect(carregarConfig()).rejects.toThrow();
    expect(mensagensDeErro.join('\n')).not.toContain('valor-secretissimo-do-jwt');
  });

  it('deveIgnorarVariavelProibidaDefinidaComoStringVazia', async () => {
    // Vazio é ausência, não presença: não faz sentido travar a subida.
    definirAmbiente({ SUPABASE_JWT_SECRET: '' });

    await expect(carregarConfig()).resolves.toBeDefined();
  });

  it('deveAvisarSemDerrubarQuandoServiceRoleKeyEstaPresente', async () => {
    // Perigosa, mas legítima para um módulo específico — avisa, não bloqueia.
    definirAmbiente({ SUPABASE_SERVICE_ROLE_KEY: 'chave-service-role' });

    await expect(carregarConfig()).resolves.toBeDefined();
    expect(mensagensDeErro.join('\n')).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});

describe('config/env — fail-fast de variáveis obrigatórias', () => {
  it.each([
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ])('deveDerrubarOProcessoQuandoFalta_%s', async (variavel) => {
    definirAmbiente({ [variavel]: undefined });

    await expect(carregarConfig()).rejects.toBeInstanceOf(SaidaDoProcesso);
  });

  it('deveDizerExatamenteQualVariavelEstaFaltando', async () => {
    // Uma mensagem vaga aqui custa meia hora de investigação no deploy.
    definirAmbiente({ CLOUDINARY_API_SECRET: undefined });

    await expect(carregarConfig()).rejects.toThrow();
    expect(mensagensDeErro.join('\n')).toContain('CLOUDINARY_API_SECRET');
  });

  it.each([
    ['sem esquema', 'projeto.supabase.co'],
    ['texto solto', 'nao-e-url'],
    ['vazio', ''],
  ])('deveRecusarSupabaseUrlQuandoEh_%s', async (_rotulo, valor) => {
    definirAmbiente({ SUPABASE_URL: valor });

    await expect(carregarConfig()).rejects.toBeInstanceOf(SaidaDoProcesso);
  });

  it.each([
    ['zero', '0'],
    ['negativa', '-1'],
    ['acima do máximo', '70000'],
    ['não numérica', 'abc'],
  ])('deveRecusarPortaQuandoEh_%s', async (_rotulo, valor) => {
    definirAmbiente({ PORT: valor });

    await expect(carregarConfig()).rejects.toBeInstanceOf(SaidaDoProcesso);
  });
});

describe('config/env — normalização', () => {
  it('deveRemoverABarraFinalDaUrlDoSupabaseParaNaoGerarCaminhoDuplicado', async () => {
    definirAmbiente({ SUPABASE_URL: 'https://projeto.supabase.co///' });

    const { env } = await carregarConfig();

    expect(env.supabase.url).toBe('https://projeto.supabase.co');
  });

  it('deveNascerSemNenhumaOrigemLiberadaQuandoAllowedOriginEstaVazio', async () => {
    // Lista vazia = CORS fechado. O app nativo não precisa. [#57]
    definirAmbiente({ ALLOWED_ORIGIN: '' });

    const { env } = await carregarConfig();

    expect(env.origensPermitidas).toEqual([]);
  });

  it('deveSepararMultiplasOrigensIgnorandoEspacosEEntradasVazias', async () => {
    definirAmbiente({ ALLOWED_ORIGIN: 'https://a.test , ,https://b.test ' });

    const { env } = await carregarConfig();

    expect(env.origensPermitidas).toEqual(['https://a.test', 'https://b.test']);
  });

  it('deveAssumirPorta3000QuandoAVariavelNaoEhInformada', async () => {
    definirAmbiente({ PORT: undefined });

    const { env } = await carregarConfig();

    expect(env.porta).toBe(3000);
  });

  it('deveMarcarComoProducaoApenasQuandoNodeEnvEhProduction', async () => {
    definirAmbiente({ NODE_ENV: 'production' });
    const producao = await carregarConfig();
    expect(producao.env.ehProducao).toBe(true);

    vi.resetModules();
    definirAmbiente({ NODE_ENV: 'development' });
    const desenvolvimento = await carregarConfig();
    expect(desenvolvimento.env.ehProducao).toBe(false);
  });
});
