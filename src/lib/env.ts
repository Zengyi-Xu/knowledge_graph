/**
 * 运行环境判别 + 本地设置键管理。
 *
 * 开发版（`vite` 开发服务器、`npm run dev:desktop` 构建的未打包 Electron）与
 * 正式版（打包后的 exe）使用**不同的 localStorage 键前缀**，这样在开发环境里
 * 试验新功能时不会读写到正式版的设置、笔记缓存与 vault 目录。
 *
 * 键名规则：`kg-<base>` / 开发版 `kg-dev-<base>`；旧版（KAUST 命名）的键只在
 * 正式版里做一次性前向迁移，保证已有数据不丢。
 */

declare const __APP_ENV__: string | undefined
declare const __APP_VERSION__: string | undefined

/** 应用显示名（不含机构名） */
export const APP_NAME = '知识图谱'

/** 构建期注入的版本号（来自 package.json），用于「关于/版本」显示 */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

/**
 * 构建期环境：由 vite.config.ts 的 `define` 注入。
 * 浏览器开发服务器 / `--mode development` 构建 = development，其余 = production。
 * 注意：必须在 ENV_LABEL 之前初始化——ENV_LABEL 的求值会调用 isDevApp() 读到这里。
 */
export const BUILD_ENV: 'development' | 'production' =
  typeof __APP_ENV__ === 'string' && __APP_ENV__ === 'development' ? 'development' : 'production'

/** 环境标签：正式版显示版本号，开发版明确标注，避免误把试验环境当正式环境 */
export const ENV_LABEL = isDevApp() ? '开发版' : APP_VERSION

/**
 * 当前是否运行在开发环境：
 * - 浏览器开发服务器；
 * - 未打包的 Electron（`electron .` 加载 dist-dev）；
 * - 显式带 `?dev=1` 打开页面（便于临时排查）。
 */
export function isDevApp(): boolean {
  if (BUILD_ENV === 'development') return true
  if (typeof window !== 'undefined') {
    try {
      if (new URLSearchParams(window.location.search).get('dev') === '1') return true
    } catch {
      /* ignore */
    }
  }
  return false
}

/** `kg-notes-v1` / `kg-dev-notes-v1` */
export function storageKey(base: string): string {
  return isDevApp() ? `kg-dev-${base}` : `kg-${base}`
}

/** Zotero 数据库路径设置键（桌面版可改；本地网页端由服务端启动参数固定） */
export const ZOTERO_DB_KEY = 'zotero-db-v1'

/** 旧版键名（KAUST 命名）→ 仅正式版做一次前向迁移，开发版保持独立 */
const LEGACY_KEYS: Record<string, string[]> = {
  'notes-v1': ['kaust-knowledge-graph-notes-v1'],
  'empty-v1': ['kaust-knowledge-graph-empty'],
  'vault-dir-v1': ['kaust-knowledge-graph-vault-dir'],
  'vault-watch-v1': ['kaust-knowledge-graph-vault-watch'],
  'sync-path-v1': ['kaust-knowledge-graph-sync-path'],
  'auto-sync-v1': ['kaust-knowledge-graph-auto-sync'],
  'sync-baseline-v1': ['kaust-knowledge-graph-sync-baseline'],
  'list-open-v1': ['kaust-kg-list-open'],
  'collapsed-types-v1': ['kaust-kg-collapsed-types'],
  'preview-theme-v1': ['kaust-preview-theme-v1'],
  'custom-preview-theme-v1': ['kaust-custom-preview-theme-v1'],
}

/** 读设置：优先新键；正式版里没有时回退到旧键并前向复制一份 */
export function readSetting(base: string): string | null {
  try {
    const key = storageKey(base)
    const current = localStorage.getItem(key)
    if (current !== null) return current
    if (isDevApp()) return null
    for (const legacy of LEGACY_KEYS[base] ?? []) {
      const old = localStorage.getItem(legacy)
      if (old !== null) {
        // 配额已满时迁移副本会失败，但旧数据仍然可读，不得当作「无笔记」。
        try { localStorage.setItem(key, old) } catch { /* 保留旧键作为可读来源 */ }
        return old
      }
    }
  } catch {
    /* localStorage 不可用（隐私模式等）时按“没有设置”处理 */
  }
  return null
}

export function writeSetting(base: string, value: string): boolean {
  try {
    localStorage.setItem(storageKey(base), value)
    return true
  } catch {
    return false
  }
}

export function removeSetting(base: string): void {
  try {
    localStorage.removeItem(storageKey(base))
  } catch {
    /* ignore */
  }
}
