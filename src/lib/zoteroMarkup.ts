/**
 * Zotero 标注 / 子笔记的纯转换逻辑（不碰文件、不碰 React）。
 *
 * 职责边界：
 * - 桥接层（electron/zoteroFs.cjs 的 readZoteroMarkup）只从 sqlite 取原始记录；
 * - 这里决定「哪些能画到 PDF 上」「坐标/页码怎么映射」「同步结果怎么写进 sidecar」；
 * - 本地 `.annotations.json` 与 Zotero sidecar 永远分开，同步只替换 sidecar。
 *
 * 身份规则：本地标注 id 由 uid() 生成；Zotero 标注 id 固定为 `zotero-<annotationKey>`。
 * 不用 `zotero:<key>` 是因为 PDF 引用链接的 id 白名单只有 `[a-zA-Z0-9_-]`（page 链接要能回跳）。
 */
import type { PdfAnnotation } from '@/lib/attachments'
import type { PdfSource } from '@/lib/pdfSource'

export type ZoteroAnnotationType = 'highlight' | 'underline' | 'note' | 'image' | 'ink' | 'text' | 'unknown'

/** ok=能画到 PDF；其余三种仍会列在「Zotero 标注」里，只是不画 */
export type ZoteroAnnotationStatus = 'ok' | 'unsupported-type' | 'missing-text' | 'invalid-position'

export interface ZoteroAttachmentInfo {
  key: string
  parentKey: string
  path: string
  fileName: string
  exists: boolean
  /** 本次同步时与 readZoteroPdf 同一规则选出的那份 PDF */
  primary: boolean
}

export interface ZoteroAnnotationRecord {
  key: string
  parentKey: string
  attachmentKey: string
  attachmentPath: string
  type: ZoteroAnnotationType
  text: string
  comment: string
  color: string
  /** Zotero 的 PDF 页索引，从 0 开始；本软件页码 = pageIndex + 1 */
  pageIndex: number | null
  /** 只用于显示（可能是「xiv」「38」这类非数字页码），不能当成页索引 */
  pageLabel: string
  /** PDF 坐标（点、原点左下）；首版只用于展示，不直接拿来画 */
  rects: number[][]
  status: ZoteroAnnotationStatus
  dateAdded: string
  dateModified: string
}

export interface ZoteroNoteRecord {
  key: string
  /** 挂在书目条目或 PDF 附件下 */
  parentKey: string
  html: string
  dateAdded: string
  dateModified: string
}

export interface ZoteroMarkupSkipped {
  unsupportedType: number
  missingText: number
  invalidPosition: number
  /** 属于同一篇文献的另一份 PDF（不能画到当前这份上） */
  otherAttachment: number
}

export interface ZoteroMarkupBundle {
  parentKeys: string[]
  attachment: ZoteroAttachmentInfo | null
  attachments: ZoteroAttachmentInfo[]
  annotations: ZoteroAnnotationRecord[]
  notes: ZoteroNoteRecord[]
  skipped: ZoteroMarkupSkipped
}

export const ZOTERO_ANNOTATION_ID_PREFIX = 'zotero-'

/** 与 Zotero 默认色号一致的合法 CSS 颜色；认不出就用黄色兜底 */
const FALLBACK_COLOR = '#ffd54a'

export function zoteroAnnotationId(key: string): string {
  return `${ZOTERO_ANNOTATION_ID_PREFIX}${String(key || '').replace(/[^a-zA-Z0-9]/g, '')}`
}

export function isZoteroAnnotationId(id: string): boolean {
  return id.startsWith(ZOTERO_ANNOTATION_ID_PREFIX)
}

