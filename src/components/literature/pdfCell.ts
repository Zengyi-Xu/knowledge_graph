/**
 * PDF 单元格的判定层：把「这一篇该显示按钮还是文字」收成纯函数，组件只按 kind 渲染。
 *
 * 优先级（与 AGENTS.md 的 PDF 打开链一致）：`localPdf` → Zotero `availablePdfCount` → 其它状态。
 * 有可读 PDF 时徽标本身就是按钮（单击直接进全屏阅读，无悬停延迟）。
 */
import type { Note } from '@/types/note'
import { localPdfMatch } from '@/lib/localPdfFallback'

/** PDF 单元格形态 */
export type PdfCellView =
  /** 徽标即按钮：单击进全屏阅读；`matched` = 来源是「按标题兜底匹配到的本地文件」，还没记进笔记 */
  | { kind: 'read'; matched?: boolean }
  /** 有 Zotero key 但还没同步过 PDF 状态 */
  | { kind: 'unsynced' }
  /** Zotero 里登记了 PDF 但本机没有 → 引导去 Zotero 打开 */
  | { kind: 'missing' }
  /** 纯文字：`—` / `文件不在本机` / `无本地 PDF` */
  | { kind: 'none'; text: string }

/** 能就地全屏阅读：笔记里的 localPdf、Zotero 里有可访问的 PDF，或兜底匹配到的本地 PDF */
export function hasReadablePdf(note: Note): boolean {
  const lit = note.literature
  if (!lit) return false
  return Boolean(lit.localPdf) || (lit.zoteroAvailablePdfCount ?? 0) > 0 || Boolean(localPdfMatch(note))
}

export function pdfCellView(note: Note): PdfCellView {
  const lit = note.literature
  if (hasReadablePdf(note)) {
    const own = Boolean(lit?.localPdf) || (lit?.zoteroAvailablePdfCount ?? 0) > 0
    return own ? { kind: 'read' } : { kind: 'read', matched: true }
  }
  if (!lit?.zoteroKey) return { kind: 'none', text: '—' }
  const available = lit.zoteroAvailablePdfCount
  if (available === undefined) return { kind: 'unsynced' }
  if (available === 0 && lit.zoteroPdfCount) return { kind: 'missing' }
  return { kind: 'none', text: lit.zoteroPdfCount ? '文件不在本机' : '无本地 PDF' }
}
