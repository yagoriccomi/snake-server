# Como contribuir

Obrigado pelo interesse. Este guia tem tudo que você precisa para sair do zero até um
Pull Request aceito — sem precisar perguntar nada a ninguém.

Este projeto é **software livre sob GPL-3.0**. Ao contribuir, você concorda que sua
contribuição será distribuída sob essa mesma licença.

---

## Antes de tudo: entenda o que este servidor é

Vale gastar dez minutos com dois documentos antes de escrever código:

| Leia | Para entender |
| --- | --- |
| [README.md](README.md) | O que o sistema faz e como rodá-lo |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | **Por que** ele é assim — as decisões e as alternativas descartadas |
| [docs/openapi.yaml](docs/openapi.yaml) | O contrato exato da API |

A leitura de arquitetura importa mais do que parece: várias escolhas aqui têm motivo
de segurança e parecem estranhas fora de contexto. Por exemplo, a validação do corpo
acontece **antes** da autenticação — isso é intencional, não descuido.

---

## Preparando o ambiente

```bash
git clone https://github.com/yagoriccomi/snake-server.git
cd snake-server
npm install

cp .env.example .env      # Windows: copy .env.example .env
```

Abra o `.env` e preencha. Você precisa de um projeto no Supabase e de uma conta na
Cloudinary — ambos têm plano gratuito suficiente para desenvolver. O `.env` está no
`.gitignore` e nunca deve ser enviado ao repositório.

Suba o ambiente:

```bash
# Windows
scripts\dev.bat start

# Linux/Mac
chmod +x scripts/dev.sh   # só na primeira vez
./scripts/dev.sh start
```

Confirme:

```bash
curl http://localhost:3000/health
# {"ok":true}
```

---

## O ciclo de trabalho

### 1. Crie uma branch

Nunca trabalhe direto na `main`.

| Prefixo | Para quê | Exemplo |
| --- | --- | --- |
| `feature/` | Funcionalidade nova | `feature/modulo-notificacoes` |
| `bugfix/` | Correção de defeito | `bugfix/url-assinada-expirada` |
| `refactor/` | Reorganização sem mudar comportamento | `refactor/extrai-cliente-http` |
| `chore/` | Manutenção sem efeito em produção | `chore/atualiza-dependencias` |

Prefira branches curtas. Uma branch que vive semanas acumula divergência e a fusão
vira um problema maior do que o trabalho original.

### 2. Escreva o código — e o teste junto

A suíte tem uma característica que vale conhecer: **a maior parte dos casos ataca
falha**, não o caminho de sucesso. Quando você adicionar algo, siga essa linha —
pergunte "como isso quebra?" antes de "como isso funciona?".

Nomes de teste dizem a condição e o resultado esperado:

```ts
it('deveNegarComForbiddenQuandoARlsNaoDevolveuNenhumaLinha', ...)
```

Não `it('funciona')`.

Você não precisa de mocks complicados: `criarApp(dependenciasFalsas)` levanta a API
inteira sem tocar a rede. Veja `tests/ajudantes/dependencias-falsas.ts`.

```bash
npm test              # roda tudo
npm run test:watch    # roda enquanto você edita
npm run test:coverage # com relatório de cobertura
```

### 3. Commit

As mensagens seguem [Conventional Commits](https://www.conventionalcommits.org/pt-br/).
Isso não é preferência de estilo: um robô valida a mensagem, e ela é o que responde
"quando isso quebrou e por quê" seis meses depois.

```
<tipo>(<escopo opcional>): <assunto no imperativo, sem ponto final>
```

Tipos aceitos: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`,
`chore`, `revert`.

```bash
git commit -m "feat(proofs): adiciona rota de exclusao de comprovante"
git commit -m "fix: corrige timeout curto demais na chamada ao Supabase"
```

Faça commits **atômicos** — uma mudança lógica por commit. "Vários ajustes" não é uma
mudança lógica.

> **O commit vai demorar alguns segundos.** Antes de aceitá-lo, o projeto roda análise
> de código, verificação de tipos e a suíte inteira. Se algo falhar, o commit é
> recusado. É de propósito: descobrir o problema agora custa segundos, descobrir na
> revisão custa um ciclo inteiro.
>
> Não use `--no-verify` para contornar. Se o gate está atrapalhando, provavelmente
> encontrou um problema real.

### 4. Abra o Pull Request

Explique **por que** a mudança existe e **como testá-la**. O que ela faz, o diff já
mostra; o motivo, só você sabe.

---

## O que a esteira automática exige

Todo PR passa por estas verificações. Rodar antes localmente evita ida e volta:

```bash
npm run format:check   # formatação
npm run lint           # análise de código
npm run typecheck      # tipos
npm test               # suíte completa
```

Além disso, a esteira verifica automaticamente:

- **Vulnerabilidades** nas dependências de produção.
- **Licenças** — só são aceitas licenças permissivas. Uma dependência copyleft trava o
  merge, mesmo que venha indiretamente por outra.
- **Segredos** — se um `.env` ou uma chave privada for enviada por engano, reprova.
- **A imagem Docker** — ela é construída, **um contêiner sobe de verdade** e precisa
  responder ao `/health`.

---

## Adicionando um módulo novo à API

A estrutura foi feita para isso: um módulo novo não deve tocar nos existentes.

1. **Crie a pasta** `src/modules/<dominio>/` com os arquivos de camada:
   `routes`, `controller`, `service`, `schema` (e `repository`, se falar com dados).

2. **Exponha uma função que monta**, nunca uma instância pronta:

   ```ts
   export function criarNotificationsRouter(deps: DependenciasDeNotifications): Router
   ```

   Isso é o que permite testar sem rede. Instância criada no escopo do módulo amarra
   a implementação real no momento do import.

3. **Defina os contratos no `service`.** A regra de negócio declara de que precisa
   (uma interface); a infraestrutura implementa. A dependência aponta para dentro.

4. **Reutilize `validarCorpo` e `criarRequireUser`** — nesta ordem. Validar antes de
   autenticar evita gastar uma ida à rede com entrada malformada.

5. **Registre as dependências** em `src/composition-root.ts`.

6. **Adicione uma linha** em `src/routes/v1.ts`.

7. **Cadastre os segredos do módulo** no `.env.example` (só o nome, nunca o valor) e
   no painel da Render.

8. **Documente o contrato** em [`docs/openapi.yaml`](docs/openapi.yaml). Especificação
   fora de sincronia engana mais do que ajuda.

---

## Regras que não se negociam

- **Nenhum segredo no repositório.** Nem em branch, nem "temporariamente", nem em
  repositório privado. Se um segredo já foi enviado, ele precisa ser **rotacionado** —
  apagar o commit não basta, porque ele continua no histórico de quem clonou.
- **Nenhum dado pessoal nos registros.** Comprovante de pagamento é dado financeiro.
  O mascaramento acontece dentro do logger justamente para você não precisar lembrar —
  mas não contorne isso.
- **Não reescreva histórico público.** `git push --force` em branch compartilhada
  quebra o repositório de todo mundo.
- **Não confie no cliente.** Todo dado que chega de fora é validado antes do uso.

---

## Encontrou um problema de segurança?

**Não abra uma issue pública.** Entre em contato em privado com quem mantém o
repositório, descrevendo o problema e como reproduzi-lo. Uma falha divulgada antes da
correção fica disponível para quem quiser explorá-la.

---

## Dúvidas

Se algo neste guia estiver confuso ou desatualizado, isso também é um problema
digno de correção — abra uma issue ou um PR. Documentação que engana custa mais caro
do que documentação que falta.
