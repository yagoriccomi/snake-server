import { semAcesso } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import {
  PASTA_COMPROVANTES,
  PROVEDOR_CLOUDINARY,
  TIPO_ENTREGA_PRIVADO,
} from './proofs.constants.js';

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
  /** Onde o arquivo está: `cloudinary` ou `supabase_storage` (legado). */
  proof_provider: string | null;
  /** Identificador na Cloudinary. Nulo quando o comprovante é legado. */
  proof_public_id: string | null;
}

/** Contrato de leitura de pagamentos — a implementação real passa pela RLS. */
export interface LeitorDePagamentos {
  buscarPorId(paymentId: string, authorization: string): Promise<RegistroDePagamento | null>;
}

/**
 * O que fazer quando a RLS libera um comprovante que NÃO é do chamador.
 *
 * Existem exatamente duas explicações para isso, e o servidor não consegue
 * distingui-las sozinho: ou o chamador é um administrador legítimo (a
 * `docs/BACKEND.md §6` prevê esse caso), ou uma política de RLS quebrou e
 * está vazando dado alheio.
 *
 * Quem sabe diferenciar é o schema do Supabase — que vive fora deste
 * repositório. Em vez de adivinhar como o papel de admin é modelado (e
 * escrever uma checagem decorativa ou que quebra o admin), a decisão vira
 * política explícita de configuração:
 *
 *  - `rls`          → confia na RLS, mas ALERTA em nível `error` toda vez que
 *                     isso acontecer. Não quebra o administrador; entrega
 *                     visibilidade imediata caso a política caia. É o padrão,
 *                     porque preserva o comportamento previsto na spec.
 *  - `somente-dono` → nega qualquer acesso que não seja do próprio dono,
 *                     independentemente do que a RLS respondeu. Use quando não
 *                     houver administrador, ou quando o admin usar outro
 *                     caminho. É a postura mais dura. [#55]
 */
export type PoliticaDeAcesso = 'rls' | 'somente-dono';

export interface DependenciasDeProofs {
  midia: AssinadorDeMidia;
  pagamentos: LeitorDePagamentos;
  /** Injetado para o teste poder congelar o tempo em vez de esperar por ele. */
  agoraEmSegundos: () => number;
  politicaDeAcesso: PoliticaDeAcesso;
}

/** Contexto de quem está pedindo — sempre derivado do token JÁ verificado. */
export interface Chamador {
  userId: string;
  authorization: string;
  traceId: string;
}

export function criarProofsService(deps: DependenciasDeProofs) {
  /**
   * Segunda barreira de autorização — defesa em profundidade. [#55]
   *
   * A RLS é a trava principal e continua sendo. Esta função existe porque
   * ela mora em outro sistema: uma migration distraída, uma política
   * renomeada ou uma tabela recriada sem `ENABLE ROW LEVEL SECURITY` bastam
   * para transformar este endpoint num vazamento silencioso de dado
   * financeiro. Nunca confie numa trava só.
   */
  function conferirDono(pagamento: RegistroDePagamento, chamador: Chamador): void {
    if (pagamento.user_id === chamador.userId) return;

    // Chegou aqui: a RLS liberou um pagamento de OUTRA pessoa.
    logger.error('RLS liberou comprovante de outro usuário', {
      traceId: chamador.traceId,
      user_id: chamador.userId,
      dono_user_id: pagamento.user_id,
      politica: deps.politicaDeAcesso,
      // Este log é um alarme, não um registro de rotina: se ele aparecer sem
      // que exista um administrador legítimo agindo, a RLS está quebrada.
      acao: deps.politicaDeAcesso === 'somente-dono' ? 'bloqueado' : 'permitido-por-politica',
    });

    if (deps.politicaDeAcesso === 'somente-dono') {
      throw semAcesso();
    }
  }

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
     * Duas barreiras, nesta ordem:
     *  1. A RLS do Supabase, com o token do chamador — trava principal.
     *  2. `conferirDono`, com o `user_id` que a própria consulta devolveu —
     *     rede de segurança para o caso de a primeira falhar. [#55]
     */
    async obterUrlDeVisualizacao(paymentId: string, chamador: Chamador): Promise<string> {
      const pagamento = await deps.pagamentos.buscarPorId(paymentId, chamador.authorization);

      // Vazio ou sem comprovante: a RLS não liberou. 403 sem distinguir
      // "não existe" de "não é seu" — o contrário seria um oráculo de
      // enumeração para quem varre ids. [#55]
      if (!pagamento?.proof_public_id) {
        throw semAcesso();
      }

      // Comprovante de outro provedor não é assinável aqui. Recusar é a única
      // resposta honesta: assinar assim mesmo devolveria um link quebrado
      // apontando para um arquivo que não existe na Cloudinary. [#9]
      if (pagamento.proof_provider !== PROVEDOR_CLOUDINARY) {
        throw semAcesso();
      }

      conferirDono(pagamento, chamador);

      const publicId = deps.midia.extrairPublicId(pagamento.proof_public_id);
      return deps.midia.gerarUrlDeVisualizacao(publicId);
    },
  };
}

export type ProofsService = ReturnType<typeof criarProofsService>;
