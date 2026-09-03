# Pendências

Tudo que **não pôde ser executado ou decidido** durante a construção do servidor, com
o motivo. Nada aqui foi esquecido — cada item está registrado porque depende de um
acesso, de uma informação ou de uma decisão que estão fora do meu alcance.

**Atualizado em:** 2026-08-31

> **Guia operacional:** os itens que dependem de você (P-1, P-2, P-4, P-5, P-6,
> P-7, P-18) estão consolidados, na ordem de execução, em
> [`DEPLOY.md`](DEPLOY.md). Este documento continua sendo o registro do porquê
> de cada pendência; aquele é o passo a passo.
**Estado do projeto:** branch `feature/servidor-docker` · 193 testes passando ·
cobertura 95,16% · imagem Docker validada · `npm audit` limpo.

---

## 🔴 Bloqueadores — o servidor não funciona de verdade sem isto

### P-1. Preencher o `.env` com credenciais reais

**Situação:** o `.env` existe, mas está com **valores fictícios** que criei apenas para
demonstrar que o servidor sobe. Com eles, `/health` responde, mas `/v1/proofs/*` não
funcionam — não há Supabase nem Cloudinary reais atrás.

**Por que não fiz:** não tenho acesso à sua conta do Supabase nem à da Cloudinary.
Inventar credenciais que "parecem certas" seria pior do que deixar em branco, porque
falharia só na hora do uso.

**O que fazer:** abra o `.env` (há um aviso no topo dele) e substitua os quatro valores
marcados com `<<<`:

| Variável | Onde obter |
| --- | --- |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary → Dashboard → Cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary → Dashboard → API Key |
| `CLOUDINARY_API_SECRET` | Cloudinary → Dashboard → API Secret |

Depois: `scripts\dev.bat restart` (Windows) ou `./scripts/dev.sh restart`.

---

### P-2. Rotacionar a `CLOUDINARY_API_SECRET` se ela já circulou no aplicativo

**Situação:** o `docs/BACKEND.md §12` pede isto explicitamente, e é o **único item deste
documento que pode já estar comprometido hoje**.

Se essa chave um dia esteve dentro do app Expo — como `EXPO_PUBLIC_*` ou embutida de
qualquer outra forma —, considere-a **pública**. Um APK publicado é um arquivo que
qualquer pessoa baixa e abre.

**Por que não fiz:** não tenho como saber o que já foi publicado no app, e não tenho
acesso ao painel da Cloudinary.

**O que fazer:** Cloudinary → Settings → Access Keys → gerar uma nova chave, atualizar
no `.env` local e no painel da Render, e **revogar a antiga**. Se nunca esteve no app,
apenas confirme e risque este item.

---

### P-3. Confirmar se o repositório do GitHub é público ou privado

**Situação:** o projeto é **GPL-3.0** (sua decisão). Se o repositório for público,
qualquer pessoa que já o tenha clonado recebeu uma licença **irrevogável** sobre
aquela versão — trocar a licença no futuro não retroage sobre as cópias existentes.

**Por que não fiz:** a visibilidade só é verificável no GitHub, e eu não tenho acesso.

**O que fazer:** confirmar em `github.com/yagoriccomi/snake-server` → Settings. Se a
intenção é software livre, está tudo certo — apenas registre a confirmação. Se em
algum momento você quiser fechar o código, saiba que isso só vale daí para frente.

---

## 🟠 Configuração externa — o deploy não acontece sem isto

### P-4. Cadastrar os segredos e variáveis no GitHub

**Por que não fiz:** exige acesso ao painel do repositório.

**Settings → Secrets and variables → Actions → aba _Secrets_:**

| Nome | O que é | Onde obter |
| --- | --- | --- |
| `RENDER_DEPLOY_HOOK_URL` | URL secreta que dispara a publicação | Render → serviço → Settings → Deploy Hook |

**Aba _Variables_:**

| Nome | O que é | Exemplo |
| --- | --- | --- |
| `RENDER_SERVICE_URL` | Endereço público, usado no health check pós-deploy | `https://snakethai-api.onrender.com` |

Sem o secret, o job de deploy falha com uma mensagem explícita — de propósito, para
não publicar silenciosamente sem gate.

---

### P-5. Criar o ambiente `producao` no GitHub

**Situação:** o workflow referencia `environment: producao`. Ele funciona sem o
ambiente existir, mas criá-lo permite **exigir aprovação manual** antes de publicar e
restringe quem enxerga o secret de deploy.

