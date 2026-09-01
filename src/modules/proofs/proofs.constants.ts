/**
 * Constantes do domínio "comprovantes".
 *
 * Moram aqui, e não na config global, porque são conhecimento DESTE módulo:
 * nenhum outro precisa saber onde o comprovante é guardado nem como ele é
 * entregue. Config global é para o que a aplicação inteira compartilha. [#13]
 */

/** Raiz das pastas de comprovante na Cloudinary. O `userId` verificado é anexado a ela. */
export const PASTA_COMPROVANTES = 'comprovantes';

/**
 * Tipo de entrega da Cloudinary: `authenticated` = privado, só por URL assinada.
 *
 * Comprovante de PIX é dado financeiro pessoal — nunca `upload` (público). [#63]
 */
export const TIPO_ENTREGA_PRIVADO = 'authenticated';

/** Tabela e colunas lidas via PostgREST, com a RLS decidindo o acesso. */
export const TABELA_PAGAMENTOS = 'payments';
export const COLUNAS_DO_PAGAMENTO = 'user_id,proof_url';
