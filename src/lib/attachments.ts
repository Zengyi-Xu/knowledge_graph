/**
 * 渲染进程侧的附件访问封装（vault 内 attachments/ 目录）。
 * 浏览器版没有桌面文件 API：这里统一抛「附件仅桌面版可用」，由 UI 降级提示。
 */
import { uid } from '@/types/note'
import { resolvedVaultDir } from '@/lib/vaultFs'
import { capability } from '@/lib/capabilities'
import type { ZoteroAnnotationRecord, ZoteroAttachmentInfo, ZoteroNoteRecord, ZoteroMarkupSkipped } from '@/lib/zoteroMarkup'

/**
 * PDF 坐标（与 Zotero 的 `annotationPosition` 同款）：`pageIndex` 从 0 开始，
 * rects 是 `[x1, y1, x2, y2]`，左下原点、单位 point。回写 Zotero 时原样提交。
 */
export interface PdfAnnotationPosition {
  pageIndex: number
  rects: [number, number, number, number][]
}

/** 这条本地高亮已经回写到 Zotero 时记下的 key（回写只处理没有这个字段的） */
export interface PdfAnnotationZoteroLink {
  key: string
  attachmentKey: string
  syncedAt: number
}

/** 标注 JSON 结构（见 docs/VAULT_FORMAT.md） */
export interface PdfAnnotation {
  id: string
  page: number
  color: string
  anchor: { exact: string; prefix: string; suffix: string }
  comment: string
  createdAt: number
  /** 来自 Zotero 的只读标注：不写进本地 .annotations.json，也不允许在本软件里改/删 */
  origin?: {
    provider: 'zotero'
    key: string
    parentKey: string
    attachmentKey: string
    attachmentPath: string
    dateModified: string
    readOnly: true
  }
  /** 创建时记下的 PDF 坐标（老数据没有；没有坐标的高亮不参与回写） */
  position?: PdfAnnotationPosition
  /** 创建时 Zotero 会显示的页码标签（可能是 "xiv"）；缺省时回写用页码数字 */
  pageLabel?: string
  /** Zotero 的排序键「页|字符偏移|距页顶」，只影响 Zotero 标注列表里的顺序 */
  sortIndex?: string
  /** 已经回写到 Zotero：记下 key，之后不再重复创建，重新导入时也不会出现重复条目 */
  zotero?: PdfAnnotationZoteroLink
}

export interface PdfAnnotationsFile {
  format: 'kaust-kg-pdf-annotations'
  version: 1
  fileName: string
  items: PdfAnnotation[]
}

export const PDF_ANNOTATIONS_FORMAT = 'kaust-kg-pdf-annotations'

/**
 * Zotero 标注 / 子笔记 sidecar（`attachments/<storeId>.zotero.json`）。
 * 与本地 `.annotations.json` 完全独立：同步只替换这一份，绝不覆盖用户自己画的高亮。
 */
export interface ZoteroMarkupFile {
  format: 'kaust-kg-zotero-markup'
  version: 1
  noteId: string
  parentKeys: string[]
  /** 本次同步时 readZoteroPdf 会打开的那份附件（按 key 顺序首个存在的 PDF） */
  attachmentKey: string
  attachmentPath: string
  attachments: ZoteroAttachmentInfo[]
  annotations: ZoteroAnnotationRecord[]
  notes: ZoteroNoteRecord[]
  skipped: ZoteroMarkupSkipped
  syncedAt: number
}

export const ZOTERO_MARKUP_FORMAT = 'kaust-kg-zotero-markup'

/** 附件能力是否可用（桌面版 + 已选 vault 目录） */
export function attachmentsSupported(): boolean {
  return Boolean(window.knowledgeGraphDesktop?.readAttachment) && Boolean(vaultDir())
}

function vaultDir(): string {
  return resolvedVaultDir()
}

function api() {
  const desk = window.knowledgeGraphDesktop
  // 明确降级：附件（PDF 标注）要求「本机服务 + 运行服务的那台电脑」
  if (!desk?.readAttachment || !desk.writeAttachment) throw new Error(capability('vaultAttachments').reason)
  const dir = vaultDir()
  if (!dir) throw new Error('请先选择笔记目录（附件保存在笔记目录的 attachments/ 里）')
  return { desk, dir }
}

const pdfRel = (id: string) => `attachments/${id}.pdf`
const annRel = (id: string) => `attachments/${id}.annotations.json`
const zoteroMarkupRel = (id: string) => `attachments/${id}.zotero.json`
/** 一层安全文件名：storeId 由 annotationStoreId() 生成，这里再兜一道，绝不接受路径片段 */
const STORE_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/

/** 列出附件目录（attachments/ 内全部文件） */
export async function listAttachmentFiles(): Promise<{ name: string; mtimeMs: number; size: number }[]> {
  const { desk, dir } = api()
  return desk.listAttachments(dir)
}