export function zoteroColor(value: string): string {
  const text = String(value || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    const [, r, g, b] = text
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return FALLBACK_COLOR
}

/** Zotero pageIndex(0 起) → 本软件页码(1 起)；无有效页索引返回 null */
export function pageForZoteroAnnotation(record: Pick<ZoteroAnnotationRecord, 'pageIndex'>): number | null {
  const index = record.pageIndex
  return Number.isInteger(index) && index !== null && index >= 0 ? index + 1 : null
}

export function zoteroAnnotationDrawable(record: ZoteroAnnotationRecord): boolean {
  return record.status === 'ok' && pageForZoteroAnnotation(record) !== null && record.text.trim().length > 0
}

/**
 * Zotero 记录 → 阅读器用的 PdfAnnotation。
 * 首版只用文本锚定（anchor.exact），prefix/suffix 留空；颜色、批注、时间都跟 Zotero 走。
 */
export function mapZoteroAnnotation(record: ZoteroAnnotationRecord): PdfAnnotation | null {
  if (!zoteroAnnotationDrawable(record)) return null
  const page = pageForZoteroAnnotation(record)
  if (page === null) return null
  const created = Date.parse(record.dateAdded)
  return {
    id: zoteroAnnotationId(record.key),
    page,
    color: zoteroColor(record.color),
    anchor: { exact: record.text, prefix: '', suffix: '' },
    comment: record.comment,
    createdAt: Number.isFinite(created) ? created : 0,
    origin: {
      provider: 'zotero',
      key: record.key,
      parentKey: record.parentKey,
      attachmentKey: record.attachmentKey,
      attachmentPath: record.attachmentPath,
      dateModified: record.dateModified,
      readOnly: true,
    },
  }
}

/**
 * 本地标注永远在前且原样保留；Zotero 标注按 id 去重后追加。
 * 同一个 Zotero key 出现在多个 parentKey 下时也只保留一份（桥接层已去重，这里再兜一道）。
 * 已经回写到 Zotero 的本地高亮按 `zotero.key` 认出来：重新同步时不再叠一份只读副本。
 */
export function mergeViewerAnnotations(
  local: PdfAnnotation[],
  zotero: PdfAnnotation[],
): PdfAnnotation[] {
  const pushed = new Set(local.map((item) => item.zotero?.key).filter((key): key is string => Boolean(key)))
  const seen = new Set(local.map((item) => item.id))
  const extra: PdfAnnotation[] = []
  for (const item of zotero) {
    if (seen.has(item.id)) continue
    if (item.origin?.provider === 'zotero' && pushed.has(item.origin.key)) continue
    seen.add(item.id)
    extra.push(item)
  }
  return extra.length ? [...local, ...extra] : local
}

/** 路径规范化：统一分隔符；Windows 盘符路径大小写不敏感 */
export function normalizePdfPath(value: string): string {
  const text = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
  if (!text) return ''
  return /^[a-zA-Z]:\//.test(text) ? text.toLowerCase() : text
}

export function samePdfPath(a: string, b: string): boolean {
  const left = normalizePdfPath(a)
  const right = normalizePdfPath(b)
  return Boolean(left) && left === right
}

/**
 * 当前打开的是哪份 Zotero PDF（没有就看不出、也不能画）。
 * - Zotero 来源：同步时记下的那份（与 readZoteroPdf 的选取规则一致）
 * - 本地 localPdf：按规范化后的绝对路径与附件路径比较（Windows 大小写/分隔符）
 * - vault 内复制的附件：不是 Zotero 那份文件，返回 null（只列文字，不画）
 */
export function zoteroAttachmentForSource(
  source: PdfSource | null,
  file: { attachmentKey: string; attachments: ZoteroAttachmentInfo[] } | null,
): ZoteroAttachmentInfo | null {
  if (!source || !file) return null
  if (source.kind === 'zotero') {
    return file.attachments.find((entry) => entry.key === file.attachmentKey) ?? null
  }
  if (source.kind === 'local' || source.kind === 'local-scan') {
    return file.attachments.find((entry) => samePdfPath(entry.path, source.path)) ?? null
  }
  return null
}

/** 某份附件上可以画到 PDF 的高亮（其它附件的标注不参与绘制） */
export function zoteroAnnotationsForAttachment(
  file: { annotations: ZoteroAnnotationRecord[] } | null,
  attachmentKey: string,
): PdfAnnotation[] {
  if (!file || !attachmentKey) return []
  const out: PdfAnnotation[] = []
  for (const record of file.annotations) {
    if (record.attachmentKey !== attachmentKey) continue
    const mapped = mapZoteroAnnotation(record)
    if (mapped) out.push(mapped)
  }
  return out
}

export function zoteroOtherAttachmentCount(
  file: { annotations: ZoteroAnnotationRecord[] } | null,
  attachmentKey: string,
): number {
  if (!file) return 0
  return file.annotations.filter((record) => record.attachmentKey !== attachmentKey).length
}

function dedupeByKey<T extends { key: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (!item?.key || seen.has(item.key)) continue
    seen.add(item.key)
    out.push(item)
  }
  return out
}

