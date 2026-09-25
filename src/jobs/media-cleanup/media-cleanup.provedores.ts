/**
 * Adaptador de exclusão — a única peça que sabe apagar de verdade em cada
 * provedor. Implementa `ExclusorDeMidia`; a regra do worker não conhece
 * Cloudinary nem Supabase Storage. [#20][#30]
 */

import { v2 as cloudinary } from 'cloudinary';

import type { ExclusorDeMidia } from './media-cleanup.service.js';

/**
 * Bucket do comprovante legado. Mesmo nome usado em
 * `scripts/migrar-comprovantes.ts` — os dois programas apontam para o mesmo
 * bucket do `snake-thai` por convenção de nome, não por import compartilhado
 * (são repositórios diferentes). [#6]
 */
const BUCKET_LEGADO = 'payment_proofs';

export interface ConfigDosProvedores {
  supabaseUrl: string;
  serviceRoleKey: string;
  cloudinary: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
  };
}

/**
 * `destroy` da Cloudinary é idempotente por natureza: apagar um asset que já
 * não existe responde `result: "not found"`, não erro. Isso importa porque
 * este worker pode reprocessar um item que uma execução anterior já tinha
 * concluído (ex.: crash entre apagar e marcar `processado_em`) — sem isso,
 * o retry criaria um falso alarme sobre um trabalho que já terminou. [#9]
 */
export function criarExclusorDeMidia(config: ConfigDosProvedores): ExclusorDeMidia {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true,
  });

  return {
    async apagarDaCloudinary(publicId) {
      const resultado = (await cloudinary.uploader.destroy(publicId, {
        type: 'authenticated',
        resource_type: 'image',
        invalidate: true,
      })) as { result?: string };

      if (resultado.result !== 'ok' && resultado.result !== 'not found') {
        throw new Error(`Cloudinary recusou a exclusão: ${resultado.result ?? 'desconhecido'}`);
      }
    },

    async apagarDoStorage(caminho) {
      // `encodeURI` deixaria `?`, `#` e `%` passarem e mudarem a URL; cada
      // segmento vai escapado, e só a `/` entre eles continua sendo `/`. O
      // `..` já foi barrado pela regra antes de chegar aqui. [#51]
      const caminhoEscapado = caminho.split('/').map(encodeURIComponent).join('/');
      const resposta = await fetch(
        `${config.supabaseUrl}/storage/v1/object/${BUCKET_LEGADO}/${caminhoEscapado}`,
        {
          method: 'DELETE',
          headers: {
            apikey: config.serviceRoleKey,
            Authorization: `Bearer ${config.serviceRoleKey}`,
          },
        },
      );

      // 404: o arquivo já não existe — mesmo raciocínio de idempotência do
      // destroy da Cloudinary, e pelo mesmo motivo (reprocessamento seguro).
      if (!resposta.ok && resposta.status !== 404) {
        throw new Error(`Storage recusou a exclusão: HTTP ${String(resposta.status)}`);
      }
    },
  };
}
