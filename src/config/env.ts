import { z } from 'zod';

/**
 * Ponto ÚNICO de leitura de variáveis de ambiente. Nenhum outro arquivo
 * toca em `process.env` — quem precisa de config importa daqui. [#80]
 *
 * A validação roda na importação do módulo: se faltar (ou vier torta)
 * qualquer variável obrigatória, o processo morre agora, com uma mensagem
 * que diz exatamente o que falta — em vez de quebrar no meio de uma
 * requisição do usuário, três dias depois do deploy. [#9]
 */

/**
 * Variáveis que NUNCA devem existir neste servidor.
 * `SUPABASE_JWT_SECRET` permitiria FORJAR um token de qualquer usuário —
 * a presença dela é falha de configuração grave, não conveniência. [#55]
 */
const VARIAVEIS_PROIBIDAS = ['SUPABASE_JWT_SECRET'] as const;

/**
 * Variáveis perigosas toleradas, mas nunca silenciosas.
 * `SUPABASE_SERVICE_ROLE_KEY` ignora a RLS por completo; só faz sentido
 * se um módulo específico exigir escrita fora dela, de forma isolada.
 */
const VARIAVEIS_DE_RISCO = ['SUPABASE_SERVICE_ROLE_KEY'] as const;

const esquemaAmbiente = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /** Origens liberadas para CORS, separadas por vírgula. Vazio = nenhuma. [#57] */
  ALLOWED_ORIGIN: z.string().trim().default(''),

  SUPABASE_URL: z
    .string()
    .trim()
    .min(1, 'obrigatória')
    .url('precisa ser uma URL completa, ex.: https://xxxx.supabase.co')
    // Barra final quebraria a concatenação dos caminhos (`//auth/v1/user`).
    .transform((valor) => valor.replace(/\/+$/, '')),

  SUPABASE_ANON_KEY: z.string().trim().min(1, 'obrigatória'),

  CLOUDINARY_CLOUD_NAME: z.string().trim().min(1, 'obrigatória'),
  CLOUDINARY_API_KEY: z.string().trim().min(1, 'obrigatória'),
  CLOUDINARY_API_SECRET: z.string().trim().min(1, 'obrigatória'),

  /**
   * Segunda barreira de autorização dos comprovantes.
   *
   * `rls`          confia na RLS e ALERTA quando ela libera dado alheio.
   * `somente-dono` nega qualquer acesso que não seja do próprio dono.
   *
   * Ver `PoliticaDeAcesso` em modules/proofs/proofs.service.ts. [#55]
   */
  POLITICA_ACESSO_COMPROVANTE: z.enum(['rls', 'somente-dono']).default('rls'),
});

type AmbienteValidado = z.infer<typeof esquemaAmbiente>;

function abortar(mensagem: string): never {
  // Antes do logger existir, o console é o único canal — e este erro
  // é de inicialização, nunca chega a um usuário final.
  console.error(`\n[config] ${mensagem}\n`);
  process.exit(1);
}

function verificarVariaveisProibidas(): void {
  const presentes = VARIAVEIS_PROIBIDAS.filter((nome) => {
    const valor = process.env[nome];
    return typeof valor === 'string' && valor.length > 0;
  });

  if (presentes.length > 0) {
    abortar(
      `Variável proibida presente: ${presentes.join(', ')}.\n` +
        `Este servidor NUNCA guarda o segredo do JWT do Supabase — ele valida\n` +
        `tokens chamando /auth/v1/user, e não os forja. Remova a variável do\n` +
        `ambiente (e do painel da Render) antes de subir.`,
    );
  }
}

function avisarVariaveisDeRisco(): void {
  for (const nome of VARIAVEIS_DE_RISCO) {
    const valor = process.env[nome];
    if (typeof valor === 'string' && valor.length > 0) {
      console.warn(
        `\n[config] ATENÇÃO: ${nome} está definida. Ela ignora a RLS por completo.\n` +
          `          Use apenas dentro do módulo que a exige, nunca como atalho geral.\n`,
      );
    }
  }
}

function carregarAmbiente(): AmbienteValidado {
  verificarVariaveisProibidas();
  avisarVariaveisDeRisco();

  const resultado = esquemaAmbiente.safeParse(process.env);

  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');

    abortar(
      `Variáveis de ambiente inválidas ou ausentes:\n${problemas}\n\n` +
        `Copie o .env.example para .env e preencha os valores.`,
    );
  }

  return resultado.data;
}

const ambiente = carregarAmbiente();

/** Origens de navegador liberadas. Lista vazia = CORS desligado. [#57] */
const origensPermitidas = ambiente.ALLOWED_ORIGIN.split(',')
  .map((origem) => origem.trim())
  .filter((origem) => origem.length > 0);

export const env = {
  nodeEnv: ambiente.NODE_ENV,
  ehProducao: ambiente.NODE_ENV === 'production',
  porta: ambiente.PORT,
  nivelDeLog: ambiente.LOG_LEVEL,
  origensPermitidas,

  supabase: {
    url: ambiente.SUPABASE_URL,
    anonKey: ambiente.SUPABASE_ANON_KEY,
  },

  cloudinary: {
    cloudName: ambiente.CLOUDINARY_CLOUD_NAME,
    apiKey: ambiente.CLOUDINARY_API_KEY,
    apiSecret: ambiente.CLOUDINARY_API_SECRET,
  },

  politicaDeAcessoAComprovante: ambiente.POLITICA_ACESSO_COMPROVANTE,
} as const;

export type Env = typeof env;
