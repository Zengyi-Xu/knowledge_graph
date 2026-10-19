import type { Note } from '@/types/note'
import { readPdf, openPdfExternal } from '@/lib/attachments'
import { readSetting } from '@/lib/env'
import { capability } from '@/lib/capabilities'
import { localPdfMatch } from '@/lib/localPdfFallback'

export type PdfSource =
  | { kind: 'attachment'; attachmentId: string }
  | { kind: 'local'; path: string }
  /** 按标题在本机授权目录里兜底匹配到的 PDF（未记入笔记的 localPdf） */
  | { kind: 'local-scan'; path: string }
  | { kind: 'zotero'; dbPath: string; key: string; keys: string[] }

export interface LoadedPdf {
  data: Uint8Array
  fileName: string
  source: PdfSource
}

const ZOTERO_DB_KEY = 'zotero-db-v1'

export function preferredPdfSource(note: Note): PdfSource | null {
  const lit = note.literature
  if (!lit) return null
  if (lit.localPdf) return { kind: 'local', path: lit.localPdf }
  if (lit.zoteroKey && (lit.zoteroAvailablePdfCount ?? 0) > 0) {
    const desk = window.knowledgeGraphDesktop
    return {
      kind: 'zotero',
      dbPath: readSetting(ZOTERO_DB_KEY) || desk?.defaultZoteroDb || '',
      key: lit.zoteroKey,
      keys: lit.zoteroKeys ?? [],
    }
  }
  const attachmentId = lit.attachments?.[0]
  if (attachmentId) return { kind: 'attachment', attachmentId }
  // 兜底：字段都缺时用「按标题在本机授权目录里匹配到的 PDF」（只提名，未记入笔记）
  const matched = localPdfMatch(note)
  return matched ? { kind: 'local-scan', path: matched.path } : null
}

/**
 * 笔记里「应用外」的 PDF（`localPdf` / Zotero），即详情页附件区要额外呈现的那一份。
 * 附件（vault 内复制的 PDF）由附件列表自己管，这里不返回——复用同一优先级，避免两处规则漂移。
 */
export function externalPdfSource(note: Note): PdfSource | null {
  const source = preferredPdfSource(note)
  return source && source.kind !== 'attachment' ? source : null
}

/** 来源身份：同一个 PDF 的多次读取要命中同一个缓存键 */
export function pdfSourceKey(source: PdfSource): string {
  if (source.kind === 'attachment') return `attachment\u0000${source.attachmentId}`
  if (source.kind === 'local') return `local\u0000${source.path}`
  if (source.kind === 'local-scan') return `local-scan\u0000${source.path}`
  return `zotero\u0000${source.dbPath}\u0000${source.key}\u0000${source.keys.join(',')}`
}

/**
 * 会话内的字节缓存：详情页快照、就地阅读面板、全屏工作台读的是同一份 PDF，
 * 缓存让第二、第三次打开不必再跨桥读一遍整份文件。
 * 只留最近两份、且单份超过 CACHE_MAX_BYTES 就不进缓存（大 PDF 不长期占内存）。
 */
const CACHE_MAX_ENTRIES = 2
const CACHE_MAX_BYTES = 32 * 1024 * 1024
const cache = new Map<string, LoadedPdf>()

/** 已经读过的 PDF（没读过返回 null）；调用方据此判断「能不能直接出快照」 */
export function cachedPdfSource(source: PdfSource): LoadedPdf | null {
  return cache.get(pdfSourceKey(source)) ?? null
}

export async function loadPdfSourceCached(source: PdfSource): Promise<LoadedPdf> {
  const hit = cachedPdfSource(source)
  if (hit) return hit
  const loaded = await loadPdfSource(source)
  if (loaded.data.length <= CACHE_MAX_BYTES) {
    const key = pdfSourceKey(source)
    cache.delete(key)
    cache.set(key, loaded)
    while (cache.size > CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }
  return loaded
}

function bytes(data: Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data)
}

export async function loadPdfSource(source: PdfSource): Promise<LoadedPdf> {
  const desk = window.knowledgeGraphDesktop
  if (source.kind === 'attachment') {
    const data = await readPdf(source.attachmentId)
    if (!data) throw new Error('PDF 附件不存在')
    return { data: bytes(data), fileName: `${source.attachmentId}.pdf`, source }
  }
  if (source.kind === 'local' || source.kind === 'local-scan') {
    // 明确降级：说清 localPdf 是「运行本机服务那台电脑上的绝对路径」
    if (!desk?.readExternalPdf) throw new Error(capability('localPdf').reason)
    const result = await desk.readExternalPdf(source.path)
    return { data: bytes(result.data), fileName: result.name, source }
  }
  if (!desk?.readZoteroPdf) throw new Error(capability('zoteroSqlite').reason)
  const result = await desk.readZoteroPdf(desk.isLocalWeb ? '' : source.dbPath, source.key, source.keys)
  return { data: bytes(result.data), fileName: result.name, source }
}

export async function openPdfSourceExternally(source: PdfSource): Promise<void> {
  const desk = window.knowledgeGraphDesktop
  if (source.kind === 'attachment') {
    const error = await openPdfExternal(source.attachmentId)
    if (error) throw new Error(error)
    return
  }
  if (source.kind === 'local' || source.kind === 'local-scan') {
    if (!desk?.openExternalFile) throw new Error(capability('systemOpener').reason)
    const result = await desk.openExternalFile(source.path)
    if (result.error) throw new Error(result.error)
    return
  }
  if (!desk?.openZoteroPdf) throw new Error(capability('systemOpener').reason)
  await desk.openZoteroPdf(desk.isLocalWeb ? '' : source.dbPath, source.key, source.keys)
}

/** 外链 PDF 的标注只写 JSON，不复制 PDF；按笔记 id 得到稳定且安全的一层附件名。 */
export function annotationStoreId(noteId: string, source: PdfSource): string {
  if (source.kind === 'attachment') return source.attachmentId
  return `pdfref-${noteId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}
