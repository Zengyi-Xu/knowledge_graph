/**
 * 复制引用到剪贴板（纯剪贴板能力，浏览器版与桌面版均可用）。
 */
import { toast } from 'sonner'
import type { Note } from '@/types/note'
import { buildBibtex, formatCitation, litToCSL, type CitationStyleId } from '@/lib/literature'
import { toastDegraded } from '@/lib/degrade'

/** 复制一条引文：国标 GB/T 7714 / APA / BibTeX 三选一 */
export async function copyCitationFor(note: Note, style: CitationStyleId | 'bibtex'): Promise<void> {
  const lit = note.literature
  const text =
    style === 'bibtex'
      ? buildBibtex({
          title: note.title,
          authors: lit?.authors ?? [],
          venue: lit?.venue ?? '',
          year: lit?.year ?? '',
          doi: lit?.doi ?? '',
          citekey: lit?.citekey ?? '',
        })
      : await formatCitation(litToCSL(note), style)
  // 明确降级：拿不到剪贴板接口（非安全上下文 / 浏览器不支持）时说清原因，不提示成功
  if (typeof navigator.clipboard?.writeText !== 'function') {
    toastDegraded('plainClipboard', '无法复制引用', 'error')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    toast.error('复制失败：浏览器拒绝了剪贴板写入（可能没有焦点或没有授权），请手动选中文本复制')
    return
  }
  toast.success('已复制引用（纯文本）')
}
