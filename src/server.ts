import { criarApp } from './app.js';
import { TIMEOUT_SHUTDOWN_MS } from './config/constants.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';

/**
 * Bootstrap do processo: sobe a porta e trata o ciclo de vida.
 *
 * O desligamento limpo importa mais aqui do que num servidor comum: a Render
 * manda SIGTERM ao hibernar e a cada deploy. Sem tratar o sinal, requisições
 * em voo morrem no meio e o app do aluno recebe uma conexão cortada.
 */
const app = criarApp();

const servidor = app.listen(env.porta, () => {
  logger.info('servidor no ar', {
    porta: env.porta,
    ambiente: env.nodeEnv,
    versaoNode: process.version,
  });
});

function encerrar(sinal: NodeJS.Signals): void {
  logger.info('encerrando servidor', { sinal });

  // Rede de segurança: se alguma conexão travar, o processo morre mesmo assim.
  const desistir = setTimeout(() => {
    logger.error('shutdown demorou demais; encerrando à força');
    process.exit(1);
  }, TIMEOUT_SHUTDOWN_MS);
  desistir.unref();

  servidor.close((erro) => {
    if (erro) {
      logger.error('falha ao fechar o servidor', { erro });
      process.exit(1);
    }
    logger.info('servidor encerrado');
    process.exit(0);
  });
}

process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);

/**
 * Falhas que escapam do handler global do Express. Logamos e derrubamos:
 * um processo em estado desconhecido serve resposta errada — a Render
 * reinicia o container, e reiniciar é mais seguro do que insistir.
 */
process.on('unhandledRejection', (motivo) => {
  logger.error('promessa rejeitada sem tratamento', { erro: motivo });
  process.exit(1);
});

process.on('uncaughtException', (erro) => {
  logger.error('exceção não capturada', { erro });
  process.exit(1);
});
