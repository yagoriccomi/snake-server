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

  Qualquer resposta diferente de `true` dá **403** e um alarme (`error`, sem PII).
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

1. **Falha do Supabase (5xx ou rede) na barreira dá 503**, como em toda rota deste servidor e como
   no `pode_anexar_ao_motivo` (§ 13.1, já no G2). A barreira nunca libera por falha, que é o que
   a § 13.5 protege. Um 4xx (inclusive a função que não existe) vira `false` e, portanto, 403.
2. **A ordem na justificativa é a da § 13.5:** `is_admin` primeiro e, só se der `false`,
   `pode_decidir_justificativa`. Assim, o admin custa uma chamada.
3. **O `view-url` de justificativas em produção não piora.** Desde o #29, ele já responde 403 até as
   migrations da 2.0.0, porque a coluna `attempt` ainda não existe. Depois delas,
   `pode_decidir_justificativa` existe com `execute` para `authenticated`.
4. **`is_admin()` existe em produção desde o esquema inicial**, com `execute` para
   `authenticated` (`20260727130000_init_schema.sql`). É a mesma função da política
   `payments_select_own_or_admin`. Se ela falhar, o admin recebe 403 no comprovante: esse é o
   risco a conferir depois do merge (veja abaixo).

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

## Plano de testes

- **Comprovante, `rls`:** linha alheia com admin → serve, sem alarme; não admin → 403, alarme `error`
  e nenhuma URL emitida; 4xx da RPC → 403; dono → nenhuma chamada a `is_admin`; a RPC recebe o
  token de quem pede.
- **Comprovante, `somente-dono`:** linha alheia → 403 sem perguntar ao banco.
- **Justificativa:** dono → nenhuma RPC; admin → serve sem chamar `pode_decidir`; professor que
  pode decidir → serve; nenhum dos dois → 403, alarme e nenhuma URL; o alarme não traz os ids
  inteiros.
- **Repositórios:** o nome e o corpo de cada RPC (`{}` e `{ p_id }`); só o booleano `true` libera
  (`null`, `false`, `"true"` e `1` negam).

## Riscos e rollback

- **Admin bloqueado no comprovante**, se `rpc/is_admin` falhar em produção. Conferência depois do
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
