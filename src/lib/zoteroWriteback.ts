/**
 * Zotero 回写（单向、只增）的纯逻辑：挑出可回写的本地高亮、生成 Zotero 的
 * annotation 请求体、把返回的 key 记回本地标注、生成结果文案。
 *
 * 边界：
 * - 只回写「本软件里画的」高亮（`origin` 为空），Zotero 自己的标注永远只读；
 * - 只回写有 PDF 坐标的（老版本画的没有坐标，直接跳过并计数，不猜坐标）；
 * - 已经回写过的（有 `zotero.key`）不再提交，避免每点一次就多一条；
 * - 不删、不改 Zotero 里的任何对象，写入的是新的 annotation 条目。
 */
import type { PdfAnnotation, PdfAnnotationsFile } from '@/lib/attachments'
import type { ZoteroAttachmentInfo } from '@/lib/zoteroMarkup'

/** 回写到 Zotero 的一条高亮（服务端按这个结构组装 annotation 条目） */
export interface ZoteroWriteAnnotation {
  /** 本地标注 id：服务端只用来回传对应关系 */
  id: string
  text: string
  comment: string
  color: string
  pageLabel: string
  sortIndex: string
  /** `JSON.stringify({ pageIndex, rects })`，原样作为 annotationPosition */
  position: string
}

export type ZoteroLocalApiErrorCode =
  | 'unavailable'
  | 'unsupported'
  | 'unauthorized'
  | 'denied'
  | 'rate-limited'
  | 'locked'
  | 'server-changed'
  | 'bad-request'
  | 'failed'

export interface ZoteroLocalApiStatus {
  action: 'status'
  available: boolean
  serverId: string
  version: string
  /** Zotero 10+ 才带 Server ID，写入也只有 10+ 支持 */
  writeSupported: boolean
  error: string
}

export interface ZoteroLocalApiAuthorize {
  action: 'authorize'
  ok: boolean
  remember: boolean
  code?: ZoteroLocalApiErrorCode
  error?: string
}

export interface ZoteroLocalApiSaved {
  index: number
  id: string
  key: string
}

export interface ZoteroLocalApiFailure {
  index: number
  id: string
  message: string
}

export interface ZoteroLocalApiWrite {
  action: 'write'
  ok: boolean
  saved: ZoteroLocalApiSaved[]
  failed: ZoteroLocalApiFailure[]
  code?: ZoteroLocalApiErrorCode
  error?: string
}

export type ZoteroLocalApiResult = ZoteroLocalApiStatus | ZoteroLocalApiAuthorize | ZoteroLocalApiWrite

export type ZoteroLocalApiRequest =
  | { action: 'status' }
  | { action: 'authorize' }
  | { action: 'write'; attachmentKey: string; annotations: ZoteroWriteAnnotation[] }

// ---------------------------------------------------------------------------
// 挑选与请求体
// ---------------------------------------------------------------------------

export type WritebackSkipReason = 'zotero-origin' | 'no-position' | 'empty-text' | 'already-pushed'

export interface WritebackSkip {
  id: string
  reason: WritebackSkipReason
  text: string
}

export interface WritebackPlanItem {
  id: string
  payload: ZoteroWriteAnnotation
}

export interface WritebackPlan {
  items: WritebackPlanItem[]
  skipped: WritebackSkip[]
  total: number
  /** 非空 = 整篇都不能回写（当前 PDF 不是 Zotero 里的那份附件） */
  blockReason: string
}

const ATTACHMENT_KEY_RE = /^[A-Za-z0-9]{8}$/
const MAX_RECTS = 200

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function clampInt(value: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.floor(value) : min
  return Math.min(max, Math.max(min, n))
}

/**
 * Zotero 的 annotationSortIndex：`页|字符偏移|距页顶`，三段各自补零。
 * 只影响 Zotero 里同一页高亮的排序；缺字符偏移时给 0，格式必须合法。
 */
export function buildZoteroSortIndex(input: {
  pageIndex: number
  /** 距页顶的 PDF 坐标（pageHeight - rect 上沿） */
  top: number
  /** 页内第一个非空白字符的序号（Zotero 数非空白字符） */
  charOffset?: number
}): string {
  return [
    pad(clampInt(input.pageIndex, 0, 99999), 5),
    pad(clampInt(input.charOffset ?? 0, 0, 999999), 6),
    pad(clampInt(Math.max(0, input.top), 0, 99999), 5),
  ].join('|')
}

