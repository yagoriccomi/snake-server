# Plano — itens 4.1 e 4.8 do ROADMAP (worker de limpeza)

> **Modo:** Loop (sem confirmação do plano; o merge na `main` publica e pede confirmação).
> **Contrato:** `snake-thai/docs/CONTRATO.md` v3, § 13.3. **Branch:** `bugfix/worker-valida-caminho-e-tipos-de-recurso`.

## Enunciado

- **Problema:** o worker apaga `asset_ref` sem conferir nada (um valor forjado apagaria o arquivo de
  outra pessoa; no Storage, `encodeURI` não escapa `/` nem `..`) e apaga na Cloudinary só com
  `resource_type: 'image'`, contando `"not found"` como sucesso: um anexo guardado como `raw` ou
  `video` sai da fila sem ter sido apagado.
- **Resultado esperado:** o worker valida o caminho antes de apagar (formato e pasta por motivo; `..`
  no Storage), recusa de forma terminal com `prefixo_invalido`, e apaga `motivos/` e
  `justificativas/` tentando `image`, `raw` e `video`.
- **Como validar:** testes unitários dos dois itens, gate local (lint, tipos, testes) e CI verde.

## Escopo negativo [#8]

- Varredura de órfãos (4.5), `allowed_formats` (4.9), módulo `motivos` (4.2): fora.
- Mensagem de erro de objeto simples da Cloudinary (3.6): fora; fica para o item dele.
- Nenhuma coluna nova na fila: o banco é do `snake-thai`.

## Premissas assumidas

1. **Como "marcar `prefixo_invalido`" sem coluna de estado.** A fila só tem `processado_em`,
   `tentativas` e `ultimo_erro`, e o worker lista `processado_em is null`. Terminal, sem nova
   tentativa, só existe fechando o item: `processado_em = now()` e `ultimo_erro =
   'prefixo_invalido'`, sem mexer em `tentativas`. Deixar `processado_em` nulo faria o item voltar
   em toda execução, na frente da fila. Quem auditar a fila distingue os recusados por
   `ultimo_erro = 'prefixo_invalido'`. [#9]
2. **Motivo fora do enum conhecido** faz o repositório parar o lote, como já faz com provedor
   desconhecido (esquema divergente é motivo de parar, não de adivinhar). A ordem de publicação do
   contrato (§ 14) põe o servidor antes das migrations, então os valores novos
   (`anexo_de_motivo_removido`, `anexo_expirado`) já chegam conhecidos. [#5][#9]
3. **"Caminho forjado de outra pessoa":** o worker não sabe quem é o dono (a fila não tem
   `user_id`). O que ele barra é o que o formato e a pasta barram: segmentos a mais, `..`, pasta
   fora da lista e pasta errada para o motivo. Um caminho bem formado de outra pessoa só entra na
   fila por quem já tem `service_role` ou pelos gatilhos do banco, que derivam o caminho. Registrado
   aqui para não vender a validação como mais do que ela é.
4. **UUID em maiúsculas** não casa com o formato do contrato. O Postgres devolve `uuid` em
   minúsculas, e os caminhos da fila vêm do banco; o risco é só de um item legítimo ser recusado,
   nunca de apagar errado (falha fechada).
5. **Storage:** o contrato diz "recusa caminho com `..`". Aplicado literalmente (qualquer `..` no
   texto); cada segmento vai por `encodeURIComponent`.

## Decisão visual

Sem superfície visual (worker sem interface).

## Passos

| # | Arquivo | O que muda | Prática | Verificação |
| --- | --- | --- | --- | --- |
| 1 | `src/jobs/media-cleanup/media-cleanup.constants.ts` (novo) | Formato do contrato, pastas por motivo, `prefixo_invalido`, tipos de recurso | [#3][#13] | tipos |
| 2 | `media-cleanup.service.ts` | `ItemDaFila` ganha `motivo`; valida antes de apagar; recusa terminal; `recusados` no resultado | [#9][#30] | testes 4.1 |
| 3 | `media-cleanup.repository.ts` | Lê `motivo`, recusa motivo desconhecido, `marcarInvalido` | [#22] | tipos |
| 4 | `media-cleanup.provedores.ts` | Storage com `encodeURIComponent` por segmento | [#51] | teste do adaptador |
| 5 | `media-cleanup.ts` | Linha final conta os recusados | [#91] | tipos |
| 6 | `media-cleanup.service.ts` + `provedores.ts` | `apagarDaCloudinary(publicId, tipo)` devolve `apagado`/`inexistente`; a regra tenta `image`, `raw`, `video` em `motivos/` e `justificativas/` | [#20][#30] | testes 4.8 |
| 7 | `tests/unit/media-cleanup.*.test.ts` | Casos do roadmap (um por motivo, forjado, `..`, os três tipos) | [#41][#46] | `npm test` |
| 8 | `docs/BACKEND.md`, `ROADMAP-server.md` | Seção do worker e registro | [#96] | leitura |

Commits: 4.1 (passos 1–5 e testes), 4.8 (passo 6 e testes), docs. [#31][#32]

## Riscos e rollback [#84]

- **Item legítimo recusado** (formato inesperado em dado antigo): fica fechado com
  `prefixo_invalido` e alarme `error` no log; reabrir é um `update` de `processado_em = null` depois
  de corrigir. Nada é apagado por engano.
- **Custo de chamadas:** até três `destroy` por anexo; volume baixo (lote de 100 por execução).
- **Rollback:** reverter o merge; o worker volta ao comportamento anterior.

## Definição de pronto

- [ ] Lint, tipos e testes verdes localmente.
- [ ] PR aberto com CI verde.
- [ ] Merge na `main` **só com a confirmação do dono** (publica na Render).
- [ ] 4.1 e 4.8 marcados `[x]` e anotados no Registro.
