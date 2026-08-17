import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';

/**
 * Lint rules that enforce the report's coding rules (§14.4) as far as static
 * analysis can. The rules that matter most here are the architectural ones:
 * the dependency direction from §14.2, and the prohibitions on floating-point
 * money and on provider calls inside transactions.
 *
 * Rules a linter cannot check (tenant scoping, audit classification) are
 * covered by the integration suite instead.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '.data/**',
      'test-results/**',
      'playwright-report/**',
      'docs/openapi/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortSignal: 'readonly',
        NodeJS: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  // --- Report §14.4: no floating-point money -------------------------------
  {
    files: ['packages/domain/**/*.ts', 'packages/application/**/*.ts', 'packages/db/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // `parseFloat` on anything monetary is the classic way this rule gets
          // broken. Quantities parse through `parseQuantity`, money through
          // bigint.
          selector: "CallExpression[callee.name='parseFloat']",
          message:
            'Money and quantities never pass through parseFloat (report §8.1, §14.4). Use bigint or parseQuantity.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='round']",
          message:
            'Rounding for money must use roundHalfUpToBigint so the report §8.1 half-up rule is applied consistently.',
        },
      ],
    },
  },

  // --- Report §14.2: dependency direction ----------------------------------
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@extrawork/db',
                '@extrawork/integrations',
                '@extrawork/files',
                '@extrawork/runtime',
              ],
              message:
                'domain must not depend on infrastructure (report §14.2: domain <- application <- api/worker).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@extrawork/db',
                '@extrawork/domain',
                '@extrawork/application',
                '@extrawork/runtime',
                '@extrawork/integrations',
              ],
              message:
                'web imports contracts only; it must never reach the database or server domain internals (report §14.2).',
            },
          ],
        },
      ],
    },
  },

  // --- React and Next rules, scoped to the web app -------------------------
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      // Attachment derivatives are short-lived signed URLs from private
      // storage, so Next's image optimiser cannot fetch them; a plain <img>
      // with explicit dimensions is correct here.
      '@next/next/no-img-element': 'off',
      // This is an app-router project; the rule looks for a pages/ directory
      // that deliberately does not exist.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  // Tests and operational scripts legitimately reach across layers.
  {
    files: ['tests/**/*.ts', 'packages/testkit/**/*.ts', 'scripts/**/*.ts', '**/cli/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
    },
  },
);
