import type { DependenciasDaApi } from '../../src/composition-root.js';
import type { ClienteSupabase, UsuarioAutenticado } from '../../src/lib/supabase.js';
import type { RegistroDeJustificativa } from '../../src/modules/justifications/justifications.service.js';
import type { RegistroDeAnexoDeMotivo } from '../../src/modules/motivos/motivos.service.js';
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

/** Justificativa que a RLS libera (dono, professor da aula ou admin). */
export const JUSTIFICATIVA_VISIVEL = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** Justificativa que a RLS não libera: lista vazia. */
export const JUSTIFICATIVA_INVISIVEL = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';

/** Aula a que a justificativa visível pertence. */
export const AULA_DA_JUSTIFICATIVA = '5b4c3d2e-1f0a-4b9c-8d7e-6f5a4b3c2d1e';

/** Motivo a que o dono pode anexar: `pode_anexar_ao_motivo` responde `true`. */
export const MOTIVO_PERMITIDO = '4c3d2e1f-0a9b-4c8d-9e7f-6a5b4c3d2e1f';

/** Motivo de outra pessoa (ou já usado): a RPC responde `false`. */
export const MOTIVO_NEGADO = '3d2e1f0a-9b8c-4d7e-8f6a-5b4c3d2e1f0a';

/** Anexo de motivo que a RLS libera. */
export const ANEXO_DE_MOTIVO_VISIVEL = '1f0a9b8c-7d6e-4f5a-8b4c-3d2e1f0a9b8c';

/** Anexo de motivo que a RLS não libera: lista vazia. */
export const ANEXO_DE_MOTIVO_INVISIVEL = '0a9b8c7d-6e5f-4a4b-9c3d-2e1f0a9b8c7d';

/** Quem enviou o anexo visível — não é o usuário do token (ex.: professor lendo o atestado). */
export const AUTOR_DO_ANEXO = '8c7d6e5f-4a3b-4c2d-8e1f-0a9b8c7d6e5f';

/** Timestamp congelado — teste não espera o relógio andar. [#48] */
export const AGORA_EM_SEGUNDOS = 1_700_000_000;

export const PUBLIC_ID_GRAVADO = 'comprovantes/11111111-2222-4333-8444-555555555555/pagamento-1';

export const URL_ASSINADA_FALSA = `https://res.cloudinary.com/nuvem-de-teste/image/authenticated/s--ASSINATURA--/${PUBLIC_ID_GRAVADO}`;

/** Registra o que foi chamado, para o teste afirmar sobre COMPORTAMENTO, não só saída. */
export interface Espioes {
  buscasPorPagamento: { paymentId: string; authorization: string }[];
  buscasPorJustificativa: { justificationId: string; authorization: string }[];
  perguntasDePermissao: { motivoId: string; authorization: string }[];
  buscasPorAnexoDeMotivo: { anexoId: string; authorization: string }[];
  tokensVerificados: string[];
}

export function criarSupabaseFalso(espioes: Espioes): ClienteSupabase {
  return {
    async buscarUsuarioPeloToken(authorization) {
      espioes.tokensVerificados.push(authorization);
      return authorization === TOKEN_VALIDO ? USUARIO_DONO : null;
    },

    // Os módulos recebem os seus leitores prontos (ver `criarDependenciasFalsas`);
    // nenhum chama RPC por este dublê.
    chamarRpcComoChamador: () => Promise.resolve(null),

    async consultarComoChamador<T>(
      _tabela: string,
      filtros: Record<string, string>,
      _colunas: string,
      _authorization: string,
    ): Promise<T[]> {
      // Simula a RLS: só devolve linha para o pagamento do próprio dono.
      const linha: RegistroDePagamento = {
        user_id: USUARIO_DONO.id,
        proof_provider: 'cloudinary',
        proof_public_id: PUBLIC_ID_GRAVADO,
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
    contarPaginas: () => Promise.resolve(1),
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
  const midia = criarMidiaFalsa();

  return {
    supabase,
    proofs: {
      supabase,
      midia,
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
    justifications: {
      supabase,
      midia,
      justificativas: {
        buscarPorId(justificationId, authorization) {
          espioes.buscasPorJustificativa.push({ justificationId, authorization });

          // Simula a RLS de absence_justifications.
          const linha: RegistroDeJustificativa = {
            user_id: USUARIO_DONO.id,
            class_id: AULA_DA_JUSTIFICATIVA,
            proof_provider: 'cloudinary',
            proof_public_id: `justificativas/${USUARIO_DONO.id}/${AULA_DA_JUSTIFICATIVA}`,
          };
          return Promise.resolve(justificationId === JUSTIFICATIVA_VISIVEL ? linha : null);
        },
      },
      agoraEmSegundos: () => AGORA_EM_SEGUNDOS,
    },
    motivos: {
      supabase,
      midia,
      motivos: {
        podeAnexar(motivoId, authorization) {
          espioes.perguntasDePermissao.push({ motivoId, authorization });
          // Simula `pode_anexar_ao_motivo`: só o motivo permitido responde
          // `true`. O banco antigo sem a função é provado no teste do
          // repositório, onde a recusa 4xx acontece de fato.
          return Promise.resolve(motivoId === MOTIVO_PERMITIDO);
        },
        buscarAnexo(anexoId, authorization) {
          espioes.buscasPorAnexoDeMotivo.push({ anexoId, authorization });

          // Simula a RLS de action_reason_attachments.
          const linha: RegistroDeAnexoDeMotivo = {
            id: ANEXO_DE_MOTIVO_VISIVEL,
            uploaded_by: AUTOR_DO_ANEXO,
            provider: 'cloudinary',
            public_id: `motivos/${AUTOR_DO_ANEXO}/${ANEXO_DE_MOTIVO_VISIVEL}`,
          };
          return Promise.resolve(anexoId === ANEXO_DE_MOTIVO_VISIVEL ? linha : null);
        },
      },
      agoraEmSegundos: () => AGORA_EM_SEGUNDOS,
    },
  };
}

export function criarEspioes(): Espioes {
  return {
    buscasPorPagamento: [],
    buscasPorJustificativa: [],
    perguntasDePermissao: [],
    buscasPorAnexoDeMotivo: [],
    tokensVerificados: [],
  };
}
