# Entrega — Fase 4 do servidor (G2), 25/09

> **Modo:** Loop. **Contrato:** `snake-thai/docs/CONTRATO.md` v3 (revisão de 25/09), § 13 e § 14.
> O plano dos itens 4.1 e 4.8 está em `PLANO-worker-4.1-4.8.md`; os demais seguiram a
> especificação item a item do `ROADMAP-server.md`, que já descreve arquivo, regra e testes.

## O que mudou

| Item | PR | Arquivos |
| --- | --- | --- |
| 4.1, 4.8 | #28 (mesclado, `7a73c83`) | `src/jobs/media-cleanup/*` (constantes novas, validação, três tipos de recurso), testes do worker, `docs/BACKEND.md` |
| 4.9 | #29 | `proofs.service.ts` (`ParametrosDeUpload`), `proofs.constants.ts` (`FORMATOS_DE_ANEXO`) |
| 4.2 | #29 | `src/lib/supabase.ts` (`chamarRpcComoChamador`), `src/modules/motivos/*`, `composition-root.ts`, `routes/v1.ts` |
| 4.3 | #29 | `src/modules/justifications/*` |
| 4.4 | #29 | `src/app.ts` |
| 4.5 | #29 | `media-cleanup.orfaos.ts` (novo), `media-cleanup.repository.ts`, `media-cleanup.provedores.ts`, `media-cleanup.ts` |
| 4.6 | #29 | `docs/openapi.yaml`, `README.md`, `docs/BACKEND.md`, `render.yaml` (comentário) |

## Decisões e premissas

1. **Recusa terminal sem coluna de estado** (4.1): `processado_em = now()` + `ultimo_erro =
   'prefixo_invalido'`, sem somar `tentativas`.
2. **Motivo desconhecido na fila** para o lote, como o provedor desconhecido.
3. **`view-url` de justificativas no banco antigo:** o contrato manda ler `attempt`; o dono decidiu
   seguir o contrato (403 até as migrations).
4. **Limite compartilhado:** a mesma instância do `limitadorDeComprovantes` nas três rotas.
5. **Varredura de órfãos:** só assets no formato do contrato, com mais de 24 h; falha fechada
   (qualquer erro de listagem ou consulta interrompe sem apagar).

## Como validar

- `npm test` (377 casos), `npm run lint`, `npm run typecheck`, `npm run build`.
- `npx @redocly/cli lint docs/openapi.yaml`.
- Depois do merge do #29: as duas conferências sem token do § 14 e o commit no Cron Job.

## Pendências

- **Fase 1** (quem publica) — decisão do dono, adiada em 25/09.
- **Item 1.2** — conferir no painel se o `snakethai-api` e o Cron Job rodam os commits de hoje.
- **4.7** — merge do #29 com a confirmação do dono; depois, "G2 aberto" no Registro.
