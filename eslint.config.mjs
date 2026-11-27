import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

const NODE_BUILTINS = [
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'net',
  'os',
  'path',
  'process',
  'stream',
  'url',
  'util',
  'worker_threads',
  'zlib'
]

export default defineConfig(
  {
    ignores: ['**/node_modules', '**/dist', '**/out', 'test-results', 'playwright-report']
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  // src/core must stay pure TypeScript (see docs/spec/01-architecture.md).
  // tsconfig.core.json blocks DOM/Node globals; this rule blocks imports.
  {
    files: ['src/core/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'src/core must not depend on Electron.' },
            ...NODE_BUILTINS.map((name) => ({
              name,
              message: 'src/core must not use Node built-ins. Use a pure library (e.g. fflate).'
            }))
          ],
          patterns: [
            { group: ['node:*'], message: 'src/core must not use Node built-ins.' },
            {
              group: ['@renderer/*', '**/renderer/**'],
              message: 'src/core must not import renderer code.'
            },
            {
              group: ['**/main/**', '**/preload/**'],
              message: 'src/core must not import main/preload code.'
            }
          ]
        }
      ]
    }
  },
  eslintConfigPrettier
)
