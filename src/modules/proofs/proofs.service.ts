import { semAcesso } from '../../lib/http-error.js';
import { PASTA_COMPROVANTES, TIPO_ENTREGA_PRIVADO } from './proofs.constants.js';

/**
 * Regra de negócio dos comprovantes. Camada sem Express e sem SDK: recebe
 * suas dependências prontas e devolve dados puros. É o que torna esta
 * lógica testável sem subir servidor nem tocar a rede. [#21][#30][#45]
 *
 * Os tipos abaixo são o CONTRATO que o domínio impõe à infraestrutura —
 * o adaptador da Cloudinary os implementa, não o contrário. [#20]
 */

export interface ParametrosDeUpload {
  folder: string;
  public_id: string;
  timestamp: number;
  type: string;
}

export interface UploadAssinado extends ParametrosDeUpload {
  cloudName: string;
  apiKey: string;
  signature: string;
  uploadUrl: string;
}

/** Contrato do provedor de mídia. Depender da abstração, não da Cloudinary. [#20] */
export interface AssinadorDeMidia {
  assinarUpload(parametros: ParametrosDeUpload): UploadAssinado;
  gerarUrlDeVisualizacao(publicId: string): string;
  extrairPublicId(valorGravado: string): string;
}

export interface RegistroDePagamento {
  user_id: string;
  proof_url: string | null;
}

/** Contrato de leitura de pagamentos — a implementação real passa pela RLS. */
export interface LeitorDePagamentos {
  buscarPorId(paymentId: string, authorization: string): Promise<RegistroDePagamento | null>;
}

export interface DependenciasDeProofs {
  midia: AssinadorDeMidia;
  pagamentos: LeitorDePagamentos;
  /** Injetado para o teste poder congelar o tempo em vez de esperar por ele. */
  agoraEmSegundos: () => number;
}

export function criarProofsService(deps: DependenciasDeProofs) {
  return {
    /**
     * Assina um upload para a pasta do PRÓPRIO aluno.
     *
     * O destino é derivado do `userId` que veio do token verificado — nunca
     * do corpo da requisição. É essa derivação que impede um aluno de assinar
     * um upload dentro da pasta de outro. [#55]
     */
    assinarUpload(userId: string, paymentId: string): UploadAssinado {
      return deps.midia.assinarUpload({
        folder: `${PASTA_COMPROVANTES}/${userId}`,
        public_id: paymentId,
        timestamp: deps.agoraEmSegundos(),
        type: TIPO_ENTREGA_PRIVADO,
      });
    },

    /**
     * Devolve a URL assinada do comprovante de um pagamento.
     *
     * A autorização NÃO é decidida aqui: a leitura vai com o token do
     * chamador e a RLS do Supabase filtra. Se ela devolveu vazio, o
     * chamador não é dono nem admin — 403, sem distinguir "não existe"
     * de "não é seu". [#20][#55]
     */
    async obterUrlDeVisualizacao(paymentId: string, authorization: string): Promise<string> {
      const pagamento = await deps.pagamentos.buscarPorId(paymentId, authorization);

      if (!pagamento?.proof_url) {
        throw semAcesso();
      }

      const publicId = deps.midia.extrairPublicId(pagamento.proof_url);
      return deps.midia.gerarUrlDeVisualizacao(publicId);
    },
  };
}

export type ProofsService = ReturnType<typeof criarProofsService>;