/** Zotero 数页内字符时跳过空格与控制字符（与它的 pdf.js 文本提取口径一致） */
export function countedCharOffset(pageText: string, textOffset: number): number {
  if (!pageText) return 0
  const limit = clampInt(Math.min(pageText.length, textOffset), 0, pageText.length)
  let count = 0
  for (let i = 0; i < limit; i++) {
    const code = pageText.charCodeAt(i)
    const char = pageText[i]
    if (char === ' ' || code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue
    count++
  }
  return count
}

/** 本地标注能不能回写；能回写返回空串 */
export function writebackSkipReason(annotation: PdfAnnotation): WritebackSkipReason | '' {
  if (annotation.origin?.provider === 'zotero') return 'zotero-origin'
  if (annotation.zotero?.key) return 'already-pushed'
  if (!annotation.anchor?.exact?.trim()) return 'empty-text'
  const position = annotation.position
  if (!position || !Array.isArray(position.rects) || position.rects.length === 0) return 'no-position'
  if (!Number.isFinite(position.pageIndex) || position.pageIndex < 0) return 'no-position'
  return ''
}

/** 一条本地高亮 → Zotero annotation 请求体；不可回写时返回 null */
export function zoteroWriteAnnotation(annotation: PdfAnnotation): ZoteroWriteAnnotation | null {
  if (writebackSkipReason(annotation)) return null
  const position = annotation.position!
  const rects = position.rects
    .filter((rect) => Array.isArray(rect) && rect.length === 4 && rect.every((n) => Number.isFinite(n)))
    .slice(0, MAX_RECTS)
    .map((rect) => rect.map((n) => Math.round(n * 10000) / 10000) as [number, number, number, number])
  if (!rects.length) return null
  const label = annotation.pageLabel?.trim() || String(annotation.page)
  return {
    id: annotation.id,
    text: annotation.anchor.exact,
    comment: annotation.comment ?? '',
    color: annotation.color,
    pageLabel: label,
    sortIndex: annotation.sortIndex?.trim() || buildZoteroSortIndex({ pageIndex: position.pageIndex, top: 0 }),
    position: JSON.stringify({ pageIndex: position.pageIndex, rects }),
  }
}

/**
 * 一篇文献的回写计划：只含「能提交的」与「跳过的（带原因）」，总数 = 两者之和。
 * `attachmentKey` 是当前 PDF 在 Zotero 里的附件 key（由同步结果确定）。
 */
export function planZoteroWriteback(input: {
  annotations: PdfAnnotation[]
  attachmentKey: string
}): WritebackPlan {
  const total = input.annotations.length
  if (!ATTACHMENT_KEY_RE.test(input.attachmentKey)) {
    return {
      items: [],
      skipped: [],
      total,
      blockReason: '当前 PDF 不是 Zotero 里的那份附件：先在 Zotero 里给这篇文献挂上 PDF，再点「同步 Zotero 标注」确认附件',
    }
  }
  const items: WritebackPlanItem[] = []
  const skipped: WritebackSkip[] = []
  for (const annotation of input.annotations) {
    const reason = writebackSkipReason(annotation)
    if (reason) {
      skipped.push({ id: annotation.id, reason, text: annotation.anchor?.exact ?? '' })
      continue
    }
    const payload = zoteroWriteAnnotation(annotation)
    if (!payload) {
      skipped.push({ id: annotation.id, reason: 'no-position', text: annotation.anchor?.exact ?? '' })
      continue
    }
    items.push({ id: annotation.id, payload })
  }
  return { items, skipped, total, blockReason: '' }
}

/** 回写前置条件（空串=可以点回写） */
export function zoteroWritebackBlockReason(input: {
  attachment: ZoteroAttachmentInfo | null
  pending: number
  bridge: boolean
}): string {
  if (!input.bridge) return '当前环境没有重启 Zotero 写入接口所需的桌面/本机服务'
  if (!input.attachment) return '当前 PDF 不是 Zotero 里的那份附件，无法确定回写目标'
  if (input.pending === 0) return '没有需要回写的高亮'
  return ''
}

// ---------------------------------------------------------------------------
// 结果落地与文案
// ---------------------------------------------------------------------------

/**
 * 把 Zotero 返回的 key 记到本地标注上（只改命中的那几条）。
 * 回写成功后重新同步 Zotero 时，这些 key 会让合并逻辑跳过「自己刚写进去的那一条」。
 */
export function applyZoteroWriteback(
  file: PdfAnnotationsFile,
  input: { saved: ZoteroLocalApiSaved[]; attachmentKey: string; syncedAt?: number },
): PdfAnnotationsFile {
  if (!input.saved.length) return file
  const byId = new Map(input.saved.map((entry) => [entry.id, entry.key]))
  const syncedAt = input.syncedAt ?? Date.now()
  return {
    ...file,
    items: file.items.map((item) => {
      const key = byId.get(item.id)
      if (!key) return item
      return { ...item, zotero: { key, attachmentKey: input.attachmentKey, syncedAt } }
    }),
  }
}

export interface WritebackOutcome {
  saved: number
  failed: number
  skipped: number
  /** 第一条失败原因，用来在 toast 里说清楚为什么 */
  firstError?: string
}

function skippedSummary(skipped: number): string {
  return skipped > 0 ? `，跳过 ${skipped} 条` : ''
}

/** 回写结果文案（toast 用） */
export function writebackSummary(outcome: WritebackOutcome): string {
  const { saved, failed, skipped, firstError } = outcome
  if (saved > 0 && failed === 0) return `已回写 ${saved} 条高亮到 Zotero${skippedSummary(skipped)}`
  if (saved > 0 && failed > 0) {
    return `已回写 ${saved} 条，${failed} 条失败${firstError ? `：${firstError}` : ''}`
  }
  if (failed > 0) return `回写失败${firstError ? `：${firstError}` : `（${failed} 条）`}`
  return `没有需要回写的高亮${skippedSummary(skipped)}`
}

/** 跳过原因的人话（面板/提示里用） */
export function writebackSkipLabel(reason: WritebackSkipReason): string {
  switch (reason) {
    case 'zotero-origin':
      return '来自 Zotero（只读）'
    case 'no-position':
      return '缺少 PDF 坐标（在旧版本里画的）'
    case 'empty-text':
      return '没有选中文字'
    case 'already-pushed':
      return '已经回写过'
    default:
      return '不可回写'
  }
}
