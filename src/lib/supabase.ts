import { TIMEOUT_REQUISICAO_EXTERNA_MS } from '../config/constants.js';
import {
  dependenciaIndisponivel,
  respostaInvalidaDaDependencia,
  sessaoInvalida,
  tempoEsgotadoDaDependencia,
  type HttpError,
} from './http-error.js';
import { logger } from './logger.js';

/**
 * Adaptador do Supabase — duas responsabilidades, e só:
 *
 *  1. IDENTIDADE — descobrir QUEM é o chamador, perguntando ao próprio
 *     Supabase (`/auth/v1/user`). O servidor não guarda o segredo do JWT
 *     nem o valida por conta própria: ele não pode forjar o que não tem.
 *  2. AUTORIZAÇÃO — ler dados REPASSANDO o token do chamador ao PostgREST,
 *     para que a RLS que já existe decida o acesso. O servidor não
 *     reimplementa permissão; delega a quem é dono da regra. [#20]
 *
 * Exposto como factory, não como funções soltas que leem `env`: assim quem
 * depende dele depende da INTERFACE, e um teste injeta um cliente falso sem
 * precisar interceptar o módulo. [#20][#21]
 *
 * Falha do Supabase nunca é "sem acesso" nem "sessão inválida": vira 502, 503
 * ou 504, e nada é liberado (contrato § 13.6, D20). A única recusa que chega
 * ao cliente como 401 é a do próprio token.
 */

export interface UsuarioAutenticado {
  id: string;
  email?: string;
  role?: string;
}

export interface ConfigSupabase {
  url: string;
  anonKey: string;
}

export interface ClienteSupabase {
  /**
   * Resolve o token em um usuário. `null` só quando o Auth recusa o token
   * (4xx); falha do Auth é erro 502, 503 ou 504, nunca `null`.
   */
  buscarUsuarioPeloToken(authorization: string): Promise<UsuarioAutenticado | null>;

  /**
   * Consulta uma tabela COM o token do chamador, para a RLS filtrar. Lista
   * vazia é "a RLS não liberou"; recusa do PostgREST ou resposta fora do
   * formato é erro, nunca lista vazia.
   */
  consultarComoChamador<T>(
    tabela: string,
    filtros: Record<string, string>,
    colunas: string,
    authorization: string,
  ): Promise<T[]>;

  /**
   * Pergunta a uma RPC de permissão se o chamador pode. `true` ou `false` só
   * quando o banco responde esse booleano. O token recusado pelo PostgREST
   * (401) é 401 `bad_token`; qualquer outra coisa é falha do Supabase, e falha
   * nunca vira "pode" nem "não pode": vira 502, 503 ou 504 (contrato § 13.5).
   */
  confirmarPermissaoComoChamador(
    funcao: string,
    argumentos: Record<string, unknown>,
    authorization: string,
  ): Promise<boolean>;
}

/**
 * O PostgREST recusou o token: a sessão venceu. Não é "não pode" (o 403 com
 * alarme acusaria de acesso indevido quem só precisa entrar de novo).
 */
const STATUS_TOKEN_RECUSADO = 401;

/** Do 500 para cima, a falha é do Supabase, não do token. */
const PRIMEIRO_STATUS_DE_FALHA_DO_SERVIDOR = 500;

/** O gateway do Supabase avisa que o banco está fora do ar. */
const STATUS_FORA_DO_AR: readonly number[] = [502, 503];

/** O gateway do Supabase desistiu de esperar o banco. */
const STATUS_TEMPO_ESGOTADO = 504;

/** Nome que o `AbortSignal.timeout` dá ao erro quando o prazo vence. */
const NOME_DO_ERRO_DE_TIMEOUT = 'TimeoutError';

const MENSAGEM_FORA_DO_AR = 'Não foi possível falar com o servidor de dados';
const MENSAGEM_TEMPO_ESGOTADO = 'O servidor de dados demorou demais para responder';
const MENSAGEM_RESPOSTA_INVALIDA = 'O servidor de dados respondeu de forma inesperada';

