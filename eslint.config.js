import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'infra/terrain/**', 'tools/**', 'design/**'] },
  ...tseslint.configs.recommended,
);
