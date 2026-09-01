# Backend do Snake Thai (Render) — Handoff

> Especificação do **backend próprio do app**: o serviço que hospeda tudo que o
> app não pode (ou não deve) fazer sozinho — guardar segredos de servidor,
> integrar terceiros, rodar lógica server-side e tarefas agendadas. Começa com
> **um** módulo (assinatura dos comprovantes na Cloudinary) e cresce por módulos.
> Para quem vai construir e publicar o servidor.

## 1. O papel deste servidor

O app precisa de coisas que não cabem no cliente:

- **Segredos que não podem ir no APK** (tudo `EXPO_PUBLIC_*` é extraível) — a
  `api_secret` da Cloudinary hoje; amanhã chaves de e-mail, push, gateway de
  pagamento, etc.
- **Integrações de terceiros** que exigem servidor (assinar upload, webhooks,
  provedores externos).
- **Lógica e tarefas server-side** (relatórios, exportações, jobs agendados,
  operações administrativas privilegiadas).

Este servidor é esse lugar. Não é um microserviço só de comprovantes — é a **API
própria do Snake Thai**, desenhada para receber novos módulos sem retrabalho.

## 2. Arquitetura — híbrido Supabase + Render

O app tem **dois back-ends complementares**, cada um no que é bom:

```
                 ┌───────────────────────────────────────────┐
   App (Expo)    │  Supabase  — DADOS + AUTH (plano rápido)   │
   ───────────►  │  Postgres com RLS, Auth, Storage           │
      caminho    │  Perfis, pagamentos, aulas, planos...       │
      direto     │  SEM cold start. É o dia a dia do app.      │
                 └───────────────────────────────────────────┘
        │
        │  quando precisa de segredo, terceiro ou lógica server-side
        ▼
                 ┌───────────────────────────────────────────┐
   App (Expo)    │  Servidor Render — APLICAÇÃO + INTEGRAÇÃO  │
   ───────────►  │  API própria (/v1/...). Guarda segredos.    │
      chamadas   │  Comprovantes (Cloudinary) hoje; e o que     │
      pontuais   │  vier: push, relatórios, webhooks, jobs.     │
                 │  Plano free HIBERNA — ver cold start (§5).   │
                 └───────────────────────────────────────────┘
```

**Por que híbrido, e não tudo no Render?** O plano free da Render hiberna após
inatividade; rotear **toda** leitura de dados por ele colocaria cold-start em
cada tela. Então:

- **Dados e auth continuam direto no Supabase** — rápido, protegido por RLS, sem
  cold start. É o caminho do dia a dia.
- **O Render entra só onde há segredo, terceiro ou lógica de servidor** —
  chamadas pontuais, que toleram (e escondem) o cold start.

Se um dia você quiser mover mais coisa para o Render (ou trocar o free por um
plano sem hibernação), a estrutura por módulos (§3) permite — mas **comece
assim**: Supabase para dados, Render para o resto.

## 3. Estrutura extensível (o que torna "todo o backend")

O servidor nasce preparado para crescer:

- **Versionamento de rotas:** tudo sob `/v1/...`. Uma quebra futura vira `/v2`
  sem derrubar apps antigos.
- **Middleware de autenticação:** valida o JWT do Supabase uma vez, injeta o
  usuário na request. Todo módulo herda.
- **Rotas modulares por domínio:** cada recurso é um arquivo/pasta
  (`routes/proofs`, e no futuro `routes/notifications`, `routes/reports`...),
  registrado no router `/v1`. Adicionar um módulo não toca nos outros.
- **Config central:** um único ponto lê as variáveis de ambiente e falha rápido
  se faltar alguma (mesmo espírito do `src/config/env.ts` do app).
- **Erro padronizado:** toda resposta de erro é `{ "error": "...", "code": "..." }`
  com o HTTP status certo — nunca stack trace para o cliente.
