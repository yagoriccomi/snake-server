import { v2 as cloudinary } from 'cloudinary';

import { TIPO_ENTREGA_PRIVADO } from '../config/constants.js';
import { env } from '../config/env.js';

/**
 * Ponto único de contato com a Cloudinary.
 *
 * A `api_secret` vive SÓ aqui dentro, no servidor. Ela nunca é devolvida
 * numa resposta, nunca entra em log, nunca chega ao app — o cliente recebe
 * apenas a assinatura já calculada, válida para um destino específico. [#55]
 */

cloudinary.config({
  cloud_name: env.cloudinary.cloudName,
  api_key: env.cloudinary.apiKey,
  api_secret: env.cloudinary.apiSecret,
  secure: true,
});

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

/**
 * Assina um upload para um destino FIXO e já decidido pelo servidor.
 *
 * O app não escolhe pasta nem nome: eles derivam do `userId` verificado no
 * token. Assim a assinatura autoriza exatamente um lugar — a própria pasta
 * do aluno — e nada mais. [#55]
 */
export function assinarUpload(parametros: ParametrosDeUpload): UploadAssinado {
  const signature = cloudinary.utils.api_sign_request({ ...parametros }, env.cloudinary.apiSecret);

  return {
    ...parametros,
    cloudName: env.cloudinary.cloudName,
    apiKey: env.cloudinary.apiKey,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/auto/upload`,
  };
}

/**
 * Gera a URL assinada de um asset privado (`type=authenticated`).
 * Sem a assinatura, a URL não entrega nada — é isso que mantém o
 * comprovante fora do alcance de quem só adivinhou o caminho.
 */
export function gerarUrlDeVisualizacao(publicId: string): string {
  return cloudinary.url(publicId, {
    type: TIPO_ENTREGA_PRIVADO,
    sign_url: true,
    secure: true,
    resource_type: 'image',
  });
}

/**
 * Normaliza o que está gravado em `payments.proof_url`.
 *
 * O campo é ambíguo por herança: pode conter o `public_id` puro (o esperado)
 * ou uma URL completa de entrega, dependendo de como o app gravou. Aceitar os
 * dois evita um 500 silencioso quando o dado vem do outro formato.
 */
export function extrairPublicId(valorGravado: string): string {
  const valor = valorGravado.trim();

  if (!valor.startsWith('http://') && !valor.startsWith('https://')) {
    return valor;
  }

  let caminho: string;
  try {
    caminho = new URL(valor).pathname;
  } catch {
    return valor;
  }

  // Formato de entrega: /<cloud>/<resource_type>/<type>/<v123>/<public_id>.<ext>
  const marcador = `/${TIPO_ENTREGA_PRIVADO}/`;
  const posicao = caminho.indexOf(marcador);
  const depoisDoTipo =
    posicao >= 0 ? caminho.slice(posicao + marcador.length) : caminho.replace(/^\/+/, '');

  const semVersao = depoisDoTipo.replace(/^v\d+\//, '');
  return semVersao.replace(/\.[A-Za-z0-9]{2,5}$/, '');
}
