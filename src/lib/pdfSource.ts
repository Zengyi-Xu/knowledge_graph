import type { Note } from '@/types/note'
import { readPdf, openPdfExternal } from '@/lib/attachments'
import { readSetting } from '@/lib/env'

export type PdfSource =
  | { kind: 'attachment'; attachmentId: string }
  | { kind: 'local'; path: string }
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
  return attachmentId ? { kind: 'attachment', attachmentId } : null
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
  if (source.kind === 'local') {
    if (!desk?.readExternalPdf) throw new Error('当前版本不支持在软件内读取本地 PDF')
    const result = await desk.readExternalPdf(source.path)
    return { data: bytes(result.data), fileName: result.name, source }
  }
  if (!desk?.readZoteroPdf) throw new Error('当前版本不支持在软件内读取 Zotero PDF')
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
  if (source.kind === 'local') {
    if (!desk?.openExternalFile) throw new Error('当前环境不支持系统阅读器')
    const result = await desk.openExternalFile(source.path)
    if (result.error) throw new Error(result.error)
    return
  }
  if (!desk?.openZoteroPdf) throw new Error('当前环境不支持系统阅读器')
  await desk.openZoteroPdf(desk.isLocalWeb ? '' : source.dbPath, source.key, source.keys)
}

/** 外链 PDF 的标注只写 JSON，不复制 PDF；按笔记 id 得到稳定且安全的一层附件名。 */
export function annotationStoreId(noteId: string, source: PdfSource): string {
  if (source.kind === 'attachment') return source.attachmentId
  return `pdfref-${noteId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}
