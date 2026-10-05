# Plano — 5.5, a segunda barreira de verdade (P-9)

> **Origem:** item 5.5 do `ROADMAP-server.md`, P-9 do `PENDENCIAS.md`. **Contrato:** § 13.5 (v4),
> sem mudança na v5. **Destravado por inteiro na C10** (01/10): o 4.8 do app está na `main` (#69).
> **Modo:** loop, sem confirmação do plano; o merge publica e pede confirmação, só depois do #34 (D6).

## Enunciado

- **Problema:** quando a RLS devolve a linha de **outra pessoa**, o servidor hoje não sabe se quem
  pede é um leitor legítimo. No comprovante, a política `rls` deixa passar e só alarma; na
  justificativa, nem alarma.
- **Resultado esperado:** a linha de outra pessoa só é servida se o banco confirmar, com o token
  de quem pede, que ele é leitor legítimo:
  - **comprovante:** `rpc/is_admin`;
  - **justificativa:** `rpc/is_admin`, e, se der `false`, `rpc/pode_decidir_justificativa`.

  `false` (ou o token recusado, 401/403) dá **403** e um alarme (`error`, sem PII). Falha
  do Supabase dá **502**, **503** ou **504**, sem alarme (D20, ajuste de 05/10).
  Nada é liberado em nenhum caso.
- **Como validar:** testes unitários dos services e dos repositórios; integração pelo app inteiro;
  gate local e CI verdes.

## Escopo

| Rota | Antes | Depois |
| --- | --- | --- |
| `POST /v1/proofs/view-url`, linha alheia, `rls` | Serve e alarma | Serve só se `is_admin` = `true`; senão, 403 e alarme |
| `POST /v1/proofs/view-url`, linha alheia, `somente-dono` | 403 e alarme | Igual (nem pergunta ao banco) |
| `POST /v1/justifications/view-url`, linha alheia | Serve, sem alarme | Serve se `is_admin` ou `pode_decidir_justificativa` = `true`; senão, 403 e alarme |
| Linha do próprio chamador | Serve | Igual, **sem nenhuma chamada a mais** |

## Escopo negativo [#8]

- **Sem RPC nova e sem papel próprio do servidor** (§ 13.5). As chamadas vão com o token de quem pede.
- `/v1/motivos/view-url` continua só com a RLS (`pode_ler_motivo`), como manda a § 13.5.
- Os `sign-upload` não mudam.
- `POLITICA_ACESSO_COMPROVANTE` continua com os mesmos dois valores. Nenhuma variável de ambiente
  nova; muda só o que o modo `rls` faz (§ 13.5: "deixa de ser só um alarme").

## Premissas assumidas (modo loop)

1. **Falha do Supabase na barreira segue a D20** (decisão do dono de 02/10; revoga a premissa
   de 02/10, que dava 503 para tudo). A barreira nunca libera por falha, que é o que a § 13.5
   protege, e falha não é "sem permissão":

   | O que o Supabase fez | Resposta | Código | Mensagem |
   | --- | --- | --- | --- |
   | `true` | serve | — | — |
   | `false`, ou recusou o token (401/403) | 403 e alarme | `forbidden` | Sem acesso |
   | Retorno que não é booleano, JSON inválido, 400, 404 (função ausente) ou 500 | 502 | `supabase_invalid_response` | O servidor de dados respondeu de forma inesperada |
   | Rede caiu, ou o gateway respondeu 502/503 | 503 | `supabase_unreachable` | Não foi possível falar com o servidor de dados |
   | Prazo de 10 s vencido, ou o gateway respondeu 504 | 504 | `supabase_timeout` | O servidor de dados demorou demais para responder |

   Fica **só nas duas RPCs da barreira** (`confirmarPermissaoComoChamador`, no cliente
   Supabase). As outras rotas continuam com 503 até o PR próprio, depois da v6 (C15).
2. **A ordem na justificativa é a da § 13.5:** `is_admin` primeiro e, só se der `false`,
   `pode_decidir_justificativa`. Assim, o admin custa uma chamada.
3. **O `view-url` de justificativas em produção não piora.** Desde o #29, ele já responde 403 até as
   migrations da 2.0.0, porque a coluna `attempt` ainda não existe. Depois delas,
   `pode_decidir_justificativa` existe com `execute` para `authenticated`.
4. **`is_admin()` existe em produção desde o esquema inicial**, com `execute` para
   `authenticated` (`20260727130000_init_schema.sql`). É a mesma função da política
   `payments_select_own_or_admin`. Se ela responder `false` ao admin, ele recebe 403 no
   comprovante; se falhar, 502, 503 ou 504. É o risco a conferir depois do merge (veja abaixo).

## Passos

| # | Arquivo | O que muda | Prática | Verificação |
| --- | --- | --- | --- | --- |
| 1 | `src/modules/proofs/proofs.constants.ts` | `RPC_IS_ADMIN = 'is_admin'` | [#3] | — |
| 2 | `src/modules/proofs/proofs.service.ts` | Interface `ConferenciaDeAdmin`; `conferirDono` vira `conferirLeitorLegitimo` (assíncrona) | [#20][#55] | testes |
| 3 | `src/modules/proofs/proofs.repository.ts` | `criarConferenciaDeAdmin(supabase)`: só `true` libera | [#22] | teste do repositório |
| 4 | `src/modules/justifications/justifications.constants.ts` | `RPC_PODE_DECIDIR_JUSTIFICATIVA` | [#3] | — |
| 5 | `src/modules/justifications/justifications.service.ts` | `podeDecidir` no leitor; `admin` nas dependências; barreira antes de derivar o caminho | [#55] | testes |
| 6 | `src/modules/justifications/justifications.repository.ts` | `podeDecidir` chama a RPC com `{ p_id }` | [#22] | teste do repositório |
| 7 | `src/composition-root.ts` e `tests/ajudantes/dependencias-falsas.ts` | Uma `ConferenciaDeAdmin` para os dois módulos | [#21] | typecheck |
| 8 | testes (`defesa-em-profundidade`, services, repositórios) | Casos abaixo | [#41][#46] | `vitest` |
| 9 | `README.md`, `docs/BACKEND.md`, `docs/openapi.yaml`, `PENDENCIAS.md` (P-9) | O que o modo `rls` faz agora | [#29][#96] | leitura |
| 10 | `src/lib/http-error.ts`, `src/lib/supabase.ts` | **D20:** 502 e 504; `confirmarPermissaoComoChamador` classifica a falha; os dois repositórios passam a usá-lo | [#93][#3] | `supabase.test.ts` |
| 11 | testes e docs | **D20:** cada caminho da tabela da premissa 1; 502/504 no OpenAPI e no README | [#41][#96] | `vitest`, `redocly lint` |

## Plano de testes

- **Comprovante, `rls`:** linha alheia com admin → serve, sem alarme; não admin → 403, alarme `error`
  e nenhuma URL emitida; dono → nenhuma chamada a `is_admin`; a RPC recebe o token de quem
  pede; falha 502/503/504 → o mesmo status, sem alarme e sem URL.
- **Comprovante, `somente-dono`:** linha alheia → 403 sem perguntar ao banco.
- **Justificativa:** dono → nenhuma RPC; admin → serve sem chamar `pode_decidir`; professor que
  pode decidir → serve; nenhum dos dois → 403, alarme e nenhuma URL; o alarme não traz os ids
  inteiros.
- **Repositórios:** o nome e o corpo de cada RPC (`{}` e `{ p_id }`); a resposta passa intacta e
  a falha sobe.
- **Cliente Supabase (D20):** `true`/`false`; 401/403 → `false`; não booleano, JSON inválido,
  400, 404 e 500 → 502; 502/503 e rede → 503; 504 e prazo vencido → 504; a mensagem não vaza o
  detalhe do upstream; a consulta comum continua com 503 no timeout.
- **Justificativa (D20):** falha no `is_admin` não pergunta `pode_decidir`; falha em qualquer
  uma das duas sobe sem alarme.

## Riscos e rollback

- **Admin bloqueado no comprovante**, se `rpc/is_admin` negar ou falhar em produção. Conferência depois do
  merge: o admin abre um comprovante de aluno pelo app (Financeiro). Se der 403, há dois caminhos:
  - **rápido:** reverter o merge [#84];
  - **sem deploy:** nenhum. O `somente-dono` também bloqueia o admin, e a política não tem
    terceiro valor.
- **Professor bloqueado na justificativa:** só depois das migrations da 2.0.0. A § 13.5 diz que é a
  mesma regra da RLS.

## Definição de pronto

- [ ] Lint, tipos, testes, OpenAPI válido; CI verde.
- [ ] PR aberto, com a conferência pós-merge na descrição. **Sem merge até o #34 (D6)** e sem a
      confirmação do dono.