/** 添加 PDF：写入 attachments/<id>.pdf 并建一个带原始文件名的空标注 JSON；返回附件 id */
export async function addPdfToVault(file: File): Promise<string> {
  const { desk, dir } = api()
  const id = uid()
  const data = new Uint8Array(await file.arrayBuffer())
  await desk.writeAttachment(dir, pdfRel(id), data)
  const ann: PdfAnnotationsFile = {
    format: PDF_ANNOTATIONS_FORMAT,
    version: 1,
    fileName: file.name,
    items: [],
  }
  await desk.writeAttachment(dir, annRel(id), new TextEncoder().encode(JSON.stringify(ann, null, 2)))
  return id
}

/** 读取 PDF 二进制；不存在返回 null */
export async function readPdf(id: string): Promise<Uint8Array | null> {
  const { desk, dir } = api()
  return desk.readAttachment(dir, pdfRel(id))
}

/** 保存标注（整个 JSON 原子替换） */
export async function saveAnnotations(id: string, json: PdfAnnotationsFile): Promise<void> {
  const { desk, dir } = api()
  await desk.writeAttachment(dir, annRel(id), new TextEncoder().encode(JSON.stringify(json, null, 2)))
}

/** 读取标注；不存在返回 null */
export async function readAnnotations(id: string): Promise<PdfAnnotationsFile | null> {
  const { desk, dir } = api()
  const data = await desk.readAttachment(dir, annRel(id))
  if (!data) return null
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as PdfAnnotationsFile
    if (parsed?.format !== PDF_ANNOTATIONS_FORMAT || !Array.isArray(parsed.items)) return null
    return { fileName: parsed.fileName ?? '', items: parsed.items, format: PDF_ANNOTATIONS_FORMAT, version: 1 }
  } catch {
    return null
  }
}

/** 删除附件：PDF 与标注 JSON 一起删（级联） */
export async function removeAttachment(id: string): Promise<void> {
  const { desk, dir } = api()
  await desk.removeAttachment(dir, pdfRel(id))
  await desk.removeAttachment(dir, annRel(id))
}

/** 用系统默认程序打开本地 PDF（如外部 PDF 阅读器）；返回错误信息（成功为 null） */
export async function openPdfExternal(id: string): Promise<string | null> {
  const desk = window.knowledgeGraphDesktop
  if (!desk?.openAttachmentExternal) throw new Error(capability('systemOpener').reason)
  const dir = vaultDir()
  if (!dir) throw new Error('请先选择笔记目录')
  const result = await desk.openAttachmentExternal(dir, pdfRel(id))
  return result?.error ?? null
}

/**
 * 读取 Zotero 标注 sidecar；不存在或格式不对返回 null。
 * 与本地标注分开存放，所以旧版本写本地标注时不会覆盖已同步的 Zotero 数据。
 */
export async function readZoteroMarkupFile(storeId: string): Promise<ZoteroMarkupFile | null> {
  if (!STORE_ID_RE.test(storeId)) return null
  const { desk, dir } = api()
  const data = await desk.readAttachment(dir, zoteroMarkupRel(storeId))
  if (!data) return null
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as ZoteroMarkupFile
    if (parsed?.format !== ZOTERO_MARKUP_FORMAT || parsed.version !== 1) return null
    if (!Array.isArray(parsed.annotations) || !Array.isArray(parsed.notes) || !Array.isArray(parsed.attachments)) return null
    return {
      ...parsed,
      parentKeys: Array.isArray(parsed.parentKeys) ? parsed.parentKeys : [],
      attachmentKey: typeof parsed.attachmentKey === 'string' ? parsed.attachmentKey : '',
      attachmentPath: typeof parsed.attachmentPath === 'string' ? parsed.attachmentPath : '',
      syncedAt: Number(parsed.syncedAt) || 0,
      skipped: {
        unsupportedType: Number(parsed.skipped?.unsupportedType) || 0,
        missingText: Number(parsed.skipped?.missingText) || 0,
        invalidPosition: Number(parsed.skipped?.invalidPosition) || 0,
        otherAttachment: Number(parsed.skipped?.otherAttachment) || 0,
      },
    }
  } catch {
    return null
  }
}

/**
 * 保存 Zotero 标注 sidecar（整份原子替换）。
 * 只有「完整查询成功」后调用方才拿得到新数据；数据没拿到时不要调用，旧 sidecar 保持原样。
 */
export async function saveZoteroMarkupFile(storeId: string, file: ZoteroMarkupFile): Promise<void> {
  if (!STORE_ID_RE.test(storeId)) throw new Error('无效的标注存储 id')
  const { desk, dir } = api()
  await desk.writeAttachment(dir, zoteroMarkupRel(storeId), new TextEncoder().encode(JSON.stringify(file, null, 2)))
}
