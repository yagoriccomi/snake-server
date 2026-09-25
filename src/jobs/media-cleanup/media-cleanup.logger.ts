/**
 * O logger do WORKER. Mesmo mascaramento de PII do servidor web, sem a
 * configuração dele: o worker é outro programa, com outro esquema de ambiente
 * (ver `media-cleanup.ts`). Importar `lib/logger.ts` aqui carregava o `env.ts`
 * do servidor web, que exige `SUPABASE_ANON_KEY` — variável que o Cron Job não
 * tem —, e o worker morria ao iniciar. [#20][#63]
 *
 * `info` e sem stack: o worker só roda na Render, sempre como produção.
 */

import { criarLogger } from '../../lib/log-estruturado.js';

export const logger = criarLogger({ nivelMinimo: 'info', incluirStack: false });
