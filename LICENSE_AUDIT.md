# ⚖️ Mapa de Risco de Licenças

**Projeto:** `snakethai-api` — backend do Snake Thai (software livre, GPL-3.0)
**Data:** 2026-08-21
**Escopo:** 384 pacotes instalados (diretos e transitivos) + licenciamento do próprio repositório

> Este documento é **apoio à decisão**, não parecer jurídico formal. O licenciamento do
> repositório foi decidido (ver seção abaixo); a seção 🔴 fica preservada como registro
> da análise que levou à decisão.

---

## 📊 Resumo Executivo

**Modelo de negócio detectado: SaaS hospedado.** O código roda na Render e o app Expo o
consome por HTTP. Nada é entregue ao usuário final — nem binário, nem fonte. Essa
distinção é o que determina se uma cláusula copyleft dispara ou não. [#98]

| Faixa de risco | Dependências |
| --- | --- |
| 🔴 Crítico / Alto (contágio viral) | **0** |
| 🟡 Moderado (copyleft fraco) | **0** |
| 🟢 Baixo (permissivas) | **384** |
| 🤖 IA / não-OSI | **0** |
| ❓ Sem licença declarada | **0** |

**As dependências não oferecem risco jurídico algum.** A árvore inteira é permissiva:

| Licença | Pacotes | Natureza |
| --- | --- | --- |
| MIT | 319 | Permissiva — exige apenas aviso de copyright |
| ISC | 28 | Permissiva — equivalente funcional à MIT |
| Apache-2.0 | 16 | Permissiva + **concessão expressa de patente** |
| BSD-3-Clause | 8 | Permissiva — veda uso do nome do autor em endosso |
| BlueOak-1.0.0 | 6 | Permissiva moderna, redigida em linguagem simples |
| BSD-2-Clause | 6 | Permissiva |
| Python-2.0 | 1 | Permissiva (`argparse@2.0.1`, só desenvolvimento) |

**Nenhuma GPL, AGPL, LGPL, MPL, SSPL ou BUSL em qualquer ponto da árvore.**

### ✅ A contradição encontrada foi resolvida

A auditoria detectou que o `LICENSE` da raiz era a **GNU GPL v3** enquanto o
`package.json` declarava **MIT** — duas licenças incompatíveis para a mesma obra.
**O responsável decidiu por GPL-3.0** e os três pontos foram alinhados. Detalhe abaixo.

---

## ✅ DECISÃO TOMADA — GPL-3.0

**Em 2026-08-21 o responsável pelo projeto decidiu: o licenciamento é GPL-3.0.**

A contradição está resolvida. Os três pontos agora dizem a mesma coisa:

| Onde | Valor |
| --- | --- |
| `LICENSE` | GNU GPL v3 (já estava, desde o commit inicial) |
| `package.json` | `"license": "GPL-3.0-only"` |
| `README.md` | GPL-3.0, com explicação do alcance |

**O que isso significa na prática:**

- Qualquer pessoa pode usar, estudar, modificar e redistribuir este servidor.
- Quem **distribuir** uma versão modificada deve liberar o fonte dela sob GPL-3.0.
- Rodar como SaaS **não** obriga a publicar nada: o gatilho da GPL-3.0 é a distribuição.
  (Se a intenção fosse fechar essa porta também, a licença seria a **AGPL-3.0**.)
- O **app Expo não é afetado**: HTTP entre processos independentes não cria obra derivada.
- As 384 dependências (MIT/ISC/Apache-2.0/BSD/BlueOak/Python-2.0) são **compatíveis**
  com a GPLv3. Não há conflito de entrada.

**Dois pontos que ainda pedem atenção humana:**

1. **`GPL-3.0-only` vs `GPL-3.0-or-later`.** Adotei `only`, que é o mais conservador e
   fiel ao pedido literal. O `or-later` concederia automaticamente os termos de uma
   futura GPLv4. Trocar é um caractere, se preferir.
2. **Cabeçalho nos arquivos-fonte.** A FSF recomenda um bloco de licença no topo de cada
   arquivo. Não foi adicionado para não poluir 25 arquivos sem pedido explícito — o
   `LICENSE` na raiz já é juridicamente suficiente para a obra como um todo.

---

## 🔴 Risco Crítico / Alto (Contágio Viral)

### Dependências

> Nenhuma dependência nesta faixa. A varredura dos 384 pacotes não encontrou uma única
> licença copyleft.

### Licenciamento do próprio repositório — ✅ **RESOLVIDO (GPL-3.0)**

> Registro histórico da análise. O estado abaixo é o que existia ANTES da decisão.

| Onde | O que declara | Consequência |
| --- | --- | --- |
| `LICENSE` (raiz) | **GPL-3.0** | Copyleft forte: quem receber o código pode redistribuí-lo, e derivados distribuídos devem abrir o fonte |
| `package.json` | **MIT** | Permissiva: qualquer um pode copiar, fechar e revender |
| `README.md` | MIT *(já corrigido)* | — |

**Por que isso importa para um produto comercial:**

1. **Insegurança jurídica.** Um terceiro que copiar o código pode alegar de boa-fé
   qualquer uma das duas licenças. O arquivo `LICENSE` é o instrumento canônico e tende
   a prevalecer, mas a ambiguidade em si já é o problema — ela se resolve em tribunal,
   não em code review.

2. **Nenhuma das duas protege um backend proprietário.** A MIT permite que um
   concorrente copie o servidor inteiro e o explore comercialmente. A GPL-3.0 permite
   que qualquer um que obtenha o código o redistribua. Para código fechado de produto
   comercial, o correto é **proprietário** (`UNLICENSED`), não open-source.

3. **Se o repositório for público no GitHub, a GPL-3.0 já está valendo hoje** —
   qualquer pessoa que o tenha clonado recebeu uma licença irrevogável sobre aquela
   versão. Trocar a licença daqui para frente não retroage sobre cópias já distribuídas.
   **A visibilidade do repositório não é verificável a partir daqui — confirme no GitHub.**

**O que a GPL-3.0 NÃO faz aqui** (para não gerar alarme indevido):

- **Não contamina o app Expo.** O app conversa com este servidor por HTTP, entre
  processos independentes. Comunicação em rede entre programas separados não cria obra
  derivada — o app permanece com o licenciamento dele.
- **Não obriga a abrir o código pelo uso em SaaS.** O gatilho da GPL-3.0 é a
  **distribuição**; servir por rede não é distribuir. (Esse é o gatilho da **AGPL**, que
  não está em jogo aqui.)
- **Não conflita com as dependências.** MIT, ISC, BSD e Apache-2.0 são todas compatíveis
  com a GPLv3 — não há incompatibilidade de entrada.

**Os três caminhos analisados — o caminho B foi o escolhido:**

| Caminho | O que fazer | Quando escolher |
| --- | --- | --- |
| **A — Proprietário** *(coerente com o modelo)* | Apagar o `LICENSE` GPL, criar um `LICENSE` proprietário ("Todos os direitos reservados"), definir `"license": "UNLICENSED"` e manter o repositório **privado** | O servidor é ativo comercial e não deve ser copiável |
| **B — Manter GPL-3.0** ✅ **ESCOLHIDO** | Corrigir `package.json` para `"GPL-3.0-only"` e assumir o software livre conscientemente | Há intenção real de abrir o código |
| **C — MIT de fato** | Substituir o `LICENSE` pelo texto MIT | Quer permitir uso irrestrito, inclusive por concorrentes |

> **Nota de transparência:** a declaração `"license": "MIT"` no `package.json` e no
> `README.md` foi introduzida **por mim, durante o scaffold, assumindo MIT sem abrir o
> arquivo `LICENSE`**. O arquivo GPL-3.0 já existia desde o commit inicial (`733b2e4`) —
> muito provavelmente escolhido no assistente de criação do repositório no GitHub. Como
> a escolha da licença é decisão de negócio e não minha, ajustei a declaração para
> `"SEE LICENSE IN LICENSE"`, que aponta para o documento canônico sem eu decidir por
> você, e removi a afirmação incorreta do README.

**Proteção que já existe e está correta:** `"private": true` no `package.json` impede a
publicação acidental no registro público do npm. [#37]

---

## 🟡 Risco Moderado (Copyleft Fraco / Atribuição)

> Nenhuma dependência nesta faixa.

**Obrigação que permanece, mesmo com licenças permissivas:** MIT, ISC, BSD e Apache-2.0
exigem que o **aviso de copyright e o texto da licença acompanhem redistribuições**.
Como este é um SaaS que não distribui código nem binário, a obrigação **não dispara**
hoje. Se um dia o produto passar a ser distribuído (imagem Docker pública, instalação
on-premise, pacote npm), será necessário incluir um `NOTICE` com os avisos dos 384
pacotes. [#96]

---

## 🟢 Baixo Risco (Permissivas)

### Dependências diretas de produção — o que efetivamente vai para a imagem

| Dependência | Versão | Licença | Observação |
| --- | --- | --- | --- |
| `express` | 5.2.1 | MIT | Framework HTTP |
| `cloudinary` | 2.10.1 | MIT | SDK oficial — assina upload e URL |
| `cors` | 2.8.6 | MIT | Controle de origem |
| `express-rate-limit` | 7.5.1 | MIT | Limitação de requisições |
| `helmet` | 8.3.0 | MIT | Headers de segurança |
| `zod` | 3.25.76 | MIT | Validação de schema |

A árvore de produção alcança **~72 pacotes**, todos MIT, exceto `qs@6.15.3`
(BSD-3-Clause) e quatro utilitários ISC (`inherits`, `once`, `setprototypeof`,
`wrappy`). Todas permissivas.

### Dependências de desenvolvimento

Cerca de 310 pacotes adicionais (ESLint, TypeScript, Vitest, Prettier, Husky,
commitlint, supertest, tsx e transitivos). **Não entram na imagem Docker** — o stage
`prod-deps` roda `npm ci --omit=dev`, verificado na etapa de segurança.

Como não são distribuídas nem executadas em produção, o risco jurídico delas é
**praticamente nulo** mesmo se uma licença mudasse. Ainda assim, todas são permissivas.

---

## 🤖 Licenças de IA / Não-OSI

> Nenhum modelo, peso, dataset ou biblioteca de IA no projeto. Faixa não aplicável.

Registro para o futuro: se um módulo vier a usar IA (por exemplo, leitura automática de
comprovante por OCR), **as licenças de modelo exigem auditoria própria**. Famílias como
OpenRAIL, Llama Community License e variantes "research-only" impõem restrições de uso
aceitável e, por vezes, vedação comercial — cláusulas que não existem em licenças OSI e
que, no ordenamento brasileiro, se somam às questões de responsabilidade civil pelo
resultado gerado. Não trate peso de modelo como se fosse código MIT.

---

## ✅ Plano de Mitigação

1. ✅ **Licenciamento decidido: GPL-3.0.** `LICENSE`, `package.json` e `README.md`
   alinhados. Nada mais pendente aqui.

2. **Opcional — cabeçalho de licença nos arquivos-fonte.** A FSF recomenda um bloco no
   topo de cada `.ts`. O `LICENSE` na raiz já cobre a obra; o cabeçalho ajuda quando um
   arquivo circula isolado.

3. **Automatizar a auditoria de licenças no CI**, junto com a de vulnerabilidades, para
   que uma dependência copyleft seja barrada antes do merge — e não descoberta depois do
   deploy. [#62] Sugestão para a etapa de CI/CD:

   ```yaml
   - name: Auditar licenças das dependências de produção
     run: |
       npx license-checker-rseidelsohn --production --onlyAllow \
         "MIT;ISC;Apache-2.0;BSD-2-Clause;BSD-3-Clause;BlueOak-1.0.0;0BSD;Unlicense;CC0-1.0" \
         --excludePrivatePackages
   - name: Auditar vulnerabilidades
     run: npm audit --omit=dev --audit-level=high
   ```

   Ative também o **Dependabot** para atualização e alerta contínuos. [#62]

4. **Preparar um `NOTICE`** com os avisos de copyright das dependências **caso** o
   produto passe a ser distribuído (imagem pública, on-premise). Hoje, como SaaS, não é
   exigido — mas o custo de montá-lo cresce com o tempo. [#96]

---

## 📌 Metodologia

O inventário leu o `package.json` **real de cada pacote instalado** em `node_modules`,
e não apenas o `package-lock.json` — o lockfile nem sempre carrega o campo `license`, e
depender só dele é como uma dependência copyleft passa despercebida. A árvore de
produção foi determinada percorrendo recursivamente as `dependencies` e
`optionalDependencies` a partir das seis dependências diretas, o que separa com precisão
o que vai para a imagem do que fica no ambiente de desenvolvimento.
