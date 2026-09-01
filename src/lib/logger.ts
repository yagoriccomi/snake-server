import { env } from '../config/env.js';

/**
 * Log estruturado em JSON — uma linha por evento, pronta para ser
 * filtrada e agrupada por qualquer coletor (Datadog, ELK, Render Logs). [#91]
 *
 * REGRA CENTRAL: este servidor lida com comprovante de PIX, que é dado
 * financeiro pessoal. Nenhum campo sensível — token, segredo, assinatura,
 * e-mail, CPF, caminho do comprovante — pode vazar para o log. O mascaramento
 * é aplicado no logger, não na chamada: quem loga não pode esquecer. [#63]
 */

export type NivelDeLog = 'debug' | 'info' | 'warn' | 'error';

const PESO_DOS_NIVEIS: Record<NivelDeLog, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDIGIDO = '[REDIGIDO]';

/** Profundidade máxima ao percorrer objetos — barreira contra ciclos e payloads absurdos. */
const PROFUNDIDADE_MAXIMA = 6;

/**
 * Teto de tamanho para qualquer texto que entre no log.
 *
 * Sem ele, um campo grande (uma mensagem de erro de upstream, um corpo
 * refletido) enche a linha de log e, em volume, o disco do coletor. Truncar
 * preserva o começo, que é onde costuma estar a informacao util.
 */
export const TAMANHO_MAXIMO_DE_TEXTO = 2_048;

/** Abaixo disto, um identificador não tem prefixo suficiente para valer a pena. */
const TAMANHO_MINIMO_DO_PREFIXO = 8;

/**
 * Chaves cujo VALOR nunca é logado, em nenhuma circunstância.
 * Casa com variações comuns de escrita (camelCase, snake_case, PT e EN).
 */
const CHAVE_SENSIVEL =
  /^(authorization|auth|authheader|cookie|set-?cookie|token|jwt|refresh_?token|access_?token|api_?key|apikey|anon_?key|api_?secret|secret|signature|password|senha|pass|cpf|cnpj|rg|email|e_?mail|phone|telefone|celular|proof_?url|comprovante)$/i;

/**
 * Chaves que são identificadores: úteis para rastrear, perigosos por inteiro.
 *
 * O padrão casa QUALQUER chave terminada em `_id` — e não uma lista fechada —
 * porque a lista fechada falha em silêncio: basta alguém logar um campo novo
 * (`dono_user_id`, `turma_id`) para o identificador inteiro escapar. Aqui o
 * comportamento seguro é o padrão, e não algo que se precisa lembrar. [#63]
 */
const CHAVE_IDENTIFICADORA = /^id$|_id$|^(?:user|usuario|payment|pagamento|public)Id$/i;

const PADRAO_JWT = /\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g;
const PADRAO_EMAIL = /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;
const PADRAO_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const PADRAO_BEARER = /\bBearer\s+\S+/gi;

/**
 * Encurta um identificador para o suficiente de correlacionar dois logs,
 * sem entregar o valor inteiro a quem tiver acesso ao coletor.
 */
function mascararIdentificador(valor: string): string {
  if (valor.length <= TAMANHO_MINIMO_DO_PREFIXO) return REDIGIDO;
  return `${valor.slice(0, TAMANHO_MINIMO_DO_PREFIXO)}…`;
}

/** Remove de textos livres os padrões que costumam vazar sem querer, e corta o excesso. */
function limparTexto(texto: string): string {
  const limpo = texto
    .replace(PADRAO_BEARER, `Bearer ${REDIGIDO}`)
    .replace(PADRAO_JWT, REDIGIDO)
    .replace(PADRAO_EMAIL, REDIGIDO)
    .replace(PADRAO_CPF, REDIGIDO);

  // O corte vem DEPOIS da limpeza: truncar antes poderia partir um padrão
  // sensível ao meio e deixar metade do segredo passar.
  return limpo.length > TAMANHO_MAXIMO_DE_TEXTO
    ? `${limpo.slice(0, TAMANHO_MAXIMO_DE_TEXTO)}…[truncado]`
    : limpo;
}

