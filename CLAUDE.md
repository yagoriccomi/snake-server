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
├── app.ts                      # criarApp(deps) — deps por parâmetro [#21][#42]
├── server.ts                   # Bootstrap: porta, SIGTERM, shutdown limpo
├── composition-root.ts         # ÚNICO lugar que conhece implementações concretas [#30]
├── config/
│   ├── constants.ts            # Limites da APLICAÇÃO (payload, rate limit, timeouts) [#3]
│   └── env.ts                  # ÚNICO ponto que lê process.env; fail-fast [#80]
├── lib/
│   ├── log-estruturado.ts      # criarLogger(): JSON com PII mascarada, SEM ler config [#91][#63]
│   ├── logger.ts               # o logger do servidor web, montado do env.ts
│   ├── descrever-erro.ts       # mensagem legível de Error ou do objeto da Cloudinary, sem UUID
│   ├── http-error.ts           # Contrato de erro da aplicação [#93]
│   └── supabase.ts             # criarClienteSupabase() — identidade, leitura e RPC via RLS
├── middleware/
│   ├── request-context.ts      # traceId por requisição [#94]
│   ├── validate.ts             # Validação Zod na borda [#51]
│   ├── require-user.ts         # criarRequireUser(supabase) — auth injetável
│   └── error-handler.ts        # classificarErro() puro + handler global [#2][#93]
├── modules/
│   ├── proofs/                 # Módulo 1 — comprovantes
│   │   ├── proofs.constants.ts   # constantes DO DOMÍNIO (pasta, tipo, tabela) [#13]
│   │   ├── proofs.cloudinary.ts  # adaptador do provedor de mídia (infra) [#20]
│   │   ├── proofs.repository.ts  # única camada que fala PostgREST [#22]
│   │   ├── proofs.service.ts     # a regra + os CONTRATOS que a infra implementa
│   │   ├── proofs.controller.ts  # só HTTP
│   │   ├── proofs.schema.ts      # validação Zod
│   │   └── proofs.routes.ts      # criarProofsRouter(deps) — factory, não instância
│   ├── justifications/         # Módulo 2 — anexos de justificativa (mesmas camadas)
│   └── motivos/                # Módulo 3 — anexos de motivo (mesmas camadas)
├── routes/
│   └── v1.ts                   # criarV1Router(deps) — registro dos módulos [#28]
├── jobs/
│   └── media-cleanup/          # Cron Job SEPARADO do serviço web (LGPD)
│       ├── media-cleanup.constants.ts   # formato e pastas do contrato (§ 13.3)
│       ├── media-cleanup.service.ts     # a regra: valida o caminho e processa 1 lote da fila
│       ├── media-cleanup.orfaos.ts      # a regra: varredura diária de anexos órfãos
│       ├── media-cleanup.repository.ts  # fala com media_deletion_queue e as referências
│       ├── media-cleanup.provedores.ts  # lista e apaga na Cloudinary / apaga no Storage
│       ├── media-cleanup.logger.ts      # logger do worker — NUNCA importar lib/logger.ts
│       │                                # (carrega o env.ts do servidor web e derruba o worker)
│       └── media-cleanup.ts             # entrypoint — próprio esquema de env
│                                # ÚNICO lugar do repo que carrega a
│                                # SUPABASE_SERVICE_ROLE_KEY como processo
│                                # de longa duração. Nunca no serviço web. [#55]
└── types/
    └── express.d.ts            # Campos que os middlewares anexam à Request [#11]
