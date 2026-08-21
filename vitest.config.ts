import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],

    /**
     * `config/env.ts` valida o ambiente NO IMPORT (fail-fast). Sem estas
     * variáveis, qualquer arquivo que importe a aplicação derruba o runner
     * antes do primeiro `expect`.
     *
     * Todos os valores abaixo são FICTÍCIOS e existem só para satisfazer o
     * schema. Nenhum teste usa credencial real: quem precisa de Supabase ou
     * Cloudinary recebe um dublê injetado. [#37][#45][#80]
     */
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      LOG_LEVEL: 'error',
      SUPABASE_URL: 'https://projeto-de-teste.supabase.co',
      SUPABASE_ANON_KEY: 'chave-anon-ficticia-de-teste',
      CLOUDINARY_CLOUD_NAME: 'nuvem-de-teste',
      CLOUDINARY_API_KEY: '000000000000000',
      CLOUDINARY_API_SECRET: 'segredo-ficticio-de-teste',
    },

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'src/server.ts'],
    },
  },

  resolve: {
    /**
     * O código usa `module: NodeNext`, então os imports relativos carregam a
     * extensão `.js` mesmo apontando para arquivos `.ts` — exigência do
     * TypeScript. O Vite não faz essa tradução sozinho; o alias abaixo remove
     * a extensão só dos caminhos relativos, deixando `tsc` e Vitest
     * concordarem sem duplicar convenção de import.
     */
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' }],
  },
});