- **Rate limiting** por IP/usuário e **CORS** restrito (o app nativo dispensa
  CORS; deixe pronto caso surja uso web).
- **Log estruturado** (JSON), com PII mascarada — mesmo padrão de `src/lib/logger.ts`.

### Como adicionar um módulo novo (o padrão)

1. Crie `routes/<dominio>.js` com as rotas sob `/v1/<dominio>`.
2. Reuse o middleware de auth; autorize dados via RLS (repassando o token) ou,
   se o módulo exigir, um segredo próprio (env).
3. Registre no router `/v1`.
4. Cadastre os segredos do módulo na Render (nunca no git).
5. Documente o contrato aqui, numa seção como a §6.

## 4. Autenticação & autorização

- **Identidade:** o servidor valida o token chamando
  `GET {SUPABASE_URL}/auth/v1/user` (apikey=anon, Authorization=token do
  chamador). Ele **não** guarda o segredo do JWT nem o forja.
- **Autorização de dados:** quando um endpoint precisa saber se o chamador pode
  ver/alterar um dado, ele repassa o **token do chamador** ao PostgREST do
  Supabase; a **RLS que já existe** decide. O servidor não reimplementa
  permissão.
- **Regra de segredos:**
  - Segredos de terceiros (Cloudinary etc.) vivem **só** na Render.
  - **Nunca** o `SUPABASE_JWT_SECRET` (permitiria forjar tokens).
  - O `SUPABASE_SERVICE_ROLE_KEY` **só** se um módulo específico exigir escrita
    fora da RLS — e então isolado nesse módulo, com uso mínimo, nunca como
    atalho geral.

## 5. Cold start (Render free) — e como o app lida

O free tier hiberna após ~15 min sem tráfego; a primeira chamada depois disso
leva ~30–60 s. Só as rotas **do Render** sofrem isso — o caminho Supabase não.

- **`/health` trivial** (sem I/O): a Render usa para o health check e o app usa
  para "acordar" o servidor.
- **Pré-aquecimento pelo app:** ao abrir uma tela que vai usar o backend, dispara
  `GET /health` (fire-and-forget). Enquanto o usuário interage, o servidor sobe.
- **Timeout longo (60–70 s) + 1 retry** nas chamadas, com UX de carregamento
  honesta ("um instante…") e `ErrorState` com "tentar de novo" — nunca tela
  congelada.

## 6. Módulo 1 — Comprovantes (Cloudinary)

O primeiro módulo. Comprovante PIX é **dado financeiro pessoal (PII)**: sobe como
`type=authenticated` (privado) e só é visto por URL assinada, gerada pelo servidor
para o dono do pagamento ou para um administrador.

