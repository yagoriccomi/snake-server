import type { UsuarioAutenticado } from '../lib/supabase.js';

/**
 * Campos que os middlewares deste servidor anexam à requisição.
 * Tipados de propósito: nada de `(req as any).usuario` espalhado
 * pelos controllers. [#11]
 */
declare global {
  namespace Express {
    interface Request {
      /** Correlaciona todos os logs de uma mesma requisição. [#94] */
      traceId: string;

      /** Preenchido por `requireUser`. Ausente em rotas públicas. */
      usuario?: UsuarioAutenticado;

      /** Header `Authorization` original, para repassar à RLS do Supabase. */
      authorizationHeader?: string;
    }
  }
}

export {};