export interface ZoteroMarkupStats {
  /** 能画到 PDF 上的高亮/下划线数 */
  imported: number
  notes: number
  skipped: number
}

export function zoteroMarkupStats(file: {
  annotations: ZoteroAnnotationRecord[]
  notes: ZoteroNoteRecord[]
  skipped: ZoteroMarkupSkipped
}): ZoteroMarkupStats {
  return {
    imported: file.annotations.filter((record) => record.status === 'ok').length,
    notes: file.notes.length,
    skipped:
      file.skipped.unsupportedType + file.skipped.missingText + file.skipped.invalidPosition,
  }
}

/**
 * 「已同步：12 条高亮、3 条 Zotero 笔记；跳过 2 条无法定位或不支持的标注」
 * 高亮只数当前 PDF 附件上的：多份 PDF 时另有一段「另有 N 条属于另一份 PDF」，
 * 否则 58 条里实际只画了 7 条，提示会骗人。
 */
export function zoteroSyncSummary(file: {
  attachmentKey: string
  annotations: ZoteroAnnotationRecord[]
  notes: ZoteroNoteRecord[]
  skipped: ZoteroMarkupSkipped
}): string {
  const stats = zoteroMarkupStats(file)
  const mine = file.attachmentKey
    ? file.annotations.filter((record) => record.status === 'ok' && record.attachmentKey === file.attachmentKey).length
    : stats.imported
  const parts = [`已同步：${mine} 条高亮、${stats.notes} 条 Zotero 笔记`]
  if (stats.skipped) parts.push(`跳过 ${stats.skipped} 条无法定位或不支持的标注`)
  if (file.skipped.otherAttachment) parts.push(`另有 ${file.skipped.otherAttachment} 条属于另一份 PDF`)
  return parts.join('；')
}

export interface ZoteroMarkupPlan {
  file: {
    format: 'kaust-kg-zotero-markup'
    version: 1
    noteId: string
    parentKeys: string[]
    attachmentKey: string
    attachmentPath: string
    attachments: ZoteroAttachmentInfo[]
    annotations: ZoteroAnnotationRecord[]
    notes: ZoteroNoteRecord[]
    skipped: ZoteroMarkupSkipped
    syncedAt: number
  }
  stats: ZoteroMarkupStats
}

/**
 * 同步计划：以「本次完整查询结果」整份替换 sidecar 里的 Zotero 部分。
 * - 完全幂等：同一份库重复同步得到同一组记录（只有 syncedAt 变）；
 * - Zotero 里改颜色/批注/文字 → 新记录直接生效；
 * - Zotero 里删掉的标注 → 不在新结果里，自然消失；
 * - 本地标注不在这个文件里，所以永远不会被删。
 */
