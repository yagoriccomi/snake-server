/**
 * Script OPERACIONAL — migra os comprovantes já existentes do Supabase Storage
 * para a Cloudinary. Roda uma vez (e pode ser reexecutado com segurança).
 *
 * NÃO faz parte do servidor web. É um programa separado, de propósito:
 *
 *   1. Ele precisa da `SUPABASE_SERVICE_ROLE_KEY` para ler o arquivo de
 *      QUALQUER aluno no bucket privado. Essa chave ignora a RLS por completo.
 *      Mantê-la num script pontual — executado por uma pessoa, num terminal,
 *      e nunca carregado pelo processo que atende requisições — é o isolamento
 *      que `docs/BACKEND.md` §4 exige. O servidor continua sem essa chave. [#55]
 *
 *   2. Por isso ele NÃO importa `src/config/env.ts`: aquele é o ponto único de
 *      config do SERVIDOR, e o servidor não deve nem conhecer essa variável.
 *      Este script tem o seu próprio ponto único, aqui embaixo. [#80]
 *
 * Uso:
 *   npx tsx scripts/migrar-comprovantes.ts            # simulação (padrão)
 *   npx tsx scripts/migrar-comprovantes.ts --aplicar  # executa de verdade
 *   npx tsx scripts/migrar-comprovantes.ts --aplicar --lote 50
 *
 * Idempotente: só enxerga linhas com `proof_provider = 'supabase_storage'`.
 * Uma linha já migrada some do conjunto de trabalho — reexecutar não duplica.
 */

