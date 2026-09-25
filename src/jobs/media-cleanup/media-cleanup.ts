/**
 * Worker de eliminação de mídia — LGPD art. 15, I e art. 18, VI.
 *
 * Programa SEPARADO do servidor web. Roda até o fim e sai — desenhado para
 * ser disparado por agendamento (Render Cron Job), não para ficar de pé.
 *
 * POR QUE ESTE ARQUIVO TEM SEU PRÓPRIO ESQUEMA DE AMBIENTE, em vez de usar
 * `src/config/env.ts`: aquele é o ponto único de config do SERVIDOR WEB, e o
 * servidor web não deve nem conhecer `SUPABASE_SERVICE_ROLE_KEY` — ela ignora
 * a RLS por completo. Este worker É o módulo isolado que a documentação do
 * projeto previu para essa chave (`docs/BACKEND.md §7`, linha `media-cleanup`).
 * Mesmo padrão de `scripts/migrar-comprovantes.ts`. [#55][#80]
 *
 * Uso:
 *   node dist/jobs/media-cleanup/media-cleanup.js
 *   node dist/jobs/media-cleanup/media-cleanup.js --lote 50
 */

import { z } from 'zod';

import { criarRepositorioDaFila } from './media-cleanup.repository.js';
import { criarExclusorDeMidia } from './media-cleanup.provedores.js';
import { processarLote } from './media-cleanup.service.js';

const esquema = z.object({
  SUPABASE_URL: z
    .string()
    .trim()
    .url('precisa ser a URL completa do projeto')
    .transform((v) => v.replace(/\/+$/, '')),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .trim()
    .min(1, 'obrigatória NESTE WORKER (e só aqui) — apaga assets fora da RLS'),
  CLOUDINARY_CLOUD_NAME: z.string().trim().min(1),
  CLOUDINARY_API_KEY: z.string().trim().min(1),
  CLOUDINARY_API_SECRET: z.string().trim().min(1),
});

const analise = esquema.safeParse(process.env);
if (!analise.success) {
  console.error('Configuração inválida:');
  for (const problema of analise.error.issues) {
    console.error(`  - ${problema.path.join('.')}: ${problema.message}`);
  }
  process.exit(1);
}
const config = analise.data;

/** Teto do lote por execução. Uma fila enorme processa em várias rodadas do
 * agendamento, em vez de uma execução única segurando o cron por horas. */
const TAMANHO_PADRAO_DO_LOTE = 100;

const tamanhoDoLote = (() => {
  const i = process.argv.indexOf('--lote');
  const bruto = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isInteger(bruto) && bruto > 0 && bruto <= 500 ? bruto : TAMANHO_PADRAO_DO_LOTE;
})();

async function principal(): Promise<void> {
  const deps = {
    fila: criarRepositorioDaFila({
      supabaseUrl: config.SUPABASE_URL,
      serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
    }),
    midia: criarExclusorDeMidia({
      supabaseUrl: config.SUPABASE_URL,
      serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
      cloudinary: {
        cloudName: config.CLOUDINARY_CLOUD_NAME,
        apiKey: config.CLOUDINARY_API_KEY,
        apiSecret: config.CLOUDINARY_API_SECRET,
      },
    }),
  };

  const resultado = await processarLote(deps, tamanhoDoLote);

  console.log(
    `media-cleanup: ${String(resultado.processados)} apagados, ` +
      `${String(resultado.falhas)} com falha (seguem na fila), ` +
      `${String(resultado.recusados)} recusados por caminho inválido (fechados sem apagar).`,
  );

  // Falha no processo ≠ falha de UM item (essa já ficou registrada na fila
  // e vira alarme depois de N tentativas). Sair com erro aqui alertaria o
  // agendador por algo que o próprio worker já soube tratar. [#93]
}

principal().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : String(erro));
  process.exit(1);
});
