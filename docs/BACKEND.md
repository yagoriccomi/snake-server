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

O primeiro módulo. Comprovante PIX é **dado financeiro (PII)**: upload como
`type=authenticated` (privado), visto só por URL assinada, gerada pelo servidor,
para o dono do pagamento ou um admin.

Env do módulo (na Render): `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
`CLOUDINARY_API_SECRET`.

### `POST /v1/proofs/sign-upload`
Autenticado. Body `{ "paymentId": "<uuid>" }`.
1. Valida o token → `user.id`.
2. Destino derivado do **id verificado**: `folder = comprovantes/<userId>`,
   `public_id = <paymentId>` (o aluno só sobe na própria pasta).
3. Assina com a `api_secret` (`type: 'authenticated'`).

Resposta: `{ cloudName, apiKey, timestamp, signature, folder, publicId, type, uploadUrl }`.
O app faz o `multipart` **direto para a Cloudinary** — o arquivo não passa pelo servidor.

### `POST /v1/proofs/view-url`
Autenticado (dono ou admin). Body `{ "paymentId": "<uuid>" }`.
1. Lê o pagamento com o **token do chamador**
   (`GET /rest/v1/payments?id=eq.<id>&select=user_id,proof_url`); a RLS libera só
   para dono ou admin. Vazio → `403`.
2. Assina a URL de visualização do asset autenticado.

Resposta: `{ "url": "https://res.cloudinary.com/.../authenticated/s--...--/..." }`.

> **(Opcional)** URLs com expiração exigem o recurso "Auth Token" da Cloudinary
> (uma *secure delivery key* própria). O baseline (URL assinada de asset
> autenticado) já protege; a expiração é um plus.

## 7. Módulos futuros prováveis (esboço — não implementar agora)

Registrados para o servidor já nascer com o lugar deles previsto:

| Módulo | Para quê | O que precisaria |
| --- | --- | --- |
| `notifications` | Push de vencimento/aprovação | Expo Push (token do device); sem segredo forte |
| `reports` | Relatório de inadimplência/faturamento em PDF/CSV | lê via RLS; gera no servidor |
| `webhooks` | Receber eventos de terceiros (ex.: confirmação de pagamento) | verificação de assinatura do provedor |
| `jobs` | Tarefas agendadas (lembretes, fechamento do mês) | cron do provedor; possível `service_role` isolado |
| `admin-ops` | Operações que exigem escrita fora da RLS | `service_role` **isolado** neste módulo |

## 8. Esqueleto modular (Node + Express)

Referência mínima — a estrutura que importa.

```js
// index.js — monta o app, o /v1 e o health
import express from 'express';
import rateLimit from 'express-rate-limit';
import { v1 } from './routes/index.js';

const app = express();
app.use(express.json({ limit: '32kb' }));      // JSON pequeno; arquivos não passam aqui
app.use(rateLimit({ windowMs: 60_000, max: 60 }));
app.get('/health', (_req, res) => res.json({ ok: true })); // trivial: acorda rápido
app.use('/v1', v1);                             // todos os módulos versionados
app.listen(process.env.PORT || 3000);
```

```js
// middleware/auth.js — valida o JWT do Supabase e injeta o usuário
export async function requireUser(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Não autenticado', code: 'no_token' });
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth },
  });
  if (!r.ok) return res.status(401).json({ error: 'Sessão inválida', code: 'bad_token' });
  req.user = await r.json();   // { id, ... }
  req.authHeader = auth;       // para repassar à RLS
  next();
}
```

```js
// routes/index.js — registra os módulos
import { Router } from 'express';
import { proofs } from './proofs.js';
export const v1 = Router();
v1.use('/proofs', proofs);
// v1.use('/notifications', notifications);  // futuro: um require a mais, nada além
```

```js
// routes/proofs.js — o módulo dos comprovantes
import { Router } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { requireUser } from '../middleware/auth.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const proofs = Router();

