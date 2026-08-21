# 🔍 Relatório de Auditoria e Revisão de Código

**Projeto:** `snakethai-api` — API própria do Snake Thai
**Data:** 2026-08-21
**Escopo:** `src/`, `tests/`, infraestrutura (Docker, Render), confronto com `docs/BACKEND.md`
**Auditor:** Engenheiro Sênior + AppSec + Compliance LGPD

---

## 📊 Resumo Executivo

**Stack:** Node 22 · Express 5 · TypeScript estrito (ESM) · Zod · Supabase (Auth + PostgREST/RLS) ·
Cloudinary · Docker multi-stage · Vitest. Sem banco de dados próprio.

**Nível de risco geral: BAIXO no eixo técnico, ALTO no eixo legal (LGPD).**

A postura de segurança do código é sólida e, em vários pontos, acima da média:

- Nenhum segredo no repositório — varredura em **todo o histórico do Git** retornou zero ocorrências.
- `npm audit` (produção e desenvolvimento): **0 vulnerabilidades**.
- Injeção no PostgREST: **defendida e testada**. Os filtros vão por `URLSearchParams` e o `paymentId`
  é validado como UUID **antes** de qualquer ida à rede.
- Stack trace **não vaza** em nenhum caminho de erro — verificado em teste automatizado.
- Container roda como usuário `node`, não-root, com imagem de produção sem TypeScript nem devDependencies.
- O servidor **não guarda** `SUPABASE_JWT_SECRET` (e se recusa a subir se ela existir) nem
  `SUPABASE_SERVICE_ROLE_KEY`.

O problema real não está no código escrito, e sim no que **ainda não existe**: o ciclo de vida do
comprovante PIX. Um comprovante de pagamento é dado financeiro pessoal, e hoje ele é criado sem
qualquer previsão de eliminação, prazo de retenção ou atendimento ao direito do titular.

Há também uma **dependência de segurança não verificada**: a autorização do `/v1/proofs/view-url`
repousa inteiramente em políticas de RLS que vivem no Supabase — fora deste repositório. O servidor
lê o campo `user_id` do pagamento e **não o utiliza para nada**, desperdiçando uma checagem de
defesa em profundidade que custaria três linhas.

### Não auditado (sem acesso — não confundir com aprovado)

| Item | Por quê |
| --- | --- |
| Políticas de RLS reais no Supabase | Fora deste repositório. **A segurança do `/view-url` depende delas.** |
| Schema real da tabela `payments` | Fora deste repositório — afeta o achado M-2. |
| Se a `CLOUDINARY_API_SECRET` já circulou no APK | Só o time do app sabe. Ver Plano de Ação. |
| Configuração do painel da Render | Variáveis, plano e região são definidos lá. |
| Pipeline de CI/CD | `.github/workflows` **não existe** ainda (previsto para a próxima etapa). |

---

## 🚨 Risco Crítico (Segurança e LGPD)

### C-1. Ausência total de ciclo de vida do comprovante — direito de eliminação e retenção

**O problema:** o comprovante PIX é **dado pessoal de natureza financeira**. O sistema o cria
(`POST /v1/proofs/sign-upload`) e o disponibiliza (`POST /v1/proofs/view-url`), mas **não existe
nenhum caminho para apagá-lo**, nenhum prazo de retenção declarado e nenhuma finalidade documentada
que justifique guardá-lo indefinidamente.

Isso descumpre três obrigações distintas da Lei 13.709/2018:

| Dispositivo | Obrigação | Estado |
| --- | --- | --- |
| Art. 18, VI | Eliminação dos dados a pedido do titular | ❌ Não há rota nem processo |
| Art. 15/16 | Eliminação após o fim do tratamento | ❌ Sem prazo definido |
| Art. 18, V | Portabilidade dos dados | ❌ Não há |
| Art. 6º, I e III | Finalidade e necessidade declaradas | ❌ Não documentadas |

Agrava o quadro o fato de o `public_id` ser **determinístico** (`comprovantes/<userId>/<paymentId>`):
mesmo depois de o aluno ser excluído do sistema, o arquivo continua na Cloudinary, endereçável,
vinculado ao `userId` dele.

**Onde está:**
- `src/modules/proofs/proofs.routes.ts:41-61` — só existem `sign-upload` e `view-url`; não há `DELETE`.
- `src/modules/proofs/proofs.service.ts:52-70` — o serviço cria, nunca remove.
- `docs/BACKEND.md §6` — a especificação também não prevê exclusão.