**O que fazer:** Settings → Environments → New environment → `producao` → marcar
*Required reviewers*.

---

### P-6. Cadastrar as variáveis de ambiente no painel da Render

**Por que não fiz:** exige acesso à sua conta da Render.

**O que fazer:** Render → serviço → Environment → cadastrar as mesmas variáveis do
`.env`, marcando `CLOUDINARY_API_SECRET` como **secret**.

⚠️ **Não cadastre** `SUPABASE_JWT_SECRET` (o servidor se recusa a iniciar se ela
existir) nem `SUPABASE_SERVICE_ROLE_KEY` (ignora a RLS por completo).

---

### P-7. Apontar o aplicativo para a API publicada

Depois do primeiro deploy, copiar a URL gerada (`https://….onrender.com`) para a
variável `EXPO_PUBLIC_API_URL` do app.

**Fora deste repositório** — é trabalho no projeto do aplicativo.

---

## 🟡 Informações que faltam e afetam o código

### ~~P-8. Confirmar o formato real gravado em `payments.proof_url`~~ ✅ RESOLVIDA em 2026-08-31

**Situação:** o nome da coluna diz "url", mas a especificação a usa como `public_id`.
Sem acesso ao schema real, `extrairPublicId` (`src/modules/proofs/proofs.cloudinary.ts`)
aceita **os dois formatos**, por segurança: passar uma URL completa para
`cloudinary.url()` produziria um link quebrado **em silêncio**, com dado financeiro.

**Por que não decidi:** é uma pergunta sobre o schema do app, não sobre este código.

**Resolvido:** o formato real era um TERCEIRO, que nenhuma das duas hipóteses
previa — um path do Supabase Storage (`<user_id>/<payment_id>_<arquivo>`). A
migration `20260831120000_proofs_cloudinary_contract` deu à coluna um contrato
único e o faz valer por constraint; `extrairPublicId` encolheu para
`valorGravado.trim()` e os testes de parsing de URL saíram junto.

**Referência:** achado M-2 do [`../REVIEW.md`](../REVIEW.md).

---

### P-9. Confirmar como o papel de "administrador" é modelado no Supabase

**Situação:** a especificação prevê o administrador vendo comprovante alheio, mas não
diz **como** esse papel é reconhecido. O `role` do Supabase Auth é `authenticated` para
todo mundo — o papel real deve viver numa tabela de perfis ou num claim próprio.

Por isso a segunda barreira virou configuração (`POLITICA_ACESSO_COMPROVANTE`), em vez
de uma checagem chutada que seria decorativa ou quebraria o admin de verdade.

**O que fazer:** se **não houver** administrador visualizando comprovante de aluno,
troque para `POLITICA_ACESSO_COMPROVANTE=somente-dono` — é a postura mais segura. Se
houver, me diga como o papel é identificado e eu implemento a checagem de verdade.

**Referência:** achado A-1 do [`../REVIEW.md`](../REVIEW.md), seção 4 de
[`ARQUITETURA.md`](ARQUITETURA.md).

---

### P-10. Verificar se as políticas de RLS existem e estão corretas

**Situação:** toda a autorização do `/v1/proofs/view-url` depende de políticas de Row
Level Security na tabela `payments` — que vivem no Supabase, fora deste repositório.
**Não pude auditá-las.**

Há uma segunda barreira no servidor que alarma se a RLS liberar dado alheio (P-9), mas
ela é rede de segurança, não substituta.

**O que fazer:** confirmar no Supabase que a tabela `payments` tem
`ENABLE ROW LEVEL SECURITY` e políticas de `SELECT` que liberem apenas para o dono
(e para administrador, se houver).

---

## 🔵 Decisões de produto que ainda não foram tomadas

### P-11. Ciclo de vida do comprovante — obrigação da LGPD

**Situação em 2026-09-02 — PARCIALMENTE RESOLVIDA.**

| Dispositivo | Obrigação | Estado |
| --- | --- | --- |
| Art. 18, VI | Eliminação a pedido do titular | ✅ `eliminar_comprovantes_do_titular` (migration do contrato) |
| Art. 15/16 | Eliminação após o fim do tratamento | ✅ **worker consumidor** (`src/jobs/media-cleanup/`) |
| Art. 15, I (prazo) | Retenção por tempo definido | ❌ **falta o número de dias — decisão sua** |
| Art. 18, V | Portabilidade | ❌ não iniciado |
| Art. 6º, I e III | Finalidade e necessidade declaradas | ❌ não iniciado |

