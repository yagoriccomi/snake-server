import { v2 as cloudinary } from 'cloudinary';

import { TIPO_ENTREGA_PRIVADO } from './proofs.constants.js';
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

/** Detecta se o valor gravado já é um `public_id` em vez de uma URL de entrega. */
const EH_URL = /^https?:\/\//i;

/** Formato de entrega: `/<cloud>/<resource_type>/<type>/v<versao>/<public_id>.<ext>` */
const APOS_A_VERSAO = /\/v\d+\/(.+)$/;
const EXTENSAO_FINAL = /\.[A-Za-z0-9]{2,5}$/;
const SEGMENTOS_ANTES_DO_PUBLIC_ID = 4;

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
     * URL assinada de um asset privado. Sem a assinatura a URL não entrega
     * nada — é isso que mantém o comprovante fora do alcance de quem apenas
     * adivinhou o caminho.
     */
    gerarUrlDeVisualizacao(publicId: string): string {
      return cloudinary.url(publicId, {
        type: TIPO_ENTREGA_PRIVADO,
        sign_url: true,
        secure: true,
        resource_type: 'image',
      });
    },

    /**
     * Normaliza o que está gravado em `payments.proof_url`.
     *
     * ⚠️ PENDENTE DE CONFIRMAÇÃO: o nome da coluna diz "url", mas a
     * especificação a usa como `public_id`. Sem acesso ao schema real do app,
     * aceitar os dois formatos é a escolha conservadora — passar uma URL
     * completa para `cloudinary.url()` produziria um link quebrado em silêncio,
     * e o dado em jogo é financeiro. Se o schema confirmar um formato único,
     * esta função encolhe para um `return valorGravado.trim()`.
     */
    extrairPublicId(valorGravado: string): string {
      const valor = valorGravado.trim();
      if (!EH_URL.test(valor)) return valor;

      let caminho: string;
      try {
        caminho = new URL(valor).pathname;
      } catch {
        return valor;
      }

      const comVersao = APOS_A_VERSAO.exec(caminho);
      const bruto =
        comVersao?.[1] ?? caminho.split('/').slice(SEGMENTOS_ANTES_DO_PUBLIC_ID).join('/');

      return bruto.replace(EXTENSAO_FINAL, '');
    },
  };
}
