/**
 * 渲染进程侧的 vault 访问封装：只做能力探测与 IPC 转发，格式语义在 vaultFormat.ts。
 * 浏览器版没有文件系统权限，这里的所有函数都会返回「不支持」，由 useNotes 回退到 localStorage。
 */
import type { VaultDirListing } from '@/types/desktop'
import type { VaultWritePlan } from '@/lib/vaultFormat'
import { isDesktop } from '@/lib/syncFile'
import { readSetting } from '@/lib/env'

/** 设置键基名；实际键由 src/lib/env.ts 加 `kg-` / `kg-dev-` 前缀 */
export const VAULT_DIR_KEY = 'vault-dir-v1'

/**
 * 当前生效的笔记目录：优先用户在界面里选择的，其次运行时注入的默认目录
 * （桌面端由 Electron 探测、本地网页端由启动参数注入）。
 * 附件、写盘等能力判断都必须用这个，否则桌面端会用「没选过目录」的假象。
 */
export function resolvedVaultDir(): string {
  return readSetting(VAULT_DIR_KEY) || window.knowledgeGraphDesktop?.defaultVaultDir || ''
}

/** 设置键基名；实际键由 src/lib/env.ts 加 `kg-` / `kg-dev-` 前缀 */
export const VAULT_WATCH_KEY = 'vault-watch-v1'

export function vaultSupported(): boolean {
  return typeof window !== 'undefined' && Boolean(window.knowledgeGraphDesktop?.listVault)
}

/** 原生目录选择框；取消返回 null */
export async function chooseVaultDir(): Promise<string | null> {
  const api = window.knowledgeGraphDesktop
  if (!api?.chooseVaultDir) return null
  try {
    return await api.chooseVaultDir()
  } catch {
    return null
  }
}

/** 列目录（含 meta.json 内容与所有 md 的 stat）；不支持或失败返回 null */
export async function listVault(dir: string): Promise<VaultDirListing | null> {
  const api = window.knowledgeGraphDesktop
  if (!api?.listVault || !dir) return null
  try {
    const listing = await api.listVault(dir)
    if (!listing || typeof listing !== 'object') return null
    return {
      exists: Boolean(listing.exists),
      meta: typeof listing.meta === 'string' ? listing.meta : null,
      md: Array.isArray(listing.md) ? listing.md : [],
    }
  } catch {
    return null
  }
}

/** 按名字读取若干 md 正文；读不到的（已被删除）不会出现在返回的 Map 里 */
export async function readVaultTexts(dir: string, names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const api = window.knowledgeGraphDesktop
  if (names.length === 0) return out
  if (!api?.readVaultFiles || !dir) throw new Error('vault 读取不可用，不能将未读取的文件视作已删除')
  const files = await api.readVaultFiles(dir, names)
  for (const f of files ?? []) {
    if (f && typeof f.name === 'string' && typeof f.text === 'string') out.set(f.name, f.text)
  }
  return out
}

/** 执行一次写盘（写 md → 删旧文件 → 写 meta） */
export async function writeVaultPlan(
  dir: string,
  plan: VaultWritePlan,
): Promise<{ written: number; deleted: number }> {
  const api = window.knowledgeGraphDesktop
  if (!api?.writeVault) throw new Error('vault 写入不可用（仅桌面版支持）')
  return api.writeVault(dir, {
    writes: plan.writes.map((w) => ({ file: w.file, text: w.text })),
    deletes: plan.deletes,
    // meta 没变化时传 null，避免无意义地刷新 meta.json 的 mtime
    meta: plan.metaSkipped ? null : plan.meta,
  })
}

export async function openVaultDir(dir: string): Promise<string | null> {
  const api = window.knowledgeGraphDesktop
  if (!api?.openVaultDir || !dir) return 'vault 目录不可用'
  try {
    const r = await api.openVaultDir(dir)
    return r?.error ?? null
  } catch {
    return '打开目录失败'
  }
}

export { isDesktop }
