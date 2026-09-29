import { describe, expect, it } from 'vitest';

import { descreverErro } from '../../src/lib/descrever-erro.js';

/**
 * O SDK da Cloudinary rejeita com objeto simples, não com `Error`. O log e a
 * fila precisam da mensagem nos dois formatos — e sem o id do titular. [#63][#92]
 */

const UUID = '11111111-2222-4333-8444-555555555555';

describe('descreverErro', () => {
  it('deveUsarAMensagemDeUmError', () => {
    expect(descreverErro(new Error('timeout'))).toBe('timeout');
  });

  it('deveLerAMensagemDoObjetoQueASdkDaCloudinaryRejeita', () => {
    const rejeicao = { error: { message: 'Rate Limit Exceeded', http_code: 420 } };

    expect(descreverErro(rejeicao)).toBe('Rate Limit Exceeded (HTTP 420)');
  });

  it('deveLerAMensagemDeUmObjetoComMessage', () => {
    expect(descreverErro({ message: 'falhou' })).toBe('falhou');
  });

  it('deveAceitarTextoLancado', () => {
    expect(descreverErro('boom')).toBe('boom');
  });

  it.each([[null], [undefined], [42], [{}], [{ error: {} }], [{ error: 'x' }], ['']])(
    'deveDizerDesconhecidoQuandoNaoHaMensagem (%j)',
    (causa) => {
      expect(descreverErro(causa)).toBe('desconhecido');
    },
  );

  it('nuncaDeveDevolverObjectObject', () => {
    expect(descreverErro({ qualquer: 'coisa' })).not.toContain('[object Object]');
  });

  it('deveEsconderOIdDoTitularQueAMensagemDoProvedorCita', () => {
    const rejeicao = {
      error: { message: `Resource not found - comprovantes/${UUID}/${UUID}`, http_code: 404 },
    };

    const descricao = descreverErro(rejeicao);

    expect(descricao).toBe('Resource not found - comprovantes/[id]/[id] (HTTP 404)');
    expect(descricao).not.toContain(UUID);
  });
});
