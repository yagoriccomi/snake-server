import { TIMEOUT_REQUISICAO_EXTERNA_MS } from '../config/constants.js';
import {
  dependenciaIndisponivel,
  respostaInvalidaDaDependencia,
  tempoEsgotadoDaDependencia,
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
  /** Resolve o token em um usuário. `null` = token ausente, expirado ou inválido. */
  buscarUsuarioPeloToken(authorization: string): Promise<UsuarioAutenticado | null>;

  /** Consulta uma tabela COM o token do chamador, para a RLS filtrar. */
  consultarComoChamador<T>(
    tabela: string,
    filtros: Record<string, string>,
    colunas: string,
    authorization: string,
  ): Promise<T[]>;

  /**
   * Chama uma RPC COM o token do chamador. `null` quando o PostgREST recusa
   * (4xx) — inclusive a RPC que ainda não existe num banco antigo. Quem
   * interpreta a recusa é a regra, não esta camada.
   */
  chamarRpcComoChamador<T>(
    funcao: string,
    argumentos: Record<string, unknown>,
    authorization: string,
  ): Promise<T | null>;

  /**
   * Pergunta a uma RPC de permissão se o chamador pode. `true` só quando o
   * banco responde o booleano `true`; `false` quando responde `false` ou
   * recusa o token (401/403). Qualquer outra coisa é falha do Supabase, e
   * falha nunca vira "pode" nem "não pode": vira 502, 503 ou 504 (D20).
   */
  confirmarPermissaoComoChamador(
    funcao: string,
    argumentos: Record<string, unknown>,
    authorization: string,
  ): Promise<boolean>;
}

/** Recusa do token pelo PostgREST: a resposta é "não pode", não falha. */
const STATUS_SEM_PERMISSAO: readonly number[] = [401, 403];

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

function respostaInvalida(options?: { cause?: unknown }) {
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
   * com JSON). Falha de rede ou timeout sobe crua: quem chama decide o que
   * ela vira.
   */
  function enviar(url: string, authorization: string, corpo?: unknown): Promise<Response> {
    const cabecalhos: Record<string, string> = {
      apikey: config.anonKey,
      Authorization: authorization,
      Accept: 'application/json',
    };
    const requisicao: RequestInit =
      corpo === undefined ? { method: 'GET' } : { method: 'POST', body: JSON.stringify(corpo) };
    if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';

    return fetch(url, {
      ...requisicao,
      headers: cabecalhos,
      signal: AbortSignal.timeout(TIMEOUT_REQUISICAO_EXTERNA_MS),
    });
  }

  /**
   * As rotas fora da segunda barreira ainda tratam rede e timeout como um
   * 503 só: a troca pelos códigos da D20 espera a v6 do contrato (C15).
   */
  async function chamar(url: string, authorization: string, corpo?: unknown): Promise<Response> {
    try {
      return await enviar(url, authorization, corpo);
    } catch (causa) {
      logger.error('Falha de rede ao chamar o Supabase', { erro: causa });
      throw foraDoAr({ cause: causa });
    }
  }

  return {
    async buscarUsuarioPeloToken(authorization) {
      const resposta = await chamar(montarUrl('/auth/v1/user'), authorization);

      if (!resposta.ok) return null;

      const corpo = (await resposta.json()) as RespostaUsuarioSupabase;

      // O `id` é a única coisa que este servidor realmente usa — e é ele que
      // deriva o destino do upload. Sem id verificado, não há usuário.
      if (typeof corpo.id !== 'string' || corpo.id.length === 0) {
        logger.warn('Supabase respondeu 200 sem id de usuário');
        return null;
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

        // 401/403 aqui significam token que não passa na RLS — tratado como
        // "sem acesso" por quem chamou. 5xx é problema do upstream.
        if (resposta.status >= 500) {
          throw dependenciaIndisponivel('Servidor de dados indisponível', 'supabase_error');
        }
        return [];
      }

      const corpo: unknown = await resposta.json();
      return Array.isArray(corpo) ? (corpo as T[]) : [];
    },

    /**
     * Os argumentos vão no corpo JSON, nunca na URL; o nome da função passa
     * por `encodeURIComponent`, como o nome da tabela acima. [#51][#52]
     */
    async chamarRpcComoChamador<T>(
      funcao: string,
      argumentos: Record<string, unknown>,
      authorization: string,
    ): Promise<T | null> {
      const resposta = await chamar(
        montarUrl(`/rest/v1/rpc/${encodeURIComponent(funcao)}`),
        authorization,
        argumentos,
      );

      if (!resposta.ok) {
        logger.warn('PostgREST recusou a RPC', { funcao, status: resposta.status });

        // 4xx: token sem permissão ou a função ainda não existe (banco antigo,
        // PGRST202). Os dois viram "sem acesso" em quem chamou — nunca 5xx,
        // para o servidor poder ir ao ar antes das migrations (contrato § 14).
        if (resposta.status >= 500) {
          throw dependenciaIndisponivel('Servidor de dados indisponível', 'supabase_error');
        }
        return null;
      }

      return (await resposta.json()) as T;
    },

    /**
     * Mesmo transporte da RPC acima, mas sem o atalho "4xx vira `null`": numa
     * barreira de permissão, função ausente ou formato estranho não podem se
     * passar por "não pode" e disparar o alarme de acesso indevido. [#9][#93]
     */
    async confirmarPermissaoComoChamador(funcao, argumentos, authorization) {
      let resposta: Response;
      try {
        resposta = await enviar(
          montarUrl(`/rest/v1/rpc/${encodeURIComponent(funcao)}`),
          authorization,
          argumentos,
        );
      } catch (causa) {
        logger.error('Falha ao chamar a RPC de permissão', { funcao, erro: causa });
        throw ehTimeout(causa) ? tempoEsgotado({ cause: causa }) : foraDoAr({ cause: causa });
      }

      if (!resposta.ok) {
        logger.warn('PostgREST recusou a RPC de permissão', { funcao, status: resposta.status });

        if (STATUS_SEM_PERMISSAO.includes(resposta.status)) return false;
        if (resposta.status === STATUS_TEMPO_ESGOTADO) throw tempoEsgotado();
        if (STATUS_FORA_DO_AR.includes(resposta.status)) throw foraDoAr();
        throw respostaInvalida();
      }

      let corpo: unknown;
      try {
        corpo = await resposta.json();
      } catch (causa) {
        throw respostaInvalida({ cause: causa });
      }

      if (typeof corpo !== 'boolean') {
        logger.warn('RPC de permissão respondeu fora do formato', { funcao, tipo: typeof corpo });
        throw respostaInvalida();
      }
      return corpo;
    },
  };
}
