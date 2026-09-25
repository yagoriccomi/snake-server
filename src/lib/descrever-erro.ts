/**
 * Uma frase de diagnóstico a partir de qualquer coisa que tenha sido lançada.
 *
 * O SDK da Cloudinary rejeita com OBJETO SIMPLES (`{ error: { message,
 * http_code } }`), não com `Error`: tratar só `Error` gravava `desconhecido`
 * no log, e `String(causa)` gravava `[object Object]` na fila. Sem a mensagem,
 * ninguém sabe por que a contagem de páginas ou uma exclusão falhou. [#92]
 *
 * A mensagem do provedor costuma citar o caminho do arquivo, que carrega o id
 * do titular: todo UUID vira `[id]` antes de sair daqui. [#63]
 */

const PADRAO_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** O que vai para o log quando a causa não traz mensagem nenhuma. */
export const ERRO_SEM_MENSAGEM = 'desconhecido';

function textoDe(valor: unknown): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

/** A mensagem crua, sem mascarar: `Error`, texto, `{ message }` ou `{ error: { message } }`. */
function mensagemCrua(causa: unknown): string {
  if (causa instanceof Error) return causa.message || ERRO_SEM_MENSAGEM;
  if (typeof causa === 'string') return textoDe(causa) ?? ERRO_SEM_MENSAGEM;
  if (typeof causa !== 'object' || causa === null) return ERRO_SEM_MENSAGEM;

  const { message, error } = causa as { message?: unknown; error?: unknown };
  const direta = textoDe(message);
  if (direta !== null) return direta;
  if (typeof error !== 'object' || error === null) return ERRO_SEM_MENSAGEM;

  const aninhado = error as { message?: unknown; http_code?: unknown };
  const mensagem = textoDe(aninhado.message) ?? ERRO_SEM_MENSAGEM;
  return typeof aninhado.http_code === 'number'
    ? `${mensagem} (HTTP ${String(aninhado.http_code)})`
    : mensagem;
}

export function descreverErro(causa: unknown): string {
  return mensagemCrua(causa).replace(PADRAO_UUID, '[id]');
}