function foraDoAr(options?: { cause?: unknown }) {
  return dependenciaIndisponivel(MENSAGEM_FORA_DO_AR, 'supabase_unreachable', options);
}

function tempoEsgotado(options?: { cause?: unknown }) {
  return tempoEsgotadoDaDependencia(MENSAGEM_TEMPO_ESGOTADO, 'supabase_timeout', options);
}

/**
 * O Supabase respondeu fora do combinado. Exportado porque um valor fora do
 * contrato numa linha válida (como `attempt` fora de 1–2) é a mesma falha,
 * percebida pela regra e não pelo transporte (contrato § 13.6).
 */
export function respostaInvalidaDoSupabase(options?: { cause?: unknown }): HttpError {
  return respostaInvalidaDaDependencia(
    MENSAGEM_RESPOSTA_INVALIDA,
    'supabase_invalid_response',
    options,
  );
}

// `DOMException` nem sempre passa por `instanceof Error`; o nome basta.
function ehTimeout(causa: unknown): boolean {
  return (
    typeof causa === 'object' &&
    causa !== null &&
    (causa as { name?: unknown }).name === NOME_DO_ERRO_DE_TIMEOUT
  );
}

/** O status de falha do gateway ou do banco, quando o token não está em causa. */
function falhaDoServidorDeDados(status: number): HttpError {
  if (status === STATUS_TEMPO_ESGOTADO) return tempoEsgotado();
  if (STATUS_FORA_DO_AR.includes(status)) return foraDoAr();
  return respostaInvalidaDoSupabase();
}

/**
 * A recusa do PostgREST. Só o 401 é do token; o resto do 4xx (função ou
 * coluna ausente, falta de `grant`) é dependência quebrada, não falta de
 * permissão: tratá-lo como "sem acesso" esconderia o defeito atrás de um 403.
 */
function recusaDoPostgrest(status: number): HttpError {
  if (status === STATUS_TOKEN_RECUSADO) return sessaoInvalida();
  return falhaDoServidorDeDados(status);
}

interface RespostaUsuarioSupabase {
  id?: unknown;
  email?: unknown;
  role?: unknown;
}

