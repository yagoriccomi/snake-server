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
  gerarUrlDeVisualizacao(publicId: string, pagina?: number): string;
  contarPaginas(publicId: string): Promise<number>;
}

/** O que o cliente recebe para exibir um comprovante. */
export interface ComprovanteParaVisualizar {
  url: string;
  /** Total de páginas do documento. `1` para imagem comum. */
  paginas: number;
  /** Qual página esta `url` mostra. */
  pagina: number;
}

export interface RegistroDePagamento {
  user_id: string;
  /** Onde o arquivo está: `cloudinary` ou `supabase_storage` (legado). */
  proof_provider: string | null;
  /**
   * Identificador na Cloudinary. Serve como FLAG de existência ("há
   * comprovante?"), não como fonte do caminho: o caminho é derivado do par
   * verificado. Ver C-2 no `REVIEW.md`.
   */
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
    async obterUrlDeVisualizacao(
      paymentId: string,
      chamador: Chamador,
      pagina = 1,
    ): Promise<ComprovanteParaVisualizar> {
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

      /*
       * O identificador é DERIVADO, nunca lido.
       *
       * `proof_public_id` é gravável pelo aluno no próprio pagamento — a RLS
       * libera porque a linha é dele. Assinar o valor gravado deixaria ele
       * apontar para `comprovantes/<outro_aluno>/<outro_pagamento>` e receber,
       * com uma URL válida, o comprovante de outro titular. A consulta acima
       * não pega isso: o pagamento É dele; o que está adulterado é o ponteiro.
       *
       * O caminho é determinístico e as duas metades já foram verificadas — o
       * `user_id` vem da linha (coluna que o aluno não pode alterar) e o
       * `paymentId` é o mesmo que a RLS acabou de autorizar. Derivando, um
       * ponteiro adulterado no banco simplesmente não tem efeito.
       *
       * Achado C-2 do `REVIEW.md`. [#55]
       */
      const publicId = `${PASTA_COMPROVANTES}/${pagamento.user_id}/${paymentId}`;

      // O total vem junto para a tela poder avisar que há mais documento além
      // do que está sendo exibido. Um comprovante na página 2 de um extrato,
      // sem esse aviso, é indistinguível de comprovante que não existe.
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

export type ProofsService = ReturnType<typeof criarProofsService>;
