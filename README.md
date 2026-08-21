# snakethai-api

![Node](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-5.7-3178C6?logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/express-5-000000?logo=express&logoColor=white)
![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-GPL--3.0-green)

API própria do **Snake Thai** — o servidor que guarda o que o aplicativo não pode
guardar.

Um app Expo publicado é um arquivo que qualquer pessoa consegue abrir: toda chave
embutida nele pode ser extraída. Então tudo que exige um segredo de verdade —
assinar um upload na Cloudinary, falar com um gateway, disparar um push — precisa
acontecer em algum lugar fora do celular. Este servidor é esse lugar.

Ele convive com o Supabase em vez de substituí-lo: o app continua lendo e gravando
dados direto no Supabase (rápido, protegido por RLS, sem hibernação), e só recorre
a esta API quando há um segredo, um terceiro ou uma lógica de servidor envolvida.

## ✨ Features

* **Assinatura de upload de comprovantes** — o app envia o arquivo direto para a
  Cloudinary com uma assinatura gerada aqui; o arquivo nunca passa pelo servidor.
* **Comprovantes privados** — todo comprovante sobe como asset autenticado e só é
  visível por URL assinada, emitida para o dono do pagamento ou um administrador.
* **Autenticação delegada ao Supabase** — o servidor confirma quem é o chamador
  com o próprio Supabase e nunca guarda o segredo capaz de forjar um token.
* **Autorização pela RLS** — as regras de acesso que já existem no banco continuam
  valendo; o servidor repassa o token do usuário e obedece à resposta.
* **Pronto para crescer** — rotas versionadas em `/v1` e estrutura modular:
  um módulo novo (push, relatórios, webhooks) entra sem tocar nos existentes.
* **Docker de ponta a ponta** — a mesma imagem roda na sua máquina e em produção.

## 🛠️ Tecnologias Utilizadas

* **Node.js 22** + **TypeScript** (modo estrito)
* **Express 5** — rotas, middlewares e tratamento central de erros
* **Zod** — validação de tudo que chega do cliente
* **Supabase** — identidade dos usuários e acesso a dados com RLS
* **Cloudinary** — armazenamento privado dos comprovantes
* **Docker** e **Docker Compose** — ambiente local e imagem de produção
* **ESLint**, **Prettier** e **Vitest** — qualidade e testes

## 🚀 Como Rodar o Projeto Localmente

### Pré-requisitos

