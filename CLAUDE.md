# Diretrizes do Projeto (CLAUDE.md)

> Documento vivo de regras. Toda decisão arquitetural deste projeto deriva do
> arquivo de referência **"100 Melhores Práticas de Programação"**. Os números
> entre colchetes (ex: `[#11]`, `[#22]`) referenciam a prática que justifica a regra.

## 🎯 Objetivo e Escopo

**`snakethai-api`** é a API própria do Snake Thai: o lugar onde mora tudo que o app
Expo não pode (ou não deve) fazer sozinho — segredos de servidor, integrações de
terceiros que exigem assinatura, lógica e tarefas server-side.

Ela **não** é um microserviço de comprovantes. Nasce com um módulo e cresce por
módulos, sem retrabalho de fundação. [#26]

**Arquitetura híbrida — cada back-end no que é bom:**

| Caminho | Responsabilidade | Por quê |
| --- | --- | --- |
| App → **Supabase** (direto) | Dados e auth do dia a dia (perfis, pagamentos, aulas, planos) | Postgres com RLS, sem cold start |
| App → **este servidor** (Render) | Segredos, terceiros, lógica server-side | Plano free hiberna; chamadas pontuais toleram o cold start |

**FORA do escopo (YAGNI [#8]):**
- **Banco de dados próprio.** Não há schema, migrations nem ORM aqui. Os dados
  vivem no Supabase e a autorização é da **RLS** — este servidor não reimplementa
  permissão, ele repassa o token do chamador e obedece à resposta. [#20]
- **Interface gráfica.** É API headless.
- Rotear leitura de dados comum pelo Render (colocaria cold start em cada tela).

## 🚀 Stack Tecnológica e Ferramentas

* **Runtime:** Node.js 22 (ESM nativo)
* **Backend:** Express 5 + TypeScript (strict)
* **Validação:** Zod — schema é a única fonte de verdade do contrato de entrada
* **Identidade/Dados:** Supabase (Auth + PostgREST com RLS)
* **Mídia:** Cloudinary (assets `type=authenticated`, privados)
* **Infraestrutura/DevOps:** Docker (multi-stage) + Docker Compose; deploy na Render por imagem Docker
* **Qualidade:** ESLint (type-checked) + Prettier + Vitest

**Por que Express e não Fastify?** O `docs/BACKEND.md` já especifica Express, o
volume é de chamadas pontuais (não há gargalo de throughput a resolver) e o
ecossistema de middlewares é o mais direto para o que precisamos. Trocar por
performance sem gargalo medido seria otimização prematura. [#99]

## 🏗️ Arquitetura e Padrões

* **Design Pattern Principal:** Arquitetura em Camadas por módulo de domínio [#22]
  * `routes` → composition root do módulo: monta as dependências concretas [#21]
  * `controller` → traduz HTTP em chamada de serviço. **Zero regra de negócio**
  * `service` → a regra. Sem Express, sem SDK — recebe contratos por injeção [#20][#21]
  * `schema` → validação de entrada com Zod [#51]
* **Versionamento de API:** tudo sob `/v1`. Uma quebra futura vira `/v2` sem
  derrubar apps já instalados. [#28]

### Regras Estritas

- Tipagem forte OBRIGATÓRIA — `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`. `any` é erro de lint. [#11]
- Early returns; nada de aninhamento profundo. [#9]
- Injeção de dependências nos services; proibido instanciar SDK dentro da regra. [#20][#21]
- Funções com responsabilidade única; até 3–4 parâmetros. [#2][#10]
- DRY e KISS — sem duplicar regra, sem solução maior que o problema. [#6][#7]
- Sem magic numbers/strings: tudo em `src/config/constants.ts`. [#3]
- Comentar o **porquê**, nunca o **o quê**. [#4]
- Nomenclatura descritiva em **PT-BR** para o domínio; identificadores de
  protocolo (`user_id`, `public_id`, `signature`) mantêm o nome do contrato externo. [#1]
- ESLint + Prettier como gate. [#5]
- Zero segredos no código ou no Git. [#37][#80]

### Ordem dos middlewares (é regra de segurança, não detalhe)

```
requestContext → helmet → cors → /health → json(32kb) → rateLimit → /v1 → 404 → errorHandler
```

Dentro de cada rota de módulo:

```
validarCorpo(schema) → requireUser → controller
```

`validarCorpo` **antes** de `requireUser` de propósito: rejeitar entrada malformada
não pode custar uma ida à rede. Sem isso, qualquer um força o servidor a chamar o
Supabase mandando lixo, e quem errou o payload recebe 503 em vez de 400.

`/health` fica **antes** do rate limiter e sem I/O: seus dois clientes legítimos
são o health check da Render e o pré-aquecimento do app. Contá-los no limite
puniria exatamente o comportamento que pedimos ao app. [#82]

## 📂 Estrutura de Diretórios

```
src/
├── app.ts                      # Monta o Express (separado do listen → testável) [#42]
├── server.ts                   # Bootstrap: porta, SIGTERM, shutdown limpo
├── config/
│   ├── constants.ts            # Limites e timeouts nomeados [#3]
│   └── env.ts                  # ÚNICO ponto que lê process.env; fail-fast [#80]
├── lib/
│   ├── logger.ts               # JSON estruturado com PII mascarada [#91][#63]
│   ├── http-error.ts           # Contrato de erro da aplicação [#93]
│   ├── supabase.ts             # Identidade (/auth/v1/user) + leitura via RLS
│   └── cloudinary.ts           # Assinatura de upload e URL privada
├── middleware/
│   ├── request-context.ts      # traceId por requisição [#94]
│   ├── validate.ts             # Validação Zod na borda [#51]
│   ├── require-user.ts         # Autenticação herdada por todo módulo
│   └── error-handler.ts        # Handler global — sem stack para o cliente [#93]
├── modules/
│   └── proofs/                 # Módulo 1 — comprovantes
│       ├── proofs.routes.ts    # composition root [#21]
│       ├── proofs.controller.ts
│       ├── proofs.service.ts   # regra pura, testável sem rede [#45]
│       └── proofs.schema.ts
├── routes/
│   └── v1.ts                   # Registro dos módulos sob /v1 [#28]
└── types/
    └── express.d.ts            # Campos que os middlewares anexam à Request [#11]
```

### Como adicionar um módulo novo

1. Crie `src/modules/<dominio>/` com `routes` / `controller` / `service` / `schema`.
2. Reuse `validarCorpo` e `requireUser`; autorize dados pela **RLS** (repassando o
   token) ou, se o módulo exigir, por um segredo próprio vindo do `env`.
3. Acrescente **uma linha** em `src/routes/v1.ts`.
4. Cadastre os segredos do módulo na Render e em `.env.example` (nunca no Git).
5. Documente o contrato no `README.md` e em `docs/BACKEND.md`.

## 🔐 Diretrizes de Segurança Mínimas

- **Identidade por delegação:** o servidor pergunta ao Supabase quem é o chamador
  (`GET /auth/v1/user`). Ele **não** guarda o segredo do JWT — não pode forjar o
  que não tem. `SUPABASE_JWT_SECRET` no ambiente **impede a inicialização**.
- **Autorização pela RLS:** leituras repassam o token do chamador ao PostgREST.
  O servidor não decide permissão. [#20]
- **`SUPABASE_SERVICE_ROLE_KEY`:** ausente por padrão. Só se um módulo exigir
  escrita fora da RLS — isolado nesse módulo, uso mínimo, nunca atalho geral. [#55]
- **Destino derivado do id verificado:** o app não escolhe pasta nem nome do
  comprovante; ambos vêm do `userId` do token. [#55]
- **Comprovante é PII financeira:** sempre `type=authenticated` (privado), visto
  só por URL assinada. Nunca em log. [#63]
- Validação de todo input com Zod; filtros do PostgREST por `URLSearchParams`,
  jamais por concatenação de string. [#51][#52]
- Rate limiting por IP e CORS restrito (lista vazia = nenhuma origem). [#57][#58]
- Helmet para headers de segurança; `x-powered-by` desligado. [#59]
- Payload JSON limitado a 32kb — arquivos vão direto para a Cloudinary. [#65]
- Erro padronizado `{ error, code, traceId }`; **stack trace nunca sai do servidor**. [#93]
- Container roda como usuário `node`, não-root. [#55]

## 🐳 Ambiente Local (Docker)

O `docker-compose.yml` sobe **a própria API** — não há banco/cache local de
propósito (os dados são do Supabase; subir um Postgres aqui seria teatro [#8]).
O mesmo `Dockerfile` roda local e na Render: paridade real. [#79][#81]

* **Stages do Dockerfile:** `deps` → `dev` (hot reload) → `build` (TS→dist) →
  `prod-deps` → `runtime` (imagem final enxuta, sem TypeScript nem devDeps) [#85]
* **Subir / parar / reiniciar:**
  - Windows: `scripts\dev.bat start` | `stop` | `restart` | `logs` | `prod`
  - Linux/Mac: `./scripts/dev.sh start` | `stop` | `restart` | `logs` | `prod`
* **`prod`** sobe localmente a imagem `runtime` — a mesma que vai para a Render.
* **Healthcheck** do container bate em `/health`. [#82]

## ☁️ Deploy (Render)

`render.yaml` com `runtime: docker` — a Render constrói a mesma imagem. [#78]
Health check em `/health`. Variáveis sensíveis entram como **secret** no painel,
com `sync: false` no arquivo (nunca valores no Git). [#37]

**Cold start é do plano free, não da imagem:** containerizar dá paridade e boot
enxuto, mas o serviço continua hibernando após ~15 min. A mitigação é do lado do
app (pré-aquecimento via `/health`, timeout longo, 1 retry).

## 🔄 Protocolo de Atualização do README.md (CRÍTICO)

O `README.md` é a documentação pública deste projeto. **Sempre que ocorrer uma das
mudanças abaixo, o `README.md` DEVE ser atualizado no mesmo ciclo de trabalho:** [#96]

1. Adição de novas variáveis de ambiente (`.env`).
2. Mudança nos comandos de instalação ou execução.
3. Novo serviço no `docker-compose.yml`.
4. Adição de integração de terceiros essencial.
5. Finalização de um módulo principal (novo endpoint sob `/v1`).

> Falha em manter o README sincronizado é tratada como bug de documentação.

## 🔌 Integrações

| Integração | Estado | Data |
| --- | --- | --- |
| **Jira / Atlassian** | **Recusado pelo usuário** | 2026-08-21 |
| **Remoto Git** | GitHub — `git@github.com:yagoriccomi/snake-server.git` (SSH) | pré-existente |

> **Jira: não perguntar de novo.** A decisão foi tomada em 2026-08-21, ao aprovar o
> roadmap de construção. A rastreabilidade fica por conta dos Conventional Commits.
> Se um dia mudar, atualize esta tabela — ela é a fonte da verdade do handshake.

## 🐙 Convenção de Versionamento

### Branches [#33][#36]

| Prefixo | Para quê | Exemplo |
| --- | --- | --- |
| `feature/` | Funcionalidade nova | `feature/modulo-notificacoes` |
| `bugfix/` | Correção de defeito | `bugfix/url-assinada-expirada` |
| `chore/` | Manutenção sem efeito em produção | `chore/atualiza-dependencias` |
| `refactor/` | Reestruturação sem mudar comportamento | `refactor/extrai-cliente-http` |

Branches são de **curta duração**: integre na `main` com frequência. Uma branch que
vive semanas vira Merge Hell — o custo da fusão cresce mais rápido que o trabalho. [#36]

### Commits [#31][#32]

Formato: `<tipo>(<escopo opcional>): <assunto no imperativo, sem ponto final>`

Tipos aceitos: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`,
`chore`, `revert`. O `commitlint` valida no hook `commit-msg` — mensagem fora do
padrão **não commita**.

Cada commit é **atômico**: uma mudança lógica por commit. "Vários ajustes" não é
uma mudança lógica. [#31]

### Gate local (Husky) [#5][#49][#76]

O hook `pre-commit` roda, nesta ordem:

1. `lint-staged` — ESLint com `--fix` e Prettier nos arquivos em stage
2. `npm run typecheck` — tipos do projeto inteiro
3. `vitest run --passWithNoTests` — a suíte

> **Dívida registrada:** a flag `--passWithNoTests` está ali porque a suíte ainda
> não existe. Ao concluir a etapa de testes, **remova a flag** — a partir daí,
> "nenhum teste encontrado" é sintoma, não estado aceitável.

### Regras invioláveis

- **Zero segredos no Git**, nem em repositório privado. O `.env` é ignorado; o
  `.env.example` carrega só nomes de chave. [#37][#40]
- **Nunca reescrever história pública.** `git push --force` em branch compartilhada
  é proibido — o commit inicial já está no GitHub. [#38]
- **Push só com decisão explícita.** Nenhuma automação empurra código para o remoto.
