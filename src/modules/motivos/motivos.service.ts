import { semAcesso } from '../../lib/http-error.js';
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
  type UploadAssinado,
} from '../proofs/proofs.service.js';
import { PASTA_MOTIVOS } from './motivos.constants.js';

/**
 * Regra dos anexos de motivo (contrato § 8 e § 13.1): o atestado do
 * cancelamento, da retificação ou da troca permanente de aula.
 *
 * Quem pode anexar e quem pode ler é decisão do banco — a RPC
 * `pode_anexar_ao_motivo` e a RLS de `action_reason_attachments`. Este módulo
 * não olha o tipo do motivo nem reimplementa permissão: pergunta, obedece e
 * deriva o caminho. [#20]
 */

export interface RegistroDeAnexoDeMotivo {
  id: string;
  uploaded_by: string;
  provider: string | null;
  /** Não é a fonte do caminho: o caminho é derivado de `uploaded_by` + `id`. */
  public_id: string | null;
}

/** Contrato de acesso ao banco — a implementação real passa pelo token do chamador. */
export interface RepositorioDeMotivos {
  /** `true` só quando o banco responde `true`; recusa, erro 4xx ou banco antigo são `false`. */
  podeAnexar(motivoId: string, authorization: string): Promise<boolean>;
  buscarAnexo(anexoId: string, authorization: string): Promise<RegistroDeAnexoDeMotivo | null>;
}

export interface DependenciasDeMotivos {
  midia: AssinadorDeMidia;
  motivos: RepositorioDeMotivos;
  /** Injetado para o teste congelar o tempo em vez de esperar por ele. */
  agoraEmSegundos: () => number;
}

export function criarMotivosService(deps: DependenciasDeMotivos) {
  return {
    /**
     * Assina o upload do anexo para a pasta do PRÓPRIO usuário.
     *
     * A pasta vem do `userId` do token, nunca do corpo. O banco decide ANTES
     * se esse usuário pode anexar a esse motivo; sem o `true`, nenhuma
     * assinatura sai daqui. `overwrite = false` impede que um segundo upload
     * troque um anexo já enviado, e `allowed_formats` faz a Cloudinary recusar
     * o que não é imagem nem PDF — os dois dentro da assinatura. [#51][#55]
     */
    async assinarUpload(
      chamador: Chamador,
      motivoId: string,
      anexoId: string,
    ): Promise<UploadAssinado> {
      const podeAnexar = await deps.motivos.podeAnexar(motivoId, chamador.authorization);
      if (!podeAnexar) {
        throw semAcesso();
      }

      return deps.midia.assinarUpload({
        folder: `${PASTA_MOTIVOS}/${chamador.userId}`,
        public_id: anexoId,
        timestamp: deps.agoraEmSegundos(),
        type: TIPO_ENTREGA_PRIVADO,
        overwrite: false,
        allowed_formats: FORMATOS_DE_ANEXO,
      });
    },

    /**
     * URL assinada de um anexo de motivo.
     *
     * A RLS de `action_reason_attachments` é quem libera a linha — é por ela
     * que o anexo da troca permanente chega a quem decide a troca. Linha
     * ausente é 403, sem distinguir "não existe" de "não é seu". [#55]
     */
    async obterUrlDeVisualizacao(
      anexoId: string,
      chamador: Chamador,
      pagina = 1,
    ): Promise<ComprovanteParaVisualizar> {
      const anexo = await deps.motivos.buscarAnexo(anexoId, chamador.authorization);

      if (!anexo) {
        throw semAcesso();
      }

      if (anexo.provider !== PROVEDOR_CLOUDINARY) {
        throw semAcesso();
      }

      // Caminho DERIVADO de colunas que o autor não altera, nunca lido de
      // `public_id` (achado C-2). O `id` é o mesmo que a RLS acabou de liberar.
      const publicId = `${PASTA_MOTIVOS}/${anexo.uploaded_by}/${anexo.id}`;

      return montarVisualizacao(deps.midia, publicId, pagina);
    },
  };
}

export type MotivosService = ReturnType<typeof criarMotivosService>;
