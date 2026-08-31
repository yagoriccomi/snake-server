# Pendências

Tudo que **não pôde ser executado ou decidido** durante a construção do servidor, com
o motivo. Nada aqui foi esquecido — cada item está registrado porque depende de um
acesso, de uma informação ou de uma decisão que estão fora do meu alcance.

**Atualizado em:** 2026-08-21
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

**Este é o item mais importante do documento.**

O comprovante PIX é dado pessoal de natureza financeira. Hoje o sistema o cria e o
disponibiliza, mas **não existe caminho para apagá-lo**, prazo de retenção definido nem
finalidade documentada.

| Dispositivo | Obrigação | Estado |
| --- | --- | --- |
| Art. 18, VI | Eliminação a pedido do titular | ❌ |
| Art. 15/16 | Eliminação após o fim do tratamento | ❌ |
| Art. 18, V | Portabilidade | ❌ |
| Art. 6º, I e III | Finalidade e necessidade declaradas | ❌ |

Agrava: o `public_id` é determinístico (`comprovantes/<userId>/<paymentId>`), então o
arquivo sobrevive na Cloudinary mesmo depois de o aluno ser excluído do sistema.

**Por que não fiz:** implementar a rota `DELETE /v1/proofs/:paymentId` é **escopo novo**
— vai além de "construir este servidor em Docker". Precisa da sua autorização, e as
decisões de prazo e base legal são de negócio, não técnicas.

**O que precisa ser decidido:**
1. Qual o prazo de retenção? (a legislação fiscal costuma orientar comprovantes de pagamento)
2. Excluir a conta do aluno deve apagar os comprovantes dele?
3. Qual a base legal declarada? (provavelmente execução de contrato, art. 7º, V)

**Diga a palavra e eu implemento** a rota de exclusão, o job de retenção e a
documentação da base legal.

**Referência:** achado C-1 do [`../REVIEW.md`](../REVIEW.md).

---

### P-12. URL de visualização com expiração

**Situação:** hoje a URL assinada do comprovante **não expira**. O asset é privado
(`type=authenticated`), então quem não tem a URL não acessa — mas quem obtiver a URL
(print, histórico de navegador, log de proxy) tem acesso **vitalício**.

O `docs/BACKEND.md §6` trata isso como "opcional". Para PII financeira, recomendo
reclassificar como requisito.

**Por que não fiz:** exige ativar o recurso *Auth Token* na Cloudinary, que precisa de
uma *secure delivery key* própria — configuração na conta, que não tenho.

**O que fazer:** ativar o recurso na Cloudinary e me avisar; a mudança no código é
pequena.

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

### P-18. Liberar a entrega de PDF na conta da Cloudinary

**Situação:** o app aceita comprovante em PDF (`PagamentoScreen` tem "Enviar PDF").
O código está correto para isso e há teste travando o comportamento: a Cloudinary
armazena PDF sob `resource_type: image`, que é exatamente o que
`gerarUrlDeVisualizacao` usa e onde o upload com `auto` cai.

**O que o teste NÃO alcança:** por padrão, contas da Cloudinary vêm com a entrega
de PDF e ZIP **desabilitada** — uma trava de segurança da própria plataforma. Com
ela desligada, a URL assinada de um comprovante em PDF responde **401**, mesmo
estando tudo certo no código.

**Por que não fiz:** é configuração de conta, e não tenho acesso ao painel.

**O que fazer:** Cloudinary → Settings → Security → habilitar *Allow delivery of
PDF and ZIP files*. Depois, subir um comprovante em PDF e abri-lo pela tela do
admin — é o único teste que prova este ponto de ponta a ponta.

**Alternativa, se preferir não habilitar:** restringir o envio a imagem no app
(remover o botão "Enviar PDF"), o que muda o produto e precisa da sua decisão.

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
