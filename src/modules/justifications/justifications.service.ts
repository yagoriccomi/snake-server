import { semAcesso } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import {
  FORMATOS_DE_ANEXO,
  PROVEDOR_CLOUDINARY,
  TIPO_ENTREGA_PRIVADO,
} from '../proofs/proofs.constants.js';
import {
  montarVisualizacao,
  type AssinadorDeMidia,
  type Chamador,
  type ComprovanteParaVisualizar,
  type ConferenciaDeAdmin,
  type UploadAssinado,
} from '../proofs/proofs.service.js';
import {
  PASTA_JUSTIFICATIVAS,
  STATUS_PENDENTE,
  SUFIXO_DA_SEGUNDA_TENTATIVA,
} from './justifications.constants.js';

/**
 * Regra dos anexos de justificativa de falta (contrato § 9.1 e § 13.2).
 *
 * Reusa o CONTRATO de mídia dos comprovantes (`AssinadorDeMidia`) em vez de um
 * segundo adaptador: a Cloudinary assina qualquer pasta e entrega qualquer
 * `public_id`, e duplicar essa integração seria duplicar seus defeitos. [#6][#20]
 */

/** O que o `view-url` lê. */
export interface RegistroDeJustificativa {
  id: string;
  user_id: string;
  /** Nulo na justificativa da semana (`scope = 'week'`). */
  class_id: string | null;
  /** Só vem com as migrations do G4 em produção; os caminhos derivados não a usam. */
  attempt?: number;
  proof_provider: string | null;
  /** Escolhe entre os caminhos derivados; nunca é assinado sem ser um deles. */
  proof_public_id: string | null;
}

/** O que o `sign-upload` com `{ justificationId }` lê. */
export interface JustificativaParaAssinar {
  id: string;
  user_id: string;
  status: string;
  attempt: number;
  proof_public_id: string | null;
}

/** Contrato de leitura — a implementação real passa pela RLS. */
export interface LeitorDeJustificativas {
  buscarPorId(
    justificationId: string,
    authorization: string,
  ): Promise<RegistroDeJustificativa | null>;
  buscarParaAssinar(
    justificationId: string,
    authorization: string,
  ): Promise<JustificativaParaAssinar | null>;
  /**
   * `pode_decidir_justificativa` com o token de quem pede: só `true` libera.
   * Falha do Supabase rejeita (502/503/504), como em `ehAdmin`.
   */
  podeDecidir(justificationId: string, authorization: string): Promise<boolean>;
}

export interface DependenciasDeJustificativas {
  midia: AssinadorDeMidia;
  justificativas: LeitorDeJustificativas;
  admin: ConferenciaDeAdmin;
  /** Injetado para o teste congelar o tempo em vez de esperar por ele. */
  agoraEmSegundos: () => number;
}

/**
 * O nome do arquivo de cada tentativa (contrato § 9.1, `anexar_a_justificativa`).
 * Tentativa fora de 1 e 2 não tem nome: quem chama recusa. [#9]
 */
function nomeDoAnexoDaTentativa(justificationId: string, tentativa: number): string | null {
  if (tentativa === 1) return justificationId;
  if (tentativa === 2) return `${justificationId}${SUFIXO_DA_SEGUNDA_TENTATIVA}`;
  return null;
}

/**
 * Os únicos caminhos que um anexo de justificativa pode ter, todos DERIVADOS
 * de colunas que o aluno não altera: as duas tentativas da forma nova e, na
 * justificativa de aula, o caminho legado por `class_id`.
 */
function caminhosDerivados(justificativa: RegistroDeJustificativa): string[] {
  const pasta = `${PASTA_JUSTIFICATIVAS}/${justificativa.user_id}`;
  const caminhos = [
    `${pasta}/${justificativa.id}`,
    `${pasta}/${justificativa.id}${SUFIXO_DA_SEGUNDA_TENTATIVA}`,
  ];
  if (justificativa.class_id !== null) caminhos.push(`${pasta}/${justificativa.class_id}`);
  return caminhos;
}

