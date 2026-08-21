import { TIMEOUT_REQUISICAO_EXTERNA_MS } from '../config/constants.js';
import { dependenciaIndisponivel } from './http-error.js';
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
   */
  async function chamar(url: string, authorization: string): Promise<Response> {
    try {
      return await fetch(url, {
        method: 'GET',
        headers: {
          apikey: config.anonKey,
          Authorization: authorization,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(TIMEOUT_REQUISICAO_EXTERNA_MS),
      });
    } catch (causa) {
      logger.error('Falha de rede ao chamar o Supabase', { erro: causa });
      throw dependenciaIndisponivel(
        'Não foi possível falar com o servidor de dados',
        'supabase_unreachable',
        { cause: causa },
      );
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
  };
}
