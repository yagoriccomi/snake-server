# Plano — diagnóstico do `trust proxy` (D7)

> **Origem:** achado médio da 5.7 (`AUDITORIA-5.7-navegador.md`, achado 1) e decisão **D7** do
> dono (29/09, `handoffs/COORDENACAO.md`). **Modo:** loop, sem confirmação do plano; o merge
> publica e pede confirmação, só depois do #34 (D6).

## Enunciado

- **Problema:** o limite de taxa não enxerga o IP do cliente. Com `trust proxy 1` e, provavelmente,
  dois proxies na frente (Cloudflare e Render), o `req.ip` é o de um proxy: quem passa pelo mesmo nó
  divide a cota, e um cliente pode ganhar mais de uma. Trocar para `trust proxy 2` às cegas abre a
  falsificação pelo `X-Forwarded-For` se a cadeia não tiver exatamente dois saltos. [#58]
- **Resultado esperado:** em produção, cada requisição às rotas `/v1` grava **quantas** entradas
  chegaram no `X-Forwarded-For`. Nunca o IP, que é dado pessoal. [#63]
- **Como validar:** testes provam que o log tem a contagem certa e não tem nenhum endereço; em
  produção, as linhas `diagnóstico do proxy` nos logs da Render mostram o número.

## Escopo

- Middleware novo e isolado (`src/middleware/diagnostico-proxy.ts`), montado em `src/app.ts`
  **depois** do `/health` e **antes** dos limitadores. Assim o health check da Render, que bate a
  cada poucos segundos, não enche o log, e o que se mede é exatamente o que o limitador vê.
- Campos do log: `traceId` (para amarrar à linha "requisição concluída") e
  `entradasNoXForwardedFor` (número). Nível `info`. [#91][#92]

## Escopo negativo [#8]

- **Não muda o `trust proxy`.** A correção vem depois, com a evidência, em outro PR.
- Não grava IP, nem parte dele, nem `CF-Connecting-IP`, nem a rota (um 404 traria texto livre).
- Não cria variável de ambiente: o log é temporário e sai por código.

## Premissas assumidas (modo loop)

1. **`LOG_LEVEL` do painel é `info` ou mais detalhado** (o `render.yaml` e o padrão do `env.ts` dizem
   `info`). Se nenhuma linha aparecer, conferir essa variável no painel antes de concluir algo.
2. **Uma linha por requisição é aceitável:** o tráfego é baixo (plano free, poucos alunos) e o log
   dura dias.

## Passos

| # | Arquivo | O que muda | Prática | Verificação |
| --- | --- | --- | --- | --- |
| 1 | `src/middleware/diagnostico-proxy.ts` | `contarEntradasEncaminhadas` (ignora entradas vazias) e o middleware que loga a contagem | [#2][#63] | testes unitários |
| 2 | `src/app.ts` | Uma linha: `app.use(diagnosticoDeProxy)` depois do `/health` | [#58] | teste de integração |
| 3 | `tests/unit/diagnostico-proxy.test.ts` | Contagem (sem cabeçalho, uma, várias, com espaços e vazias) e o log pelo app inteiro: número certo, nenhum IP, nada no `/health` | [#41][#42][#46] | `vitest` |

## Riscos e rollback

- **Risco:** algum IP no log. Mitigado: o log recebe só um número, e o teste procura os endereços
  enviados na linha gravada.
- **Rollback:** reverter o commit; nada mais depende dele. [#84]

## Plano de retirada (parte da D7)

1. Depois do merge (que publica), esperar um dia de uso real **e** fazer o experimento da 5.7:
   cinco requisições do mesmo computador a `/v1/proofs/sign-upload` sem token.
2. O dono (ou quem tiver acesso aos logs da Render) lê as linhas `diagnóstico do proxy` e anota
   os números no Registro do `ROADMAP-server.md`.
3. **Com a evidência, num PR só:** apagar `src/middleware/diagnostico-proxy.ts`, o teste e a linha
   do `app.ts`; ajustar o `trust proxy` ao número de saltos medido, com o teste do experimento.
   Se a contagem variar entre requisições, **não** subir o valor: registrar e voltar ao dono.
4. Prazo: se ninguém ler os logs em **14 dias** depois do merge, o log sai assim mesmo, para não
   ficar esquecido.

## Definição de pronto

- [ ] Lint, tipos e testes verdes no pre-commit e no CI.
- [ ] PR aberto, com o plano de retirada na descrição. **Sem merge até o #34 (D6)** e sem a
      confirmação do dono.
