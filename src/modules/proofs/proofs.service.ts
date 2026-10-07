import { conflito, naoEncontrado, semAcesso } from '../../lib/http-error.js';
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

/**
 * Os dois erros que só o leitor legítimo vê (contrato § 13.6): chegam depois
 * de confirmado o dono, então não revelam nada a quem varre ids. [#55]
 */
const comprovanteAusente = () =>
  naoEncontrado('Este pagamento não tem comprovante', 'proof_not_found');
const comprovanteNoArmazenamentoAntigo = () =>
  conflito(
    'Este comprovante está no armazenamento antigo e não abre por aqui',
    'proof_not_on_cloudinary',
  );

export interface ParametrosDeUpload {
  folder: string;
  public_id: string;
  timestamp: number;
  type: string;
  /**
   * Só nos anexos novos (motivos e `{justificationId}`, contrato § 13.1 e
   * § 13.2). Ficam AUSENTES no comprovante e no `{classId}` legado: o APK
   * instalado não envia estes campos, e a assinatura deixaria de bater.
   */
  overwrite?: boolean;
  allowed_formats?: string;
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

/**
 * Monta a visualização de um arquivo JÁ autorizado, com o caminho JÁ
 * derivado — quem chama responde pelas duas coisas. Os módulos que exibem
 * anexo (comprovante, justificativa, motivo) diferem em quem pode ver e em
 * como o caminho é derivado, não nesta parte. [#6]
 *
 * O total vem junto para a tela poder avisar que há mais documento além do
 * que está sendo exibido. Um comprovante na página 2 de um extrato, sem esse
 * aviso, é indistinguível de comprovante que não existe.
 */
export async function montarVisualizacao(
  midia: AssinadorDeMidia,
  publicId: string,
  pagina: number,
): Promise<ComprovanteParaVisualizar> {
  const paginas = await midia.contarPaginas(publicId);
  const paginaExibida = Math.min(Math.max(pagina, 1), paginas);

  return {
    url: midia.gerarUrlDeVisualizacao(publicId, paginaExibida),
    paginas,
    pagina: paginaExibida,
  };
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
 * Pergunta ao banco, com o token de quem pede, se ele é admin (contrato
 * § 13.5). `true` só quando o banco confirma; `false` quando nega ou recusa
 * o token. Falha do Supabase rejeita a promessa (502/503/504): não é "não",
 * e por isso não dispara o alarme (D20). Compartilhada com a justificativa. [#20]
 */
export interface ConferenciaDeAdmin {
  ehAdmin(authorization: string): Promise<boolean>;
}

/**
 * O que fazer quando a RLS libera um comprovante que NÃO é do chamador.
 *
 * Existem duas explicações: ou o chamador é um admin legítimo (a política
 * `payments_select_own_or_admin` libera), ou uma política de RLS quebrou e
 * está vazando dado alheio. Desde o 5.5, o servidor distingue as duas
 * perguntando ao banco pela mesma `is_admin()` da RLS (contrato § 13.5):
 *
 *  - `rls`          → serve só se `is_admin` confirmar. Qualquer outra
 *                     resposta é 403 e alarme em nível `error`. É o padrão,
 *                     porque preserva o admin previsto na spec.
 *  - `somente-dono` → nega qualquer acesso que não seja do próprio dono, sem
 *                     perguntar nada ao banco. Use quando nenhum admin
 *                     precisar abrir comprovante de aluno. [#55]
 */
export type PoliticaDeAcesso = 'rls' | 'somente-dono';

export interface DependenciasDeProofs {
  midia: AssinadorDeMidia;
  pagamentos: LeitorDePagamentos;
  /** Injetado para o teste poder congelar o tempo em vez de esperar por ele. */
  agoraEmSegundos: () => number;
  politicaDeAcesso: PoliticaDeAcesso;
  admin: ConferenciaDeAdmin;
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
   *
   * O dono passa sem custo nenhum: o banco só é consultado para a linha de
   * outra pessoa, que é o caso raro (o admin no Financeiro).
   */
  async function conferirLeitorLegitimo(
    pagamento: RegistroDePagamento,
    chamador: Chamador,
  ): Promise<void> {
    if (pagamento.user_id === chamador.userId) return;

    if (deps.politicaDeAcesso === 'rls' && (await deps.admin.ehAdmin(chamador.authorization))) {
      return;
    }

    // Chegou aqui: a RLS liberou o pagamento de OUTRA pessoa a quem não é
    // admin. É um alarme, não registro de rotina: a RLS está quebrada.
    logger.error('RLS liberou comprovante de outro usuário', {
      traceId: chamador.traceId,
      user_id: chamador.userId,
      dono_user_id: pagamento.user_id,
      politica: deps.politicaDeAcesso,
      acao: 'bloqueado',
    });
    throw semAcesso();
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
     *  2. `conferirLeitorLegitimo`, com o `user_id` que a própria consulta
     *     devolveu e, se não for o do chamador, a `is_admin()` do banco —
     *     rede de segurança para o caso de a primeira falhar. [#55]
     */
    async obterUrlDeVisualizacao(
      paymentId: string,
      chamador: Chamador,
      pagina = 1,
    ): Promise<ComprovanteParaVisualizar> {
      const pagamento = await deps.pagamentos.buscarPorId(paymentId, chamador.authorization);

      // Vazio: a RLS não liberou. 403 sem distinguir "não existe" de "não
      // é seu" — o contrário seria um oráculo de enumeração para quem varre
      // ids. [#55]
      if (!pagamento) {
        throw semAcesso();
      }

      // Primeiro o leitor legítimo (dono ou admin); só então o 404 e o 409,
      // que contam algo sobre a linha e por isso são de quem pode lê-la
      // (contrato § 13.6, regra 4).
      await conferirLeitorLegitimo(pagamento, chamador);

      // Comprovante de outro provedor não é assinável aqui: assinar assim
      // mesmo devolveria um link quebrado. O provedor vem antes do
      // `proof_public_id` porque o legado do Storage não tem public_id, e
      // a resposta certa para ele é "armazenamento antigo", não "sem
      // comprovante". [#9]
      if (pagamento.proof_provider !== null && pagamento.proof_provider !== PROVEDOR_CLOUDINARY) {
        throw comprovanteNoArmazenamentoAntigo();
      }

      if (!pagamento.proof_provider || !pagamento.proof_public_id) {
        throw comprovanteAusente();
      }

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

      return montarVisualizacao(deps.midia, publicId, pagina);
    },
  };
}

export type ProofsService = ReturnType<typeof criarProofsService>;
