# Auditoria focada no navegador — item 5.7 (25/09)

> Escopo: o servidor agora tem um cliente de navegador (`https://snake-web-eight.vercel.app`).
> CORS e preflight, cabeçalhos (Helmet), limite de taxa, `trust proxy` e as rotas `/v1/proofs`,
> `/v1/justifications` e `/v1/motivos`. Conferido no código (branch `feature/g2-anexos`) e **em
> produção** (`https://snake-server-3j25.onrender.com`), sem token e sem dado real.

## Top 5 causas de vazamento

| # | Causa | Veredicto | Evidência |
| --- | --- | --- | --- |
| V1 | Banco sem RLS | ✅ PROTEGIDO | `payments`: RLS ligada, leitura só dono ou `is_admin()` (P-10, item 5.6). As tabelas da v3 são do `snake-thai` (contrato § 8) |
| V2 | Autorização no cliente | ✅ PROTEGIDO | Identidade por `GET /auth/v1/user` (`require-user.ts`); pasta do upload sempre do token; permissão pela RLS ou por `pode_anexar_ao_motivo` |
| V3 | IDOR | ✅ PROTEGIDO | `view-url` lê com o token de quem chama e assina caminho **derivado**; `{justificationId}` confere `user_id`; `motivos` pergunta ao banco antes de assinar |
| V4 | Segredo no código ou no Git | ✅ PROTEGIDO | Nenhum padrão de chave no código nem no histórico (o JWT dos testes é o exemplo público do jwt.io). Brecha no CI corrigida (achado 2) |
| V5 | XSS | ✅ PROTEGIDO (API) | Só JSON; entrada validada por Zod; CSP `default-src 'self'` e `nosniff`. A renderização é da web (fora deste repositório) |

## Conferido em produção

- **CORS:** a origem da web recebe `Access-Control-Allow-Origin`; uma origem estranha e `Origin: null`
  não. Sem `credentials` (a autenticação é por `Bearer`, não por cookie): **CSRF não se aplica**.
  `Vary: Origin` presente.
- **Cabeçalhos:** HSTS (1 ano, subdomínios), CSP restritiva, `frame-ancestors 'self'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, sem `X-Powered-By`.
- **Erro:** `401` com `{ error, code, traceId }`, sem stack.

## Achados

### 1. ⚠️ Médio — o limite de taxa não enxerga o IP do cliente (não corrigido; precisa de evidência)

Cinco requisições do mesmo computador caíram em **dois contadores diferentes**, que se alternavam
(os `RateLimit` com `reset` distintos). Um `X-Forwarded-For` forjado **não** mudou a chave, então
não dá para falsificar o IP. A explicação provável: há dois proxies na frente do app
(`Server: cloudflare` e a Render), e com `trust proxy 1` o `req.ip` é o IP de um proxy, não o do
cliente. Efeito: quem passa pelo mesmo nó do proxy **divide a mesma cota** (20/min nas rotas de
arquivo), e um cliente ganha mais de uma cota. [#58]

**Por que não corrigi:** trocar para `trust proxy 2` só é seguro se a cadeia tiver exatamente dois
saltos; errado, abre a falsificação pelo `X-Forwarded-For`. Falta ver, em produção, quantas entradas
chegam no `X-Forwarded-For`. **Próximo passo:** um log temporário que registre só a **quantidade**
de entradas (nunca o IP, que é dado pessoal) ou a documentação da Render sobre o cabeçalho; depois,
ajustar e testar com o mesmo experimento.

### 2. Baixo — checagem de segredos do CI ignorava `.env.dev` e `.env.prod` (corrigido)

O passo "Verificar se algum segredo escapou" reconhecia só `.env`, `.env.local`,
`.env.production` e `.env.development`. Os arquivos que este projeto usa são `.env.dev` e
`.env.prod` (no `snake-thai`, também). Agora qualquer `.env` ou `.env.<algo>`, menos o
`.env.example`, reprova o CI. [#37][#64]

### Observações sem ação

- `Cross-Origin-Resource-Policy: same-origin` (padrão do Helmet) não afeta o `fetch` da web: vale
  só para requisições `no-cors`.
- O CORS não expõe `X-Request-Id` nem os `RateLimit-*` ao navegador; o `traceId` já vem no corpo
  do erro.
- Limite em memória (P-16) continua aceitável com uma instância só.
- Recomendação para o futuro: varredura de **conteúdo** de segredos no CI (ex.: gitleaks); hoje a
  checagem é por nome de arquivo.