**O que existe agora:** `media_deletion_queue` é alimentada automaticamente (gatilho do
banco + a função de exclusão de conta), e um **Cron Job novo**
(`snakethai-media-cleanup` no `render.yaml`) a consome diariamente às 3h — apaga o
arquivo de verdade na Cloudinary ou no Storage e marca o item como processado.
Testado contra a Cloudinary real: exclusão confirmada na API administrativa
(fonte da verdade, não no cache do CDN), e idempotente — reprocessar um item já
apagado não lança erro. **217 testes** cobrindo a lógica do worker.

⚠️ **Custo:** Cron Jobs na Render não têm plano gratuito. O `render.yaml` já usa o
mais barato (`starter`) — confirme o valor no painel antes do primeiro deploy.

**O que ainda falta, e é decisão sua, não técnica:**

1. **Prazo de retenção em dias.** Sem esse número, o worker consome só o que já foi
   enfileirado por outro motivo (conta excluída, comprovante recusado) — ele **não**
   varre pagamentos antigos por tempo. O motivo `retencao_expirada` existe no banco e
   não é usado por ninguém ainda. Me diga o prazo e eu implemento a varredura.
2. Base legal declarada (provavelmente execução de contrato, art. 7º, V) — falta
   documentar.
3. Portabilidade (art. 18, V) — escopo novo, não iniciado.

**Referência:** achado C-1 do [`../REVIEW.md`](../REVIEW.md).

---

### ~~P-12. URL de visualização com expiração~~ ✅ CÓDIGO PRONTO, bloqueado por plano da conta em 2026-09-03

**Situação original:** a URL assinada do comprovante **não expirava**. O asset é
privado (`type=authenticated`), então quem não tem a URL não acessa — mas quem
obtiver a URL (print, histórico de navegador, log de proxy) tinha acesso **vitalício**.

**Resolvido do lado do código.** `gerarUrlDeVisualizacao` agora expira a URL em 10 min
quando a variável `CLOUDINARY_AUTH_TOKEN_KEY` está presente — mesmo prazo que o
Supabase Storage já usava. Sem ela, a URL continua exatamente como hoje (sem prazo);
nada quebra em produção até o passo abaixo ser feito.

**Testado contra a conta real (verificado, não presumido):** uma chave inventada é
rejeitada pela Cloudinary com 401 — o mesmo que não mandar token nenhum.

