import { semAcesso } from '../../lib/http-error.js';
import { PROVEDOR_CLOUDINARY, TIPO_ENTREGA_PRIVADO } from '../proofs/proofs.constants.js';
import type {
  AssinadorDeMidia,
  Chamador,
  ComprovanteParaVisualizar,
  UploadAssinado,
} from '../proofs/proofs.service.js';
import { PASTA_JUSTIFICATIVAS } from './justifications.constants.js';

/**
 * Regra dos anexos de justificativa de falta (docs/FREQUENCIA.md no app).
 *
 * Reusa o CONTRATO de mídia dos comprovantes (`AssinadorDeMidia`) em vez de um
 * segundo adaptador: a Cloudinary assina qualquer pasta e entrega qualquer
 * `public_id`, e duplicar essa integração seria duplicar seus defeitos. [#6][#20]
 */

export interface RegistroDeJustificativa {
  user_id: string;
  class_id: string;
  proof_provider: string | null;
  /** Serve como FLAG de existência do anexo, não como fonte do caminho. */
  proof_public_id: string | null;
}

/** Contrato de leitura — a implementação real passa pela RLS. */
export interface LeitorDeJustificativas {
  buscarPorId(
    justificationId: string,
    authorization: string,
  ): Promise<RegistroDeJustificativa | null>;
}

export interface DependenciasDeJustificativas {
  midia: AssinadorDeMidia;
  justificativas: LeitorDeJustificativas;
  /** Injetado para o teste congelar o tempo em vez de esperar por ele. */
  agoraEmSegundos: () => number;
}

export function criarJustificationsService(deps: DependenciasDeJustificativas) {
  return {
    /**
     * Assina o upload do anexo para a pasta do PRÓPRIO aluno.
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
     * URL assinada do anexo de uma justificativa.
     *
     * A autorização é inteiramente da RLS de `absence_justifications`: o dono,
     * o professor daquela aula e o admin são leitores LEGÍTIMOS. Por isso não
     * existe aqui o alarme "a RLS liberou linha de outra pessoa" dos
     * comprovantes — ele dispararia a cada revisão feita por um professor.
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

      /*
       * Caminho DERIVADO, nunca lido.
       *
       * Enquanto a justificativa está pendente, o próprio aluno pode alterar
       * `proof_public_id`. Assinar o valor gravado deixaria ele apontar para o
       * anexo de outro aluno e receber uma URL válida. As duas metades do
       * caminho abaixo vêm de colunas que o aluno não altera (o gatilho do
       * banco recusa trocar user_id/class_id). Mesmo achado C-2 dos
       * comprovantes. [#55]
       */
      const publicId = `${PASTA_JUSTIFICATIVAS}/${justificativa.user_id}/${justificativa.class_id}`;

      const paginas = await deps.midia.contarPaginas(publicId);
      const paginaExibida = Math.min(Math.max(pagina, 1), paginas);

      return {
        url: deps.midia.gerarUrlDeVisualizacao(publicId, paginaExibida),
        paginas,
        pagina: paginaExibida,
      };
    },
  };
}

export type JustificationsService = ReturnType<typeof criarJustificationsService>;
