import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import pkg from "./package.json" with { type: "json" }

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 开发版与正式版的产物、存储键前缀都分开：
  //   vite dev / --mode development → dist-dev/，__APP_ENV__ = development
  //   vite build（默认）            → dist/，__APP_ENV__ = production
  const appEnv = mode === "development" ? "development" : "production"

  return {
  base: './',
  define: {
    __APP_ENV__: JSON.stringify(appEnv),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: appEnv === "development" ? "dist-dev" : "dist",
  },
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
    watch: {
      // Windows 上并发写入（打包、复制 vendor 资源、别的编辑器保存）会让 chokidar 的
      // 原生 fs.watch 抛 EBUSY，而 Vite 没有兜住这个 error 事件，dev server 会**直接退出**。
      // 改用轮询：不再对单个文件持有句柄，这类崩溃从根上不会发生。
      // 本工程需要监视的文件只有约百个（node_modules/release/dist 已排除），开销可忽略。
      usePolling: true,
      interval: 400,
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/release/**',
        '**/dist/**',
        '**/dist-dev/**',
        '**/.backups/**',
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  }
})