**Correção em 2026-09-03: a chave NÃO é self-service no console.** Confirmado na
[documentação oficial](https://cloudinary.com/documentation/control_access_to_media):
- É recurso do **plano Advanced ou superior** — não aparece em nenhuma tela do painel
  em planos abaixo disso (é por isso que "Strict Transformations" é a única coisa
  visível perto de Security, e ela é um recurso diferente, não relacionado).
- A chave **não é gerada por você**: é preciso [abrir um chamado com o suporte da
  Cloudinary](https://support.cloudinary.com/hc/en-us/requests/new), informar o
  `cloud_name` e pedir para habilitarem "token-based access" — eles enviam a chave
  (uma string hexadecimal, diferente da `api_secret`).

**O que fazer:**
1. Confirmar o plano da conta (Cloudinary → Settings → Billing). Se for Advanced ou
   superior, abrir o chamado de suporte pedindo a chave.
2. Se o plano não incluir esse recurso, a URL permanece sem expiração até um upgrade
   de plano — decisão sua, de custo/benefício.
3. Quando a chave chegar, cadastre-a como `CLOUDINARY_AUTH_TOKEN_KEY` no `.env` local e no
   painel da Render.
3. Reinicie o servidor. Nenhuma mudança de código é necessária a partir daqui — a URL
   passa a expirar automaticamente.

---

### P-13. `GPL-3.0-only` vs `GPL-3.0-or-later`

Adotei **`only`** — mais conservador e fiel ao pedido literal ("GPL-3.0"). O
`or-later` concederia automaticamente os termos de uma futura GPLv4.

**O que fazer:** se preferir `or-later`, é trocar o identificador no `package.json`.
Sem urgência.

---

### P-14. Cabeçalho de licença nos arquivos-fonte

A FSF recomenda um bloco de licença no topo de cada arquivo. Não adicionei para não
poluir 25 arquivos sem pedido explícito — o `LICENSE` na raiz já cobre a obra como um
todo. O cabeçalho ajuda quando um arquivo circula isolado.

**Diga se quer** e eu adiciono em todos.

---

## ⚪ Dívidas técnicas — sem urgência, registradas para não sumirem

### ~~P-15. `proofs.repository.ts` sem teste próprio~~ ✅ RESOLVIDA em 2026-08-31

Cobertura de 14%. Os testes usam um dublê que imita o comportamento, então a montagem
real do filtro (`{ id: 'eq.<uuid>' }`) e o `linhas[0] ?? null` nunca rodam de verdade.
Um erro de digitação no nome da coluna passaria despercebido.

**Resolvido:** `tests/unit/proofs.repository.test.ts` — 8 casos com um
`ClienteSupabase` falso que registra os argumentos, fazendo o código real do
repositório rodar. Cobertura do arquivo: **14% → 100%**. Inclui o caso de um
`paymentId` malicioso que tentaria escapar do parâmetro e reescrever a consulta.

**Referência:** achado M-3 do [`../REVIEW.md`](../REVIEW.md).

---

### P-16. Rate limit em memória

Zera a cada hibernação da Render e não escala horizontalmente. Aceitável hoje (uma
instância, todo endpoint exige token válido), mas vira problema ao sair do plano free
ou escalar. **Migrar para um store compartilhado (Redis)** nesse momento.

**Referência:** achado M-1 do [`../REVIEW.md`](../REVIEW.md).

---

### P-17. Arquivo `NOTICE` para o caso de distribuição

As licenças permissivas das 384 dependências exigem que o aviso de copyright acompanhe
**redistribuições**. Como hoje é um serviço hospedado — não se distribui código nem
binário —, a obrigação **não dispara**.

Se um dia houver imagem Docker pública, instalação on-premise ou pacote npm, será
preciso montar um `NOTICE`. O custo cresce com o número de dependências.

**Referência:** [`../LICENSE_AUDIT.md`](../LICENSE_AUDIT.md).

---


---

### ~~P-18. Liberar a entrega de PDF na conta da Cloudinary~~ ✅ RESOLVIDA em 2026-09-01 (sem precisar do painel)

**Situação original:** por padrão, contas da Cloudinary vêm com a entrega de PDF e
ZIP **desabilitada**. Confirmado na prática: PDF cru pela URL assinada respondia
**401**, mesmo com o upload e o `resource_type` corretos.

**Como foi resolvido:** em vez de pedir para você habilitar o recurso na conta, o
servidor passou a **converter o comprovante para JPG na entrega**
(`FORMATO_ENTREGA` em `proofs.constants.ts`) — o arquivo original continua guardado
como veio (PDF, PNG, HEIC), e é a URL de saída que sai como imagem. Isso contorna a
trava da conta por completo: a restrição é sobre entregar o **arquivo bruto** em
PDF, não sobre a Cloudinary renderizar uma página dele como imagem.

**Reconfirmado**: PDF sobe normalmente e a URL convertida responde 200 — sem
nenhuma mudança de configuração na conta. Documentado em `docs/BACKEND.md §6.1` e
coberto por teste (`deveEntregarEmJpgParaContornarATravaDePdfDaConta`).

Nenhuma ação sua é necessária para este item.

---

## 🧪 O que não pude verificar de verdade

Honestidade sobre os limites do que foi testado. **Não verificado ≠ quebrado**, mas
também **≠ garantido**:

| Item | Como foi verificado | O que falta |
| --- | --- | --- |
| Esteira de CI | Cada comando rodado **localmente**, e os gates testados bloqueando de propósito | Nunca executou num runner do GitHub |
| CodeQL | Sintaxe do workflow validada | Depende do GitHub para rodar |
| Deploy hook da Render | Lógica escrita e validada | Nunca disparado — falta o secret |
| Build no runner | Imagem construída e validada **localmente** | Não construída no ambiente do GitHub |
| Rotas `/v1` de ponta a ponta | Testadas com dublês e no smoke test | Nunca com Supabase e Cloudinary reais |

**A primeira execução da esteira (após o push) é o teste real dela.** Se algo falhar
lá, é esperado e corrigível — avise que eu ajusto.

---

## Resumo do que fazer primeiro

1. **P-2** — rotacionar a chave da Cloudinary, se ela já circulou. É o único item que
   pode já estar comprometido.
2. **P-1** — preencher o `.env` e ver o servidor funcionando de verdade.
3. **P-4** e **P-6** — cadastrar secrets no GitHub e variáveis na Render.
4. **P-10** — confirmar que a RLS existe e está correta. A segurança do `/view-url`
   depende disso.
5. **P-11** — decidir sobre o ciclo de vida do comprovante antes de receber dados de
   alunos reais.
