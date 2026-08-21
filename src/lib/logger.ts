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
 * Chaves cujo VALOR nunca é logado, em nenhuma circunstância.
 * Casa com variações comuns de escrita (camelCase, snake_case, PT e EN).
 */
const CHAVE_SENSIVEL =
  /^(authorization|auth|authheader|cookie|set-?cookie|token|jwt|refresh_?token|access_?token|api_?key|apikey|anon_?key|api_?secret|secret|signature|password|senha|pass|cpf|cnpj|rg|email|e_?mail|phone|telefone|celular|proof_?url|comprovante)$/i;

/** Chaves que são identificadores: úteis para rastrear, perigosos por inteiro. */
const CHAVE_IDENTIFICADORA = /^(user_?id|usuario_?id|payment_?id|pagamento_?id|public_?id|id)$/i;

const PADRAO_JWT = /\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g;
const PADRAO_EMAIL = /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;
const PADRAO_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const PADRAO_BEARER = /\bBearer\s+\S+/gi;

/**
 * Encurta um identificador para o suficiente de correlacionar dois logs,
 * sem entregar o valor inteiro a quem tiver acesso ao coletor.
 */
function mascararIdentificador(valor: string): string {
  if (valor.length <= 8) return REDIGIDO;
  return `${valor.slice(0, 8)}…`;
}

/** Remove de textos livres os padrões que costumam vazar sem querer. */
function limparTexto(texto: string): string {
  return texto
    .replace(PADRAO_BEARER, `Bearer ${REDIGIDO}`)
    .replace(PADRAO_JWT, REDIGIDO)
    .replace(PADRAO_EMAIL, REDIGIDO)
    .replace(PADRAO_CPF, REDIGIDO);
}

function mascararValor(valor: unknown, profundidade: number): unknown {
  if (valor === null || valor === undefined) return valor;

  if (typeof valor === 'string') return limparTexto(valor);
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'bigint') return valor.toString();
  if (typeof valor === 'function' || typeof valor === 'symbol') return REDIGIDO;

  if (profundidade >= PROFUNDIDADE_MAXIMA) return '[PROFUNDO_DEMAIS]';

  if (valor instanceof Error) {
    return {
      nome: valor.name,
      mensagem: limparTexto(valor.message),
      // A stack fica só no log do servidor — nunca vai para o cliente. [#93]
      stack: env.ehProducao ? undefined : valor.stack,
    };
  }

  if (valor instanceof Date) return valor.toISOString();

  if (Array.isArray(valor)) {
    return valor.map((item) => mascararValor(item, profundidade + 1));
  }

  if (typeof valor === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [chave, conteudo] of Object.entries(valor as Record<string, unknown>)) {
      if (CHAVE_SENSIVEL.test(chave)) {
        saida[chave] = REDIGIDO;
      } else if (CHAVE_IDENTIFICADORA.test(chave) && typeof conteudo === 'string') {
        saida[chave] = mascararIdentificador(conteudo);
      } else {
        saida[chave] = mascararValor(conteudo, profundidade + 1);
      }
    }
    return saida;
  }

  return REDIGIDO;
}

/** Torna qualquer contexto seguro para log. Exportado para uso em testes. */
export function mascarar(contexto: Record<string, unknown>): Record<string, unknown> {
  return mascararValor(contexto, 0) as Record<string, unknown>;
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
