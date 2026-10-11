/**
 * 渲染进程侧的附件访问封装（vault 内 attachments/ 目录）。
 * 浏览器版没有桌面文件 API：这里统一抛「附件仅桌面版可用」，由 UI 降级提示。
 */
import { uid } from '@/types/note'
import { readSetting } from '@/lib/env'
import { VAULT_DIR_KEY } from '@/lib/vaultFs'

/** 标注 JSON 结构（见 docs/VAULT_FORMAT.md） */
export interface PdfAnnotation {
  id: string
  page: number
  color: string
  anchor: { exact: string; prefix: string; suffix: string }
  comment: string
  createdAt: number
}

export interface PdfAnnotationsFile {
  format: 'kaust-kg-pdf-annotations'
  version: 1
  fileName: string
  items: PdfAnnotation[]
}

export const PDF_ANNOTATIONS_FORMAT = 'kaust-kg-pdf-annotations'

/** 附件能力是否可用（桌面版 + 已选 vault 目录） */
export function attachmentsSupported(): boolean {
  return Boolean(window.knowledgeGraphDesktop?.readAttachment) && Boolean(vaultDir())
}

function vaultDir(): string {
  return readSetting(VAULT_DIR_KEY) ?? ''
}

function api() {
  const desk = window.knowledgeGraphDesktop
  if (!desk?.readAttachment || !desk.writeAttachment) throw new Error('附件仅桌面版可用')
  const dir = vaultDir()
  if (!dir) throw new Error('请先选择笔记目录（附件保存在笔记目录的 attachments/ 里）')
  return { desk, dir }
}

const pdfRel = (id: string) => `attachments/${id}.pdf`
const annRel = (id: string) => `attachments/${id}.annotations.json`

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
