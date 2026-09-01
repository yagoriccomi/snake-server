import { v2 as cloudinary } from 'cloudinary';

import { logger } from '../../lib/logger.js';
import { FORMATO_ENTREGA, TIPO_ENTREGA_PRIVADO } from './proofs.constants.js';
import type { AssinadorDeMidia, ParametrosDeUpload, UploadAssinado } from './proofs.service.js';

/**
 * Adaptador da Cloudinary — a única peça que conhece o SDK e o formato de
 * URL do provedor. Implementa o contrato `AssinadorDeMidia` que o domínio
 * definiu: a dependência aponta para dentro, não o contrário. [#20][#30]
 *
 * Mora dentro do módulo `proofs` de propósito. Em `lib/` ele fingiria ser
 * infraestrutura compartilhada, e hoje só os comprovantes usam a Cloudinary.
 * Quando um segundo módulo precisar, aí sim vale extrair. [#8][#13]
 *
 * A `api_secret` vive só aqui dentro: nunca é devolvida numa resposta, nunca
 * entra em log, nunca chega ao app. O cliente recebe apenas a assinatura já
 * calculada, válida para um destino específico. [#55]
 */

export interface ConfigDeMidia {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Cria o adaptador já configurado.
 *
 * É uma factory, e não configuração no topo do módulo, porque `cloudinary.config()`
 * é estado global: fazê-lo no import obrigaria qualquer arquivo que só quisesse
 * um TIPO daqui a carregar credenciais válidas junto. [#21]
 */
export function criarAssinadorCloudinary(config: ConfigDeMidia): AssinadorDeMidia {
  const cliente = cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });

  // Mantém a referência viva para deixar explícito que a config é deste adaptador.
  void cliente;

  return {
    assinarUpload(parametros: ParametrosDeUpload): UploadAssinado {
      const signature = cloudinary.utils.api_sign_request({ ...parametros }, config.apiSecret);

      return {
        ...parametros,
        cloudName: config.cloudName,
        apiKey: config.apiKey,
        signature,
        uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/auto/upload`,
      };
    },

    /**
     * URL assinada de um asset privado, entregue como imagem.
     *
     * Sem a assinatura a URL não entrega nada — é isso que mantém o
     * comprovante fora do alcance de quem apenas adivinhou o caminho.
     *
     * `format` converte na SAÍDA: o arquivo continua guardado como veio, e é
     * o link que sai em JPG. Ver `FORMATO_ENTREGA` para o porquê.
     */
    gerarUrlDeVisualizacao(publicId: string, pagina?: number): string {
      return cloudinary.url(publicId, {
        type: TIPO_ENTREGA_PRIVADO,
        sign_url: true,
        secure: true,
        resource_type: 'image',
        format: FORMATO_ENTREGA,
        // `page` só entra quando pedida: num arquivo de página única ela é
        // ruído na URL, e a Cloudinary já entrega a única página que existe.
        ...(pagina === undefined ? {} : { page: pagina }),
      });
    },

    /**
     * Quantas páginas o documento tem. `1` para imagem comum.
     *
     * Serve para a tela avisar o administrador de que existe mais documento
     * além do que ele está vendo. Sem isso, um comprovante na página 2 de um
     * extrato simplesmente não aparece — e ninguém fica sabendo.
     *
     * Nunca lança: se a consulta falhar, o comprovante ainda precisa ser
     * exibido. Perder o aviso é ruim; perder a visualização é pior. [#9]
     */
    async contarPaginas(publicId: string): Promise<number> {
      try {
        const recurso = (await cloudinary.api.resource(publicId, {
          type: TIPO_ENTREGA_PRIVADO,
          resource_type: 'image',
          // Sem isto a resposta NÃO traz `pages` — nem para um PDF de várias
          // páginas. A consulta parece bem-sucedida e devolve 1 em silêncio,
          // e o administrador nunca fica sabendo que existe página 2.
          pages: true,
        })) as { pages?: number };
        return typeof recurso.pages === 'number' && recurso.pages > 0 ? recurso.pages : 1;
      } catch (causa) {
        /*
         * Degradar para 1 é deliberado: sem o total, o comprovante ainda
         * precisa ser exibido. Perder o aviso é ruim; perder a visualização é
         * pior. [#9]
         *
         * Mas degradar CALADO seria o mesmo que não ter o aviso — por isso o
         * log. Se a contagem começar a falhar sempre, aparece aqui antes de
         * alguém reclamar de um comprovante que "sumiu". [#92]
         */
        logger.warn('não foi possível contar as páginas do comprovante', {
          erro: causa instanceof Error ? causa.message : 'desconhecido',
        });
        return 1;
      }
    },
  };
}
