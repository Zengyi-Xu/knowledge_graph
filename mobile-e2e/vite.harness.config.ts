import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 仅用于移动端适配的本地验证：root 指向 mobile-e2e，
// publicDir 指向合成测试数据目录，绝不加载 public/notes.json。
// 关闭文件监视：无头浏览器的 Chrome profile 会写在 out/ 下，
// 递归 fs.watch 会因 EBUSY 让 dev server 直接退出（见 vite.config.ts 中的同类注释）。
const repoRoot = path.resolve(__dirname, '..')

export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: path.resolve(__dirname, 'public'),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
    fs: { allow: [repoRoot] },
    watch: null,
  },
  resolve: {
    alias: {
      '@': path.resolve(repoRoot, 'src'),
    },
  },
})
