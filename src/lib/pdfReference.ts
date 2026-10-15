import type { PdfAnnotation } from '@/lib/attachments'

export const PDF_REF_PREFIX = '#pdfref-'

export function pdfReferenceBlock(annotation: PdfAnnotation, fileName: string): string {
  const quote = annotation.anchor.exact.replace(/\s+/g, ' ').trim()
  return `> ${quote}\n>\n> [↗ PDF 第 ${annotation.page} 页 · ${fileName}](${PDF_REF_PREFIX}${annotation.id})`
}

export function appendPdfReference(content: string, annotation: PdfAnnotation, fileName: string): string {
  const clean = content.trimEnd()
  const heading = /(^|\n)## PDF 摘录\s*(\n|$)/.test(clean) ? '' : `${clean ? '\n\n' : ''}## PDF 摘录`
  return `${clean}${heading}\n\n${pdfReferenceBlock(annotation, fileName)}\n`
}

export function pdfReferenceIdFromHref(href: string): string | null {
  const index = href.indexOf(PDF_REF_PREFIX)
  if (index < 0) return null
  const id = href.slice(index + PDF_REF_PREFIX.length).split(/[?&#]/)[0]
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : null
}

export function referencedAnnotationIds(content: string): Set<string> {
  const ids = new Set<string>()
  for (const match of content.matchAll(/\]\(#pdfref-([a-zA-Z0-9_-]+)\)/g)) ids.add(match[1])
  return ids
}
