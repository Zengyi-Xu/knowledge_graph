import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    // 依赖与 VCS（node_modules/.git 已有 ESLint 默认忽略，这里显式列出保证稳定）
    'node_modules/**',
    '.git/**',

    // 构建产物 / 发布产物（release、release-*、dist、dist-*、build、build-*）
    'release/**',
    'release-*/**',
    'dist/**',
    'dist-*/**',
    'build/**',
    'build-*/**',

    // 编辑器运行时资源（public/vditor 为 vendor 依赖，冻结黑箱，不入 lint）
    'public/vditor/**',

    // 本地临时目录 / 测试脚手架产物
    '.tmp-*/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // 本项目未启用 React Compiler，只保留经典两条 hooks 规则；
      // 不引入 react-hooks 的编译器专属规则（immutability/refs/purity/set-state-in-effect 等），
      // 它们会误伤账本式 hook（mutable ledger、refs-in-render）这类有意为之的非编译器写法。
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // shadcn/ui 生成组件是冻结单元（tier 1），不得改源文件消警；
    // 生成组件常见“组件 + 非组件（variants/helpers）同文件导出”，这里窄范围豁免。
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // 构建/测试脚本由 esbuild 打包（非 Vite HMR 目标），不适用 fast-refresh 规则
    files: ['scripts/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // 测试替身文件实现 hooks 本身（scripts/harness/react-shim.ts），不适用 React 组件 hooks 规则
    files: ['scripts/harness/**'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
])
