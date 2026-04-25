import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  { ignores: ['dist-*/**', 'release/**', 'python-pipeline/**', 'resources/**', 'public/**', 'build/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsparser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
