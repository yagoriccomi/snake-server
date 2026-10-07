# Plano: a D20 nas outras rotas

> Modo Loop, 07/10/2026. Fonte: contrato v6, § 13.6 (linhas "muda"), na `main` do snake-thai desde
> 06/10; inventário `docs/planos/INVENTARIO-erros-D20.md` (seções 4.2 e 6), na branch do #37.

## Enunciado

- **Problema:** com o Supabase fora do ar, o aluno lê "Sessão inválida"; um JSON quebrado do
  Supabase vira 500; os erros de uma linha (sem comprovante, já decidida, armazenamento antigo)
  saem todos como 403; o `bad_input` tem uma mensagem só; o 429 sai sem `traceId`.
- **Resultado esperado:** cada linha "muda" da § 13.6 respondida com o status, o `code` e a
  mensagem da tabela, nas rotas fora da segunda barreira, e `supabase_error` fora do servidor.
- **Como validar:** `npm test` com um teste por linha da § 13.6 que muda; `redocly lint` no OpenAPI.

## O que não é

- A segunda barreira (§ 13.5) é do #37 e espera o G4 (D24). Este PR não a traz.
- Nenhuma chamada nova ao banco. `pode_decidir_justificativa` e a leitura de `attempt` no
  `view-url` continuam desligadas até o G4 (este PR leva o commit do #39 para isso).
- Nenhuma mudança nos clientes: a § 15 foi conferida de novo em 07/10.

## Passos

1. **Cliente do Supabase** (`src/lib/supabase.ts`): uma classificação para Auth, consulta e RPC.
   - rede ou 502/503 → 503 `supabase_unreachable`; prazo ou 504 → 504 `supabase_timeout`;
   - 401 do PostgREST → 401 `bad_token`; 4xx do Auth → token recusado (401 `bad_token`);
   - outro status, corpo que não é JSON, consulta sem lista, RPC sem booleano, Auth 200 sem
     usuário → 502 `supabase_invalid_response`.
   - `chamarRpcComoChamador` dá lugar a `confirmarPermissaoComoChamador`, o mesmo nome e o mesmo
     comportamento do #37, para os dois PRs se juntarem sem duas versões da regra.
2. **Erros comuns:** `bad_input` com a frase do primeiro problema; os esquemas ganham frases em
   português para todo problema (inclusive tipo errado e `pagina`); corpo ausente conta como `{}`;
   outro 4xx do Express vira 400 `bad_request`; o 429 passa pelo handler único.
3. **Por rota**, sempre depois de confirmar o dono ou o leitor legítimo (regra 4):
   - comprovante: 404 `proof_not_found`, 409 `proof_not_on_cloudinary`;
   - justificativa, `sign-upload`: 409 `justification_not_pending`,
     409 `justification_already_has_attachment`, 502 para `attempt` fora de 1–2;
   - justificativa, `view-url`: 404 `justification_attachment_not_found`,
     409 `justification_attachment_not_on_cloudinary`, 409 `justification_attachment_path_mismatch`;
   - motivo, `sign-upload`: falha da RPC em 502/503/504; `view-url`: 409
     `motivo_attachment_not_on_cloudinary`.
4. **Docs:** README (tabela de erros), OpenAPI, `docs/BACKEND.md`, `CLAUDE.md`.

## Premissas assumidas (modo Loop)

1. **A linha sem provedor é "sem comprovante" (404), e a do provedor antigo é 409**, mesmo sem
   `proof_public_id`: a linha legada do Storage tem `proof_storage_path`, não `proof_public_id`, e
   o 404 diria que o comprovante não existe. [#9]
2. **O corpo que não é objeto (ex.: uma lista) dá `bad_input` "O corpo precisa ser um objeto
   JSON"**: a § 13.6 permite frases novas, desde que cada problema tenha a sua.
3. **O 4xx do Auth que não é 401 também é token recusado**, como diz a linha da § 13.6
   ("Token recusado pelo Auth (4xx)").
4. **`pode_anexar_ao_motivo` não fica atrás da constante do G4:** só o APK 2.0.0 e a web nova chamam
   `/v1/motivos`, e os dois saem depois do G3.

## Riscos e volta atrás

- O merge publica na Render. A volta é reverter o merge: nenhuma migration, nenhuma variável nova.
- O #37 vai precisar trazer a `main` depois deste merge; os conflitos esperados são em
  `src/lib/supabase.ts`, nos services de comprovante e de justificativa e nos dublês de teste.

## Estado (07/10/2026)

Os quatro passos feitos, um commit cada, com 483 testes passando e o `redocly lint` limpo. O
merge espera a confirmação do dono.
