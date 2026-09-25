import { env } from '../config/env.js';
import { criarLogger } from './log-estruturado.js';

/**
 * O logger do SERVIDOR WEB, configurado pelo `env.ts`. O mascaramento e o
 * formato moram em `log-estruturado.ts`, que não lê configuração nenhuma — é
 * isso que deixa o worker de limpeza usar o mesmo mascaramento sem precisar
 * das variáveis do servidor web. [#20][#91]
 */
export const logger = criarLogger({
  nivelMinimo: env.nivelDeLog,
  incluirStack: !env.ehProducao,
});

export {
  mascarar,
  TAMANHO_MAXIMO_DE_TEXTO,
  type Logger,
  type NivelDeLog,
} from './log-estruturado.js';