```

### Regra da dependência

Nada de instância pronta exportada no escopo de módulo. Cada camada expõe uma
**factory** que recebe suas dependências, e o `composition-root.ts` é o único
arquivo que sabe que existe Cloudinary ou Supabase de verdade. [#20][#21][#30]

```
composition-root  →  criarApp(deps)  →  criarV1Router(deps)  →  criarProofsRouter(deps)
```

É isso que permite `criarApp(depsFalsas)` levantar a API inteira sem rede,
sem `vi.mock` e sem variável de ambiente de mentira. [#45]

### Como adicionar um módulo novo

1. Crie `src/modules/<dominio>/` com `routes` / `controller` / `service` / `schema`.
2. Exponha `criar<Dominio>Router(deps)` — **factory**, nunca instância pronta.
3. Defina no service os **contratos** (interfaces) que a infra do módulo implementa.
4. Reuse `validarCorpo` e `criarRequireUser`; autorize dados pela **RLS** (repassando
   o token) ou, se o módulo exigir, por um segredo próprio vindo do `env`.
5. Acrescente as dependências dele em `composition-root.ts`.
6. Acrescente **uma linha** em `src/routes/v1.ts`.
7. Cadastre os segredos do módulo na Render e em `.env.example` (nunca no Git).
8. Documente o contrato no `README.md` e em `docs/BACKEND.md`.

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
- **Segunda barreira de autorização:** a RLS é a trava principal, mas mora em outro
  sistema. `conferirDono` compara o `user_id` devolvido pela consulta com o do token e
  **alarma em nível `error`** se divergirem — uma política de RLS que caia vira alerta,
  não vazamento silencioso. Controlado por `POLITICA_ACESSO_COMPROVANTE`. [#55]
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

> **Observado ao rodar:** com o `.env` incompleto, o `fail-fast` derruba o processo do
> servidor, mas em modo `dev` o contêiner permanece `running` — o `tsx watch` segue
> vivo aguardando uma alteração de arquivo. O healthcheck marca `unhealthy`
> corretamente, e o diagnóstico está no `logs`. Em produção (`node dist/server.js`) o
> contêiner morre de fato, como esperado.

## ☁️ Deploy (Render)

`render.yaml` com `runtime: docker` — a Render constrói a mesma imagem. [#78]
Health check em `/health`. Variáveis sensíveis entram como **secret** no painel,
com `sync: false` no arquivo (nunca valores no Git). [#37]

**Cold start é do plano free, não da imagem:** containerizar dá paridade e boot
enxuto, mas o serviço continua hibernando após ~15 min. A mitigação é do lado do
app (pré-aquecimento via `/health`, timeout longo, 1 retry).

## 📋 Pendências

[`docs/PENDENCIAS.md`](docs/PENDENCIAS.md) é o registro do que **não pôde ser executado
ou decidido**, com o motivo de cada item.

**Regra:** sempre que algo depender de um acesso, de uma informação ou de uma decisão
que não estão ao alcance de quem está trabalhando, **registre lá em vez de adivinhar**.
Um palpite plausível que falha depois custa mais caro do que uma pendência anotada.

Ao resolver um item, risque-o do documento no mesmo ciclo de trabalho.

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
| **Migração p/ Cloudinary** | branch `feature/comprovantes-cloudinary` (de `feature/servidor-docker`) | 2026-08-31 |

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
3. `vitest run` — a suíte inteira

> A flag `--passWithNoTests` foi **removida** quando a suíte passou a existir:
> a partir daqui, "nenhum teste encontrado" é sintoma de suíte sumida, não
> estado aceitável.

## 🧪 Testes

```
tests/
├── ajudantes/dependencias-falsas.ts   # dublês que respeitam os contratos reais [#45]
├── unit/                              # regra isolada, sem rede
│   ├── env.test.ts                    # fail-fast e bloqueio do JWT_SECRET
│   ├── error-handler.test.ts          # classificarErro: nunca vaza detalhe interno
│   ├── logger.test.ts                 # mascarar: a barreira de PII
│   ├── descrever-erro.test.ts         # objeto da Cloudinary, sem [object Object], sem UUID
│   ├── supabase.test.ts               # montagem da URL e da RPC = defesa contra injeção
│   ├── proofs.*.test.ts               # adaptador REAL (assina local), regra e repositório
│   ├── justifications.service.test.ts # as duas formas e o caminho derivado
│   ├── motivos.*.test.ts              # regra e repositório (banco antigo = 403)
│   ├── defesa-em-profundidade.test.ts # segunda barreira dos comprovantes
│   └── media-cleanup.*.test.ts        # fila, validação, três tipos, órfãos, ambiente
└── integracao/                        # criarApp(depsFalsas) + supertest [#42]
    ├── api.test.ts                    # middlewares, limites, comprovantes
    ├── justifications.api.test.ts
    └── motivos.api.test.ts
```

**Como testar sem rede:** `criarApp(deps)` aceita as dependências por
parâmetro, então a API inteira sobe com dublês — nada de `vi.mock` de módulo. [#45]

**Regras da suíte:**
- A maior parte dos casos ataca **falha**, não o caminho feliz. [Regra de Ouro]
- Nome de teste diz condição e resultado (`deveNegarComForbiddenQuando...`). [#46]
- Cada teste prepara o próprio estado; a ordem não importa. [#48]
- Credenciais dos testes são **fictícias**, definidas em `vitest.config.ts`. [#37]

**Comandos:** `npm test` · `npm run test:watch` · `npm run test:coverage`

### Regras invioláveis

- **Zero segredos no Git**, nem em repositório privado. O `.env` é ignorado; o
  `.env.example` carrega só nomes de chave. [#37][#40]
- **Nunca reescrever história pública.** `git push --force` em branch compartilhada
  é proibido — o commit inicial já está no GitHub. [#38]
- **Push só com decisão explícita.** Nenhuma automação empurra código para o remoto.
