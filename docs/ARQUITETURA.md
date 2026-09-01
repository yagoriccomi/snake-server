# Arquitetura — as decisões e o porquê delas

> Este documento existe para responder **"por que assim?"**. O código já mostra
> *o que* foi feito; aqui está o raciocínio que levou até ele — inclusive as
> alternativas descartadas e o motivo. Se você acabou de chegar ao projeto,
> comece por aqui. [#4]
>
> Documentos irmãos: [`../README.md`](../README.md) (como rodar),
> [`openapi.yaml`](openapi.yaml) (contrato da API),
> [`BACKEND.md`](BACKEND.md) (especificação original),
> [`../CLAUDE.md`](../CLAUDE.md) (regras para quem desenvolve).

---

## 1. O problema que este servidor resolve

O Snake Thai é uma escola de Muay Thai. Os alunos pagam a mensalidade por PIX e
enviam o comprovante pelo aplicativo.

Parece simples — até você notar que **enviar um arquivo para a Cloudinary exige uma
chave secreta**, e que um aplicativo publicado é um arquivo que qualquer pessoa
consegue baixar e abrir. Tudo que estiver embutido nele pode ser extraído: no Expo,
qualquer variável `EXPO_PUBLIC_*` está, na prática, publicada.

Se a chave da Cloudinary fosse para dentro do app, qualquer pessoa poderia enviar
qualquer arquivo para a conta da escola — ou apagar os comprovantes de todo mundo.

**Este servidor é o lugar onde os segredos moram.** Ele nasce com um módulo
(comprovantes) e foi desenhado para receber outros — push, relatórios, webhooks —
sem refazer a fundação. [#98]

---

## 2. Por que dois back-ends, e não um só

O app conversa com **dois** servidores. Essa é a primeira coisa que estranha quem
chega, então vale a explicação completa.

```
                    ┌──────────────────────────────────────────┐
   App (Expo)       │  SUPABASE — dados e identidade           │
   ───────────────► │  Postgres com RLS · Auth · Storage       │
     caminho do     │  Perfis, pagamentos, aulas, planos       │
     dia a dia      │  Sempre acordado. Resposta imediata.     │
                    └──────────────────────────────────────────┘
        │
        │  só quando precisa de segredo, terceiro
        │  ou lógica que não cabe no cliente
        ▼
                    ┌──────────────────────────────────────────┐
   App (Expo)       │  ESTE SERVIDOR (Render) — aplicação      │
   ───────────────► │  API própria em /v1 · guarda segredos    │
     chamadas       │  Comprovantes hoje; push, relatórios,    │
     pontuais       │  webhooks e tarefas agendadas depois     │
                    │  Plano free HIBERNA — ver seção 7        │
                    └──────────────────────────────────────────┘
```

**A alternativa descartada: rotear tudo por este servidor.**

Seria mais simples de explicar — um único ponto de entrada. Mas o plano gratuito da
Render hiberna após ~15 minutos sem tráfego, e a primeira chamada depois disso leva
de 30 a 60 segundos. Se toda leitura de dados passasse por aqui, **cada tela do app
começaria com meio minuto de espera**.

Então a divisão segue o critério do que dói:

- **Dados e login vão direto ao Supabase** — é o caminho percorrido dezenas de vezes
  por sessão. Precisa ser instantâneo, e é.
- **Este servidor entra só onde há segredo, terceiro ou lógica de servidor** — são
  chamadas pontuais, que toleram (e conseguem esconder) o cold start.

Se um dia o projeto sair do plano gratuito, dá para mover mais coisa para cá sem
retrabalho — a estrutura modular já permite. Mas mover antes de precisar seria pagar
o custo sem colher o benefício. [#8]

---

## 3. Identidade: por que o servidor não valida o token sozinho

Este servidor **não sabe** verificar a assinatura de um token do Supabase. Isso não é
uma limitação — é a decisão.

Validar localmente exigiria guardar aqui o `SUPABASE_JWT_SECRET`. E quem tem esse
segredo não apenas *verifica* tokens: **consegue fabricá-los**. Um vazamento do
servidor viraria a capacidade de se passar por qualquer aluno ou administrador.

Em vez disso, o servidor pergunta ao próprio Supabase quem é o portador do token:

```
GET {SUPABASE_URL}/auth/v1/user
  apikey:        <chave anônima — pública por natureza>
  Authorization: <o token que o app enviou, repassado sem alteração>
```

**O que se ganha:**

- O servidor **não pode forjar** o que não tem como assinar. [#55]
- Revogação funciona na hora: derrubar a sessão no Supabase invalida o token
  imediatamente, sem esperar a expiração.
- Uma peça a menos para manter em dia (rotação de chave, algoritmo, `alg:none`).

**O que se paga:** uma ida à rede por requisição autenticada, com ~10s de timeout.
Para chamadas pontuais como as nossas, é um preço barato.

> A configuração leva isso a sério: se `SUPABASE_JWT_SECRET` existir no ambiente, o
> **processo se recusa a iniciar** (`src/config/env.ts`). Falhar alto na largada é
> melhor do que descobrir depois que o segredo estava lá "só para um teste".

---

## 4. Autorização: a RLS decide, e há uma segunda barreira

### Por que não decidir aqui

As regras de quem pode ver o quê **já existem** no Supabase, como políticas de Row
Level Security. Reimplementá-las aqui criaria duas fontes de verdade que divergiriam
no primeiro ajuste feito só de um lado. [#20]

Então, quando o servidor precisa saber se você pode ver um pagamento, ele repassa o
**seu** token ao PostgREST e deixa a RLS filtrar:

```
GET {SUPABASE_URL}/rest/v1/payments?id=eq.<uuid>&select=user_id,proof_url
  Authorization: <token do chamador>
```

Lista vazia significa "a RLS não liberou" → `403`. O servidor não interpreta,
não reimplementa, não discute.

> **Detalhe que parece pequeno e não é:** o filtro é montado com `URLSearchParams`,
> nunca por concatenação de texto. Se fosse concatenado, um `paymentId` contendo `&`
> abriria um parâmetro novo na consulta e quem chamasse controlaria a query. Há teste
> automatizado provando que isso não passa. [#51][#52]

### A segunda barreira — e por que ela é configurável

A RLS é a trava principal. Mas ela mora em **outro sistema**, e este repositório não a
controla: uma migration distraída, uma política renomeada ou uma tabela recriada sem
`ENABLE ROW LEVEL SECURITY` bastam para este endpoint virar um vazamento silencioso de
dado financeiro.

A consulta acima já traz o `user_id` do dono. Ignorá-lo seria desperdiçar uma
conferência que custa uma linha. Então o servidor compara.

O problema é o que fazer quando **não bate**. Existem exatamente duas explicações, e o
servidor não consegue distingui-las sozinho:

1. quem chamou é um **administrador legítimo** — a especificação prevê isso; ou
2. uma política de RLS **quebrou** e está liberando dado alheio.

Quem sabe diferenciar é o schema do Supabase — que vive fora daqui. Chutar
`role === 'admin'` seria pior que não checar: o `role` do Supabase Auth é
`authenticated` para todo mundo, então a verificação ou nunca dispararia (decoração)
ou bloquearia o administrador de verdade.

A saída foi transformar isso em **decisão explícita de configuração**:

| `POLITICA_ACESSO_COMPROVANTE` | Comportamento |
| --- | --- |
| `rls` *(padrão)* | Permite — pode ser administrador — mas registra **alarme em nível `error`**. Preserva o comportamento previsto e dá visibilidade imediata se a RLS cair. |
| `somente-dono` | Nega qualquer comprovante que não seja do próprio dono, mesmo que a RLS tenha liberado. |

> **O alarme é a entrega desta política.** Se a linha `RLS liberou comprovante de
> outro usuário` aparecer nos registros sem que exista um administrador trabalhando
> naquele momento, **a RLS está quebrada em produção** — e você fica sabendo por
> alerta, não por incidente. [#55]

### Por que `403` e não `404`

Um comprovante que não existe e um comprovante que não é seu devolvem **exatamente a
mesma resposta**. Diferenciá-los entregaria a quem estivesse varrendo identificadores
uma forma de descobrir quais pagamentos existem. A ambiguidade é a proteção.

---

## 5. O caminho completo de um comprovante

```
┌─────────┐                                                    ┌──────────────┐
│   App   │                                                    │  Cloudinary  │
└────┬────┘                                                    └──────▲───────┘
     │                                                                │
     │ 1. POST /v1/proofs/sign-upload   { paymentId }                 │
     │    Authorization: Bearer <token>                               │
     ▼                                                                │
┌─────────────────────────────────────────────────────┐               │
│  ESTE SERVIDOR                                      │               │
│                                                     │               │
│  a) valida o corpo (Zod)      ← ANTES de autenticar │               │
│  b) confirma quem é você  ────────────► Supabase    │               │
│  c) monta o destino a partir do SEU id:             │               │
│         comprovantes/<userId>/<paymentId>           │               │
│  d) assina com a api_secret (que nunca sai daqui)   │               │
└──────────────────────┬──────────────────────────────┘               │
                       │ 2. { signature, folder, public_id, ... }     │
                       ▼                                              │
                  ┌─────────┐                                         │
                  │   App   │ 3. envia o ARQUIVO direto ───────────────┘
                  └─────────┘    (não passa por este servidor)
```

**Três decisões escondidas nesse desenho:**

**O arquivo nunca passa por aqui.** O servidor assina; o app envia. Um serviço que
recebesse arquivos precisaria de memória, disco e limite de upload — e no plano free
seria o primeiro a cair. Aqui o corpo aceito é de **32 kB**, o que basta para um JSON
e nada mais.

**O destino vem do token, nunca do corpo.** Se o app pudesse escolher a pasta, bastaria
trocar um campo para assinar um envio dentro da pasta de outro aluno. Mandar
`folder` na requisição não tem efeito algum — há teste garantindo isso.

**A validação vem antes da autenticação.** Parece invertido, mas é proposital: um
`paymentId` malformado é rejeitado com `400` **sem gastar uma ida à rede**. Sem isso,
qualquer pessoa faria o servidor consultar o Supabase mandando lixo, e quem apenas
errou o payload receberia um confuso `503` em vez de um claro `400`.

Para **ver** um comprovante, o caminho é o inverso: o servidor lê o pagamento com o
seu token (RLS decide), confere o dono (seção 4) e devolve um endereço assinado. O
arquivo é `type=authenticated` — privado —, então sem a assinatura o endereço não
entrega nada.

---

## 6. Ordem dos middlewares — isso é regra de segurança

A sequência não é estilo. Trocar dois itens de lugar abre buraco.

```
requestContext → helmet → cors → /health → json(32kb) → rateLimit → /v1 → 404 → erro
```

| Posição | Por quê |
| --- | --- |
| `requestContext` primeiro | Todo registro, inclusive de erro, precisa do identificador de correlação. |
| `/health` **antes** do rate limit | Seus dois clientes legítimos são o monitor da Render e o pré-aquecimento do app. Limitá-los puniria o comportamento que pedimos ao app. Ela não faz I/O algum, então o custo de um flood é desprezível. |
| `json` **antes** do rate limit | O limite de 32 kB precisa valer antes de qualquer processamento do corpo. |
| `404` antes do handler de erro | O Express só reconhece um handler de erro pelos quatro parâmetros, e ele tem de ser o último. |

Dentro de cada rota de módulo:

```
validarCorpo(schema) → requireUser → controller
```

Explicado na seção 5: entrada inválida não pode custar uma ida à rede.

---

## 7. Cold start — o que é, e de quem é o problema

O plano gratuito da Render hiberna após ~15 minutos sem tráfego. A primeira chamada
seguinte espera o container subir: **30 a 60 segundos**.

Containerizar não resolve isso. Uma imagem enxuta acelera o boot, mas a hibernação é
política do plano, não característica da imagem. Vale dizer claramente porque é fácil
supor o contrário.

**Só as rotas deste servidor sofrem.** O caminho do app direto ao Supabase continua
instantâneo — foi por isso que a arquitetura é híbrida (seção 2).

**O que este servidor faz:** mantém `GET /health` trivial e sem I/O, para acordar o
mais rápido possível.

**O que o app precisa fazer** (fora deste repositório):

1. Chamar `GET /health` ao abrir uma tela que vá usar o backend — sem esperar a
   resposta. Enquanto a pessoa lê a tela, o servidor sobe.
2. Usar tempo de espera de 60–70 segundos, com **uma** nova tentativa.
3. Mostrar carregamento honesto ("um instante…") e uma tela de erro com "tentar de
   novo" — nunca uma tela congelada.

---

## 8. Camadas e injeção de dependências

Cada módulo é organizado em camadas, e cada uma só sabe o que precisa: [#22][#30]

```
routes       monta o módulo, ligando as implementações concretas
controller   traduz HTTP em chamada de serviço — zero regra de negócio
service      A REGRA. Sem Express, sem SDK. Recebe contratos por injeção
repository   única camada que conhece o PostgREST
schema       validação da entrada (Zod)
```

**A regra da dependência:** nenhuma peça exporta instância pronta. Cada uma expõe uma
**função que monta**, e um único arquivo — `src/composition-root.ts` — sabe que
existem Cloudinary e Supabase de verdade.

```
composition-root → criarApp(deps) → criarV1Router(deps) → criarProofsRouter(deps)
```

**Por que isso importa na prática:** antes, o serviço era montado no escopo do
arquivo de rotas. Importar aquele arquivo já amarrava Cloudinary e Supabase reais, e
testar exigia interceptar módulos. Hoje, `criarApp(dependenciasFalsas)` levanta a API
inteira **sem rede** — os 193 testes rodam em cerca de um segundo. [#21][#45]

O `service` define os **contratos** (`AssinadorDeMidia`, `LeitorDePagamentos`) e a
infraestrutura os implementa. A dependência aponta para dentro: trocar de provedor de
mídia é escrever outro adaptador, sem tocar em uma linha de regra. [#20]

---

## 9. Registros (logs) e privacidade

Comprovante de PIX é **dado financeiro pessoal**. Um vazamento pelos registros não
derruba o servidor — ele acontece em silêncio, por meses, até alguém olhar.

Por isso o mascaramento vive **dentro** do logger, e não na chamada: quem registra não
tem como esquecer. [#63]

- Chaves sensíveis (`authorization`, `signature`, `proof_url`, `email`, `cpf`…) têm o
  valor substituído por `[REDIGIDO]`.
- **Qualquer** chave terminada em `_id` é truncada para os 8 primeiros caracteres —
  suficiente para correlacionar dois registros, insuficiente para identificar alguém.
  O padrão cobre a *forma* da chave, e não uma lista de nomes: lista fechada falha em
  silêncio quando alguém registra um campo novo.
- Textos livres passam por limpeza de JWT, e-mail, CPF e `Bearer <...>`.
- Textos são cortados em 2 kB — **depois** da limpeza, porque cortar antes poderia
  partir um JWT ao meio e deixar metade passar.

O formato é JSON, uma linha por evento, com `traceId` em todas. [#91][#94]

---

## 10. O que ficou de fora, e por quê

| Decisão | Motivo |
| --- | --- |
| **Sem banco de dados próprio** | Os dados vivem no Supabase. Um Postgres aqui seria uma segunda fonte de verdade para sincronizar. [#8] |
| **Sem cache** | Não há gargalo medido. Cache traz invalidação — complexidade real por benefício hipotético. [#99] |
| **Sem `service_role` do Supabase** | Ela ignora a RLS por completo. Só entra se um módulo específico exigir escrita fora dela, isolado nesse módulo. |
| **Sem fila / processamento assíncrono** | Nenhuma operação é lenta o bastante. Entra quando houver relatório pesado ou envio de e-mail. |
| **Sem microserviços** | Um monólito modular atende com folga, e cada módulo novo é um arquivo a mais. [#26] |
| **Sem expiração na URL do comprovante** | Exige o recurso *Auth Token* da Cloudinary. O asset autenticado já protege o acesso; a expiração está registrada como melhoria em [`../REVIEW.md`](../REVIEW.md). |

---

## 11. Dívidas conhecidas

Registradas com honestidade, em vez de escondidas. O detalhe está em
[`../REVIEW.md`](../REVIEW.md):

1. **Ciclo de vida do comprovante (LGPD)** — não existe rota de exclusão nem prazo de
   retenção. É a pendência mais importante antes de o sistema receber dados de alunos
   reais.
2. **`extrairPublicId` opera sobre suposição** — o campo `payments.proof_url` pode
   guardar um `public_id` ou uma URL completa; sem acesso ao schema real, o código
   aceita os dois. Confirmando o formato, a função encolhe para uma linha.
3. **Rate limit em memória** — zera a cada hibernação e não escala horizontalmente.
   Ao sair do plano free, migrar para um store compartilhado.
4. **`proofs.repository.ts` sem teste próprio** — a implementação real que fala com o
   PostgREST é exercitada apenas por dublê.
