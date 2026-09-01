import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodSchema } from 'zod';

/**
 * Valida o corpo da requisição contra um schema Zod e substitui `req.body`
 * pelo dado já validado e normalizado. [#51]
 *
 * Vem ANTES do `requireUser` nas rotas de propósito: rejeitar entrada
 * malformada não deveria custar uma ida à rede. Sem isso, qualquer um
 * consegue fazer o servidor chamar o Supabase mandando lixo — e o usuário
 * legítimo que errou o payload recebe um 503 confuso em vez de um 400 claro.
 *
 * A validação acontece em UM lugar só; o controller recebe o corpo já
 * tipado pelo genérico do `RequestHandler`, sem re-parse e sem cast. [#6]
 */
export function validarCorpo<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const resultado = schema.safeParse(req.body);

    if (!resultado.success) {
      // O ZodError é traduzido em 400 pelo handler global. [#93]
      next(resultado.error);
      return;
    }

    req.body = resultado.data;
    next();
  };
}