* [Docker Desktop](https://www.docker.com/products/docker-desktop/) (inclui o Docker Compose) — **caminho recomendado**
* [Node.js 22+](https://nodejs.org/) — só se você preferir rodar sem contêiner
* Um projeto no [Supabase](https://supabase.com/) e uma conta na [Cloudinary](https://cloudinary.com/)

### Passo a passo (com Docker)

1. Clone o repositório:

   ```bash
   git clone <url-do-repositorio>
   cd snake-server
   ```

2. Crie o seu arquivo de configuração a partir do exemplo:

   ```bash
   # Windows
   copy .env.example .env

   # Linux/Mac
   cp .env.example .env
   ```

3. Abra o `.env` e preencha as credenciais (veja [Variáveis de Ambiente](#-variáveis-de-ambiente)).
   O `.env` está no `.gitignore` e nunca deve ser enviado ao repositório.

4. Suba o ambiente com um comando:

   ```bash
   # Windows
   scripts\dev.bat start

   # Linux/Mac
   chmod +x scripts/dev.sh   # só na primeira vez
   ./scripts/dev.sh start
   ```

5. Confirme que está no ar:

   ```bash
   curl http://localhost:3000/health
   # {"ok":true}
   ```

O código é recarregado sozinho ao salvar um arquivo em `src/`.

| Comando | O que faz |
| --- | --- |
| `start` | Sobe a API em modo desenvolvimento, com recarregamento automático |
| `stop` | Derruba os contêineres |
| `restart` | Derruba e sobe de novo |
| `status` | Mostra os contêineres e a saúde deles |
| `logs` | Acompanha os logs da API em tempo real |
| `shell` | Abre um terminal dentro do contêiner |
| `prod` | Sobe **a imagem de produção** localmente, igual à que roda na nuvem |
| `prod-stop` | Derruba a imagem de produção local |

> Use `prod` sempre que quiser reproduzir um problema que só aparece publicado:
> ela roda o mesmo build enxuto, sem TypeScript e sem ferramentas de desenvolvimento.

### Alternativa: rodar sem Docker

```bash
npm install
cp .env.example .env    # e preencha
npm run dev
```

### Comandos de desenvolvimento

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Sobe o servidor com recarregamento automático |
| `npm run build` | Compila o TypeScript para `dist/` |
| `npm start` | Roda o código já compilado |
| `npm run typecheck` | Verifica os tipos sem gerar arquivos |
| `npm run lint` | Analisa o código em busca de problemas |
| `npm run format` | Formata o código |
| `npm test` | Roda os testes automatizados |

## 📝 Variáveis de Ambiente

Copie o `.env.example` e preencha. Nenhuma delas deve ser enviada ao repositório.

| Variável | Para que serve | Obrigatória |
| --- | --- | --- |
| `PORT` | Porta do servidor. Em produção a Render define sozinha. | Não (padrão `3000`) |
| `NODE_ENV` | `development`, `test` ou `production`. | Não (padrão `development`) |
| `LOG_LEVEL` | Detalhamento dos logs: `debug`, `info`, `warn` ou `error`. | Não (padrão `info`) |
| `ALLOWED_ORIGIN` | Endereços de sites autorizados a chamar a API, separados por vírgula. O app de celular não precisa disso; deixe vazio se não houver site. | Não |
| `SUPABASE_URL` | Endereço do seu projeto no Supabase. | **Sim** |
| `SUPABASE_ANON_KEY` | Chave pública do Supabase, usada para confirmar a identidade de quem chama. | **Sim** |
| `POLITICA_ACESSO_COMPROVANTE` | Segunda camada de proteção ao abrir um comprovante. Veja a explicação abaixo. | Não (padrão `rls`) |
| `CLOUDINARY_CLOUD_NAME` | Nome da sua conta na Cloudinary. | **Sim** |
| `CLOUDINARY_API_KEY` | Identificador da chave da Cloudinary. | **Sim** |
| `CLOUDINARY_API_SECRET` | Segredo da Cloudinary. **Nunca** coloque este valor no aplicativo. | **Sim** |

Se faltar alguma obrigatória, o servidor não sobe e diz exatamente qual está
faltando — em vez de falhar mais tarde, no meio de uma requisição de usuário.

### Sobre a `POLITICA_ACESSO_COMPROVANTE`

Quem decide se você pode ver um comprovante é o próprio banco de dados, pelas regras
de acesso do Supabase. Esta variável define o que o servidor faz caso o banco libere
um comprovante que **não** pertence a quem pediu:

| Valor | Comportamento |
| --- | --- |
| `rls` *(padrão)* | Permite, porque pode ser um administrador legítimo — mas registra um **alerta** no log. Se esse alerta aparecer sem que haja um administrador trabalhando, é sinal de que as regras de acesso do banco quebraram. |
| `somente-dono` | Recusa, sempre, qualquer comprovante que não seja do próprio dono. Mais rígido; use se nenhum administrador precisar abrir comprovante de aluno. |

> **Duas variáveis ficaram de fora de propósito.** `SUPABASE_JWT_SECRET` permitiria
> criar tokens de qualquer usuário, e o servidor se recusa a iniciar se ela estiver
> presente. `SUPABASE_SERVICE_ROLE_KEY` ignora todas as regras de acesso do banco;
> só deve entrar se um módulo específico exigir, e apenas dentro dele.

## 📡 Endpoints

Todas as rotas ficam sob `/v1` e exigem o cabeçalho
`Authorization: Bearer <token da sessão do Supabase>`, exceto `/health`.

### `GET /health`

Pública e instantânea. Serve para a hospedagem verificar se o servidor está vivo e
para o app "acordá-lo" antes de usar.

```json
{ "ok": true }
```

### `POST /v1/proofs/sign-upload`

Autoriza o envio de um comprovante. O destino é decidido pelo servidor a partir do
usuário do token — ninguém consegue enviar um arquivo para a pasta de outra pessoa.

**Envio:** `{ "paymentId": "<uuid>" }`

**Resposta:** os dados que o app usa para enviar o arquivo direto à Cloudinary
(`cloudName`, `apiKey`, `timestamp`, `signature`, `folder`, `public_id`, `type`,
`uploadUrl`).

### `POST /v1/proofs/view-url`

Devolve o endereço temporário para visualizar um comprovante. Quem pode ver é
decidido pelas regras de acesso do banco: o dono do pagamento ou um administrador.

**Envio:** `{ "paymentId": "<uuid>" }`

**Resposta:** `{ "url": "https://res.cloudinary.com/..." }`

### Formato dos erros

Toda falha responde no mesmo formato, com um identificador para rastrear o caso
nos logs:

```json
{ "error": "Sem acesso", "code": "forbidden", "traceId": "a7d91dcb-..." }
```

| Código HTTP | Quando acontece |
| --- | --- |
| `400` | Dados inválidos ou JSON malformado |
| `401` | Sem token, ou token expirado/inválido |
| `403` | Autenticado, mas sem direito ao comprovante |
| `404` | Rota inexistente |
| `413` | Corpo da requisição acima do limite |
| `429` | Requisições demais em pouco tempo |
| `503` | Supabase ou Cloudinary indisponíveis |

## ☁️ Publicando na Render

1. Crie um **New → Web Service** e conecte este repositório.
2. Escolha o ambiente **Docker** (o `render.yaml` já traz a configuração pronta).
3. Em **Environment**, cadastre as variáveis da tabela acima. Marque
   `CLOUDINARY_API_SECRET` como *secret*.
4. Confirme o **Health Check Path** como `/health`.
5. Publique e copie o endereço gerado (`https://….onrender.com`) para a variável
   `EXPO_PUBLIC_API_URL` do aplicativo.

> **Sobre a primeira chamada demorar.** No plano gratuito o serviço hiberna depois
> de cerca de 15 minutos parado, e a primeira requisição seguinte leva de 30 a 60
> segundos para acordá-lo. Isso vale só para as chamadas a esta API — o caminho do
> app direto ao Supabase continua instantâneo. O aplicativo contorna isso chamando
> `/health` assim que abre a tela e usando um tempo de espera generoso com uma
> mensagem honesta de carregamento.

## 🔄 Integração contínua e publicação

Toda alteração passa por uma esteira automática antes de chegar ao ar
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

| Etapa | O que verifica |
| --- | --- |
| **Qualidade** | Formatação, análise de código, tipos e a suíte de testes com cobertura |
| **Segurança** | Vulnerabilidades conhecidas, licenças das dependências e arquivos de segredo versionados por engano |
| **CodeQL** | Varredura estática em busca de padrões inseguros no código |
| **Imagem** | Constrói a imagem, **sobe um contêiner de verdade** e exige resposta do `/health` |
| **Publicação** | Só na branch `main`, e só depois que todas as anteriores passam |

> **Por que a publicação automática da Render está desligada.** Com ela ligada, cada
> envio ia direto para produção — inclusive código que não passou por nenhuma dessas
> verificações. Existiriam dois caminhos até o ar, e o mais rápido seria justamente o
> sem conferência. Agora existe um só, e ele passa pela esteira.

**Para reverter uma publicação:** painel da Render → o serviço → aba *Deploys* →
botão *Rollback* na versão anterior.

### 🔐 O que precisa ser cadastrado no GitHub

Nada disso pode ir para dentro de um arquivo do repositório.

**Settings → Secrets and variables → Actions → aba _Secrets_:**

| Nome | O que é | Onde obter |
| --- | --- | --- |
| `RENDER_DEPLOY_HOOK_URL` | Endereço secreto que dispara a publicação | Render → serviço → *Settings* → *Deploy Hook* → copiar a URL |

**Aba _Variables_** (não são segredos, ficam visíveis no log):

| Nome | O que é | Exemplo |
| --- | --- | --- |
| `RENDER_SERVICE_URL` | Endereço público do serviço, usado para conferir a saúde após publicar | `https://snakethai-api.onrender.com` |

**E no painel da Render** (*Environment*), as variáveis da tabela acima — marcando
`CLOUDINARY_API_SECRET` como *secret*.

> Recomendado: em **Settings → Environments**, criar o ambiente `producao` e exigir
> aprovação manual. A esteira já aponta para ele, então basta ativar a exigência.

## 📚 Documentação

* [`docs/BACKEND.md`](docs/BACKEND.md) — especificação completa: arquitetura,
  decisões de segurança e módulos previstos.
* [`CLAUDE.md`](CLAUDE.md) — regras técnicas e padrões para quem for desenvolver.

## 📄 Licença

**GNU General Public License v3** — veja [LICENSE](LICENSE).

Software livre: qualquer pessoa pode usar, estudar, modificar e redistribuir este
servidor. Quem distribuir uma versão modificada precisa disponibilizar o código-fonte
dela sob a mesma licença.

Isso vale para **este servidor**, e não para o aplicativo: o app conversa com a API por
HTTP, como dois programas independentes, e mantém o licenciamento próprio. A análise
completa está em [LICENSE_AUDIT.md](LICENSE_AUDIT.md).
