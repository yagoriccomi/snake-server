/**
 * Conventional Commits como contrato de histórico. [#32]
 *
 * O histórico não é diário pessoal: é a ferramenta que responde
 * "quando isso quebrou e por quê" seis meses depois. Um commit
 * "ajustes" não responde nada.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // nova funcionalidade
        'fix', // correção de bug
        'refactor', // muda estrutura sem mudar comportamento
        'perf', // ganho de performance (com gargalo medido)
        'test', // testes
        'docs', // documentação
        'build', // build, Dockerfile, dependências
        'ci', // esteira de integração contínua
        'chore', // tarefa de manutenção sem efeito em produção
        'revert', // reversão de commit anterior
      ],
    ],
    // Assunto em português, sem ponto final e com limite legível.
    'subject-case': [0],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 100],
  },
};
