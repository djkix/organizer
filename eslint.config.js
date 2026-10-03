import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.svelte-kit/**', '**/build/**', '**/test-results/**', '**/playwright-report/**', 'infra/terrain/**', 'tools/**', 'design/**'] },
  ...tseslint.configs.recommended,
);