**Prática quebrada:** [#63] (tratamento de PII).

**Como corrigir:**

1. **Curto prazo — rota de eliminação.** Acrescentar ao módulo:
   ```ts
   // DELETE /v1/proofs/:paymentId — autenticado, autorizado pela RLS
   // 1. Confirma pela RLS que o chamador é dono ou admin (mesma leitura do view-url).
   // 2. cloudinary.uploader.destroy(publicId, { type: 'authenticated', invalidate: true })
   // 3. Limpa `payments.proof_url` no Supabase, para não restar referência órfã.
   ```
2. **Médio prazo — retenção automática.** Definir e documentar o prazo (ex.: o exigido pela
   legislação fiscal para comprovante de pagamento) e criar um job que elimine o que passar dele.
   O módulo `jobs` já está previsto em `docs/BACKEND.md §7`.
3. **Documentar a base legal** (execução de contrato, art. 7º, V) e a finalidade em `docs/`, e
   garantir que a exclusão da conta do aluno dispare a eliminação dos comprovantes dele.

> **Nota de honestidade:** este achado é Crítico pela dimensão **legal**, não pela técnica. Nada aqui
> é explorável por um atacante — é uma obrigação regulatória não atendida. Ela precisa entrar no
> roadmap antes de o sistema receber comprovantes reais de alunos reais.

---

## 🐛 Risco Alto (Bugs e Arquitetura)

### A-1. `user_id` do pagamento é lido do banco e ignorado — defesa em profundidade ausente

**O problema:** a consulta pede explicitamente a coluna `user_id`
(`proofs.constants.ts:21` — `'user_id,proof_url'`), o tipo a declara
(`proofs.service.ts:35`), mas **nenhuma linha do código a compara com o usuário do token**.

Toda a autorização do `/view-url` depende de a RLS do Supabase estar corretamente configurada. Se
uma política for removida por engano, renomeada numa migration, ou se a tabela for recriada sem RLS
habilitada, **qualquer aluno autenticado passa a ver o comprovante de qualquer outro** — e o servidor
não tem como perceber.

Delegar a autorização à RLS é a decisão de arquitetura correta e está bem justificada. O problema é
não ter uma segunda barreira quando o dado necessário para ela **já está em mãos**.

**Onde está:** `src/modules/proofs/proofs.service.ts:72-84` (`obterUrlDeVisualizacao`).

**Práticas quebradas:** [#55] (menor privilégio / verificação de acesso), [#12] (campo lido sem uso).

**Como refatorar** — o serviço passa a receber o `userId` já verificado e confere:

```ts
async obterUrlDeVisualizacao(
  paymentId: string,
  userId: string,          // ← vem do token JÁ verificado
  authorization: string,
  ehAdmin: boolean,
): Promise<string> {
  const pagamento = await deps.pagamentos.buscarPorId(paymentId, authorization);
  if (!pagamento?.proof_url) throw semAcesso();

  // Segunda barreira: a RLS já deveria ter filtrado, mas se ela falhar,
  // esta checagem impede o vazamento. Nunca confie em uma trava só. [#55]
  if (!ehAdmin && pagamento.user_id !== userId) {
    logger.error('RLS devolveu pagamento de outro usuário — política pode estar quebrada', {
      traceId, payment_id: paymentId,
    });
    throw semAcesso();
  }
  ...
}
```

O `log.error` é parte da correção: se essa condição disparar, é sinal de que a RLS **está quebrada
em produção** — e você quer saber disso por alerta, não por incidente. Requer definir como o papel
de admin é reconhecido (o `role` já vem de `/auth/v1/user` em `supabase.ts:88`).

### A-2. Deploy automático para produção sem gate de testes

**O problema:** `render.yaml:24` define `autoDeploy: true`. Como **não existe pipeline de CI**
(`.github/workflows` ausente), qualquer push na branch conectada vai direto para produção — sem
rodar os 173 testes, sem lint, sem typecheck. O gate do Husky protege apenas quem commita local com
os hooks instalados; ele não protege o repositório remoto.

**Onde está:** `render.yaml:24`; ausência de `.github/workflows/`.

**Práticas quebradas:** [#49] (código que não passa não vira deploy), [#76], [#77].

**Como corrigir:** criar a esteira de CI (lint → typecheck → testes → build da imagem) e só então
manter o `autoDeploy`. Até o CI existir, considerar `autoDeploy: false` e promover manualmente.

---

## ⚠️ Risco Médio (Performance e Infraestrutura)

### M-1. Rate limiting em memória — zera a cada hibernação e não escala

**O problema:** `express-rate-limit` sem `store` configurado usa `MemoryStore`. Duas consequências
concretas no plano free da Render:

1. O serviço **hiberna após ~15 min** — e todo contador de rate limit some junto. Um atacante que
   respeite o intervalo de hibernação recupera a cota inteira.
2. Se um dia houver mais de uma instância, cada uma terá o próprio contador, multiplicando o limite
   efetivo pelo número de réplicas.

**Impacto:** a proteção contra força bruta é bem mais fraca do que aparenta. Não é crítico hoje
(uma instância, endpoints que exigem token válido), mas é uma falsa sensação de segurança.

**Onde está:** `src/app.ts:65-74`.

**Solução:** documentar a limitação agora e migrar para um store compartilhado (Redis) quando houver
mais de uma instância ou plano pago. [#27] (stateless), [#58].

### M-2. `extrairPublicId` opera sobre uma suposição não confirmada do schema

**O problema:** a função aceita tanto um `public_id` puro quanto uma URL completa, porque o nome da
coluna (`proof_url`) sugere URL enquanto a especificação a usa como `public_id`. **Não foi possível
confirmar qual formato o app realmente grava** — o schema está fora deste repositório.

Se o formato real for diferente dos dois previstos, o resultado é um link quebrado **em silêncio**,
com dado financeiro.

**Onde está:** `src/modules/proofs/proofs.cloudinary.ts:82-101`.

**Práticas:** [#4] (o comentário já registra a incerteza), [#8] (YAGNI — parte do código pode ser
especulação desnecessária).

**Solução:** confirmar o formato com o time do app. Se for sempre `public_id`, a função encolhe para
`return valorGravado.trim()` e os 4 testes de URL saem junto. Se for sempre URL, a outra metade sai.

### M-3. A implementação real do repositório não é exercitada por teste

**O problema:** `proofs.repository.ts` tem **14,28% de cobertura**. Os testes usam um dublê que
imita seu comportamento, então a montagem real do filtro (`{ id: 'eq.<uuid>' }`) e o `linhas[0] ?? null`
nunca rodam de verdade. Um erro de digitação no nome da coluna passaria despercebido.

**Onde está:** `src/modules/proofs/proofs.repository.ts:17-29`.

**Prática:** [#42] (teste de integração entre módulos).

**Solução:** um teste que monte o repositório com um `ClienteSupabase` falso e verifique o filtro e
as colunas pedidas — cinco linhas, fecha a lacuna.

### M-4. Imagem base por tag mutável e `npm ci` executando scripts de pacotes

**O problema:** dois pontos de exposição a supply chain:

1. `Dockerfile:9` usa `node:22.14-alpine` — uma **tag**, não um digest. A tag pode ser reapontada
   para outra imagem sem que o `Dockerfile` mude, tornando builds não reprodutíveis.
2. `Dockerfile:26` e `:52` rodam `npm ci` sem `--ignore-scripts`: qualquer dependência (ou
   dependência de dependência) executa código arbitrário durante o build.

**Impacto:** um pacote comprometido roda com acesso ao contexto de build. Como o `.dockerignore`
exclui o `.env`, o dano é limitado — mas não é zero.

**Onde está:** `Dockerfile:9,26,52`.

**Prática:** [#62] (auditoria de dependências).

**Solução:** fixar o digest (`FROM node:22.14-alpine@sha256:<digest>`) e avaliar
`npm ci --ignore-scripts` (validando antes que nenhuma dependência dependa de postinstall).

---

## 💡 Risco Baixo (Clean Code e Dívida Técnica)

### B-1. O `x-request-id` do cliente é aceito sem restrição de formato

**Verificado na prática:** duas requisições distintas conseguiram usar o mesmo
`X-Request-Id: id-forjado-por-atacante`, e ambas o ecoaram na resposta.

O único efeito é confundir a correlação de logs — não há injeção (o parser HTTP do Node rejeita
bytes de controle com 400, e o logger serializa via `JSON.stringify`). O limite de 64 caracteres é
respeitado corretamente.

**Onde está:** `src/middleware/request-context.ts:17-21`.

**Recomendação:** aceitar o id do cliente apenas se casar com `/^[\w-]{8,64}$/`, ou registrar os dois
ids (`traceId` gerado + `traceIdCliente` recebido) em campos separados.

### B-2. `/health` está fora do rate limit

**Verificado na prática:** 61 chamadas seguidas a `/health` retornaram 200 (enquanto `/v1` corta na
61ª com 429). É uma **decisão consciente e correta** — o health check da Render e o pré-aquecimento
do app não podem ser punidos. Fica o registro de que o endpoint é um vetor de flood sem limite,
mitigado pelo fato de não fazer I/O algum.

**Onde está:** `src/app.ts:56-58`.

### B-3. O logger não limita o tamanho de strings

Um campo de texto muito longo vai inteiro para o log. Há barreira de profundidade
(`PROFUNDIDADE_MAXIMA = 6`), mas não de comprimento.

**Onde está:** `src/lib/logger.ts:55-61`.

**Recomendação:** truncar strings acima de ~2 kB com sufixo `…[truncado]`.

### B-4. `composition-root.ts` e `server.ts` sem cobertura de teste

`composition-root.ts` tem 31% e `server.ts` está excluído do relatório. O shutdown por SIGTERM foi
validado **manualmente** no container (log confirmou `encerrando servidor` → `servidor encerrado`),
mas não há teste automatizado. São arquivos de montagem e bootstrap, de baixo risco.

---

## ✅ O que está correto (e não deve ser "melhorado")

Registro explícito para evitar refatoração desnecessária em revisões futuras:

| Item | Situação |
| --- | --- |
| Injeção no PostgREST | Filtros por `URLSearchParams` + UUID validado na borda. **Testado com 3 payloads de ataque.** |
| Segredos no Git | Zero, em todo o histórico. `.gitignore` cobre `.env`, chaves e artefatos. |
| `SUPABASE_JWT_SECRET` | O servidor **se recusa a iniciar** se ela existir (`env.ts:60-77`). Excelente. |
| Stack trace em erro | Nunca exposto. Coberto por teste em todos os ramos de `classificarErro`. |
| Mascaramento de PII | Aplicado **dentro** do logger — quem loga não pode esquecer. 49 testes. |
| Destino do upload | Derivado do `userId` do token, nunca do corpo. Travessia de caminho sem efeito. |
| `type=authenticated` | Comprovante sempre privado, conforme `docs/BACKEND.md §6`. |
| Validação antes da auth | Entrada malformada não custa ida à rede — 400 em vez de 503. |
| Container | Usuário `node`, `tini` no PID 1, sem TypeScript na imagem final, healthcheck ativo. |
| CORS | Lista vazia = nenhuma origem liberada. Verificado por teste. |
| Erro padronizado | `{ error, code, traceId }` em 100% dos caminhos. |
| Dependências | `npm audit`: 0 vulnerabilidades. |

### Conformidade com o checklist do `docs/BACKEND.md §12`

| Item do checklist | Estado |
| --- | --- |
| Segredos de terceiros só na Render | ✅ |
| Sem `service_role` e sem `JWT_secret` | ✅ (o segundo é bloqueado ativamente) |
| Rotas sob `/v1` com auth em tudo que não é `/health` | ✅ |
| Autorização pela RLS | ⚠️ Implementado, mas **sem segunda barreira** — ver A-1 |
| Comprovante `authenticated`, destino do `user.id` verificado | ✅ |
| Rate limiting e erro sem stack trace | ✅ (com a ressalva M-1) |
| `/health` sem I/O | ✅ |
| Rotacionar a `api_secret` se já vazou | ❓ **Pendente — só o time do app pode confirmar** |

**Divergência adicional:** `docs/BACKEND.md §6` trata a URL com expiração como "opcional". Do ponto
de vista de PII financeira, uma URL assinada permanente significa que, se ela vazar (print, histórico
de navegador, log de proxy), o acesso ao comprovante é vitalício. Recomenda-se reclassificar de
"plus" para **requisito**, usando o recurso *Auth Token* da Cloudinary.

---

## ✅ Plano de Ação Imediato

1. **Confirmar se a `CLOUDINARY_API_SECRET` já circulou no app** e, em caso afirmativo, **rotacioná-la
   antes do primeiro deploy**. É o único item que pode já estar comprometido hoje. (§12 do BACKEND.md)
2. **Implementar a segunda barreira de autorização** em `obterUrlDeVisualizacao` (A-1) — três linhas
   que transformam uma falha de configuração da RLS em um 403 com alerta, em vez de um vazamento.
3. **Criar a esteira de CI antes de manter `autoDeploy: true`** (A-2) — hoje um push envia código não
   testado para produção.
4. **Planejar o ciclo de vida do comprovante** (C-1): rota de eliminação, prazo de retenção e base
   legal documentada. Obrigatório antes de tratar dados de alunos reais.
5. **Confirmar o formato de `payments.proof_url`** com o time do app (M-2) e encolher
   `extrairPublicId` para o caso real.

---

## 📌 Observação sobre este relatório

Os achados abaixo foram **verificados executando a aplicação**, não inferidos por leitura:
prototype pollution via `__proto__` (negativo), header com byte de controle (rejeitado com 400),
limite de 64 caracteres do trace (respeitado), rate limit ativo em `/v1` (429 na 61ª requisição) e
ausente em `/health` (confirmado), e `npm audit` em produção e desenvolvimento.

Nenhum achado foi inflado para preencher seção: **não há vulnerabilidade explorável identificada**
neste código. O risco alto é regulatório (LGPD) e de dependência externa não verificada (RLS).
