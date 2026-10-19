/**
 * 「同步 Zotero 分类」对话框的流程层（纯函数 + 一个异步取计划函数）。
 *
 * 对话框只负责状态与渲染，读取 → 计划 → 应用的门槛都收在这里，便于单测：
 * 没有桥（非桌面/非本地网页端）或路径为空时明确报错，绝不静默走空计划。
 */
import type { Note } from '@/types/note'
import { planZoteroSync, type ZoteroItem, type ZoteroSyncPlan, type ZoteroSyncUpdate } from '@/lib/zoteroSync'

/** 读取计划只需要这一个方法（Electron preload / 本地网页端注入的桥的子集） */
export interface ZoteroSyncSource {
  readZotero: (dbPath: string) => Promise<{ collections: string[]; items: ZoteroItem[] }>
}

/** 预览列表最多列出的条数（其余从略） */
export const PREVIEW_LIMIT = 50

/**
 * 只读打开 Zotero 库并算出同步计划。
 * 路径去掉首尾空白后为空、或当前环境没有桥时抛出可展示的错误文案。
 */
export async function readSyncPlan(source: ZoteroSyncSource | undefined, dbPath: string, notes: Note[]): Promise<ZoteroSyncPlan> {
  if (!source) throw new Error('仅桌面版或本地网页端可用：当前环境没有读取 Zotero 的能力')
  const target = dbPath.trim()
  if (!target) throw new Error('请先填写 zotero.sqlite 的完整路径')
  const data = await source.readZotero(target)
  return planZoteroSync(data.items, notes)
}

/** 「读取并预览」按钮：没有路径或正在读取时不可点 */
export function readAction(busy: boolean, dbPath: string): { label: string; disabled: boolean } {
  return { label: busy ? '读取中…' : '读取并预览', disabled: busy || dbPath.trim() === '' }
}

/** 「应用 N 条更新」按钮：0 条更新时禁用（不写空计划） */
export function applyAction(plan: ZoteroSyncPlan): { label: string; disabled: boolean } {
  return { label: `应用 ${plan.updates.length} 条更新`, disabled: plan.updates.length === 0 }
}

/** 预览列表里要列出的更新（最多 PREVIEW_LIMIT 条） */
export function previewUpdates(plan: ZoteroSyncPlan): ZoteroSyncUpdate[] {
  return plan.updates.slice(0, PREVIEW_LIMIT)
}

/** 预览列表是否还有被折叠掉的条目 */
export function hasHiddenUpdates(plan: ZoteroSyncPlan): boolean {
  return plan.updates.length > PREVIEW_LIMIT
}
