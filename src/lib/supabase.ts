import { TIMEOUT_REQUISICAO_EXTERNA_MS } from '../config/constants.js';
import { env } from '../config/env.js';
import { dependenciaIndisponivel } from './http-error.js';
import { logger } from './logger.js';

/**
 * Ponto único de conversa com o Supabase.
 *
 * Duas responsabilidades, e só:
 *  1. IDENTIDADE — descobrir QUEM é o chamador, perguntando ao próprio
 *     Supabase (`/auth/v1/user`). O servidor não guarda o segredo do JWT
 *     nem o valida por conta própria: ele não pode forjar o que não tem.
 *  2. AUTORIZAÇÃO — ler dados REPASSANDO o token do chamador ao PostgREST,
 *     para que a RLS que já existe decida o acesso. O servidor não
 *     reimplementa permissão; delega a quem é dono da regra. [#20]
 */

export interface UsuarioAutenticado {
  id: string;
  email?: string;
  role?: string;
}

interface RespostaUsuarioSupabase {
  id?: unknown;
  email?: unknown;
  role?: unknown;
}

function montarUrl(caminho: string, parametros?: URLSearchParams): string {
  const base = `${env.supabase.url}${caminho}`;
  return parametros ? `${base}?${parametros.toString()}` : base;
}

/**
 * Todas as chamadas de saída têm timeout. Sem isso, um Supabase lento
 * segura a conexão do app até o cliente desistir — e nós nem sabemos.
 */
async function chamar(url: string, authorization: string): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'GET',
      headers: {
        apikey: env.supabase.anonKey,
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

/**
 * Resolve o token do chamador em um usuário.
 * Retorna `null` para token ausente, expirado ou inválido — a decisão de
 * responder 401 é de quem chamou, não daqui.
 */
export async function buscarUsuarioPeloToken(
  authorization: string,
): Promise<UsuarioAutenticado | null> {
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
}

/**
 * Consulta uma tabela via PostgREST **com o token do chamador**, para que a
 * RLS filtre o que ele pode ver.
 *
 * Os filtros entram por `URLSearchParams`, nunca por concatenação de string:
 * um `paymentId` malicioso não consegue escapar do valor e virar operador
 * de query. [#51][#52]
 */
export async function consultarComoChamador<T>(
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
    logger.warn('PostgREST recusou a consulta', {
      tabela,
      status: resposta.status,
    });
    // 401/403 aqui significam token que não passa na RLS — tratado como
    // "sem acesso" por quem chamou; 5xx é problema do upstream.
    if (resposta.status >= 500) {
      throw dependenciaIndisponivel('Servidor de dados indisponível', 'supabase_error');
    }
    return [];
  }

  const corpo: unknown = await resposta.json();
  return Array.isArray(corpo) ? (corpo as T[]) : [];
}