export function planZoteroMarkupSync(input: {
  noteId: string
  bundle: ZoteroMarkupBundle
  now?: number
}): ZoteroMarkupPlan {
  const { noteId, bundle, now = Date.now() } = input
  const annotations = dedupeByKey(bundle.annotations)
  const notes = dedupeByKey(bundle.notes)
  const skipped: ZoteroMarkupSkipped = {
    unsupportedType: Number(bundle.skipped?.unsupportedType) || 0,
    missingText: Number(bundle.skipped?.missingText) || 0,
    invalidPosition: Number(bundle.skipped?.invalidPosition) || 0,
    otherAttachment: Number(bundle.skipped?.otherAttachment) || 0,
  }
  const file = {
    format: 'kaust-kg-zotero-markup' as const,
    version: 1 as const,
    noteId,
    parentKeys: [...new Set((bundle.parentKeys ?? []).filter(Boolean))],
    attachmentKey: bundle.attachment?.key ?? '',
    attachmentPath: bundle.attachment?.path ?? '',
    attachments: bundle.attachments ?? [],
    annotations,
    notes,
    skipped,
    syncedAt: now,
  }
  return { file, stats: zoteroMarkupStats(file) }
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, name: string) => {
    const key = name.toLowerCase()
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[key] ?? whole
  })
}

/**
 * Zotero 笔记 HTML → 纯文本。刻意只做「纯文本」：界面不吃 innerHTML，
 * 所以 Zotero 里粘进来的任何标签/脚本都不会进入 DOM（不需要和清洗规则赛跑）。
 */
export function plainTextFromZoteroNote(html: string): string {
  let text = String(html || '')
  text = text.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<li\b[^>]*>/gi, '\n• ')
  text = text.replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre|table|ul|ol)>/gi, '\n')
  text = text.replace(/<[^>]*>/g, '')
  text = decodeEntities(text)
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[\s]+|[\s]+$/g, '')
}

/** 幂等标记：Markdown 渲染器把 HTML 注释解析成空块（不可见），同时让重复导出能被识别 */
export function zoteroNoteMarker(key: string): string {
  return `<!-- zotero-note:${String(key || '').replace(/[^a-zA-Z0-9]/g, '')} -->`
}

export function hasExportedZoteroNote(content: string, key: string): boolean {
  return content.includes(zoteroNoteMarker(key))
}

/** Zotero 的 ISO 时间 → 「2026-10-16 00:26」（本地时区）；无效返回空串 */
export function formatZoteroTime(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 一条 Zotero 笔记 → Markdown 块。标题统一为「Zotero 笔记」，时间进引用块，
 * 末尾的不可见标记用于「同一 note 只导出一次」。
 */
export function zoteroNoteMarkdown(note: ZoteroNoteRecord): string {
  const text = plainTextFromZoteroNote(note.html)
  const body = text || '（这条 Zotero 笔记没有文字内容）'
  const stamp = formatZoteroTime(note.dateModified || note.dateAdded)
  const quoted = body
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
  const header = stamp ? `导入自 Zotero，更新时间：${stamp}` : '导入自 Zotero'
  return `## Zotero 笔记\n\n> ${header}\n>\n${quoted}\n\n${zoteroNoteMarker(note.key)}\n`
}

export function appendZoteroNoteMarkdown(content: string, note: ZoteroNoteRecord): string {
  const clean = content.trimEnd()
  return `${clean ? `${clean}\n\n` : ''}${zoteroNoteMarkdown(note)}`
}

export function zoteroAnnotationStatusLabel(status: ZoteroAnnotationStatus, type: ZoteroAnnotationType): string {
  if (status === 'unsupported-type') {
    if (type === 'image') return '图片标注（不支持在 PDF 上绘制）'
    if (type === 'ink') return '墨迹标注（不支持在 PDF 上绘制）'
    if (type === 'note') return '便签（不支持在 PDF 上绘制）'
    if (type === 'text') return '文本框（不支持在 PDF 上绘制）'
    return '不支持的标注类型'
  }
  if (status === 'missing-text') return '没有文字，无法定位'
  if (status === 'invalid-position') return '位置数据损坏，无法定位'
  return ''
}