import { v2 as cloudinary } from 'cloudinary';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Configuração — ponto único deste script. Falha rápido e diz o que falta. [#9][#80]
// ---------------------------------------------------------------------------
const esquema = z.object({
  SUPABASE_URL: z
    .string()
    .trim()
    .url('precisa ser a URL completa do projeto')
    .transform((v) => v.replace(/\/+$/, '')),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .trim()
    .min(1, 'obrigatória NESTE SCRIPT (e só aqui) — lê o bucket privado de todos'),
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

const BUCKET = 'payment_proofs';
const PASTA_DESTINO = 'comprovantes';
const TIPO_ENTREGA_PRIVADO = 'authenticated';

const aplicar = process.argv.includes('--aplicar');
const tamanhoDoLote = (() => {
  const i = process.argv.indexOf('--lote');
  const bruto = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isInteger(bruto) && bruto > 0 && bruto <= 500 ? bruto : 100;
})();

cloudinary.config({
  cloud_name: config.CLOUDINARY_CLOUD_NAME,
  api_key: config.CLOUDINARY_API_KEY,
  api_secret: config.CLOUDINARY_API_SECRET,
  secure: true,
});

interface Pagamento {
  id: string;
  user_id: string;
  proof_storage_path: string;
}

const cabecalhosSupabase = {
  apikey: config.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
};

/**
 * Mascara o identificador nos logs. O par (user_id, payment_id) liga uma pessoa
 * a um dado financeiro; o log serve para auditar o progresso, não para
 * reconstruir quem pagou o quê. [#63]
 */
function mascarar(uuid: string): string {
  return `${uuid.slice(0, 8)}…`;
}

/**
 * Normaliza qualquer coisa lançada para um `Error` de verdade.
 * O SDK da Cloudinary rejeita com um objeto próprio, que não é `Error`:
 * interpolá-lo direto numa string renderiza "[object Object]" e apaga a causa
 * real da falha justo no log que existe para diagnosticá-la.
 */
function paraErro(valor: unknown): Error {
  if (valor instanceof Error) return valor;
  return new Error(typeof valor === 'string' ? valor : JSON.stringify(valor));
}

async function buscarPendentes(): Promise<Pagamento[]> {
  const url =
    `${config.SUPABASE_URL}/rest/v1/payments` +
    `?proof_provider=eq.supabase_storage` +
    `&select=id,user_id,proof_storage_path` +
    `&order=created_at.asc&limit=${String(tamanhoDoLote)}`;

  const resposta = await fetch(url, { headers: cabecalhosSupabase });
  if (!resposta.ok) {
    throw new Error(`Falha ao listar pagamentos: HTTP ${String(resposta.status)}`);
  }
  return (await resposta.json()) as Pagamento[];
}

async function baixarDoStorage(caminho: string): Promise<Buffer> {
  const url = `${config.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(caminho)}`;
  const resposta = await fetch(url, { headers: cabecalhosSupabase });
  if (!resposta.ok) {
    throw new Error(`Download falhou: HTTP ${String(resposta.status)}`);
  }
  return Buffer.from(await resposta.arrayBuffer());
}

/**
 * Sobe como asset PRIVADO (`authenticated`), com o mesmo `public_id`
 * determinístico que o servidor deriva do par verificado (user, pagamento):
 * `comprovantes/<user_id>/<payment_id>`.
 *
 * `overwrite: true` é o que torna o script reexecutável sem criar duplicatas
 * caso ele morra entre o upload e o UPDATE no banco.
 */
async function subirParaCloudinary(arquivo: Buffer, pagamento: Pagamento): Promise<string> {
  const publicIdAlvo = `${PASTA_DESTINO}/${pagamento.user_id}/${pagamento.id}`;

  const enviado = await new Promise<{ public_id: string }>((resolver, rejeitar) => {
    const fluxo = cloudinary.uploader.upload_stream(
      {
        public_id: publicIdAlvo,
        type: TIPO_ENTREGA_PRIVADO,
        resource_type: 'auto',
        overwrite: true,
        invalidate: true,
      },
      (erro, resultado) => {
        if (erro) {
          rejeitar(paraErro(erro));
          return;
        }
        if (!resultado) {
          rejeitar(new Error('Cloudinary não devolveu resultado'));
          return;
        }
        resolver(resultado);
      },
    );
    fluxo.end(arquivo);
  });

  return enviado.public_id;
}

/**
 * Vira a chave no banco: o pagamento passa a apontar para a Cloudinary e
 * o path antigo é enfileirado para eliminação.
 *
 * A ordem importa. O UPDATE vem primeiro; só depois a fila de exclusão. Se o
 * processo morrer no meio, o pior caso é um arquivo sobrando no Storage —
 * recuperável. A ordem inversa poderia apagar o original de um pagamento que
 * ainda aponta para ele: perda de dado financeiro. [#89]
 */
async function virarAChave(pagamento: Pagamento, publicId: string): Promise<void> {
  const respostaUpdate = await fetch(
    `${config.SUPABASE_URL}/rest/v1/payments?id=eq.${pagamento.id}`,
    {
      method: 'PATCH',
      headers: { ...cabecalhosSupabase, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof_provider: 'cloudinary',
        proof_public_id: publicId,
        proof_storage_path: null,
      }),
    },
  );
  if (!respostaUpdate.ok) {
    throw new Error(`UPDATE falhou: HTTP ${String(respostaUpdate.status)}`);
  }

  const respostaFila = await fetch(`${config.SUPABASE_URL}/rest/v1/media_deletion_queue`, {
    method: 'POST',
    headers: { ...cabecalhosSupabase, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'supabase_storage',
      asset_ref: pagamento.proof_storage_path,
      payment_id: pagamento.id,
      motivo: 'migrado_de_provedor',
    }),
  });
  if (!respostaFila.ok) {
    throw new Error(`Enfileiramento falhou: HTTP ${String(respostaFila.status)}`);
  }
}

async function principal(): Promise<void> {
  console.log(
    aplicar
      ? '>> MODO REAL — as alterações serão gravadas.'
      : '>> SIMULAÇÃO (use --aplicar para valer).',
  );

  const pendentes = await buscarPendentes();
  console.log(`Comprovantes ainda no Storage neste lote: ${String(pendentes.length)}`);

  let migrados = 0;
  const falhas: { pagamento: string; motivo: string }[] = [];

  for (const pagamento of pendentes) {
    const etiqueta = `pagamento ${mascarar(pagamento.id)} (aluno ${mascarar(pagamento.user_id)})`;

    if (!aplicar) {
      console.log(`  [simulado] ${etiqueta} → ${PASTA_DESTINO}/<user>/<payment>`);
      continue;
    }

    try {
      const arquivo = await baixarDoStorage(pagamento.proof_storage_path);
      const publicId = await subirParaCloudinary(arquivo, pagamento);
      await virarAChave(pagamento, publicId);
      migrados += 1;
      console.log(`  [ok] ${etiqueta}`);
    } catch (erro) {
      const motivo = paraErro(erro).message;
      falhas.push({ pagamento: mascarar(pagamento.id), motivo });
      console.error(`  [FALHA] ${etiqueta}: ${motivo}`);
    }
  }

  console.log('---');
  console.log(`Migrados: ${String(migrados)} · Falhas: ${String(falhas.length)}`);
  if (pendentes.length === tamanhoDoLote) {
    console.log('O lote encheu — rode de novo para continuar.');
  }
  if (falhas.length > 0) {
    process.exitCode = 1;
  }
}

principal().catch((erro: unknown) => {
  console.error(paraErro(erro).message);
  process.exit(1);
});