proofs.post('/sign-upload', requireUser, (req, res) => {
  const { paymentId } = req.body ?? {};
  if (!/^[0-9a-f-]{36}$/i.test(paymentId ?? '')) {
    return res.status(400).json({ error: 'paymentId inválido', code: 'bad_input' });
  }
  const folder = `comprovantes/${req.user.id}`;
  const timestamp = Math.round(Date.now() / 1000);
  const params = { folder, public_id: paymentId, timestamp, type: 'authenticated' };
  const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);
  res.json({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    ...params, signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload`,
  });
});

proofs.post('/view-url', requireUser, async (req, res) => {
  const { paymentId } = req.body ?? {};
  const r = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/payments?id=eq.${paymentId}&select=user_id,proof_url`,
    { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: req.authHeader } },
  );
  const row = (await r.json())?.[0];
  if (!row?.proof_url) return res.status(403).json({ error: 'Sem acesso', code: 'forbidden' });
  const url = cloudinary.url(row.proof_url, {
    type: 'authenticated', sign_url: true, secure: true, resource_type: 'image',
  });
  res.json({ url });
});
```

## 9. Variáveis de ambiente do servidor (na Render)

| Variável | Módulo | Segredo? |
| --- | --- | --- |
| `SUPABASE_URL` | base (auth/RLS) | não |
| `SUPABASE_ANON_KEY` | base | não |
| `PORT` | base (injetada pela Render) | não |
| `ALLOWED_ORIGIN` | base (CORS, se houver web) | não |
| `CLOUDINARY_CLOUD_NAME` | comprovantes | não |
| `CLOUDINARY_API_KEY` | comprovantes | sensível |
| `CLOUDINARY_API_SECRET` | comprovantes | **sim** |

> Ausentes de propósito: `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_JWT_SECRET`
> (ver §4). Cada módulo novo acrescenta só as suas variáveis.

## 10. Deploy na Render

1. Repositório do servidor (pasta `server/` neste repo ou repo separado).
   `package.json` com `"start": "node index.js"` (ou build TS → `dist`).
2. Render → **New → Web Service** → conecta o repo → plano **Free**.
3. **Environment:** cadastra as variáveis da §9 (sensíveis como *secret*).
4. **Health Check Path:** `/health`.
5. Deploy. Copia a URL (`https://….onrender.com`) para o `EXPO_PUBLIC_API_URL`
   do app.

`render.yaml` (opcional):
```yaml
services:
  - type: web
    name: snakethai-api
    runtime: node
    plan: free
    healthCheckPath: /health
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - { key: SUPABASE_URL, sync: false }
      - { key: SUPABASE_ANON_KEY, sync: false }
      - { key: CLOUDINARY_CLOUD_NAME, sync: false }
      - { key: CLOUDINARY_API_KEY, sync: false }
      - { key: CLOUDINARY_API_SECRET, sync: false }
```

## 11. Lado do app

- **Uma variável só:** `EXPO_PUBLIC_API_URL` aponta para o backend na Render. É
  tudo que o app precisa saber da infra — `cloudName`, assinaturas, etc. vêm nas
  respostas.
- **Um cliente HTTP central** (ex.: `src/lib/api.ts`) concentra: base URL, header
  `Authorization` com o JWT da sessão, timeout longo, 1 retry e o
  pré-aquecimento (`/health`). Cada feature chama seu endpoint por cima dele —
  ninguém fala com `fetch` cru espalhado.

## 12. Checklist de segurança

- [ ] Segredos de terceiros só na Render (nunca no app, nunca no git).
- [ ] Sem `service_role` e sem `JWT_secret` do Supabase por padrão; se um módulo
      exigir `service_role`, isolado e mínimo.
- [ ] Rotas sob `/v1`, com middleware de auth em tudo que não for `/health`.
- [ ] Autorização de dados pela **RLS** (token repassado), não pela palavra do app.
- [ ] Comprovante sempre `type=authenticated`; destino derivado do `user.id` verificado.
- [ ] Rate limiting nas rotas; erro padronizado sem stack trace.
- [ ] `/health` sem I/O, para o cold start acordar rápido.
- [ ] Se a `api_secret` já vazou em algum lugar, **rotacionar** antes de usar.
