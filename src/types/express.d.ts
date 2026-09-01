import type { UsuarioAutenticado } from '../lib/supabase.js';

/**
 * Campos que os middlewares deste servidor anexam à requisição.
 * Tipados de propósito: nada de `(req as any).usuario` espalhado
 * pelos controllers. [#11]
 */
declare global {
  namespace Express {
    interface Request {
      /** Correlaciona todos os logs de uma mesma requisição. Gerado pelo servidor. [#94] */
      traceId: string;

      /**
       * Id que o cliente enviou, quando bem formado. Guardado como DADO para
       * amarrar o log do app ao do servidor — nunca como identidade da
       * requisição, que é sempre do servidor.
       */
      traceIdDoCliente?: string;

      /** Preenchido por `requireUser`. Ausente em rotas públicas. */
      usuario?: UsuarioAutenticado;

      /** Header `Authorization` original, para repassar à RLS do Supabase. */
      authorizationHeader?: string;
    }
  }
}

export {};
