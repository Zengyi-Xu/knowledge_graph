/**
 * 复制引用到剪贴板（纯剪贴板能力，浏览器版与桌面版均可用）。
 */
import { toast } from 'sonner'
import type { Note } from '@/types/note'
import { buildBibtex, formatCitation, litToCSL, type CitationStyleId } from '@/lib/literature'

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
      : formatCitation(litToCSL(note), style)
  await navigator.clipboard.writeText(text)
  toast.success('已复制引用')
}
