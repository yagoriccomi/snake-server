# Inventário de erros do `snake-server` pela D20

> **Para quem:** o chat do `snake-thai`, que escreve a v6 do contrato com a política de erros.
> **Feito em:** 05/10/2026, na branch `feature/segunda-barreira-5.5` (PR #37), lendo o código e o
> contrato **v5** (`origin/main` do `snake-thai`, `6bff7d2`).
> **Regra da D20:** cada erro identificado tem código e mensagem próprios; sobra um genérico por
> categoria: `400 bad_input` para entrada e `500 internal_error` para o servidor. Falha do
> Supabase não é "sem permissão": vira `502` (resposta inválida), `503` (fora do ar ou rede) ou
> `504` (tempo esgotado). O `403` fica para quem não tem permissão.

## 1. O que já está feito e o que espera

| Onde | Estado |
| --- | --- |
| Segunda barreira (`is_admin` e `pode_decidir_justificativa`, nos dois `view-url`) | **Feito no #37** (`bfb5ae5`). Mescla só com a v6 na `main` do `snake-thai` (C15). |
| Todas as outras chamadas ao Supabase | **Esperam.** Seguem com o 503 de hoje. A mudança vai num PR próprio, depois da v6 na `origin/main` do `snake-thai`, conferindo os clientes instalados (§ 15), e pede a confirmação do dono. |

**A v6 precisa trocar uma frase da § 13.5.** Hoje ela diz: *"Qualquer erro, ou qualquer resposta
diferente de `true`, conta como **não** (403)."* Com a D20, isso vale para `false` e para o token
recusado; o resto é a tabela da seção 4.1. A barreira continua **nunca** liberando por falha.

## 2. O formato do erro

Todo erro sai num corpo só, montado pelo tratador global (`src/middleware/error-handler.ts`):

```json
{ "error": "<mensagem para gente>", "code": "<código estável>", "traceId": "<uuid>" }
```

- `error` é seguro para mostrar; nunca traz detalhe interno, PII ou stack trace.
- `code` é o que o cliente usa para decidir; não muda sem nova versão do contrato.
- `traceId` é o que o suporte procura no log da Render.
- **Exceção de hoje:** o `429` sai sem `traceId` (o `express-rate-limit` responde sozinho, sem
  passar pelo tratador). Veja a seção 6.

## 3. Erros comuns a todas as rotas de `/v1`

As rotas validam o corpo **antes** do token, para entrada malformada não custar uma ida ao
Supabase. A ordem em toda rota é: limite de taxa → JSON → `zod` → token → regra da rota.

| Status | `code` | Mensagem (`error`) | Tipo | Quando | D20 |
| --- | --- | --- | --- | --- | --- |
| 400 | `bad_input` | Dados inválidos na requisição | **genérico** | O corpo não passa no `zod` (uuid inválido, campo faltando, `pagina` fora de 1..999, os dois campos da justificativa juntos ou nenhum) | Fica |
| 400 | `malformed_json` | JSON inválido | identificado | O corpo não é JSON | Fica |
| 413 | `payload_too_large` | Corpo da requisição grande demais | identificado | Corpo acima de 32 kB | Fica |
| 401 | `no_token` | Não autenticado | identificado | Sem `Authorization` | Fica |
| 401 | `bad_token_format` | Formato de token inválido | identificado | `Authorization` sem `Bearer <token>` | Fica |
| 401 | `bad_token` | Sessão inválida | identificado | O Supabase não reconheceu o token | **Muda:** veja 4.2 |
| 404 | `route_not_found` | Rota não encontrada | identificado | Caminho ou método que não existe (as rotas são todas `POST`) | Fica |
| 429 | `rate_limited` | Muitas requisições. Tente de novo em instantes. | identificado | Teto global, ou 20/min somados em `/v1/proofs`, `/v1/justifications` e `/v1/motivos` | Fica; ganha `traceId` (seção 6) |
| 500 | `internal_error` | Erro interno | **genérico** | Qualquer exceção não prevista | Fica |
| 503 | `supabase_unreachable` | Não foi possível falar com o servidor de dados | identificado | Rede ou tempo esgotado ao validar o token | **Muda:** veja 4.2 |

`GET /health` não tem erro próprio: responde `{ "ok": true }` sem tocar rede. Uma origem fora de
`ALLOWED_ORIGIN` não recebe erro do servidor: o navegador é que bloqueia a resposta (CORS).

## 4. As chamadas ao Supabase

### 4.1 A regra da D20 (já aplicada na barreira, no #37)

| O que o Supabase fez | Status | `code` | Mensagem |
| --- | --- | --- | --- |
| Rede caiu, ou o gateway respondeu 502/503 | 503 | `supabase_unreachable` | Não foi possível falar com o servidor de dados |
| Passou do prazo de 10 s, ou o gateway respondeu 504 | 504 | `supabase_timeout` | O servidor de dados demorou demais para responder |
| Respondeu fora do combinado: 500, 400, 404, JSON inválido, formato inesperado | 502 | `supabase_invalid_response` | O servidor de dados respondeu de forma inesperada |
| Recusou o token (401/403), ou a resposta é "não pode" | 403 | `forbidden` | Sem acesso |

O `502` diz "tentar de novo agora não resolve"; o `503` e o `504` dizem "vale tentar de novo".
Nos três, o log sai em nível `error` com o `traceId`; nenhum dispara o alarme de RLS quebrada.

### 4.2 Como cada chamada se comporta hoje e o que muda depois da v6

| Chamada | Usada por | Hoje | Depois da v6 (PR próprio) |
| --- | --- | --- | --- |
| `GET /auth/v1/user` (valida o token) | todas as rotas de `/v1` | Rede ou prazo: **503** `supabase_unreachable`. **Qualquer** resposta não-ok, inclusive 5xx: **401** `bad_token`. 200 sem `id`: **401**. Corpo que não é JSON: **500** `internal_error`. | 401/403: **401** `bad_token` (fica). Rede, prazo e 5xx: tabela 4.1. 200 sem `id` e JSON inválido: **502**. **É o ponto mais importante:** hoje, com o Supabase fora do ar, o aluno lê "Sessão inválida" e pode achar que precisa entrar de novo. |
| Leitura de linha (`consultarComoChamador`): `payments`, `absence_justifications`, `action_reason_attachments` | `proofs/view-url`, `justifications/sign-upload` com `{justificationId}`, `justifications/view-url`, `motivos/view-url` | Rede ou prazo: **503** `supabase_unreachable`. 5xx: **503** `supabase_error` ("Servidor de dados indisponível"). 4xx: lista vazia, que vira **403**. JSON inválido: **500**. | Rede, prazo e 5xx: tabela 4.1; o código `supabase_error` **sai**. 401/403: **403** (fica). JSON inválido: **502**. Outro 4xx: **pergunta 1** (seção 7). |
| RPC comum (`chamarRpcComoChamador`): `pode_anexar_ao_motivo` | `motivos/sign-upload` | Igual à linha acima, com `null` no lugar da lista vazia. Só `true` libera. | Igual à linha acima. |
| RPC de permissão (`confirmarPermissaoComoChamador`): `is_admin`, `pode_decidir_justificativa` | `proofs/view-url`, `justifications/view-url` | **Já na D20** (#37). | — |

## 5. Erros de cada rota

Além dos comuns da seção 3 e dos do Supabase da seção 4.

| Rota | Status | `code` | Quando | D20 |
| --- | --- | --- | --- | --- |
| `POST /v1/proofs/sign-upload` | — | — | Não consulta o banco: assina para a pasta do próprio token. Só os erros comuns. | Só os comuns |
| `POST /v1/proofs/view-url` | 403 | `forbidden` | A RLS não devolveu o pagamento; provedor não é `cloudinary`; linha de outra pessoa e `is_admin` deu `false` (com alarme); `POLITICA_ACESSO_COMPROVANTE=somente-dono` | Fica |
| | 502/503/504 | `supabase_*` | `is_admin` falhou | **Feito** (#37) |
| `POST /v1/justifications/sign-upload` `{classId}` (legado, até a Fase B) | — | — | Não consulta o banco. Só os erros comuns. | Só os comuns |
| `POST /v1/justifications/sign-upload` `{justificationId}` | 403 | `forbidden` | Linha não veio; não é do token; não está `pending`; já tem anexo; `attempt` fora de 1 e 2 | Fica |
| `POST /v1/justifications/view-url` | 403 | `forbidden` | Linha não veio ou sem anexo; provedor não é `cloudinary`; anexo não casa com nenhum caminho derivado; linha de outra pessoa e as duas RPCs deram `false` (com alarme) | Fica |
| | 502/503/504 | `supabase_*` | `is_admin` ou `pode_decidir_justificativa` falhou | **Feito** (#37) |
| `POST /v1/motivos/sign-upload` | 403 | `forbidden` | `pode_anexar_ao_motivo` não deu `true` | Fica |
| `POST /v1/motivos/view-url` | 403 | `forbidden` | A RLS não devolveu o anexo; provedor não é `cloudinary` | Fica |

**Por que um `forbidden` só para vários motivos:** dizer "não existe", "não é seu" ou "já tem
anexo" a quem não tem acesso entrega um oráculo de enumeração. Isso continua valendo na D20: todos
esses casos são "sem permissão", e o motivo exato vai só para o log.

**A Cloudinary nunca gera erro para o cliente.** A assinatura é calculada no próprio servidor, sem
rede, e a contagem de páginas do PDF, quando falha, cai para 1 com um `warn` no log (mostrar o
arquivo vale mais que o aviso de página). O README dizia "503: Supabase ou Cloudinary
indisponíveis"; o PR das outras rotas corrige o texto.

**O worker de limpeza não tem cliente.** Ele roda como Cron Job e grava o resultado na fila
(`processado`, `erro`, `prefixo_invalido`) e no log. Não entra na política de erros da API.

## 6. Achados que o PR das outras rotas também corrige

1. **`bad_token` com o Supabase fora do ar** (seção 4.2, primeira linha): o mais urgente para o
   aluno.
2. **JSON inválido do Supabase vira `500`:** passa a `502`, porque o erro é do outro lado.
3. **`429` sem `traceId`:** passa a sair pelo mesmo formato dos outros, com o mesmo `code` e a
   mesma mensagem. O cliente não precisa mudar.

## 7. Perguntas para a v6

1. **Função ou coluna ausente no banco (4xx que não é 401/403, como o `PGRST202`).** Hoje vira
   `403` de propósito: a § 14 publica o servidor **antes** das migrations, e um `5xx` aí deixaria
   a rota fora do ar até a migration chegar. Pela D20 seria `502`.
   - **A (recomendado):** `502` só depois do G4 (G1 e G3 em produção); até lá, segue `403`. Fica
     no mesmo PR, atrás de uma constante, e a v6 diz a data.
   - **B:** `502` já no PR das outras rotas. Mais fiel à D20, mas trava a ordem da § 14.
   - **C:** `403` para sempre. Contraria a D20.
2. **O app mostra a mensagem do servidor ou uma própria?** Hoje mostra a do servidor (`error`) para
   qualquer status. A v6 pode fixar que o app separa "tente de novo" (`503`, `504`) de "tente mais
   tarde" (`502`) pelo `code`; o servidor não depende disso.

## 8. Compatibilidade com o que está instalado (§ 15), conferida hoje

A conferência vale para o desenho; o PR das outras rotas confere de novo antes de abrir.

| Cliente | Como trata erro do servidor | Efeito da D20 |
| --- | --- | --- |
| APK 1.8.0 e 1.9.0 (`src/lib/api.ts`) | Qualquer status não-ok vira `ApiError` com o `error` e o `code` do corpo; só repete em falha de rede; não decide nada pelo status | Compatível: o aluno lê a mensagem nova |
| Web (`lib/comprovante.ts`, só `proofs/sign-upload`) | `>= 500`: "O servidor está acordando. Tente de novo em alguns segundos."; outro status: mensagem genérica | Compatível: 502 e 504 continuam `>= 500` |

## 9. Catálogo de códigos

| `code` | Status | Mensagem | Tipo | Situação |
| --- | --- | --- | --- | --- |
| `bad_input` | 400 | Dados inválidos na requisição | genérico | existe |
| `malformed_json` | 400 | JSON inválido | identificado | existe |
| `no_token` | 401 | Não autenticado | identificado | existe |
| `bad_token_format` | 401 | Formato de token inválido | identificado | existe |
| `bad_token` | 401 | Sessão inválida | identificado | existe; deixa de cobrir falha do Supabase |
| `forbidden` | 403 | Sem acesso | identificado | existe |
| `route_not_found` | 404 | Rota não encontrada | identificado | existe |
| `payload_too_large` | 413 | Corpo da requisição grande demais | identificado | existe |
| `rate_limited` | 429 | Muitas requisições. Tente de novo em instantes. | identificado | existe; ganha `traceId` |
| `internal_error` | 500 | Erro interno | genérico | existe |
| `supabase_invalid_response` | 502 | O servidor de dados respondeu de forma inesperada | identificado | **novo** (#37) |
| `supabase_unreachable` | 503 | Não foi possível falar com o servidor de dados | identificado | existe |
| `supabase_timeout` | 504 | O servidor de dados demorou demais para responder | identificado | **novo** (#37) |
| `supabase_error` | 503 | Servidor de dados indisponível | identificado | **sai** no PR das outras rotas |