/** Erro vira objeto plano: a stack fica no servidor e some em produção. [#93] */
function mascararErro(erro: Error): Record<string, unknown> {
  return {
    nome: erro.name,
    mensagem: limparTexto(erro.message),
    stack: env.ehProducao ? undefined : erro.stack,
  };
}

/**
 * Aplica as regras de chave a um objeto.
 *
 * Separado do dispatch de tipo porque é aqui que mora a decisão de segurança
 * — redigir, encurtar ou seguir — e ela merece ser lida (e testada) sozinha. [#2]
 */
function mascararObjeto(
  objeto: Record<string, unknown>,
  profundidade: number,
): Record<string, unknown> {
  const saida: Record<string, unknown> = {};

  for (const [chave, conteudo] of Object.entries(objeto)) {
    if (CHAVE_SENSIVEL.test(chave)) {
      saida[chave] = REDIGIDO;
      continue;
    }

    if (CHAVE_IDENTIFICADORA.test(chave) && typeof conteudo === 'string') {
      saida[chave] = mascararIdentificador(conteudo);
      continue;
    }

    saida[chave] = mascararValor(conteudo, profundidade + 1);
  }

  return saida;
}

/** Dispatch por tipo. Cada ramo delega; nenhum concentra regra. */
function mascararValor(valor: unknown, profundidade: number): unknown {
  if (valor === null || valor === undefined) return valor;

  if (typeof valor === 'string') return limparTexto(valor);
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'bigint') return valor.toString();
  if (typeof valor === 'function' || typeof valor === 'symbol') return REDIGIDO;

  if (profundidade >= PROFUNDIDADE_MAXIMA) return '[PROFUNDO_DEMAIS]';

  if (valor instanceof Error) return mascararErro(valor);
  if (valor instanceof Date) return valor.toISOString();

  if (Array.isArray(valor)) {
    return valor.map((item) => mascararValor(item, profundidade + 1));
  }

  if (typeof valor === 'object') {
    return mascararObjeto(valor as Record<string, unknown>, profundidade);
  }

  return REDIGIDO;
}

/**
 * Torna qualquer contexto seguro para log.
 *
 * Exportada porque é a função mais crítica deste arquivo do ponto de vista de
 * privacidade: ela precisa de teste próprio, não apenas de uso indireto. [#41]
 */
export function mascarar(contexto: Record<string, unknown>): Record<string, unknown> {
  return mascararObjeto(contexto, 0);
}

function deveRegistrar(nivel: NivelDeLog): boolean {
  return PESO_DOS_NIVEIS[nivel] >= PESO_DOS_NIVEIS[env.nivelDeLog];
}

function escrever(nivel: NivelDeLog, mensagem: string, contexto?: Record<string, unknown>): void {
  if (!deveRegistrar(nivel)) return;

  const registro = {
    nivel,
    horario: new Date().toISOString(),
    mensagem: limparTexto(mensagem),
    ...(contexto ? mascarar(contexto) : {}),
  };

  const linha = JSON.stringify(registro);

  if (nivel === 'error') process.stderr.write(`${linha}\n`);
  else process.stdout.write(`${linha}\n`);
}

export const logger = {
  /** Detalhe de desenvolvimento — nunca em produção por padrão. [#92] */
  debug: (mensagem: string, contexto?: Record<string, unknown>) =>
    escrever('debug', mensagem, contexto),

  /** Fluxo de negócio esperado (requisição atendida, upload assinado). [#92] */
  info: (mensagem: string, contexto?: Record<string, unknown>) =>
    escrever('info', mensagem, contexto),

  /** Situação inesperada, porém contornável (token inválido, 403 legítimo). [#92] */
  warn: (mensagem: string, contexto?: Record<string, unknown>) =>
    escrever('warn', mensagem, contexto),

  /** Falha grave que exige investigação. [#92] */
  error: (mensagem: string, contexto?: Record<string, unknown>) =>
    escrever('error', mensagem, contexto),
} as const;

export type Logger = typeof logger;