export function criarJustificationsService(deps: DependenciasDeJustificativas) {
  /**
   * Segunda barreira (contrato § 13.5, P-9). A RLS de `absence_justifications`
   * libera três leitores: o dono, o admin e, com a justificativa pendente,
   * quem pode decidi-la. Para a linha de outra pessoa, o servidor confere com
   * as MESMAS funções da RLS, na ordem do contrato (o admin custa uma chamada
   * só). Nenhuma confirmou: a RLS liberou o que não devia. [#55]
   */
  async function conferirLeitorLegitimo(
    justificativa: RegistroDeJustificativa,
    chamador: Chamador,
  ): Promise<void> {
    if (justificativa.user_id === chamador.userId) return;
    if (await deps.admin.ehAdmin(chamador.authorization)) return;
    if (await deps.justificativas.podeDecidir(justificativa.id, chamador.authorization)) return;

    logger.error('RLS liberou justificativa de outro usuário', {
      traceId: chamador.traceId,
      user_id: chamador.userId,
      dono_user_id: justificativa.user_id,
      acao: 'bloqueado',
    });
    throw semAcesso();
  }

  return {
    /**
     * Forma LEGADA `{ classId }`, do APK 1.8 e da web atual — sem mudança até a
     * Fase B, inclusive na assinatura: sem `overwrite` e sem `allowed_formats`,
     * que o cliente instalado não envia.
     *
     * A pasta vem do `userId` do token verificado, nunca do corpo — é o que
     * impede um aluno de gravar na pasta de outro. O `classId` vira o nome do
     * arquivo, então reenviar o anexo da mesma aula substitui o anterior. [#55]
     */
    assinarUpload(userId: string, classId: string): UploadAssinado {
      return deps.midia.assinarUpload({
        folder: `${PASTA_JUSTIFICATIVAS}/${userId}`,
        public_id: classId,
        timestamp: deps.agoraEmSegundos(),
        type: TIPO_ENTREGA_PRIVADO,
      });
    },

    /**
     * Forma NOVA `{ justificationId }` (contrato § 13.2).
     *
     * Só assina a justificativa do próprio chamador, pendente e ainda sem
     * anexo; o nome do arquivo vem da tentativa. A leitura vai com o token do
     * chamador, e o `user_id` devolvido é conferido de novo aqui: o professor
     * da aula LÊ a justificativa pela RLS, mas não anexa nela. Num banco antigo
     * (sem `attempt`) a leitura é recusada e isto responde 403, nunca 5xx. [#55]
     */
    async assinarUploadDaJustificativa(
      chamador: Chamador,
      justificationId: string,
    ): Promise<UploadAssinado> {
      const justificativa = await deps.justificativas.buscarParaAssinar(
        justificationId,
        chamador.authorization,
      );

      if (!justificativa) throw semAcesso();
      if (justificativa.user_id !== chamador.userId) throw semAcesso();
      if (justificativa.status !== STATUS_PENDENTE) throw semAcesso();
      if (justificativa.proof_public_id !== null) throw semAcesso();

      const nome = nomeDoAnexoDaTentativa(justificativa.id, justificativa.attempt);
      if (nome === null) throw semAcesso();

      return deps.midia.assinarUpload({
        folder: `${PASTA_JUSTIFICATIVAS}/${chamador.userId}`,
        public_id: nome,
        timestamp: deps.agoraEmSegundos(),
        type: TIPO_ENTREGA_PRIVADO,
        overwrite: false,
        allowed_formats: FORMATOS_DE_ANEXO,
      });
    },

    /**
     * URL assinada do anexo de uma justificativa.
     *
     * Duas barreiras: a RLS, com o token do chamador, e, para a linha de
     * outra pessoa, `conferirLeitorLegitimo`. O professor que revisa passa
     * pelas duas; quem a RLS liberou por engano, só pela primeira.
     */
    async obterUrlDeVisualizacao(
      justificationId: string,
      chamador: Chamador,
      pagina = 1,
    ): Promise<ComprovanteParaVisualizar> {
      const justificativa = await deps.justificativas.buscarPorId(
        justificationId,
        chamador.authorization,
      );

      // Vazio ou sem anexo: 403 sem distinguir "não existe" de "não é seu" —
      // o contrário seria um oráculo de enumeração. [#55]
      if (!justificativa?.proof_public_id) {
        throw semAcesso();
      }

      if (justificativa.proof_provider !== PROVEDOR_CLOUDINARY) {
        throw semAcesso();
      }

      await conferirLeitorLegitimo(justificativa, chamador);

      /*
       * O caminho assinado é sempre um dos DERIVADOS; o `proof_public_id`
       * gravado só escolhe qual. Enquanto a justificativa está pendente, o
       * próprio aluno pode alterar esse valor: apontá-lo para o anexo de outra
       * pessoa não casa com nenhum caminho derivado e vira 403. Mesmo achado
       * C-2 dos comprovantes. [#55]
       */
      const publicId = caminhosDerivados(justificativa).find(
        (caminho) => caminho === justificativa.proof_public_id,
      );
      if (publicId === undefined) {
        throw semAcesso();
      }

      return montarVisualizacao(deps.midia, publicId, pagina);
    },
  };
}

export type JustificationsService = ReturnType<typeof criarJustificationsService>;
