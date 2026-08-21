// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Lint como gate, não como sugestão. O estilo é do Prettier; aqui ficam
 * as regras que pegam BUG e RISCO. [#5][#34]
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Tipagem forte é regra, não preferência. [#11]
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // Código morto e sobras não passam do lint. [#12]
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'no-debugger': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    // Arquivos de configuração em JS ficam fora do programa TypeScript —
    // as regras que exigem type information não têm o que analisar neles.
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    // A config só pode falar com o usuário pelo console — o logger ainda não existe.
    files: ['src/config/env.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  // Desliga tudo que conflita com o Prettier. Precisa vir por último.
  prettier,
);
