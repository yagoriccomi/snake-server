# Deploy — o que só você pode fazer

> Checklist operacional do primeiro deploy do `snakethai-api` na Render.
> Tudo aqui depende de acesso a painéis (GitHub, Render, Supabase, Cloudinary)
> que estão fora do alcance de quem escreveu o código. Nenhum valor real desta
> lista entra no Git — todos vivem em cofre de provedor. [#37][#80]

A esteira (`.github/workflows/ci.yml`) já está pronta e **falha de propósito**
com mensagem explícita se algo daqui faltar. Ela não publica em silêncio.

---

## Ordem recomendada

Faça na ordem. Cada passo depende do anterior.

### 1. Rotacionar a `CLOUDINARY_API_SECRET` — antes de tudo

**Só se ela já esteve dentro do app em algum momento.** Um APK publicado é um
arquivo que qualquer pessoa baixa e abre: se a chave já circulou ali, considere-a
pública, independentemente de estar num `EXPO_PUBLIC_*` ou não.

Cloudinary → Settings → Access Keys → gerar nova → **revogar a antiga**.

Se nunca esteve no app, pule e risque este item.

### 2. Criar o Web Service na Render

Render → **New → Web Service** → conectar `yagoriccomi/snake-server` → plano
**Free**.

O `render.yaml` já define o resto (runtime Docker, health check em `/health`,
`autoDeploy: false`). O `autoDeploy` está desligado **de propósito**: ligado, a
Render publicaria a cada push, inclusive de código que não passou pelos gates —
existiriam dois caminhos até produção, e o mais rápido seria justamente o sem
verificação.

### 3. Cadastrar as variáveis no painel da Render (P-6)

Render → o serviço → **Environment**:

| Variável | Marcar como secret? | Onde obter |
| --- | --- | --- |
| `SUPABASE_URL` | não | Supabase → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | não | Supabase → Project Settings → API → `anon` `public` |
| `CLOUDINARY_CLOUD_NAME` | não | Cloudinary → Dashboard → Cloud name |
| `CLOUDINARY_API_KEY` | sim | Cloudinary → Dashboard → API Key |
| `CLOUDINARY_API_SECRET` | **sim** | Cloudinary → Dashboard → API Secret |
| `ALLOWED_ORIGIN` | não | deixe vazio enquanto não houver cliente web |

⚠️ **Não cadastre** `SUPABASE_JWT_SECRET` — o servidor **se recusa a iniciar**
se ela existir, porque quem a tem pode forjar o token de qualquer usuário.
⚠️ **Não cadastre** `SUPABASE_SERVICE_ROLE_KEY` — ela ignora a RLS por completo.
Ela é usada **apenas** pelo script de migração, exportada na sua sessão de
terminal e em nenhum outro lugar.

### 4. Cadastrar o segredo e a variável no GitHub (P-4)

**Settings → Secrets and variables → Actions**

Aba **Secrets**:

| Nome | O que é | Onde obter |
| --- | --- | --- |
| `RENDER_DEPLOY_HOOK_URL` | URL secreta que dispara a publicação | Render → o serviço → Settings → Deploy Hook |

Aba **Variables**:

| Nome | O que é | Exemplo |
| --- | --- | --- |
| `RENDER_SERVICE_URL` | endereço público, usado no health check pós-deploy | `https://snakethai-api.onrender.com` |

Sem o secret, o job de deploy falha com mensagem explícita — de propósito, para
não publicar sem gate. Sem a variable, o deploy acontece mas a verificação de
saúde é **pulada com aviso**: você fica sem a confirmação de que o serviço subiu.

### 5. Criar o ambiente `producao` no GitHub (P-5)

**Settings → Environments → New environment → `producao`**

Marque **Required reviewers** e adicione você mesmo. Isso faz o deploy parar e
esperar aprovação humana antes de publicar, e restringe quem enxerga o secret.

O workflow funciona sem o ambiente existir — mas aí publica direto, sem a
parada.

### 6. Apontar o aplicativo para a API (P-7)

Depois do primeiro deploy, copie a URL gerada e coloque em `EXPO_PUBLIC_API_URL`
no `.env` do `snake-thai`. **É a única variável que o app precisa saber sobre a
infraestrutura** — `cloudName`, assinaturas e o resto vêm nas respostas.

Enquanto ela estiver vazia, o app continua enviando comprovante pelo Supabase
Storage, como sempre fez. Nada quebra.

### 7. Migrar os comprovantes que já existem

Com tudo no ar, na sua máquina:

```bash
# A service_role vive SÓ nesta sessão de terminal. Não vá para a Render,
# não vá para o .env, não vá para o Git.
export SUPABASE_URL="https://<projeto>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<a chave>"
export CLOUDINARY_CLOUD_NAME="<...>"
export CLOUDINARY_API_KEY="<...>"
export CLOUDINARY_API_SECRET="<...>"

# Simulação primeiro — não grava nada, só mostra o que faria.
npx tsx scripts/migrar-comprovantes.ts

# Só depois, para valer:
npx tsx scripts/migrar-comprovantes.ts --aplicar
```

O script é idempotente: reexecutar não duplica nada, porque só enxerga linhas
que ainda estão com `proof_provider = 'supabase_storage'`.

### 8. Liberar a entrega de PDF na Cloudinary (P-18)

Cloudinary → Settings → Security → **Allow delivery of PDF and ZIP files**.

Vem desligado por padrão. Com ele desligado, todo comprovante enviado em PDF
responde **401** — com o código inteiramente correto. É configuração de conta,
não de aplicação.

---

## Depois do deploy: o que confirmar

1. `GET https://<seu-serviço>.onrender.com/health` responde `{"ok":true}`.
2. Um aluno de teste envia um comprovante **em imagem** e o admin consegue abri-lo.
3. O mesmo, com um **PDF** — é o que prova o passo 8.
4. No Supabase, confirme que a tabela `payments` do projeto de produção realmente
   tem as políticas de RLS que estão versionadas em `supabase/migrations/`
   (pendência P-10). O que o repositório descreve e o que roda em produção podem
   ter divergido.

## O que ainda não existe

**O consumidor da fila de eliminação.** A tabela `media_deletion_queue` é
alimentada automaticamente quando um comprovante deixa de existir, mas nada a
processa ainda: os arquivos permanecem no provedor. A obrigação da LGPD de
eliminar (art. 15, I e art. 18, VI) só se cumpre quando esse worker rodar.

Isso é escopo novo e precisa da sua decisão — inclusive sobre o prazo de
retenção, que é uma escolha de negócio, não técnica.
