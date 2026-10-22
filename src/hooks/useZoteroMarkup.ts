/**
 * Zotero 标注 / 子笔记的运行时状态（模块级缓存 + 手动同步）。
 *
 * 为什么是模块级而不是 Provider：详情页附件区与全屏阅读工作台会同时存在（工作台是覆盖层），
 * 两边必须读同一份 sidecar、同步后一起刷新；再加一个 Provider 会让 App 整段布局重排。
 * 缓存按 annotationStoreId（同一份 PDF 的标注仓库）分组，与本地标注共用同一个 id。
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Note } from '@/types/note'
import type { PdfSource } from '@/lib/pdfSource'
import {
  readZoteroMarkupFile,
  saveZoteroMarkupFile,
  type ZoteroMarkupFile,
} from '@/lib/attachments'
import { ZOTERO_DB_KEY, readSetting } from '@/lib/env'
import { capability } from '@/lib/capabilities'
import {
  planZoteroMarkupSync,
  zoteroAnnotationsForAttachment,
  zoteroAttachmentForSource,
  zoteroOtherAttachmentCount,
  type ZoteroAttachmentInfo,
  type ZoteroMarkupStats,
} from '@/lib/zoteroMarkup'

interface Slot {
  file: ZoteroMarkupFile | null
  loading: boolean
  syncing: boolean
  error: string
  /** 已经尝试读过磁盘（成功或失败都算），避免每次重挂载都再读一遍 */
  loaded: boolean
}

const EMPTY: Slot = { file: null, loading: false, syncing: false, error: '', loaded: false }
const slots = new Map<string, Slot>()
const listeners = new Set<() => void>()
const pending = new Map<string, Promise<void>>()

function getSlot(id: string): Slot {
  return slots.get(id) ?? EMPTY
}

