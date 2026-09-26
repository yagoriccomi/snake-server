import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * O worker é OUTRO programa, com outro esquema de ambiente (ver
 * `media-cleanup.ts`). O Cron Job da Render só recebe as variáveis dele — sem
 * `SUPABASE_ANON_KEY`, que é do servidor web. Até 2026-09-25, o worker
 * importava o logger do servidor web, que carregava o `env.ts`, que encerra o
 * processo sem essa variável: o worker morria antes de apagar qualquer coisa.
 */

const MODULOS_DO_WORKER = [
  '../../src/jobs/media-cleanup/media-cleanup.service.js',
  '../../src/jobs/media-cleanup/media-cleanup.repository.js',
  '../../src/jobs/media-cleanup/media-cleanup.provedores.js',
  '../../src/jobs/media-cleanup/media-cleanup.logger.js',
];

describe('worker de limpeza — ambiente', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('naoDeveExigirAsVariaveisDoServidorWebAoCarregar', async () => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const encerrar = vi.spyOn(process, 'exit').mockImplementation((codigo) => {
      throw new Error(`process.exit(${String(codigo)})`);
    });

    for (const modulo of MODULOS_DO_WORKER) {
      await import(modulo);
    }

    expect(encerrar).not.toHaveBeenCalled();
  });
});
