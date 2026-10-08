# Roadmap — snake-server (API na Render)

> **Atualizado em:** 2026-10-08, com as decisões do dono de 29/09 a 07/10 (D6, D7, D14, D16,
> D19, D20, D24, D25, D27, D29, D31, D33, D34, C10, C12, C15 e C19 em `handoffs/COORDENACAO.md`),
> as D37 a D52 da coordenação (08/10), com a D42 revista, a C22, a C23 e o contrato v6.
> **Complementa** o [`docs/PENDENCIAS.md`](docs/PENDENCIAS.md): aquele registra **por que**
> algo ficou pendente; este diz **em que ordem** resolver.
> **Repositórios irmãos:** [`snake-thai/ROADMAP-thai.md`](../snake-thai/ROADMAP-thai.md) (app e banco,
> onde está o marco "pronto para o primeiro aluno real") ·
> [`snake-web/ROADMAP-web.md`](../snake-web/ROADMAP-web.md)

**Como usar**

- Marque `[x]` quando um item terminar e anote no [Registro](#registro).
- **👤** = só você (painéis da Render, do GitHub e da Cloudinary, decisões).
- **⚠️** = mexe em produção. **Todo merge na `main` publica**, então sempre pede confirmação.
- A coluna **Skill** diz quem executa. Código entra por `executar-projeto`.

---

## Onde estamos

| | |
| --- | --- |
| **Em produção** | `snakethai-api` na Render (plano free), em `https://snake-server-3j25.onrender.com`: `/health`, `/v1/proofs/*`, `/v1/justifications/*` e `/v1/motivos/*`. Último merge de código na `main`: **PR #44** (`72667b4`, 08/10, 15:20 UTC), que liga a chave `MIGRATIONS_DO_G4_EM_PRODUCAO` (**D48 da coordenação**). **Até o `db-push-prod`, abrir anexo de justificativa (`view-url`) dá 502**, e o dono aceitou isso. Antes dele vieram o **#40** (`9be4c5b`, 07/10, 19:04 UTC, a D20 nas outras rotas) e o **#36** (`a6847de`, 19:01 UTC, o diagnóstico do proxy). As conferências sem token do § 14 responderam certo depois de cada um, mas não dizem qual commit está no ar; isso só o painel mostra. **Conferido pelo dono no painel em 07/10, antes desses merges:** o `8e654ec` (#41) estava no ar (deploy às 15:24, sucesso), e o Auto-Deploy está em **On Commit**, que fica (D33): a Render publica cada commit da `main` sem esperar os checks, e a barreira é só mesclar com o CI todo verde. O `render.yaml` não chega ao painel (sem Blueprint) |
| **Worker** | Cron Job `snakethai-media-cleanup` (LGPD), declarado no `render.yaml`. **Não existe no painel** (conferido pelo dono em 07/10): nenhum arquivo é apagado de fato até ele ser criado, antes de ter alunos de verdade, junto com o 5.1 (D34) |
| **Clientes** | O app Android (sem `Origin`) e, desde 23/09, o **`snake-web`**, o **primeiro cliente de navegador**. `ALLOWED_ORIGIN` conferido pelo dono em 24/09 |
| **Cópia local** | Na branch `chore/ambiente-dev-local`, já mesclada (PR #16). A `main` local está atrás da remota, que já tem o PR #22 |
| **PRs abertos** | **Mesclados em 07/10, na ordem da D31:** o **#34** (Fase 1, *On Commit*, D33; `5ab7c77`), o **#39** (D27; `e14fb08`), o **#42** ("G2 aberto", D34; `90bfebc`), o **#36** (log do D7; `a6847de`) e o **#40** (D20 nas outras rotas; `9be4c5b`). **Mesclado em 08/10:** o **#44** (a chave do G4, D48; `72667b4`). Abertos, os dois **esperando o G4**: o **#37** (5.5, ajustado à D20, com a `main` trazida em `bc862ec`; D24), que pela **D39 da coordenação** sobe no G4 junto com o banco e o site; e o **#45** (rascunho), que retira a forma `{classId}` do `justifications/sign-upload` (**D42 revista**; passa a responder 410 `legacy_upload_removed`, mantido pela **D50 da coordenação**). **A ordem no G4 é #94 do `snake-thai` → `db-push-prod` → #45 → #37.** Os dois não conflitam, e o #37 só traz a `main` depois do #45. Do Dependabot: #23, #25, #35 e #38 (o #35, `node` 22.23-alpine, substituiu o #32; o #38 substituiu o #33 em 05/10), **abertos por decisão do dono (D1, C12): sem merge e sem fechar** |
| **Contrato** | `snake-thai/docs/CONTRATO.md` **v6** na `origin/main` do `snake-thai` (#88, `48d8b20`, 06/10; ler sempre por `git show origin/main:docs/CONTRATO.md`, regra C2). A v4 trouxe a § 13.5 (5.5); a v5 deixou `pode_decidir_justificativa` mais restrita, com a mesma assinatura; a v6 traz a § 13.6 (política de erros e códigos de cada rota, D20), a errata da § 13.5 e a § 15 dos clientes. O **G0** abriu em 25/09; o **G2**, deste servidor (Fase 4), **abriu em 07/10, sem o Cron Job (D34)** |
| **Fundação** | Git, GitHub, Husky, commitlint, lint, typecheck e testes no pre-commit. Jira **recusado** em 2026-08-21, e não se pergunta de novo |

**O que está faltando, em ordem de gravidade:**

0. **(25/09) O worker de limpeza morria ao iniciar** com só as variáveis do `render.yaml`
   (`SUPABASE_ANON_KEY: Required`): a menos que o painel tenha essa variável a mais, **nunca
   apagou nada**. Correção no **PR #31**, **mesclado em 25/09** (`5a72cc4`). Ver o item 5.2.

1. **(07/10) Resolvido pelo #34 e pelo painel (D33).** O job "Publicar na Render" sai do
   `ci.yml`, e quem publica é o Auto-Deploy *On Commit*, conferido pelo dono. Histórico:
   **o CI da `main` está vermelho em todo merge desde 14/09**, inclusive no do PR #22 (25/09). O
   job "Publicar na Render" falha com `Secret RENDER_DEPLOY_HOOK_URL não configurado` (conferido
   nos PRs #14, #15 e #16). Os deploys anteriores saíram **por outro caminho**, provavelmente o
   Auto-Deploy do painel, **mas ninguém conferiu se ele está ligado**: por isso não se sabe se o
   lote de 25/09 já está em produção. Isso é o "dois caminhos até produção, e o mais rápido sem
   gate" que o próprio `render.yaml` diz querer evitar. [#49][#77]
2. **O envio de comprovante pela web nunca rodou em produção.** O `ALLOWED_ORIGIN` já está certo
   (conferido pelo dono em 24/09); falta o ponta a ponta do item 2.3, que agora também testa o
   `cloudinary` 2.11.0 do lote.
3. **(07/10) G2 aberto, sem o Cron Job (D34).** Histórico: o G2 segurava o app e a web. Sem a Fase 4 em produção, nenhum anexo novo funciona (motivo,
   troca permanente, justificativa por `{justificationId}`), e o servidor é o **passo 1** da ordem
   de publicação do contrato (§ 14). O G0 abriu em 25/09; o 4.1 e o 4.8 vêm primeiro.
4. **Pendências do lote de 25/09:** o Dependabot da imagem Docker está inerte, o `typescript` 6
   vai chegar e o log de `contarPaginas` grava `desconhecido` (itens 3.4 a 3.6).
5. **A `service_role` key vazou no chat.** Nesta API, só o Cron Job de limpeza a usa. **Decisão do
   dono:** girar só quando o app for usado de verdade, porque os dados de hoje são fictícios
   (item 5.1).
6. **Documentação fora de sincronia:** o OpenAPI não tem o módulo de justificativas, e o
   `PENDENCIAS.md` (inclusive a P-20) e o `CLAUDE.md` descrevem um estado de agosto.

**A fila de produto do app não passa por aqui.** Notificações, central de avisos e recado em
massa vivem no banco e nas Edge Functions (`send-push`), no repositório `snake-thai`. O servidor
só cresce por módulo quando houver um requisito que exija segredo ou terceiro. [#8][#26]

---

## Fase 0 — Arrumar a casa (só local)

- [x] **0.1** 🤖 `git-flow-projeto`: `git switch main && git pull --ff-only` e apagar a branch
  local `chore/ambiente-dev-local`, já mesclada. **Feito em 25/09** (`main` local em `7a73c83`;
  apagadas também as locais do PR #28).
- [x] **0.2** 🤖 Conferir se o `.env` local foi recriado depois do PR #16: o de desenvolvimento
  lê o `.env.dev`, não o `.env`. **Conferido em 25/09:** o `.env.dev` existe (23/09) e é o que o
  `docker-compose.yml` e o `dev.sh` leem; nenhum dos dois tem marcador `<<<`. O `.env` (imagem de
  produção local) ainda traz `SUPABASE_SERVICE_ROLE_KEY`, que o servidor web não usa (só avisa):
  vale tirar de lá.

---

## Fase 1 — ⚠️ Um caminho só até produção (decisão sua)

> **(07/10) Painel conferido pelo dono, D33:** o `snakethai-api` publica por **On Commit** e
> assim fica; os serviços não vieram do Blueprint, então o `render.yaml` não chega ao painel;
> o Cron Job não existe (D34, item 5.2). O texto abaixo é o histórico da escolha.

Hoje o job "Publicar na Render" do `ci.yml` falha em **todo** push na `main`, porque o secret
`RENDER_DEPLOY_HOOK_URL` não existe no GitHub, e o deploy sai mesmo assim por outro caminho.
**Não se sabe se o Auto-Deploy do painel está ligado:** o `render.yaml` declara
`autoDeploy: false` no `snakethai-api`, mas isso nunca foi conferido no painel. Enquanto não for,
ninguém sabe dizer qual commit está em produção: o `/health` responde `{"ok":true}` em qualquer
versão, e foi só isso que se viu depois do merge do PR #22.

O Cron Job `snakethai-media-cleanup` não declara `autoDeploy` no `render.yaml` (fica o padrão da
Render), e o job de deploy do `ci.yml` só dispara o hook do serviço web. A escolha abaixo precisa
dizer também **como o worker é publicado**.

As duas saídas possíveis:

| Opção | O que fazer | Consequência |
| --- | --- | --- |
| **A — o gate publica** (recomendada) | 👤 Cadastrar o secret `RENDER_DEPLOY_HOOK_URL` e a variável `RENDER_SERVICE_URL` no GitHub. Criar o Environment `producao` com revisor obrigatório. **Desligar o Auto-Deploy no painel da Render** | Só publica o que passou por lint, tipos, testes, CodeQL, auditoria e imagem. O CI volta a ficar verde |
| **B — o painel publica** (escolhida em 28/09) | Apagar o job `deploy` do `ci.yml` e assumir o Auto-Deploy, com o gatilho *After CI Checks Pass* (`autoDeployTrigger: checksPass`) | Com esse gatilho, só publica o commit cujos checks passaram, e o worker é publicado do mesmo jeito. Sem ele (*On Commit*), publicaria com ou sem teste verde. **07/10 (D33):** o dono manteve *On Commit*; a proteção é mesclar só com o CI todo verde |

- [x] **1.1** 👤 Escolher A ou B. **28/09: opção B, o painel publica** (D3 em
  `handoffs/COORDENACAO.md`), com o gatilho `checksPass` (regra C4): a Render publica cada
  commit da `main`, mas só depois de **todos** os checks do GitHub passarem (a documentação
  conta como aprovado `success`, `neutral` e `skipped`). Por isso o job de deploy **tem de**
  sair do `ci.yml`: vermelho, travaria toda publicação. P-4 e P-5 ficam sem efeito.
  **07/10 (D33):** o gatilho fica *On Commit* (`autoDeployTrigger: commit`), por decisão do
  dono. O job sai do `ci.yml` do mesmo jeito, porque falha desde 26/09 sem publicar nada.
- [x] **1.2** 👤 **Respondido pelo dono no painel em 07/10:** (1) o Auto-Deploy do
  `snakethai-api` está em **On Commit**; (2) os serviços **não** vieram do Blueprint, então o
  `render.yaml` não chega ao painel; (3) o commit no ar é o `8e654ec` (merge do #41); (4) o
  Cron Job `snakethai-media-cleanup` **não existe**; (5) o último deploy da API foi em 07/10,
  às 15:24, com sucesso; (6) o dono **não** quer *After CI Checks Pass*: fica *On Commit*
  (D33). O `9e95b39` do lote de 25/09 é anterior ao `8e654ec`, então já está no ar.
  Texto de 29/09: **no `snakethai-api`, o Auto-Deploy está ligado por commit**: o #29
  foi ao ar com o CI vermelho (ver "Onde estamos"). Como o `render.yaml` diz `autoDeploy: false`,
  o serviço provavelmente **não é gerido pelo Blueprint**, e a opção precisa ser trocada à mão
  para *After CI Checks Pass*, no serviço web e no Cron Job. Texto original: painel da Render,
  no `snakethai-api` e no `snakethai-media-cleanup`: conferir se
  o Auto-Deploy está ligado (era pendência da T4 e nunca foi confirmada) **e qual commit está no
  ar** (lista de deploys). Se o `9e95b39` (merge do PR #22) não aparecer no `snakethai-api`,
  **o lote de 25/09 não foi publicado**: publique pelo caminho escolhido no 1.1 (⚠️) antes do
  item 3.7.
- [x] **1.3** 🤖 **Redefinido pela D33 (07/10):** no merge do #34, o CI da `main` fica verde
  **inteiro** (já sem o job "Publicar na Render") e a Render publica aquele commit por *On
  Commit*, só no serviço web, porque o Cron Job não existe. A prova do merge (CI da `main`,
  `/health` e as conferências do § 14) fica no Registro. Texto original: confirmar que a
  Render publicou o commit só **depois** dos checks, nos dois serviços.

> A Fase 3 acabou saindo antes desta (PR #22, 25/09). O primeiro merge depois da escolha é que
> prova o caminho novo.

---

## Fase 2 — O primeiro cliente de navegador (`snake-web`)

A web é o primeiro cliente que manda cabeçalho `Origin`. Com a lista vazia, o servidor recusa
qualquer site, de propósito.

- [x] **2.1** ⚠️👤 Render → `snakethai-api` → Environment:
  `ALLOWED_ORIGIN=https://snake-web-eight.vercel.app`, **sem barra no final**. **Conferido pelo
  dono em 24/09** (contrato § 13.4).
  > O cabeçalho `Origin` nunca tem barra, e a comparação é exata. Com a barra, entrar e ver os
  > dados continua funcionando (eles vêm direto do Supabase), e **só o envio do comprovante
  > falha**, com um erro no console que não diz que o motivo é uma barra.
- [x] **2.2** 🤖 **Feito em 25/09** em `https://snake-server-3j25.onrender.com` (a URL real; `snakethai-api.onrender.com` não existe): preflight com a origem da web → `204` e `Access-Control-Allow-Origin: https://snake-web-eight.vercel.app`; com uma origem estranha → sem o cabeçalho. `/health` → `{"ok":true}`. **Verificação opcional** (o 2.1 já foi conferido no painel): provar o CORS
  **sem abrir o navegador**:

  ```bash
  curl -i -X OPTIONS https://snake-server-3j25.onrender.com/v1/proofs/sign-upload \
    -H "Origin: https://snake-web-eight.vercel.app" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization,content-type"
  ```

  O esperado é `Access-Control-Allow-Origin: https://snake-web-eight.vercel.app`. Repita com
  outra origem: ela **não** pode voltar no cabeçalho. O CORS é global (`src/app.ts`): a mesma
  variável cobrirá `/v1/motivos/*` depois do G2.
- [ ] **2.3** 👤 Ponta a ponta em produção, com uma **conta de aluno de teste**: enviar um
  comprovante **pela web**, com uma imagem e com um PDF. Depois, como admin no app, abrir o
  comprovante (`view-url`) e recusar, para não sujar o financeiro.
  **Esse caminho (web → servidor → Cloudinary) nunca foi exercitado:** no ambiente local a
  Cloudinary não tem credenciais, e o envio cai para o Storage do Supabase.
  **Faça depois de confirmar que o lote de 25/09 está no ar (item 1.2):** uma execução fecha este
  item e o 3.7.
- [x] **2.4** 🤖 **No PR #29 (25/09):** README, `docs/DEPLOY.md` e `.env.example` com o domínio da web e a armadilha da barra. `documentar-projeto`: a linha de `ALLOWED_ORIGIN` no `README.md` ainda diz
  "deixe vazio se não houver site", e a do `docs/DEPLOY.md`, "deixe vazio enquanto não houver
  cliente web". Agora há um site: documentar o domínio da web e a armadilha da barra.

---

## Fase 3 — Dependências

**Lote de 25/09: feito**, como na fase 2 da T4 (uma branch, um PR, um deploy). PR #22, merge
`9e95b39`. CI verde nos jobs "Qualidade e testes", "Segurança e licenças", "CodeQL" e "Imagem
Docker"; o `/health` respondeu `{"ok":true}` depois do merge, o que **não** prova que o lote
está no ar (item 1.2).

| PR | Atualização | Resultado (25/09) |
| --- | --- | --- |
| #19 | `cloudinary` 2.10.1 → 2.11.0 | **Integrado** (merged). Única dependência de **produção**; as APIs usadas não mudaram. O ponta a ponta é o item 3.7 |
| #17 | Grupo "ferramentas de desenvolvimento": `lint-staged` 17.5.1, `prettier` 3.9.8, `typescript-eslint` 8.70.0 | **Integrado** (merged) |
| #18 | `eslint` 9 → 10 | **Fechado** pelo par `eslint` 10.11 + `@eslint/js` 10.0.1, que entrou no PR #22 (o #18 subia só o `eslint`). No #18 foi comentado `@dependabot unignore @eslint/js` |
| #20 | `vitest` 3 → 5 | **Fechado** pelo par `vitest` 5.0.2 + `@vitest/coverage-v8` 5.0.2 (sozinho, o #20 quebrava o `npm ci` com `ERESOLVE`). A cobertura mudou de método: statements 79 → 83%, branches 95 → 75%, sem thresholds |
| #21 | `@types/node` 22 → 26 | **Fechado** com `@dependabot ignore this major version`: o runtime é o Node 22.14 (`Dockerfile`, por digest, e `ci.yml`), e os tipos acompanham o runtime |
| — | `qs` 6.15.3 → 6.16.0 | **Corrigido** por `npm audit fix` (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g) |

**`.github/dependabot.yml` depois do lote:** `open-pull-requests-limit: 10`; grupos de major em
par, `vitest` (`vitest`, `@vitest/*`) e `eslint` (`eslint`, `@eslint/js`), antes do grupo
`ferramentas-de-desenvolvimento`; `ignore` de major de `express-rate-limit` e `@types/node`, além
de `express` e `zod`. Rótulos `dependencias`, `ci` e `docker` criados no repositório.

- [x] **3.1** 🤖 Branch `chore/dependencias-2026-09` com #19 e #17 (e, no fim, os pares do #18 e
  do #20 e o `qs`), `npm ci` e o gate local completo.
- [x] **3.2** ⚠️👤 PR #22 e merge (`9e95b39`). `/health` com `{"ok":true}`. **Se o lote chegou à
  produção, só o item 1.2 diz**; o item 2.3 foi para o 3.7.
- [x] **3.3** 🤖 Fechar #21 (com ignore) e resolver #18 e #20 (fechados pelos pares). O registro
  na P-20 do `PENDENCIAS.md` foi para o item 6.4.

**Pendências que a avaliação do lote achou:**

- [x] **3.4** 🤖 **PR #30**, mesclado em 25/09 (`f9afb95`): `FROM` literal, mesmo digest, e `ignore` de
  major de `node`; build local da imagem `runtime` conferido. `executar-projeto`: **o ecossistema `docker` do Dependabot está inerte.** O
  `Dockerfile` usa `FROM ${NODE_IMAGE}` (o `ARG NODE_IMAGE` com o digest), e o Dependabot não
  resolve `ARG`: nunca vai avisar que o digest ficou para trás, que é o que o bloco `docker` do
  `dependabot.yml` promete. Escrever o `FROM` literal, com o digest
  (`FROM node:22.14-alpine@sha256:… AS base`), e pôr no bloco `docker` um `ignore` de major de
  `node` (o major sobe à mão, junto com `ci.yml` e `@types/node`, Fase 7). Gate: job "Imagem
  Docker" verde.
- [ ] **3.5** 🤖 **O `typescript` 5.9.3 → 6.0.3 chegou: PR #25** (aberto em 25/09, CI verde; o `typescript-eslint` 8.70 aceita
  `<6.1.0`). Avaliar **sozinho**, num PR só dele: é o compilador da imagem de produção. `npm ci`,
  gate completo e job "Imagem Docker" verdes antes do merge. O TypeScript 7 continua ignorado
  (P-20).
- [x] **3.6** 🤖 **No PR #29** (25/09): `descreverErro` (`src/lib/descrever-erro.ts`) lê o objeto da
  Cloudinary e troca todo UUID por `[id]`; usado em `contarPaginas`, no lote da fila, na varredura
  e no erro fatal do worker. `executar-projeto` + `testes-projeto`: **o log de `contarPaginas` grava
  `desconhecido`** quando a Cloudinary falha, porque o SDK rejeita com objeto simples, não
  `Error` (`src/modules/proofs/proofs.cloudinary.ts`). Extrair a mensagem do objeto, sem dado
  pessoal no log, e testar os dois formatos. Conferir o mesmo padrão no worker: `mensagemDeErro`
  (`media-cleanup.service.ts`) usa `String(causa)`, que num objeto simples grava
  `[object Object]` em `ultimo_erro`.
- [ ] **3.7** ⚠️👤 **Depois de confirmar que o lote está no ar (item 1.2)**, fazer o ponta a ponta
  do item 2.3: comprovante pela web, com imagem e com PDF. É o teste real do `cloudinary` 2.11.0.
- [ ] **3.8** 🤖 **PRs do Dependabot abertos em 25/09, já com o `dependabot.yml` novo**, CI verde nos dois:
  **#24** (grupo `ferramentas-de-desenvolvimento`, 6 atualizações de minor/patch) e **#23**
  (`actions/upload-artifact` 4 → 7, no `ci.yml`). Ler as notas de versão, conferir que o #24 não
  sobe nenhum major e, se o gate continuar verde, mesclar com merge commit (um de cada vez; o
  Dependabot rebaseia o outro). O #25 é o 3.5, e o #24 conflita com ele no lockfile: mesclar o #24
  primeiro.

---

## Fase 4 — Nova direção do app: anexos de motivo e justificativa semanal

> **Contrato (fonte de todos os nomes):**
> `C:\Users\USER\Desktop\GIT\academy\snake-thai\docs\CONTRATO.md`, **§ 13** e **§ 14**. Este
> servidor implementa a **v3** (revisão de 25/09). O que a v3 acrescenta está marcado **(v3)**; o
> resto vem da v2 e continua valendo.
>
> **Este chat não inventa nome de rota, pasta, tabela ou coluna.** Precisou mudar o contrato?
> Pare e peça ao usuário; quem edita o contrato é o chat do `snake-thai`.

**Portão de entrada: G0** (contrato § 14): contrato v3 e mockups aprovados pelo dono, com
registro no ROADMAP do `snake-thai`. **O G0 abriu em 25/09.** No mesmo dia, o dono decidiu que o **4.1 e o 4.8**, que corrigem falhas
do que **já está** em produção, vêm **primeiro**, antes do resto da Fase 4.

**Por que o servidor publica primeiro** (contrato § 14):

- Na ordem de publicação em produção, o servidor (G2) é o **passo 1**. Depois vêm a Edge Function
  `send-push`, as migrations, a `create-staff`, o APK (no mesmo dia das migrations) e a web.
- As rotas novas aceitam o banco antigo: sem as tabelas e as RPCs novas, elas respondem 403, e as
  rotas atuais não mudam.
- Publicar antes destrava o app e a web.
- O servidor espera o **G1** (esquema no banco local do `snake-thai`) só para o teste integrado de
  `motivos`.

**O que a v3 acrescenta ao servidor (só isto, § 13):**

- **`allowed_formats`** na assinatura do upload (`FORMATOS_DE_ANEXO`), em `motivos` e na variante
  `{justificationId}` → item 4.9;
- o worker e a varredura de órfãos apagam `motivos/` e `justificativas/` **nos três tipos de
  recurso** da Cloudinary (`image`, `raw`, `video`) → itens 4.8 e 4.5. É o que faz a guarda de
  180 dias (D54) e a exclusão de conta alcançarem todo anexo.

**O que continua sem mudança na v3:**

- **A troca permanente (`class_swap_evidence`) usa o módulo `motivos` como está.** O servidor
  chama só `rpc/pode_anexar_ao_motivo`, antes de assinar. A leitura do `view-url` passa pela RLS
  de `action_reason_attachments`, cuja política chama `pode_ler_motivo(reason_id)`: o servidor
  **não** chama `pode_ler_motivo` nem olha o tipo do motivo. A pasta continua `motivos/<uid>/<id>`.
  O 403 do `view-url` para o professor que se incluiu na aula nova depois do pedido (T49) vem da
  RLS; é teste de regressão do `snake-thai` (§ 0.1), não regra daqui.
- **A variante legada `{classId}` não ganha `allowed_formats`:** o APK 1.8 não envia o campo, e a
  assinatura deixaria de bater. Vale até a Fase B (§ 15).
- **`comprovantes/`** continua como está no worker (só `image`), e `/v1/proofs` não está na § 13.
- **`ALLOWED_ORIGIN`** cobre `/v1/motivos/*` sem mudança (CORS global, § 13.4). **Nenhuma
  variável de ambiente nova.**

| # | Item | Contrato | Skill | Quem |
| --- | --- | --- | --- | --- |
| 4.1 | **Worker valida o caminho antes de apagar** | § 13.3 | `executar-projeto` + `testes-projeto` | 🤖 |
| 4.2 | **Módulo `motivos`** | § 13.1 | `executar-projeto` + `testes-projeto` | 🤖 |
| 4.3 | **`justifications` aceita as duas formas** | § 13.2 | `executar-projeto` + `testes-projeto` | 🤖 |
| 4.4 | **Limite de taxa** em `/v1/justifications` e `/v1/motivos` | § 13.1 | `executar-projeto` | 🤖 |
| 4.5 | **Varredura diária de órfãos** no worker, nos três tipos de recurso (v3) | § 13.3 | `executar-projeto` + `testes-projeto` | 🤖 |
| 4.6 | **Documentação**: `openapi.yaml` (rotas novas e as correções do item 6.1), `README.md`, `docs/BACKEND.md` | § 13 | `documentar-projeto` | 🤖 |
| 4.8 | **(v3) Worker apaga nos três tipos de recurso** | § 13.3 | `executar-projeto` + `testes-projeto` | 🤖 |
| 4.9 | **(v3) `allowed_formats` na assinatura** | § 13.1, § 13.2 | `executar-projeto` + `testes-projeto` | 🤖 |
| 4.7 | ⚠️ **Publicar** e abrir o portão **G2** | § 14 | — | 👤 |

**Ordem de execução:** 4.1 → 4.8 → 4.9 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6 → 4.7. O 4.7 fica por
último: depende de todos.

**Estado (25/09):**

- [x] **4.1** e **4.8** — PR #28, **mesclado** (`7a73c83`). CI verde, menos "Publicar na Render"
  (Fase 1). Se o Cron Job já roda o commit novo, só o painel diz (item 1.2).
- [x] **4.9**, **4.2**, **4.3**, **4.4**, **4.5** e **4.6** — **PR #29** (branch
  `feature/g2-anexos`), um commit por item, 395 testes verdes e OpenAPI válido. **Mesclado em
  29/09** (`6c2e17e`, autorizado no D1).
- [x] **4.7** — **G2 aberto em 07/10, sem o Cron Job (D34).** O #29 está no ar desde 29/09, e
  as conferências do § 14 foram refeitas em 07/10, depois dos merges do #34 e do #39 (Registro).
  **Nenhum arquivo é apagado** até o dono criar o Cron Job, antes de ter alunos de verdade,
  junto com o 5.1 (item 5.2). Desde o #39 (D27), o `view-url` de justificativas não lê `attempt`
  até o G4, e não responde mais 403 por falta da coluna. Texto anterior: **o #29 está no ar**
  (conferência sem token de 29/09, no Registro). Falta, para
  escrever "G2 aberto": o dono confirmar no painel que o **Cron Job** roda um commit com o 4.1 e
  o 4.8 (item 1.2) e as conferências do § 14 registradas depois disso. **07/10 (D34):** o Cron
  Job não existe, e o G2 abre **sem ele**, num PR de docs próprio depois do merge do #39. Desde o merge, o
  `view-url` de justificativas responde 403 até as migrations do `snake-thai` (aviso abaixo).

**4.1 — Worker valida o caminho antes de apagar.** ✅ PR #28, mesclado em 25/09 (`7a73c83`).

- **É correção de segurança do que já está em produção**, independente da nova direção. Hoje o
  worker apaga `asset_ref` sem conferir nada. Um valor forjado no banco faria apagar o arquivo de
  outra pessoa; no Storage, `encodeURI` não escapa `/` nem `..`.
- **Cloudinary:** exigir o formato
  `^(comprovantes|justificativas|motivos)/[0-9a-f-]{36}/[0-9a-f-]{36}(-2)?$` e a pasta certa para o
  motivo (tabela do § 13.3, que já inclui `anexo_expirado`).
- **`anexo_expirado`** chega da guarda de 180 dias (D54): o cron `enfileirar_anexos_expirados()` do
  banco enfileira `justificativas/` e `motivos/`, inclusive a tentativa 1
  (`absence_justification_attempts`), direto.
- **Storage:** recusar `..` e montar a URL com `encodeURIComponent` em cada segmento.
- **Falha** é terminal: marca `prefixo_invalido`, sem nova tentativa e **sem apagar**.
- **Testes:** um caso por motivo, um caminho forjado de outra pessoa e um caminho com `..`.

**4.2 — Módulo `motivos`.**

- **`sign-upload`:**
  - corpo `{ motivoId, anexoId }`;
  - **antes de assinar**, chama `rpc/pode_anexar_ao_motivo` com `{ p_motivo_id }` e o token de
    quem chama; se não for `true`, 403;
  - devolve `UploadAssinado` com `folder = "motivos/<userId do token>"`, `public_id = "<anexoId>"`,
    `type = "authenticated"`, `overwrite = false` e **(v3)** `allowed_formats` (item 4.9).
- **`view-url`:** lê `action_reason_attachments` pela RLS e deriva `motivos/<uploaded_by>/<id>`.
  403 com a linha ausente ou provedor diferente de `'cloudinary'`.
- **Montagem:** `schema`, `routes`, `controller`, `service`, `repository` e `constants`;
  `composition-root.ts`; uma linha em `routes/v1.ts`; um dublê em
  `tests/ajudantes/dependencias-falsas.ts`.
- **Testes:**
  - corpo inválido → 400;
  - sem token → 401;
  - `pode_anexar_ao_motivo` falso → 403;
  - banco antigo (a RPC ainda não existe e o PostgREST responde 4xx) → 403, nunca 5xx: é o que
    deixa o servidor publicar primeiro;
  - o caminho vem **sempre** de `uploaded_by` + `id`, nunca do `public_id`;
  - linha invisível pela RLS → 403;
  - `overwrite = false` e **(v3)** `allowed_formats` estão na assinatura.

**4.3 — `justifications` aceita as duas formas.**

- **`sign-upload`:** exatamente um de `{ classId }` (legado: nada muda, **inclusive sem
  `allowed_formats`**) ou `{ justificationId }`. No novo:
  - o servidor lê `id, user_id, status, attempt, proof_public_id` com o token de quem chama;
  - só assina se a linha for de quem chama, estiver pendente e não tiver anexo;
  - `public_id` = `<id>` com `attempt = 1`, ou `<id>-2` com `attempt = 2`;
  - assina com `overwrite = false` e **(v3)** `allowed_formats` (item 4.9).
- **`view-url`:** calcula os caminhos derivados (`<id>`, `<id>-2`, `<class_id>`) e usa o que for
  igual a `proof_public_id`. `COLUNAS_DA_JUSTIFICATIVA` =
  `id,user_id,class_id,attempt,proof_provider,proof_public_id`.
- **Testes:**
  - o legado continua funcionando, com a assinatura de hoje (sem `overwrite` nem
    `allowed_formats`);
  - o novo funciona nas tentativas 1 e 2;
  - os dois campos juntos → 400;
  - justificativa de outra pessoa, já decidida ou já com anexo → 403;
  - banco antigo (sem a coluna `attempt`) → 403, nunca 5xx;
  - caminho que não bate → 403.

**4.4 — Limite de taxa.** O `limitadorDeComprovantes` (20/min) vale também em `/v1/justifications`
e `/v1/motivos`.

**4.5 — Varredura diária de órfãos.** Na mesma execução do Cron Job:

- lista os assets de `motivos/` e `justificativas/` com mais de 24 h, **(v3)** nos três tipos de
  recurso (`image`, `raw`, `video`);
- apaga os que não têm linha correspondente (em `action_reason_attachments`, em `proof_public_id`
  de `absence_justifications` ou nas tentativas, `absence_justification_attempts`);
- usa a service role que o worker já tem.

**4.8 — (v3) Worker apaga nos três tipos de recurso.** ✅ PR #28, mesclado em 25/09 (`7a73c83`).

- **O problema de hoje:** `apagarDaCloudinary` usa só `resource_type: 'image'`, e `"not found"`
  conta como sucesso. Um arquivo guardado como `raw` ou `video` nunca seria apagado, e o item
  sairia da fila como concluído.
- **Para `motivos/` e `justificativas/`:** tenta `image`, depois `raw`, depois `video`, sempre com
  `type: 'authenticated'`. O item é concluído quando um deles responde `"ok"` ou os três
  respondem `"not found"`.
- **`comprovantes/`** continua como está.
- Vai junto do 4.1: mesmo arquivo; os dois vêm primeiro (decisão do dono, 25/09).
- **Testes:** arquivo em `raw` (`image` dá `"not found"`, `raw` dá `"ok"`) → concluído; os três
  `"not found"` → concluído; falha em qualquer um → nova tentativa; `comprovantes/` chama só
  `image`.

**4.9 — (v3) `allowed_formats` na assinatura.**

- `FORMATOS_DE_ANEXO = 'jpg,png,webp,heic,pdf'`, **dentro da assinatura**, em `motivos` e em
  `{justificationId}`, junto com `overwrite = false`. O cliente envia os dois campos como os
  recebeu; sem eles, a Cloudinary recusa a assinatura. Um `.docx` ou um vídeo enviado por um
  cliente modificado é recusado na própria Cloudinary (T25, T46).
- **Não entra** em `{classId}` nem em `/v1/proofs`: a assinatura desses continua com os campos de
  hoje.
- Hoje `ParametrosDeUpload` (`proofs.service.ts`) tem só `folder`, `public_id`, `timestamp` e
  `type`, e os módulos o compartilham: os campos novos entram sem mudar o que os comprovantes e o
  legado assinam.
- **Testes:** `allowed_formats` e `overwrite` na assinatura das duas rotas novas e ausentes em
  `{classId}` e em `/v1/proofs`; a assinatura é calculada sobre os mesmos campos que voltam ao
  cliente.

**4.7 — Publicar e abrir o G2** (depois da Fase 1, com o caminho único até produção).

- **⚠️ Aviso antes de publicar (decisão do dono, 25/09):** o `view-url` de justificativas lê a
  coluna `attempt` (contrato § 13.2), que só existe depois das migrations. Entre a publicação do
  PR #29 e as migrations do `snake-thai`, **ninguém abre anexo de justificativa** (inclusive o
  professor no APK 1.8): a rota responde 403. Combine as migrations para logo depois.

- **O que o G2 significa (§ 14):** módulo `motivos`, variante `{justificationId}`, limitadores e
  worker **em produção**; **(v3)** com `allowed_formats` na assinatura e a exclusão nos três tipos
  de recurso.
- **Conferir sem token** (as conferências do § 14):
  - `POST /v1/motivos/sign-upload` com
    `{"motivoId":"00000000-0000-4000-8000-000000000000","anexoId":"00000000-0000-4000-8000-000000000000"}`
    → **401** `no_token`;
  - `POST /v1/justifications/sign-upload` com `{"justificationId":"<mesmo uuid>"}` → **401** (o
    servidor antigo responde 400).
- **Worker:** o commit com a validação e os três tipos de recurso publicado no Cron Job
  (conferido no painel, como no item 1.2). **07/10 (D34):** o Cron Job não existe; o G2 abre
  sem ele, e ele nasce com o commit em vigor quando o dono o criar (item 5.2).
- **`allowed_formats` e os três tipos de recurso não aparecem nessas conferências:** com o banco
  antigo, as rotas novas respondem 403 a quem tem token. A prova no G2 são os testes dos itens
  4.8 e 4.9 verdes no CI da `main`.
- **Anote no Registro "G2 aberto", com a data.** Os chats do app e da web leem aqui. Depois do G2,
  o `snake-thai` segue a ordem: `send-push`, migrations, `create-staff`, APK e web.

**Nomes do contrato que este servidor usa** (copie exatamente):

- **Rotas:**
  - `POST /v1/motivos/sign-upload` `{ motivoId, anexoId }`;
  - `POST /v1/motivos/view-url` `{ anexoId, pagina? }`;
  - `POST /v1/justifications/sign-upload` `{ classId }` | `{ justificationId }`;
  - `POST /v1/justifications/view-url` `{ justificationId, pagina? }`.
- **Resposta do `sign-upload`:** `UploadAssinado`, com `overwrite = false` e **(v3)**
  `allowed_formats` nas rotas novas; nunca no `{ classId }`.
- **RPC que o servidor chama:** só `pode_anexar_ao_motivo(p_motivo_id)`.
- **Função que o servidor não chama:** `pode_ler_motivo(p_motivo_id)`. Roda dentro da política da
  RLS de `action_reason_attachments`, e é por ela que o motivo `class_swap_evidence` chega ao
  `view-url`.
- **Pastas:**
  - `motivos/<userId>/<anexoId>` (inclusive a justificativa da troca permanente);
  - `justificativas/<userId>/<justificationId>` e `…/<justificationId>-2` (novo);
  - `justificativas/<userId>/<classId>` (legado);
  - `comprovantes/<userId>/<paymentId>`.
- **Leituras via RLS:**
  - `action_reason_attachments` (`id`, `uploaded_by`, `provider`, `public_id`);
  - `absence_justifications` (`id`, `user_id`, `class_id`, `attempt`, `status`, `proof_provider`,
    `proof_public_id`).
- **Leituras do worker (service role), na varredura de órfãos:** `action_reason_attachments`,
  `absence_justifications` e `absence_justification_attempts` (`proof_public_id`).
- **Motivos da fila:** `comprovante_recusado`, `migrado_de_provedor`, `retencao_expirada`,
  `justificativa_removida`, `anexo_de_motivo_removido`, `anexo_expirado`, `conta_excluida`.
- **Falha de validação no worker:** `prefixo_invalido`.
- **Tipos de recurso (v3):** `image`, `raw` e `video`, com `type: 'authenticated'`, em `motivos/` e
  `justificativas/`.
- **Constantes novas:** `PASTA_MOTIVOS`, `TABELA_ANEXOS_DE_MOTIVO`,
  `COLUNAS_DO_ANEXO_DE_MOTIVO`, `RPC_PODE_ANEXAR` e **(v3)** `FORMATOS_DE_ANEXO`. Muda o valor de
  `COLUNAS_DA_JUSTIFICATIVA`.
- **Limitador:** `limitadorDeComprovantes` (20/min) em `/v1/proofs`, `/v1/justifications` e
  `/v1/motivos`.

**O que NÃO é deste servidor** (é do `snake-thai`): tabelas, RLS (inclusive `pode_ler_motivo`),
as RPCs `criar_motivo`, `anexar_ao_motivo` e `anexar_a_justificativa`, os crons
`apagar_motivos_nao_usados()` e `enfileirar_anexos_expirados()`, o prazo de guarda
(`attachment_retention_days`), notificações (inclusive o aviso de aula cancelada), a conta da
frequência, as solicitações e as trocas de aula. O worker só apaga o que a fila manda.

---

## Fase 5 — Antes do primeiro aluno real

| # | Item | Quem | Observação |
| --- | --- | --- | --- |
| 5.1 | ⚠️ **Nova `service_role` no Cron Job de limpeza** | 👤 | **Decisão do dono: girar só quando o app for usado de verdade** (os dados de hoje são fictícios). Na hora: girar a chave no Supabase (item 3.1 do roadmap do app) e trocar em Render → `snakethai-media-cleanup` → `SUPABASE_SERVICE_ROLE_KEY`. **O serviço web nunca recebe essa chave**; o servidor se recusa a tratá-la como atalho |
| 5.2 | ✅ **Respondido em 07/10: o Cron Job não existe** (conferido pelo dono no painel). **D34:** nenhum arquivo é apagado de fato até o dono criá-lo, **antes de ter alunos de verdade, junto com o 5.1**; ao criar, Auto-Deploy *On Commit* (D33) e as variáveis do `render.yaml`. Os dados de hoje são fictícios. **O Cron Job existe e roda?** | 👤 | **(25/09) Com só as variáveis do `render.yaml`, ele morria ao iniciar (`SUPABASE_ANON_KEY: Required`); correção no PR #31, mesclado em 25/09. No painel, veja se o último "Run" falhou com essa mensagem.** Pendência da T7. Sem ele, **nenhum arquivo é apagado de fato**: nem de conta excluída, nem de comprovante recusado, nem (v3) o anexo que passou dos 180 dias (D54), que sai do banco e fica na Cloudinary. É plano pago (`starter`); confirme o custo. Prova: o último "Run" no painel e as linhas da `media_deletion_queue` marcadas como processadas |
| 5.3 | ✅ **Decidido em 01/10: 90 dias (D14).** **Prazo de guarda do comprovante** | 👤 | O valor vive no banco (`academy_settings.proof_retention_days`) e entra pelo `{{prazo_comprovantes}}` dos Dados dos termos, quando o dono os preencher (G5, item 3.6 do app); este worker só apaga o que a varredura enfileira (`retencao_expirada`). Nada muda no código daqui. O registro do pagamento continua por 5 anos mais o exercício. Os anexos de motivo e de justificativa já têm prazo (180 dias, `attachment_retention_days`) |
| 5.4 | ~~**P-2 — girar a `CLOUDINARY_API_SECRET`** se ela algum dia circulou no app ou no chat~~ | 👤 | ✅ **Riscado em 01/10 (D16):** o dono confirmou que a chave nunca circulou |
| 5.5 | **Em PR: #37** (02/10), destravado por inteiro na C10, pela § 13.5 do contrato (v4). **P-9 — segunda barreira de verdade** | 🤖 `executar-projeto` | Só quando a linha não é de quem chama: `rpc/is_admin` no comprovante; `rpc/is_admin` e, se der `false`, `rpc/pode_decidir_justificativa` na justificativa, sempre com o token de quem pede. Qualquer resposta diferente de `true` é 403 e alarme. Sem RPC nova. O 4.8 do app está na `main` (#69), então as duas partes andam. Em PR próprio; o merge publica e só vem depois do #34 (D6). **Espera o G4 (D24).** **D39 da coordenação (08/10):** no G4, o banco (`db-push-prod`), o servidor (o #37) e o site sobem juntos; o dono instala o APK 2.0.0 só no celular dele e testa no sistema real; só então o APK vai aos demais. Durante o teste, o servidor precisa continuar atendendo o APK 1.8/1.9 e a web atual. **D43 da coordenação:** no teste, o dono, os professores e os admins recebem a 2.0.0 juntos, e só os alunos esperam. **D42 revista:** o APK 1.8/1.9 e a web da `main` deixam de anexar justificativa a partir do `db-push-prod`; o resto continua atendido |
| 5.6 | ✅ **P-10 — RLS de `payments`** (evidência registrada no `PENDENCIAS.md`, PR #30, 25/09) | 🤖 | Já dá para verificar: as migrations estão no `snake-thai`, e a auditoria de 31/08 (veredicto V1) e os testes SQL no CI cobrem. Registrar a evidência e riscar |
| 5.7 | ✅ **Feita em 25/09** (`docs/planos/AUDITORIA-5.7-navegador.md`, PR #29). **Auditoria focada no navegador** | 🤖 `seguranca-projeto` | CORS, preflight, Helmet e limite de taxa agora que existe um cliente web. **O achado médio continua aberto:** o limite de taxa não enxerga o IP do cliente. **D7 (29/09):** um log de diagnóstico grava só **quantas** entradas chegam no `X-Forwarded-For`, nunca o IP, e sai assim que houver a evidência: **PR #36**, **mesclado em 07/10** (`a6847de`), com o plano de retirada em `docs/planos/PLANO-diagnostico-trust-proxy.md`. Falta ler nos logs da Render as linhas `diagnóstico do proxy`, depois de um dia de uso e do experimento da 5.7; sem leitura em 14 dias, o log sai assim mesmo. Faz parte da auditoria do marco M1 |

---

## Fase 6 — Documentação em sincronia

| # | Item | Skill |
| --- | --- | --- |
| 6.1 | ✅ **Feito no 4.6 (PR #29).** **`docs/openapi.yaml` não tem `/v1/justifications/sign-upload` nem `/v1/justifications/view-url`**, que estão no README e em produção. O CI valida se a especificação é um documento válido, não se ela está completa. Documentação que omite rota engana quem confia nela [#29] | `documentar-projeto` |
| 6.2 | ✅ **PR #30 (25/09).** **`docs/PENDENCIAS.md`** diz "Atualizado em 2026-08-31" e "branch `feature/servidor-docker`". A P-1, a P-6 e a P-7 foram resolvidas na prática, já que a API está em produção e o app a usa; conferir e riscar. A P-4 e a P-5 dependem da Fase 1 | `documentar-projeto` |
| 6.3 | ✅ **PR #29 (25/09).** **`CLAUDE.md`**: <br>• a linha "Comandos" tem a saída de três execuções do Vitest colada no meio do texto; <br>• cita o caminho antigo `GIT/snake-server`; <br>• a árvore de pastas e a lista de testes mostram só o módulo `proofs`, sem `justifications` e sem os testes novos | `documentar-projeto` |
| 6.4 | ✅ **PR #30 (25/09).** **P-20 do `docs/PENDENCIAS.md`** ainda lista como adiados o `vitest` 4, o TypeScript 7 e o `@eslint/js` 10. Registrar o lote de 25/09: `eslint` 10 e `vitest` 5 em par (PR #22), #21 fechado com ignore (os tipos acompanham o Node 22.14), os grupos de major do `dependabot.yml`, o `typescript` 6 do item 3.5 e o que continua adiado (TypeScript 7) | `documentar-projeto` |

---

## Fase 7 — Manutenção (sem data)

- **Majors:** o `eslint` 10 e o `vitest` 5 entraram em 25/09 (PR #22), e os grupos de major em par
  do `dependabot.yml` trazem os próximos num PR só. Resta o TypeScript 7, só quando o
  `typescript-eslint` suportar (o 6 é o item 3.5).
- **Node:** o 22 tem suporte até **30/04/2027**. Planejar a troca pelo próximo LTS com
  antecedência: `Dockerfile`, `ci.yml` e `@types/node` juntos. O Dependabot ignora o major de
  `@types/node` de propósito (e, depois do item 3.4, o de `node` na imagem).
- **Cobertura:** com o `vitest` 5, o método mudou (statements 79 → 83%, branches 95 → 75%). Não há
  thresholds, então nada quebra; se um dia houver, calibrar pelo número novo.
- **P-12, expiração da URL do comprovante:** o código está pronto, mas depende do plano
  Advanced da Cloudinary. A alternativa sem custo (P-12b) foi avaliada e adiada; só com
  incidente ou pedido.
- **P-16, limite de taxa em memória:** aceitável com uma instância só. Revisitar se sair do
  plano free ou escalar.
- **Anexo na justificativa pela web:** pedido em 2026-09-24. Entra pela variante
  `{ justificationId }` do item 4.3; o CORS do item 2.1 (conferido em 24/09) já cobre, e cobre
  também `/v1/motivos/*` para a troca permanente pela web (D34).

---

## Decisões em aberto (suas)

| Decisão | Recomendação | Onde |
| --- | --- | --- |
| `typescript` 6 | Integrar sozinho, se o gate e a imagem passarem | 3.5 |
| ~~Custo do Cron Job de limpeza (plano `starter`)~~ | ✅ **D34 (07/10):** criar antes de ter alunos de verdade, junto com o 5.1; até lá, nada é apagado | 5.2 |
| Plano Advanced da Cloudinary (URL que expira) | Só se o custo compensar | Fase 7 |

## Fora deste roadmap, de propósito

- **Banco próprio, ORM ou migrations aqui.** Os dados são do Supabase, e a autorização é da RLS.
- **Rotear leitura comum pelo servidor.** Colocaria o cold start em cada tela.
- **O resto da nova direção do app** (frequência, cancelamento, notificações, solicitações,
  trocas de aula): vive no banco e nas Edge Functions. Aqui entram só os anexos da Fase 4.
- **Jira** (recusado em 2026-08-21). [#8]

## Dependências com os repositórios irmãos

- **`snake-thai`** é dono do esquema. As consultas daqui (`payments`, `absence_justifications`,
  `media_deletion_queue` e, com a Fase 4, `action_reason_attachments` e
  `absence_justification_attempts`) quebram se uma migration de lá renomear coluna. Mudou uma
  dessas tabelas, confira aqui. Na ordem de publicação (§ 14), o servidor é o passo 1, antes da
  `send-push` e das migrations.
- **`snake-web`** depende do item 2.3 (o 2.1 já está feito) para o envio de comprovante funcionar
  em produção, e do **G2** para os anexos novos.

---

## Registro

| Data | O que aconteceu |
| --- | --- |
| 2026-09-24 | Roadmap criado a partir do handoff. Conferido: CI da `main` reprovado no job de deploy nos PRs #14, #15 e #16 (falta o secret do deploy hook); `trust proxy` configurado; OpenAPI sem o módulo de justificativas; 5 PRs do Dependabot abertos. |
| 2026-09-24 | **Fase 4 criada** a partir do contrato v2 (`snake-thai/docs/CONTRATO.md`, § 13): worker validando caminho (segurança, pode ir já), módulo `motivos`, `justifications` com `{justificationId}`, limites de taxa e varredura de órfãos. As antigas Fases 4 a 6 viraram 5 a 7. G2 é aberto aqui. |
| 2026-09-24 | **`ALLOWED_ORIGIN` conferido pelo dono** na Render, com o domínio da Vercel (item 2.1; contrato § 13.4). A prova por `curl` (2.2) ficou como verificação opcional. |
| 2026-09-25 | **Lote de dependências integrado à `main`** pelo PR #22 (merge `9e95b39`), com CI verde em "Qualidade e testes", "Segurança e licenças", "CodeQL" e "Imagem Docker"; `/health` com `{"ok":true}` depois do merge. Entraram: #19 (`cloudinary` 2.11.0) e #17 (`lint-staged` 17.5.1, `prettier` 3.9.8, `typescript-eslint` 8.70.0), marcados como merged; `eslint` 10.11 + `@eslint/js` 10.0.1 (fecha o #18) e `vitest` 5.0.2 + `@vitest/coverage-v8` 5.0.2 (fecha o #20); `qs` 6.16.0 por `npm audit fix`. #21 fechado com `@dependabot ignore this major version`; `@dependabot unignore @eslint/js` comentado no #18. `dependabot.yml` com limite 10, grupos de major em par e `ignore` de major de `express-rate-limit` e `@types/node`; rótulos `dependencias`, `ci` e `docker` criados. A avaliação achou pendências: itens 3.4 a 3.7, o 6.4 e o 1.2 ampliado (não se sabe se o lote está no ar). |
| 2026-09-25 | **Rotação da `service_role` adiada pelo dono** até o app ser usado de verdade (os dados de hoje são fictícios): item 5.1, na fase "Antes do primeiro aluno real". |
| 2026-09-25 | **Fase 4 atualizada para o contrato v3** (revisão de 25/09, § 13 e § 14): itens novos 4.8 (worker nos três tipos de recurso) e 4.9 (`allowed_formats`, `FORMATOS_DE_ANEXO`); o 4.5 lista os três tipos; o que não muda (`class_swap_evidence` pelo módulo `motivos`, `{classId}` sem `allowed_formats`); G0 como portão de entrada; o servidor como passo 1 da ordem de publicação; G2 com as conferências do § 14. |
| 2026-09-25 | **G0 aberto** (registrado no ROADMAP do `snake-thai`). O dono decidiu que o **4.1** (worker confere o caminho antes de apagar) e o **4.8** (worker apaga nos três tipos de recurso) vêm primeiro, porque corrigem a produção de hoje. |
| 2026-09-25 | **4.1 e 4.8 implementados** na branch `bugfix/worker-valida-caminho-e-tipos-de-recurso`, **PR #28** (plano em `docs/planos/PLANO-worker-4.1-4.8.md`). O worker lê `motivo`, exige o formato e a pasta do § 13.3 (Storage: sem `..`, `encodeURIComponent` por segmento) e apaga `motivos/` e `justificativas/` em `image`, `raw` e `video`. **Decisão de implementação:** a fila não tem coluna de estado, então a recusa terminal fecha o item com `processado_em` + `ultimo_erro = 'prefixo_invalido'`, sem somar `tentativas`. Gate local verde (56 casos no worker). **Falta o merge, com a confirmação do dono** (publica), e conferir no painel que o Cron Job recebeu o commit. |
| 2026-09-25 | **PR #28 mesclado** com a confirmação do dono (merge `7a73c83`): worker com os itens **4.1** e **4.8**. CI verde em "Qualidade e testes", "Segurança e licenças", "CodeQL" e "Imagem Docker"; "Publicar na Render" falhou de novo por falta do secret (Fase 1). Se o Cron Job já roda o commit, só o painel diz (item 1.2). |
| 2026-09-25 | **Fase 1 adiada pelo dono** ("decido depois"). O G2 (4.7) espera essa escolha. |
| 2026-09-25 | **Decisão do dono sobre um conflito do contrato:** o § 13.2 manda o `view-url` de justificativas ler `attempt`, que só existe depois das migrations, e o § 14 publica o servidor antes delas. O dono escolheu **seguir o contrato como está**: entre o G2 e as migrations, o `view-url` de justificativas responde 403 no banco antigo. Registrado no 4.7 e no PR #29. |
| 2026-09-25 | **Fase 4 implementada no PR #29** (branch `feature/g2-anexos`, empilhada sobre o #28): 4.9 (`overwrite` e `allowed_formats`), 4.2 (módulo `motivos` e RPC com o token de quem chama), 4.3 (`{classId}` \| `{justificationId}` e o `view-url` pelo caminho derivado igual ao gravado), 4.4 (limite de 20/min somado nas três rotas), 4.5 (varredura diária de órfãos, falha fechada) e 4.6 (OpenAPI com justificativas e motivos, que fecha o 6.1; README; BACKEND.md). 377 testes verdes, OpenAPI válido. **Não mesclado:** o 4.7 espera a Fase 1 e a confirmação do dono. **O G2 continua fechado.** |
| 2026-09-25 | **Fase 0 feita** (0.1 e 0.2) e **PR #30** aberto: 3.4 (`FROM` literal para o Dependabot da imagem), 6.2, 6.4 e a evidência do 5.6 (RLS de `payments`) no `PENDENCIAS.md`. |
| 2026-09-25 | ⚠️ **Achado: o worker de limpeza morria ao iniciar.** Ele importava o logger do servidor web, que carrega o `env.ts` e exige `SUPABASE_ANON_KEY`, variável que o Cron Job não recebe. Reproduzido rodando o build com o ambiente do `render.yaml`. A menos que o painel tenha essa variável a mais, **nenhum arquivo foi apagado de fato** (5.2). Correção no **PR #31** (núcleo do logger sem configuração; logger próprio do worker; teste que prova o defeito), trazida por merge para o #29. |
| 2026-09-25 | **No PR #29:** 3.6 (`descreverErro`: mensagem da Cloudinary legível e sem UUID) e 6.3 (`CLAUDE.md`). 395 testes verdes. |
| 2026-09-25 | **PRs #31 e #30 mesclados** com a confirmação do dono (`5a72cc4` e `f9afb95`): o worker não carrega mais a configuração do servidor web, e o Dependabot volta a vigiar a imagem. **Falta o dono conferir no painel** se o Cron Job pegou o commit e se o último "Run" passou da configuração (itens 1.2 e 5.2). |
| 2026-09-25 | **2.2 e 2.4 feitos.** CORS conferido em produção por `curl` (a web passa, outra origem não) na URL real, **`https://snake-server-3j25.onrender.com`** — é nela que se fazem as conferências do G2. README, `DEPLOY.md` e `.env.example` documentam o domínio da web sem barra (PR #29). |
| 2026-09-25 | **3.5 e 3.8 avaliados, sem merge por decisão do dono** ("nenhum por enquanto"). #24: 6 atualizações de desenvolvimento, só minor/patch; #23: `upload-artifact` 4 → 7, só o `ci.yml`, com o passo da cobertura verde; #25: `typescript` 6 com CI e imagem verdes, mas conflita com o #24 no lockfile (mesclar o #24 primeiro). |
| 2026-09-25 | **Item 5.7 (auditoria de navegador) feito**, no código e em produção. V1–V5 protegidos; CORS, cabeçalhos e erros certos em produção. **Achado médio, sem correção:** o limite de taxa não enxerga o IP do cliente (dois contadores alternados para o mesmo computador; `X-Forwarded-For` forjado não muda a chave). Provável causa: dois proxies (Cloudflare e Render) com `trust proxy 1`. Precisa ver quantas entradas chegam no `X-Forwarded-For` antes de mexer. **Achado baixo, corrigido no #29:** a checagem de segredos do CI ignorava `.env.dev` e `.env.prod`. |
| 2026-09-25 | **5.5 registrado como pedido de mudança no contrato** (o dono disse "pode seguir"): a segunda barreira de verdade exigiria o servidor chamar `is_admin()` (e, na justificativa, conferir o professor da aula), e o contrato § 13 diz que ele só chama `pode_anexar_ao_motivo`. **Pendência para o chat do `snake-thai`** decidir e, se for o caso, pôr no contrato; até lá, o 5.5 não anda aqui. |
| 2026-09-28 | **Decisões do dono** (`handoffs/COORDENACAO.md`): **D1**, merge do #29 autorizado, e os PRs do Dependabot (#23, #25, #32, #33) ficam abertos, sem merge e sem fechar; **D3**, Fase 1 na **opção B** (o painel publica, o job de deploy sai do `ci.yml`), com o gatilho `checksPass` se a Render aceitar (C4); **D4**, contrato **v4** aprovado, com a segunda barreira do servidor (5.5) no § 13: o 5.5 anda quando a v4 estiver na `main` do `snake-thai`. |
| 2026-09-29 | **Antes do merge do #29, conferido que nenhuma rota do app 1.8.0 (tag `v1.8.0`) nem da web atual (`origin/main`) quebra além do 403 aceito no `view-url` de justificativas.** O app usa `/v1/proofs/*` e `/v1/justifications/*` com `{classId}`; a web, só `/v1/proofs/sign-upload`. Os dois reenviam à Cloudinary apenas `folder`, `public_id`, `type` e `timestamp`, e o #29 não acrescenta `overwrite` nem `allowed_formats` nessas assinaturas (teste `naoDeveAcrescentarOsCamposQuandoNaoForamPedidos`). **Observação:** `/v1/justifications` passou a contar no limite de 20/min junto de `/v1/proofs` (§ 13.1), e a chave é o IP do proxy (achado da 5.7): com muitos usuários, a cota é dividida. |
| 2026-09-29 | **PR #29 mesclado** (`6c2e17e`, autorizado no D1); branch `feature/g2-anexos` apagada, checkout local na `main`. CI do merge: tudo verde menos "Publicar na Render" (sem o secret). **Mesmo assim, o #29 foi ao ar:** sem token, `POST /v1/motivos/sign-upload` → **401** `no_token` e `POST /v1/justifications/sign-upload` com `{justificationId}` → **401** (o servidor antigo daria 404 e 400). Conclusão: o Auto-Deploy do `snakethai-api` está ligado **por commit**, sem esperar os checks, e o `render.yaml` (`autoDeploy: false`) não chega ao serviço. **G2 ainda fechado:** falta o painel confirmar o commit do Cron Job (1.2). |
| 2026-09-29 | **Fase 1, opção B, em PR:** job "Publicar na Render" removido do `ci.yml`; `autoDeployTrigger: checksPass` no `snakethai-api` e no `snakethai-media-cleanup` (campo e valor conferidos no schema oficial `render.com/schema/render.yaml.json`, que o aceita nos dois tipos); README, `DEPLOY.md`, `BACKEND.md`, `REVIEW.md` e P-4/P-5 do `PENDENCIAS.md` alinhados. |
| 2026-10-02 | **Decisões do dono de 29/09 e 01/10 registradas** (a entrada de 29/09 da coordenação não tinha chegado a este chat, C7). **D6:** o #34 só se mescla depois que o dono responder às seis perguntas do painel e puser o `snakethai-api` e o `snakethai-media-cleanup` em *After CI Checks Pass*; até lá, **nenhum merge na `main`**, porque hoje cada commit vai ao ar sem os testes. O merge prova o 1.3. **D7:** pode fazer o log de diagnóstico do `trust proxy` (achado médio da 5.7), em PR próprio, gravando só quantas entradas chegam no `X-Forwarded-For`; sai com a evidência. **D14:** comprovante por **90 dias**; o 5.3 fica decidido, e o valor vive em `proof_retention_days`, pelos Dados dos termos (G5). **D16:** a `CLOUDINARY_API_SECRET` nunca circulou; o 5.4 (P-2) está riscado. **C10:** o 5.5 está destravado por inteiro, porque o 4.8 do app está na `main` (#69); a v5 deixou `pode_decidir_justificativa` mais restrita, com a mesma assinatura. **C12:** o Dependabot #35 (`node` 22.23-alpine) substituiu o #32 e segue o D1: aberto, sem merge e sem fechar. **Conferido na `origin/main` do `snake-thai`:** contrato **v5** (D12), sem mudança para o servidor. |
| 2026-10-02 | **PRs abertos, sem merge até o #34 (D6):** **#36** (D7), log temporário com a contagem do `X-Forwarded-For` (`diagnóstico do proxy`, só o número, fora do `/health`), com plano de retirada: um dia de uso e o experimento da 5.7, leitura dos logs da Render, depois um PR que tira o log e ajusta o `trust proxy`; sem leitura em 14 dias, o log sai assim mesmo. **#37** (5.5, C10), a segunda barreira da § 13.5: na linha de outra pessoa, `rpc/is_admin` no comprovante e `is_admin` + `pode_decidir_justificativa` na justificativa, com o token de quem pede; sem um `true`, 403 e alarme. 424 testes. **Conferência depois do merge do #37:** o admin abre um comprovante de aluno no app; se der 403, reverter. |
| 2026-10-05 | **Decisões do dono de 02/10 (segunda rodada) registradas.** **D19:** os merges do #34, do #36 e do #37 estão autorizados de antemão para quando o dono disser que fez o painel (D6): um de cada vez, o #34 primeiro, cada um com o CI verde e com a `main` trazida para o #36 e o #37. O #37 só entra ajustado à D20 e com a **v6** na `main` do `snake-thai`. Depois do #37, o admin abre um comprovante de aluno no app; se der 403, o merge é revertido. Qualquer **outro** PR do servidor continua pedindo confirmação. **D20 (regra geral de erros):** todo erro identificado tem o seu código HTTP e a sua mensagem própria; os genéricos são **400** (erro de quem pede, não identificado) e **500** (erro do servidor, não identificado). No #37, a falha do Supabase deixa de ser 503 genérico: resposta inválida → **502**, fora do ar ou rede → **503**, tempo esgotado → **504**; o **403** fica só para quem não tem permissão, e o alarme só nesse caso; nada é liberado. **C15:** a v6 do contrato (escrita pelo chat do `snake-thai`) traz a tabela de códigos da § 13 e a § 15 para o APK 1.8/1.9 e a web; a mudança nas **outras** rotas vai num PR próprio, depois da v6 na `main`, e pede confirmação. O inventário de erros das rotas para a v6 fica em `docs/planos/INVENTARIO-erros-D20.md` (branch do #37). **Dependabot:** o #33 foi fechado pelo próprio Dependabot em 05/10 e substituído pelo **#38** (o mesmo grupo, com 10 atualizações); segue o D1, aberto e sem merge. |
| 2026-10-07 | **Decisões do dono de 06/10 e 07/10 registradas, e o sinal da v6.** **Contrato v6 na `main` do `snake-thai`** (#88, `48d8b20`, 06/10): § 13.6 (política de erros e códigos de cada rota, D20), errata da § 13.5 (falha do Supabase é 502/503/504, nunca 403; o alarme só no 403), § 15 (o APK 1.8/1.9 e a web `main` não decidem pelo status nem pelo `code`: nada quebra e nenhum código antigo é mantido) e § 17. Respostas do dono que a v6 traz: função ou coluna ausente é **502**, e o Auth fora do ar ao validar o token deixa de dar 401 `bad_token` e passa a 503 (504/502). **A v6 destrava a C15.** **D24:** o **#37 espera o G4** (as migrations da 2.0.0 em produção): depois do painel, só o #34 e o #36 entram sem pedir de novo; o #37 entra depois do `db-push-prod.bat` da 2.0.0, com o CI verde e a v6 na `main`, sem pedir de novo. O 5.5 não trava a 2.0.0. **D25:** os handoffs passam a `snake-server\handoff\loop\NNN - DD_MM_AAAA <resumo>.md` (fora do Git por `.git/info/exclude`); os antigos ficam em `academy\handoffs\snake-server\`. **D27:** a leitura de `attempt` no `view-url` de justificativa (`COLUNAS_DA_JUSTIFICATIVA`) fica desligada até o G4, num PR próprio a partir da `main`; quando o dono disser que fez o painel, a ordem passa a ser o **#34**, **esse PR**, **"G2 aberto"** e o **#36**, cada um com o CI verde e a `main` trazida, sem pedir de novo. **C19 (ordem no servidor):** rodar de novo o CI do #37 (os jobs caíram na fila de 15 minutos de 05/10); depois, cada um no seu PR: a D27; no #37, `pode_decidir_justificativa` desligada até o G4 e 401 `bad_token` (e não 403) quando o PostgREST recusa o token; e a D20 nas outras rotas, com confirmação do dono (C15). O PR da D27 e o #37 mexem no mesmo módulo: quando um entrar na `main`, a `main` vai para o outro. |
| 2026-10-07 | **C19 executada até onde não depende do dono.** **(0)** O CI do #37 rodou de novo: "Qualidade e testes", "CodeQL" e "Imagem Docker" verdes; "Segurança e licenças" reprova, como em todo PR aberto, porque o `npm audit` acusa o `proxy-addr` 1.1.0–2.0.7 (GHSA-jqcg-44mw-7w3h, crítico), dependência do Express. Achado alheio à C19, **pergunta ao dono** se abre um PR próprio para corrigir. **(2) PR #39** (D27, `fix/attempt-desligado-ate-g4`): o `view-url` de justificativa não pede `attempt` até o G4, com teste; CI verde fora a Segurança. **(3) #37** com a `main` trazida e os ajustes da v6: `pode_decidir_justificativa` desligada até o G4 e 401 `bad_token` quando o PostgREST recusa o token; CI verde fora a Segurança; **continua esperando o G4** (D24). **(4) PR #40** (D20 nas outras rotas, `fix/d20-erros-das-rotas`, a partir da `main`): as linhas "muda" da § 13.6, cada erro com o seu código (falha do Supabase em 502/503/504, `bad_input` com a frase do problema, `bad_request`, 429 com `traceId`, e os 404/409 de comprovante, justificativa e motivo depois de confirmado o dono); 483 testes; OpenAPI, README e `BACKEND.md` atualizados. Leva o commit do #39. A § 15 foi conferida de novo: o APK (`chamarApi`) só repete em falha de rede e a web trata `>= 500` como "acordando"; nada quebra. **O merge do #40 pede a confirmação do dono** (C15); depois dele, o #37 traz a `main` (conflitos em `supabase.ts` e nos services). |
| 2026-10-07 | **D29 e D31 do dono (07/10).** **D29:** o CVE do `proxy-addr` (GHSA-jqcg-44mw-7w3h) ganha PR próprio, só com o `npm audit fix`, e o merge fica liberado com o CI verde, **antes** de qualquer outro merge do servidor; depois, a `main` vai para os PRs abertos. **Feito:** PR **#41** (`fix/cve-proxy-addr`): só o `package-lock.json` (`proxy-addr` 2.0.7 → 2.0.8; o mesmo comando subiu o `source-map-js`, de desenvolvimento, de 1.2.1 para 1.2.2); `npm audit --omit=dev --audit-level=high` com 0 vulnerabilidades, 395 testes, CI todo verde; **mesclado** (`8e654ec`), com o deploy na Render como em todo merge na `main`. A `main` foi trazida, um de cada vez, para o #34, o #36, o #37, o #39 e o #40. **D31:** o #40 está liberado e entra no fim do fluxo do painel. Depois de "fiz o painel", a ordem é: CVE (já feito) → **#34** → **#39** → **"G2 aberto"** → **#36** → **#40**, cada um com o CI verde e a `main` trazida, sem pedir de novo. Depois do #40, o **#37** traz a `main` e espera o G4 (D24). O painel ainda não foi feito: #34, #39, #36 e #40 seguem abertos. |
| 2026-10-07 | **O dono fez o painel (D33 e D34).** Respostas: (1) Auto-Deploy do `snakethai-api` em **On Commit**; (2) sem Blueprint, então o `render.yaml` não chega ao painel; (3) no ar, o `8e654ec` (merge do #41); (4) o Cron Job `snakethai-media-cleanup` **não existe**; (5) último deploy da API em 07/10, 15:24, com sucesso; (6) o dono **não** quer *After CI Checks Pass*. **D33:** fica *On Commit*. O #34 continua tirando do `ci.yml` o job "Publicar na Render" (falha desde 26/09 por falta do secret) e passa a declarar `autoDeployTrigger: commit` no `render.yaml`, com o comentário de que a proteção é mesclar só com o CI todo verde e de que o arquivo não chega ao painel; README, `DEPLOY.md`, `BACKEND.md`, `REVIEW.md` e `PENDENCIAS.md` alinhados. Itens **1.2** e **1.3** fechados. **D34:** o G2 abre em 07/10 **sem o Cron Job**, num PR de docs depois do #39; nenhum arquivo é apagado até o dono criá-lo, antes de ter alunos de verdade, junto com o 5.1. Item **5.2** fechado. A ordem dos merges, sem pedir de novo (D31): #34 → #39 → "G2 aberto" → #36 → #40; depois, a `main` vai ao #37 (G4, D24). |
| 2026-10-07 | **G2 aberto em 07/10, sem o Cron Job (D34).** **#34 mesclado** (`5ab7c77`, 18:51 UTC): o CI da `main` ficou verde **inteiro** pela primeira vez desde 14/09, já sem o job "Publicar na Render" (item 1.3). **#39 mesclado** (`e14fb08`, 18:55 UTC), com o CI do PR verde e a `main` trazida. Depois de cada merge, a Render publicou por *On Commit*, e as conferências sem token em `https://snake-server-3j25.onrender.com` responderam como o § 14 pede: `/health` → 200 `{"ok":true}`; `POST /v1/motivos/sign-upload` → 401 `no_token`; `POST /v1/justifications/sign-upload` com `justificationId` → 401 `no_token`. Os testes dos itens 4.8 e 4.9 estão verdes no CI da `main`. **Nenhum arquivo é apagado** até o dono criar o Cron Job `snakethai-media-cleanup`, antes de ter alunos de verdade, junto com a troca da `service_role` (5.1 e 5.2). Os chats do app e da web podem seguir a ordem do § 14. |
| 2026-10-07 | **#36 e #40 mesclados**, nessa ordem, fechando a sequência da D31. **#36** (`a6847de`, 19:01 UTC): o log temporário `diagnóstico do proxy` grava só quantas entradas chegam no `X-Forwarded-For`, nunca o IP (D7, item 5.7); a retirada segue `docs/planos/PLANO-diagnostico-trust-proxy.md`. **#40** (`9be4c5b`, 19:04 UTC): a D20 nas outras rotas, pelas linhas "muda" da § 13.6 do contrato v6, com a `main` fundida em `3ffbba5` e 493 testes. Antes de cada merge, a `main` foi trazida e o CI estava todo verde; depois de cada um, as conferências sem token do § 14 responderam certo em `https://snake-server-3j25.onrender.com`. Essas respostas são iguais antes e depois dos dois PRs, então provam que o serviço está de pé, não qual commit está no ar (só o painel diz). Em seguida, o **#37** trouxe a `main` (`bc862ec`), com o CI verde, e continua esperando o G4 (D24). |
| 2026-10-08 | **C22 fechada sem código.** A web viu 403 em `POST /v1/justifications/sign-upload` onde a § 13.6 pede 409. Conferido na `main` (`9be4c5b`), com os testes do módulo e uma conferência HTTP pela aplicação inteira: a justificativa **do próprio aluno** já decidida responde **409 `justification_not_pending`**, e a do próprio aluno que já tem anexo responde **409 `justification_already_has_attachment`**; o **403 `forbidden`** fica só para a linha que a RLS não devolve e para a linha de outra pessoa (o professor lê, mas não anexa), mesmo decidida, para o 409 não revelar o estado da justificativa alheia. Antes do #40, esses dois casos davam 403 (o diff `a6847de..9be4c5b` mostra a troca), então a web testou contra um servidor anterior ao #40. |
| 2026-10-08 | **D37 a D42 da coordenação (08/10) que tocam o servidor.** **D39 da coordenação (a principal):** a 2.0.0 só é liberada a todos depois do teste do dono no próprio celular, no sistema real. No G4, o banco (`db-push-prod`), o **servidor (o #37)** e o site sobem; o dono instala o APK 2.0.0 só no celular dele e testa; só então libera o APK aos demais e dispara o aviso. **Durante o teste, o servidor precisa continuar atendendo o APK 1.8/1.9 e a web atual com o banco novo**; se não atender, para e pergunta. A conferência do #37 com os clientes antigos fica no handoff `008` desta rodada. **D41 da coordenação:** o #94 do `snake-thai` (C11: anexo da justificativa pela rota nova e por `anexar_a_justificativa`; o caminho legado continua aceito) entra logo antes do `db-push-prod` do G4, junto com as migrations da 2.0.0, então o #37 sobe com esse banco. **D42 da coordenação:** o jeito velho de anexar (o aluno grava `proof_*` com o caminho legado) fica ligado por 90 dias depois da 2.0.0 e então é desligado; o `snake-thai` registra a data-alvo e não implementa agora. O lado do servidor desse caminho é o `{classId}` do `sign-upload` (§ 13.2), que continua como está; nada muda aqui agora. **D37, D38 e D40 da coordenação** não mudam nada no servidor: a 1.9.0 sai antes da 2.0.0 (só traz o aviso de atualização), o aviso a quem está desatualizado é notificação + aviso ao abrir o app, e a Política de Privacidade nova abre o G5 depois da 2.0.0. |
| 2026-10-08 | **D43 a D48 e D42 revista da coordenação (08/10, nona rodada), no que tocam o servidor.** **D48 da coordenação:** a chave `MIGRATIONS_DO_G4_EM_PRODUCAO = true` é publicada já, com o aval do dono ("ninguém usa o app ainda"). Até o `db-push-prod`, abrir anexo de justificativa dá 502, e isso foi aceito. O #37 continua esperando o G4. **D42 revista:** o jeito velho de anexar (o `proof_*` legado gravado direto pelo aluno e o `sign-upload {classId}`) sai já na 2.0.0, sem os 90 dias; o APK 1.8/1.9 e a web da `main` deixam de anexar justificativa a partir do `db-push-prod`. **D43 da coordenação:** no teste da D39, o dono, os professores e os admins recebem a 2.0.0 juntos, e só os alunos esperam. **D44, D45, D46 e D47 da coordenação** não mudam nada no servidor: os três casos do professor no APK antigo ficam como estão (D44); o push de versão nova é do `snake-thai` (D45); o G5 sai no mesmo dia do G4 (D46); o Expo 57 entra no APK candidato (D47). |
| 2026-10-08 | **D48 feita: #44 mesclado** (`72667b4`, 15:20 UTC). O PR só liga a chave e ajusta os testes. A chave **não depende do #37**: o merge de teste com o #37 compilou e passou a bateria inteira (555 testes). Conferência na Render às 15:27 UTC, em `https://snake-server-3j25.onrender.com`: `/health` 200 `{"ok":true}`; `proofs` e `motivos` (`sign-upload` e `view-url`) com corpo inválido deram 400, com e sem token falso; `justifications` (`sign-upload` e `view-url`) com corpo válido e sem token deram 401, como antes. **Limites da conferência:** nenhuma rota diz a versão no ar, e o 502 do `view-url` só aparece com uma sessão real e uma justificativa com anexo. Fica com o dono olhar os Events do painel (deploy do `72667b4`) e, se quiser, abrir um anexo de justificativa no app: o esperado é 502 até o `db-push-prod`. |
| 2026-10-08 | **D42 revista no servidor: PR #45 em rascunho, sem merge.** O `POST /v1/justifications/sign-upload` passa a aceitar só `{ justificationId }`. O corpo com `classId` (sozinho, malformado ou junto com `justificationId`) responde **410 `legacy_upload_removed`** ("Atualize o aplicativo para enviar o anexo da justificativa"), antes de verificar o token e sem ler a justificativa. O `view-url` continua abrindo o anexo legado `justificativas/<user>/<class_id>` já gravado (C11). README, `BACKEND.md` e `openapi.yaml` alinhados; 484 testes. O corpo do PR traz a errata do contrato para o `snake-thai`: a § 13.2 só com `{ justificationId }` e o 410 desde a 2.0.0; a § 13.6 com o código novo. **Ordem no G4:** #94 do `snake-thai` → `db-push-prod` → **#45** → #37. O #45 vem logo depois do banco porque, a partir dali, o banco recusa a gravação legada, e a rota velha ainda assinando deixaria arquivo órfão na Cloudinary. |
| 2026-10-08 | **C23 respondida, contra a migration do #94 do `snake-thai`.** (1) O `sign-upload {classId}` assina `folder = justificativas/<userId do token>` e `public_id = <classId>`. A Cloudinary grava `justificativas/<user>/<classId>`, que é exatamente o caminho legado do #94 (`'justificativas/' \|\| user_id \|\| '/' \|\| class_id`, com `proof_provider = 'cloudinary'` e `class_id` não nulo). O usuário do token é o mesmo do `user_id`, porque o trigger exige `auth.uid()`. Depois do #45, esse caminho deixa de ser assinado, e os anexos já gravados continuam válidos. (2) O `proofs/sign-upload` assina `folder = comprovantes/<userId do token>` e `public_id = <paymentId>`, o que dá `comprovantes/<user>/<paymentId>`. Isso passa no check `payments_caminho_do_comprovante` (na migration v3 `20260925200100`, não no #94) quando quem envia é o dono do pagamento. **Caso de borda:** o servidor não confere se o pagamento é de quem chama; se outra pessoa assinar (um admin, por exemplo), o caminho leva o id dela, e o check recusa a gravação. Hoje nenhum cliente faz isso. |
| 2026-10-08 | **D49 a D52 da coordenação (08/10, décima primeira rodada), no que tocam o servidor, e a URL velha.** **D50 da coordenação:** o 410 `legacy_upload_removed` do #45, com a frase "Atualize o aplicativo para enviar o anexo da justificativa", fica como está. A premissa do handoff `009` vira decisão, e o #45 continua em rascunho, esperando o G4 na mesma ordem (#94 do `snake-thai` → `db-push-prod` → #45 → #37). **D49, D51 e D52 da coordenação** não mudam nada no servidor: o push de versão nova só para quem está desatualizado, uma vez por semana, é do `snake-thai` (D49, que substitui o "para todos, uma vez" da D45); a chave FCM de produção (3.4) é configurada pelo dono antes do G4, com o roteiro do `snake-thai` (D51); a 1.9 e a 2.0 se unificam, sem APK nem tag v1.9.0, e a D37 fica revogada (D52), o que tira a 1.9.0 da frente do G4 sem mexer na parte do servidor. **URL velha:** os documentos ainda citavam `snakethai-api.onrender.com`, que responde 404; a URL real é `https://snake-server-3j25.onrender.com`. Trocada no exemplo do `RENDER_SERVICE_URL` (`docs/PENDENCIAS.md`), no valor padrão do servidor de produção do `docs/openapi.yaml` e no `curl` do item 2.2. Os nomes `snakethai-api` do serviço, do pacote e da imagem não são endereço e ficam. O `snake-thai/.env.example` também tem a URL velha, mas é do `snake-thai`. |