function setSlot(id: string, next: Slot): void {
  if (!id) return
  slots.set(id, next)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function ensureLoaded(id: string): void {
  if (!id) return
  const slot = getSlot(id)
  if (slot.loaded || slot.loading || pending.has(id)) return
  setSlot(id, { ...slot, loading: true })
  const task = readZoteroMarkupFile(id)
    .then((file) => {
      // 读失败（浏览器没有附件桥、文件损坏）不弹错：界面按「没有已同步数据」处理，同步时会给出明确原因
      setSlot(id, { file, loading: false, syncing: false, error: '', loaded: true })
    })
    .catch(() => {
      setSlot(id, { file: null, loading: false, syncing: false, error: '', loaded: true })
    })
    .finally(() => pending.delete(id))
  pending.set(id, task)
}

/** 重新从磁盘读 sidecar（外部同步、另一个标签页写入后用） */
export function refreshZoteroMarkup(id: string): void {
  if (!id) return
  slots.delete(id)
  for (const listener of listeners) listener()
  ensureLoaded(id)
}

/** 文中有没有可用于同步的 Zotero 条目 key */
export function zoteroKeysOf(note: Note): { key: string; keys: string[] } {
  const lit = note.literature
  const keys = (lit?.zoteroKeys ?? []).filter((value) => typeof value === 'string' && /^[A-Z0-9]{8}$/i.test(value))
  const key = lit?.zoteroKey && /^[A-Z0-9]{8}$/i.test(lit.zoteroKey) ? lit.zoteroKey : keys[0] ?? ''
  return { key, keys }
}

/** 同步前置条件：没有 key / 没有可保存的 PDF / 当前环境没有只读 Zotero 接口 / 没选数据库时给出原因（空串=可同步） */
export function zoteroSyncBlockReason(note: Note, storeId?: string): string {
  const { key } = zoteroKeysOf(note)
  if (!key) return '这篇笔记没有 Zotero 条目 key'
  // 空串 = 已确认「这份 PDF 没有可用的标注仓库」；undefined = 调用方还没算出来，不做这项判断
  if (storeId === '') return '这篇文献没有可读取的 PDF，无法保存同步结果'
  if (typeof window === 'undefined') return '当前环境不支持读取 Zotero'
  const desk = window.knowledgeGraphDesktop
  if (!desk?.readZoteroMarkup) return capability('zoteroSqlite').reason
  if (!desk.isLocalWeb) {
    const dbPath = readSetting(ZOTERO_DB_KEY) || desk.defaultZoteroDb || ''
    if (!dbPath) return '请先在设置里选择 Zotero 数据库（zotero.sqlite）'
  }
  return ''
}

export interface ZoteroSyncOutcome {
  file: ZoteroMarkupFile
  stats: ZoteroMarkupStats
}

/**
 * 手动同步一篇文献的 Zotero 标注与子笔记（只读 Zotero）。
 * 只有「查询 + 写 sidecar」都成功才更新状态；任何一步失败都保留上一次的数据。
 */
export async function syncZoteroMarkup(note: Note, storeId: string): Promise<ZoteroSyncOutcome> {
  if (!storeId) throw new Error('这篇文献没有可读取的 PDF，无法保存同步结果')
  const reason = zoteroSyncBlockReason(note, storeId)
  if (reason) throw new Error(reason)
  const desk = window.knowledgeGraphDesktop
  if (!desk?.readZoteroMarkup) throw new Error(capability('zoteroSqlite').reason)
  const { key, keys } = zoteroKeysOf(note)
  const dbPath = desk.isLocalWeb ? '' : readSetting(ZOTERO_DB_KEY) || desk.defaultZoteroDb || ''
  const slot = getSlot(storeId)
  if (slot.syncing) throw new Error('正在同步，请稍候')
  setSlot(storeId, { ...slot, syncing: true, error: '' })
  try {
    const bundle = await desk.readZoteroMarkup(dbPath, key, keys)
    const plan = planZoteroMarkupSync({ noteId: note.id, bundle })
    await saveZoteroMarkupFile(storeId, plan.file)
    setSlot(storeId, { file: plan.file, loading: false, syncing: false, error: '', loaded: true })
    return { file: plan.file, stats: plan.stats }
  } catch (error) {
    const message = error instanceof Error ? error.message : '同步 Zotero 标注失败'
    setSlot(storeId, { ...getSlot(storeId), syncing: false, error: message })
    throw error instanceof Error ? error : new Error(message)
  }
}

/** 在 Zotero 里定位条目（zotero://select）；只接受 8 位条目 key */
export async function openZoteroItem(key: string): Promise<void> {
  if (!/^[A-Z0-9]{8}$/i.test(key)) throw new Error('无效的 Zotero 条目 key')
  const desk = window.knowledgeGraphDesktop
  if (!desk?.selectZoteroItem) throw new Error(capability('systemOpener').reason)
  const result = await desk.selectZoteroItem(key)
  if (result?.error) throw new Error(result.error)
}

export interface ZoteroMarkupView {
  file: ZoteroMarkupFile | null
  loading: boolean
  syncing: boolean
  error: string
  /** 当前这份 PDF 对应的 Zotero 附件（null = 这份 PDF 不在 Zotero 里） */
  attachment: ZoteroAttachmentInfo | null
  /** 能画到当前 PDF 上的 Zotero 高亮 */
  drawable: ReturnType<typeof zoteroAnnotationsForAttachment>
  otherAttachment: number
  /** 附件对不上时的提示（空串=没有警告） */
  warning: string
  canSync: boolean
  blockReason: string
  sync: () => Promise<ZoteroSyncOutcome>
  refresh: () => void
}

export function useZoteroMarkup(input: {
  note: Note
  source: PdfSource | null
  storeId: string
}): ZoteroMarkupView {
  const { note, source, storeId } = input
  const slot = useSyncExternalStore(
    subscribe,
    () => getSlot(storeId),
    () => EMPTY,
  )

  useEffect(() => {
    ensureLoaded(storeId)
  }, [storeId])

  const attachment = useMemo(() => zoteroAttachmentForSource(source, slot.file), [source, slot.file])
  const drawable = useMemo(
    () => zoteroAnnotationsForAttachment(slot.file, attachment?.key ?? ''),
    [slot.file, attachment],
  )
  const otherAttachment = useMemo(
    () => zoteroOtherAttachmentCount(slot.file, attachment?.key ?? ''),
    [slot.file, attachment],
  )

  const warning = useMemo(() => {
    const file = slot.file
    if (!file || !file.attachments.length || attachment) return ''
    if (!file.annotations.length && !file.notes.length) return ''
    if (source?.kind === 'attachment') {
      return '当前阅读的是 vault 里的 PDF 副本：Zotero 标注属于它在 Zotero 里的原文件，不在这份副本上绘制。'
    }
    return '这些标注属于另一份 Zotero PDF，不在当前 PDF 上绘制；文字列表仍可查看和导出。'
  }, [slot.file, attachment, source])

  const blockReason = useMemo(() => zoteroSyncBlockReason(note, storeId), [note, storeId])
  const sync = useCallback(() => syncZoteroMarkup(note, storeId), [note, storeId])
  const refresh = useCallback(() => refreshZoteroMarkup(storeId), [storeId])

  return {
    file: slot.file,
    loading: slot.loading,
    syncing: slot.syncing,
    error: slot.error,
    attachment,
    drawable,
    otherAttachment,
    warning,
    canSync: !blockReason,
    blockReason,
    sync,
    refresh,
  }
}