export function criarClienteSupabase(config: ConfigSupabase): ClienteSupabase {
  function montarUrl(caminho: string, parametros?: URLSearchParams): string {
    const base = `${config.url}${caminho}`;
    return parametros ? `${base}?${parametros.toString()}` : base;
  }

  /**
   * Toda chamada de saída tem timeout. Sem isso, um Supabase lento segura a
   * conexão do app até o cliente desistir — e nós nem ficamos sabendo.
   *
   * Sem `corpo`, é uma leitura (GET); com `corpo`, a chamada de uma RPC (POST
   * com JSON). Prazo vencido é 504; qualquer outra falha de transporte é 503.
   */
  async function chamar(url: string, authorization: string, corpo?: unknown): Promise<Response> {
    const cabecalhos: Record<string, string> = {
      apikey: config.anonKey,
      Authorization: authorization,
      Accept: 'application/json',
    };
    const requisicao: RequestInit =
      corpo === undefined ? { method: 'GET' } : { method: 'POST', body: JSON.stringify(corpo) };
    if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';

    try {
      return await fetch(url, {
        ...requisicao,
        headers: cabecalhos,
        signal: AbortSignal.timeout(TIMEOUT_REQUISICAO_EXTERNA_MS),
      });
    } catch (causa) {
      logger.error('Falha de rede ao chamar o Supabase', { erro: causa });
      throw ehTimeout(causa) ? tempoEsgotado({ cause: causa }) : foraDoAr({ cause: causa });
    }
  }

  /**
   * O corpo também é lido sob o prazo da chamada: se ele vence no meio da
   * leitura, é 504, como na conexão. Corpo que não é JSON é 502, nunca 500.
   */
  async function lerJson(resposta: Response): Promise<unknown> {
    try {
      return await resposta.json();
    } catch (causa) {
      throw ehTimeout(causa)
        ? tempoEsgotado({ cause: causa })
        : respostaInvalidaDoSupabase({ cause: causa });
    }
  }

  return {
    async buscarUsuarioPeloToken(authorization) {
      const resposta = await chamar(montarUrl('/auth/v1/user'), authorization);

      if (!resposta.ok) {
        // 4xx é o Auth recusando o token: a sessão é que é inválida. Do 500
        // para cima é o Auth que falhou, e o aluno não pode ler "Sessão
        // inválida" com o Supabase fora do ar.
        if (resposta.status < PRIMEIRO_STATUS_DE_FALHA_DO_SERVIDOR) return null;

        logger.warn('Auth do Supabase falhou ao validar o token', { status: resposta.status });
        throw falhaDoServidorDeDados(resposta.status);
      }

      const corpo = (await lerJson(resposta)) as RespostaUsuarioSupabase | null;

      // O `id` é a única coisa que este servidor realmente usa — e é ele que
      // deriva o destino do upload. Um 200 sem id é o Auth fora do contrato.
      if (typeof corpo?.id !== 'string' || corpo.id.length === 0) {
        logger.warn('Supabase respondeu 200 sem id de usuário');
        throw respostaInvalidaDoSupabase();
      }

      const usuario: UsuarioAutenticado = { id: corpo.id };
      if (typeof corpo.email === 'string') usuario.email = corpo.email;
      if (typeof corpo.role === 'string') usuario.role = corpo.role;

      return usuario;
    },

    /**
     * Os filtros entram por `URLSearchParams`, nunca por concatenação de
     * string: um valor malicioso não consegue escapar do parâmetro e virar
     * operador de query. [#51][#52]
     */
    async consultarComoChamador<T>(
      tabela: string,
      filtros: Record<string, string>,
      colunas: string,
      authorization: string,
    ): Promise<T[]> {
      const parametros = new URLSearchParams(filtros);
      parametros.set('select', colunas);

      const resposta = await chamar(
        montarUrl(`/rest/v1/${encodeURIComponent(tabela)}`, parametros),
        authorization,
      );

      if (!resposta.ok) {
        logger.warn('PostgREST recusou a consulta', { tabela, status: resposta.status });
        throw recusaDoPostgrest(resposta.status);
      }

      const corpo = await lerJson(resposta);

      if (!Array.isArray(corpo)) {
        logger.warn('PostgREST respondeu a consulta fora do formato', {
          tabela,
          tipo: typeof corpo,
        });
        throw respostaInvalidaDoSupabase();
      }
      return corpo as T[];
    },

    /**
     * Os argumentos vão no corpo JSON, nunca na URL; o nome da função passa
     * por `encodeURIComponent`, como o nome da tabela acima. [#51][#52]
     *
     * Numa pergunta de permissão, função ausente ou formato estranho não podem
     * se passar por "não pode": o 403 esconderia o defeito. [#9][#93]
     */
    async confirmarPermissaoComoChamador(funcao, argumentos, authorization) {
      const resposta = await chamar(
        montarUrl(`/rest/v1/rpc/${encodeURIComponent(funcao)}`),
        authorization,
        argumentos,
      );

      if (!resposta.ok) {
        logger.warn('PostgREST recusou a RPC de permissão', { funcao, status: resposta.status });
        throw recusaDoPostgrest(resposta.status);
      }

      const corpo = await lerJson(resposta);

      if (typeof corpo !== 'boolean') {
        logger.warn('RPC de permissão respondeu fora do formato', { funcao, tipo: typeof corpo });
        throw respostaInvalidaDoSupabase();
      }
      return corpo;
    },
  };
}
