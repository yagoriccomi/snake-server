import type { DependenciasDaApi } from '../../src/composition-root.js';
import type { ClienteSupabase, UsuarioAutenticado } from '../../src/lib/supabase.js';
import type {
  AssinadorDeMidia,
  PoliticaDeAcesso,
  RegistroDePagamento,
} from '../../src/modules/proofs/proofs.service.js';

/**
 * Dublês das dependências externas. [#45]
 *
 * Eles respeitam o MESMO contrato das implementações reais — um mock que
 * devolve formato diferente do contrato dá falsa sensação de segurança.
 * Nenhum deles toca rede, banco ou relógio de verdade. [#48]
 */

export const TOKEN_VALIDO = 'Bearer token-de-teste-aceito';
export const TOKEN_RECUSADO = 'Bearer token-de-teste-recusado';

export const USUARIO_DONO: UsuarioAutenticado = {
  id: '11111111-2222-4333-8444-555555555555',
  email: 'aluno@exemplo.test',
};

/** Pagamento que a RLS libera para o dono. */
export const PAGAMENTO_DO_DONO = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

/** Pagamento de outra pessoa: a RLS devolve lista vazia. */
export const PAGAMENTO_DE_OUTRO = '99999999-8888-4777-a666-555555555555';

/** Timestamp congelado — teste não espera o relógio andar. [#48] */
export const AGORA_EM_SEGUNDOS = 1_700_000_000;

export const PUBLIC_ID_GRAVADO = 'comprovantes/11111111-2222-4333-8444-555555555555/pagamento-1';

export const URL_ASSINADA_FALSA = `https://res.cloudinary.com/nuvem-de-teste/image/authenticated/s--ASSINATURA--/${PUBLIC_ID_GRAVADO}`;

/** Registra o que foi chamado, para o teste afirmar sobre COMPORTAMENTO, não só saída. */
export interface Espioes {
  buscasPorPagamento: { paymentId: string; authorization: string }[];
  tokensVerificados: string[];
}

export function criarSupabaseFalso(espioes: Espioes): ClienteSupabase {
  return {
    async buscarUsuarioPeloToken(authorization) {
      espioes.tokensVerificados.push(authorization);
      return authorization === TOKEN_VALIDO ? USUARIO_DONO : null;
    },

    async consultarComoChamador<T>(
      _tabela: string,
      filtros: Record<string, string>,
      _colunas: string,
      _authorization: string,
    ): Promise<T[]> {
      // Simula a RLS: só devolve linha para o pagamento do próprio dono.
      const linha: RegistroDePagamento = {
        user_id: USUARIO_DONO.id,
        proof_url: PUBLIC_ID_GRAVADO,
      };
      return filtros.id === `eq.${PAGAMENTO_DO_DONO}` ? ([linha] as T[]) : [];
    },
  };
}

export function criarMidiaFalsa(): AssinadorDeMidia {
  return {
    assinarUpload(parametros) {
      return {
        ...parametros,
        cloudName: 'nuvem-de-teste',
        apiKey: '000000000000000',
        signature: 'assinatura-ficticia',
        uploadUrl: 'https://api.cloudinary.com/v1_1/nuvem-de-teste/auto/upload',
      };
    },
    gerarUrlDeVisualizacao: () => URL_ASSINADA_FALSA,
    extrairPublicId: (valorGravado) => valorGravado,
  };
}

export interface OpcoesDasDependencias {
  /** Substitui o leitor de pagamentos — útil para simular falha de upstream. */
  buscarPagamento?: (
    paymentId: string,
    authorization: string,
  ) => Promise<RegistroDePagamento | null>;

  /** Segunda barreira de autorização. Padrão: `rls`, como em produção. */
  politicaDeAcesso?: PoliticaDeAcesso;
}

export function criarDependenciasFalsas(
  espioes: Espioes,
  opcoes: OpcoesDasDependencias = {},
): DependenciasDaApi {
  const supabase = criarSupabaseFalso(espioes);

  return {
    supabase,
    proofs: {
      supabase,
      midia: criarMidiaFalsa(),
      pagamentos: {
        async buscarPorId(paymentId, authorization) {
          espioes.buscasPorPagamento.push({ paymentId, authorization });

          if (opcoes.buscarPagamento) {
            return opcoes.buscarPagamento(paymentId, authorization);
          }

          const linhas = await supabase.consultarComoChamador<RegistroDePagamento>(
            'payments',
            { id: `eq.${paymentId}` },
            'user_id,proof_url',
            authorization,
          );
          return linhas[0] ?? null;
        },
      },
      agoraEmSegundos: () => AGORA_EM_SEGUNDOS,
      politicaDeAcesso: opcoes.politicaDeAcesso ?? 'rls',
    },
  };
}

export function criarEspioes(): Espioes {
  return { buscasPorPagamento: [], tokensVerificados: [] };
}