Env do módulo (na Render): `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
`CLOUDINARY_API_SECRET`.

### 6.1 Onde o arquivo mora — e por que a coluna tem três nomes

O app está publicado na Play Store, então existem **duas gerações de APK em
campo ao mesmo tempo**. A tabela `payments` carrega essa realidade de forma
explícita, em vez de escondê-la:

| Coluna | Significado |
| --- | --- |
| `proof_provider` | `cloudinary` ou `supabase_storage` — onde o arquivo está |
| `proof_public_id` | Cloudinary: `comprovantes/<user_id>/<payment_id>` |
| `proof_storage_path` | Legado: `<user_id>/<payment_id>_<arquivo>` no bucket |
| `proof_url` | **Deprecada.** Só para linhas anteriores à migration do contrato |

Uma `CHECK constraint` garante que só uma das duas formas esteja preenchida por
vez. Estado ambíguo — em que o servidor não sabe onde procurar o arquivo — não
chega a existir no banco.

> **A coluna se chamava `proof_url` e nunca guardou uma URL: guardava um path.**
> Esse nome mentiroso foi a causa direta de um bug latente — o servidor leu
> "url", assumiu `public_id` da Cloudinary, e teria produzido links quebrados em
> silêncio sobre dado financeiro. Nome que não revela intenção cobra o preço
> mais tarde. [#1]

### `POST /v1/proofs/sign-upload`
Autenticado. Body `{ "paymentId": "<uuid>" }`.

1. Valida o token → `user.id`.
2. Destino derivado do **id verificado**: `folder = comprovantes/<userId>`,
   `public_id = <paymentId>`. O app não escolhe onde grava — é isso que impede
   um aluno de assinar um upload dentro da pasta de outro.
3. Assina com a `api_secret` (`type: 'authenticated'`).

Resposta: `{ cloudName, apiKey, timestamp, signature, folder, public_id, type, uploadUrl }`.
O app faz o `multipart` **direto para a Cloudinary** — o arquivo não passa pelo
servidor, que por isso pode limitar o corpo das requisições a 32kb sem impedir o
envio de um comprovante de vários megabytes.

### `POST /v1/proofs/view-url`
Autenticado (dono ou admin). Body `{ "paymentId": "<uuid>" }`.

1. Lê o pagamento com o **token do chamador**; a RLS libera só para dono ou
   admin. Vazio → `403`.
2. `conferirDono` compara o `user_id` devolvido com o do token — segunda
   barreira, que **alarma** se a RLS liberar dado alheio.
3. Se `proof_provider` **não for** `cloudinary`, responde `403`.
4. Assina a URL de visualização.

Resposta: `{ "url": "https://res.cloudinary.com/.../authenticated/s--...--/..." }`.

#### Por que o passo 3 existe

Um comprovante que ainda está no Supabase Storage **não é assinável aqui**.
Assinar assim mesmo devolveria uma URL perfeitamente formada apontando para um
arquivo que não existe na Cloudinary — link quebrado, em silêncio, sobre dado
financeiro. Recusar é a única resposta honesta.

#### Por que o caminho é DERIVADO, e não lido (leia antes de "simplificar")

O servidor **não usa** o `proof_public_id` gravado para montar a URL. Ele deriva
`comprovantes/<pagamento.user_id>/<paymentId>` — as duas metades já verificadas.

Parece redundante, já que a coluna guarda esse mesmo valor. Não é:

> A coluna é **gravável pelo aluno** no próprio pagamento — a RLS libera, porque
> a linha é dele. Se o servidor assinasse o valor gravado, bastaria apontá-lo
> para `comprovantes/<outro_aluno>/<outro_pagamento>` e pedir a URL do **próprio**
> pagamento. `conferirDono` passaria: o que está adulterado não é o dono, é o
> ponteiro. O aluno receberia o comprovante de outra pessoa com uma URL válida.

Essa barreira existia de graça no Supabase Storage: a RLS de `storage.objects`
compara a pasta do arquivo com `auth.uid()`. **A Cloudinary não tem RLS.** Ao
trocar de provedor, a proteção sumiu — e nada ocupou o lugar dela até esta
correção (achado C-2 do `REVIEW.md`).

`proof_public_id` continua útil como **flag** ("existe comprovante?"), mas não é
a fonte do caminho. Voltar a lê-lo reabre o vazamento.

### 6.2 Ciclo de vida do comprovante (LGPD)

A lei separa duas coisas que o sistema também precisa separar:

| O quê | Destino | Base |
| --- | --- | --- |
| **Registro** do pagamento (valor, data, status) | **retido** | art. 16, I — obrigação legal |
| **Imagem** do comprovante | **eliminada** | art. 15, I — fim do tratamento |

Isso importa porque `delete-my-account` **anonimiza** o perfil em vez de apagá-lo
(a cadeia `auth.users → profiles → payments` é `ON DELETE CASCADE`, e apagar o
titular levaria junto o histórico financeiro). Os pagamentos sobrevivem — e a
imagem do comprovante sobrevivia com eles.

**Como funciona agora:**

- `media_deletion_queue` é uma **outbox**. Apagar arquivo em provedor externo é
  chamada HTTP e não cabe dentro de uma transação SQL, então o banco registra a
  intenção de forma durável e o servidor consome.
- Um gatilho enfileira automaticamente quando o comprovante deixa de existir
  (admin recusa, pagamento apagado). A aplicação pode esquecer de chamar a API do
  provedor; o gatilho não.
- `eliminar_comprovantes_do_titular(uuid)` cobre o caminho que o gatilho não
  alcança — a exclusão de conta, onde os pagamentos **não** são apagados.
  A Edge Function `delete-my-account` a invoca.

> ⚠️ **O consumidor da fila ainda não existe.** Enquanto ele não rodar, a fila
> registra o que deve ser apagado, mas os arquivos permanecem no provedor. A
> obrigação de eliminar só se cumpre de fato quando esse worker existir.

## 7. Módulos futuros prováveis (esboço — não implementar agora)

Registrados para o servidor já nascer com o lugar deles previsto:

| Módulo | Para quê | O que precisaria |
| --- | --- | --- |
| `media-cleanup` | Consumir a `media_deletion_queue` (ver §6.2) | `service_role` isolado; cron |
| `notifications` | Push de vencimento/aprovação | Expo Push (token do device) |
| `reports` | Inadimplência/faturamento em PDF/CSV | lê via RLS; gera no servidor |
| `webhooks` | Eventos de terceiros | verificação de assinatura do provedor |
| `jobs` | Lembretes, fechamento do mês | cron do provedor |

## 8. Como o código está organizado

Esta seção já foi um esqueleto de exemplo. Não é mais: **o código real é a
referência**, e mantê-lo espelhado em prosa só criaria uma segunda versão para
divergir. [#6]

```
src/
├── composition-root.ts     # ÚNICO lugar que conhece implementações concretas
├── app.ts                  # criarApp(deps) — dependências por parâmetro
├── middleware/             # requestContext → helmet → cors → json → rateLimit
├── modules/proofs/
│   ├── proofs.service.ts     # a REGRA + os contratos que a infra implementa
│   ├── proofs.cloudinary.ts  # adaptador do provedor (a api_secret vive aqui)
│   ├── proofs.repository.ts  # única camada que fala PostgREST
│   ├── proofs.controller.ts  # só HTTP
│   └── proofs.routes.ts      # factory, não instância pronta
└── routes/v1.ts            # registro dos módulos
```

**A regra da dependência:** nada exporta instância pronta. Cada camada expõe uma
**factory** que recebe suas dependências, e o `composition-root.ts` é o único
arquivo que sabe que existe Cloudinary ou Supabase de verdade. É isso que permite
`criarApp(depsFalsas)` levantar a API inteira sem rede e sem variável de ambiente
de mentira. [#20][#21][#45]

Para adicionar um módulo, siga o passo a passo do `CLAUDE.md`.

## 9. Variáveis de ambiente do servidor (na Render)

| Variável | Módulo | Segredo? |
| --- | --- | --- |
| `SUPABASE_URL` | base (auth/RLS) | não |
| `SUPABASE_ANON_KEY` | base | não |
| `PORT` | base (injetada pela Render) | não |
| `ALLOWED_ORIGIN` | base (CORS, se houver web) | não |
| `POLITICA_ACESSO_COMPROVANTE` | comprovantes (`rls` \| `somente-dono`) | não |
| `CLOUDINARY_CLOUD_NAME` | comprovantes | não |
| `CLOUDINARY_API_KEY` | comprovantes | sensível |
| `CLOUDINARY_API_SECRET` | comprovantes | **sim** |

> **Ausentes de propósito:** `SUPABASE_JWT_SECRET` (permitiria forjar tokens — o
> servidor **se recusa a iniciar** se ela existir) e `SUPABASE_SERVICE_ROLE_KEY`
> (ignora a RLS por completo).
>
> A `service_role` é exigida por **um único arquivo**:
> `scripts/migrar-comprovantes.ts`, que não faz parte do servidor web. Ela vive
> na sessão de terminal de quem roda a migração e **nunca** é cadastrada na
> Render.

## 10. Deploy

O passo a passo operacional — secrets do GitHub, variáveis da Render, ambiente
com aprovação manual e a migração dos comprovantes existentes — está em
[`DEPLOY.md`](DEPLOY.md), na ordem de execução.

Em resumo: `render.yaml` com `runtime: docker` (a Render constrói a **mesma**
imagem que roda local), health check em `/health` e **`autoDeploy: false`** de
propósito — com ele ligado existiriam dois caminhos até produção, e o mais rápido
seria justamente o que ignora todos os gates da esteira.

## 11. Lado do app

**Uma variável só:** `EXPO_PUBLIC_API_URL`. É tudo que o app precisa saber da
infraestrutura — `cloudName`, assinaturas e o resto vêm nas respostas.

**Um cliente HTTP central** — `src/lib/api.ts` no `snake-thai` — concentra base
URL, o `Authorization` com o JWT da sessão, timeout de 65 s, um retry e o
pré-aquecimento. Nenhuma feature fala com `fetch` cru.

Três decisões desse cliente que não são óbvias:

- **Timeout de 65 s**, dimensionado pelo cold start da Render, não pela latência
  normal da rota (que é de milissegundos).
- **O retry só acontece em falha de REDE.** Um 4xx é a palavra final do servidor:
  repetir um 403 não muda o resultado, dobra a espera e, num POST, pode duplicar
  efeito.
- **`preAquecer()` é disparado ao ABRIR a tela**, não no momento do envio.
  Enquanto o aluno lê a chave PIX e paga no banco, o contêiner sobe — e o cold
  start acontece fora da espera dele.

**Sem `EXPO_PUBLIC_API_URL` configurada, o app continua funcionando** pelo
caminho Supabase Storage, como sempre fez. A falta do backend não derruba o boot
nem o fluxo de pagamento.

## 12. Migração — como as duas gerações convivem

A troca de provedor foi feita em **expand → migrate → contract**, porque um APK
publicado não atualiza na hora:

1. **Expand (feito).** Colunas novas convivem com `proof_url`. Todo comprovante
   existente foi marcado como `supabase_storage` no backfill.
2. **Migrate (operação).** `scripts/migrar-comprovantes.ts` copia os arquivos do
   bucket para a Cloudinary e vira a chave linha a linha. Idempotente: só enxerga
   o que ainda está com `proof_provider = 'supabase_storage'`.
3. **Contract (futuro).** Quando a telemetria mostrar o parque atualizado, o
   bucket é esvaziado e `proof_url` é removida.

Durante a convivência, quem decide de onde ler cada arquivo é o
`proof_provider` **gravado na linha** — nunca um palpite do app.

## 13. Checklist de segurança

- [x] Segredos de terceiros só na Render (nunca no app, nunca no git).
- [x] Sem `service_role` e sem `JWT_secret` no servidor.
- [x] Rotas sob `/v1`, com middleware de auth em tudo que não for `/health`.
- [x] Autorização de dados pela **RLS** (token repassado), com segunda barreira.
- [x] Comprovante sempre `type=authenticated`; destino derivado do `user.id`.
- [x] **Caminho de visualização derivado, nunca lido do banco** (§6.1).
- [x] Rate limiting nas rotas; erro padronizado sem stack trace.
- [x] `/health` sem I/O, para o cold start acordar rápido.
- [ ] **Rotacionar a `api_secret`** se ela já circulou no app — ver `DEPLOY.md`.
- [ ] **URL de visualização com expiração** — exige o recurso *Auth Token* da
      Cloudinary. Hoje a URL assinada não expira; para PII financeira isso é
      requisito, não plus (pendência P-12).
- [ ] **Consumidor da fila de eliminação** (§6.2).
