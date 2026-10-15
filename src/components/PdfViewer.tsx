/**
 * PDF 阅读器：canvas 渲染（PDF.js）+ 可选中复制的 textLayer + 划词高亮标注。
 * 不放宽 Markdown sanitizer，不引入 iframe/object/embed。
 *
 * 单页纵向浏览：翻页 / 页码输入 / 缩放（适应宽度、50%~300%）/ 当前文档文字搜索。
 * 高亮锚定走 src/lib/pdfAnchor.ts：exact 命中 → prefix+suffix 模糊兜底 → 失效不丢数据。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Search, Highlighter, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildAnchor, locateAnchor, type TextAnchor } from '@/lib/pdfAnchor'
import type { PdfAnnotation } from '@/lib/attachments'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/** textContent 条目（只取 str） */
interface TextItemLike {
  str?: string
}

/** 高亮色板（黄/绿/蓝/红/紫） */
const HIGHLIGHT_COLORS = ['#ffd54a', '#a8e6a3', '#90caf9', '#ef9a9a', '#ce93d8']

export interface NewAnnotation {
  page: number
  anchor: TextAnchor
  color: string
}

interface Props {
  data: Uint8Array
  annotations: PdfAnnotation[]
  onAddAnnotation: (a: NewAnnotation) => void
  onUpdateAnnotation: (id: string, comment: string) => void
  onDeleteAnnotation: (id: string) => void
  /** 「导出到笔记」：把高亮文本追加到文献笔记正文（由外层走 updateNote） */
  onExportAnnotation: (a: PdfAnnotation) => void
  /** 把当前选区保存为高亮并插入一条可返回 PDF 原文的笔记链接 */
  onLinkSelection?: (a: NewAnnotation) => void
  /** 外层请求定位某条标注；阅读器会跳页并短暂强调 */
  focusAnnotationId?: string | null
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** 把页内字符区间映射成 textLayer 内的覆盖矩形（用 Range + getClientRects） */
function rectsForRange(textLayer: HTMLElement, start: number, end: number): Rect[] {
  const origin = textLayer.getBoundingClientRect()
  const spans = [...textLayer.querySelectorAll('span')]
  const rects: Rect[] = []
  let offset = 0
  for (const span of spans) {
    const str = span.textContent ?? ''
    const spanStart = offset
    const spanEnd = offset + str.length
    offset = spanEnd
    if (spanEnd <= start) continue
    if (spanStart >= end) break
    const node = span.firstChild
    if (!node) continue
    const from = Math.max(0, start - spanStart)
    const to = Math.min(str.length, end - spanStart)
    try {
      const range = document.createRange()
      range.setStart(node, from)
      range.setEnd(node, to)
      for (const r of range.getClientRects()) {
        if (r.width <= 0 || r.height <= 0) continue
        rects.push({ left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height })
      }
    } catch {
      /* 个别 span 结构异常就跳过这一段 */
    }
  }
  return rects
}

/** 把 DOM Selection 换算成 textLayer 内的字符区间；不在 textLayer 内返回 null */
function selectionRange(textLayer: HTMLElement, pageText: string): { start: number; end: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!textLayer.contains(range.commonAncestorContainer)) return null
  const spans = [...textLayer.querySelectorAll('span')]
  let start: number | null = null
  let end: number | null = null
  let offset = 0
  for (const span of spans) {
    const len = (span.textContent ?? '').length
    if (start === null && (span === range.startContainer || span.contains(range.startContainer))) {
      const node = span.firstChild
      start = offset + (node === range.startContainer ? range.startOffset : 0)
    }
    if (end === null && (span === range.endContainer || span.contains(range.endContainer))) {
      const node = span.firstChild
      end = offset + (node === range.endContainer ? range.endOffset : len)
    }
    offset += len
    if (start !== null && end !== null) break
  }
  if (start === null || end === null || end <= start) return null
  if (start < 0 || end > pageText.length) return null
  return { start, end }
}

export function PdfViewer({
  data,
  annotations,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onExportAnnotation,
  onLinkSelection,
  focusAnnotationId,
}: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [pageNum, setPageNum] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [scaleMode, setScaleMode] = useState<'fit' | number>('fit')
  const [query, setQuery] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const [pageText, setPageText] = useState('')
  const [highlights, setHighlights] = useState<{ id: string; color: string; rects: Rect[]; missing?: boolean }[]>([])
  const [searchRects, setSearchRects] = useState<Rect[]>([])
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const pageTextRef = useRef('')

  // ---- 加载文档 ----
  useEffect(() => {
    let cancelled = false
    const task = pdfjsLib.getDocument({ data })
    task.promise
      .then((d) => {
        if (cancelled) {
          void (d as unknown as { destroy: () => Promise<void> }).destroy()
          return
        }
        docRef.current = d
        setDoc(d)
        setNumPages(d.numPages)
        setPageNum(1)
        setError('')
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
      task.destroy().catch(() => {})
      docRef.current = null
      setDoc(null)
    }
  }, [data])

  // ---- 渲染当前页（canvas + textLayer） ----
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    const render = async () => {
      const page: PDFPageProxy = await doc.getPage(pageNum)
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      const containerW = scrollRef.current?.clientWidth ? scrollRef.current.clientWidth - 32 : 800
      const fitScale = containerW / base.width
      const scale = scaleMode === 'fit' ? fitScale : (scaleMode / 100) * 0.75
      const dpr = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale: scale * dpr })

      const canvas = canvasRef.current
      const layer = layerRef.current
      const holder = pageRef.current
      if (!canvas || !layer || !holder) return
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
      holder.style.width = canvas.style.width
      holder.style.height = canvas.style.height
      layer.style.setProperty('--scale-factor', String(scale * dpr))

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      if (cancelled) return

      const textContent = (await page.getTextContent()) as unknown as { items: TextItemLike[] }
      if (cancelled) return
      const text = textContent.items.map((it) => it.str ?? '').join('')
      pageTextRef.current = text
      setPageText(text)

      layer.replaceChildren()
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: layer,
        viewport,
      })
      await textLayer.render()
    }
    render().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e))
    })
    return () => {
      cancelled = true
    }
  }, [doc, pageNum, scaleMode])

  // ---- 高亮渲染：锚定 → 覆盖矩形 ----
  useEffect(() => {
    // setState 放进 rAF，避免 effect 内同步 setState 触发级联渲染（lint 要求）
    const raf = requestAnimationFrame(() => {
      const layer = layerRef.current
      if (!layer || !pageTextRef.current) {
        setHighlights([])
        return
      }
      const out: { id: string; color: string; rects: Rect[]; missing?: boolean }[] = []
      for (const a of annotations) {
        if (a.page !== pageNum) continue
        const match = locateAnchor(pageTextRef.current, a.anchor)
        if (match.status === 'missing') {
          out.push({ id: a.id, color: a.color, rects: [], missing: true })
          continue
        }
        out.push({ id: a.id, color: a.color, rects: rectsForRange(layer, match.index, match.index + match.length) })
      }
      setHighlights(out)
    })
    return () => cancelAnimationFrame(raf)
  }, [annotations, pageNum, pageText])

  // ---- 搜索：当前页内全部匹配，跨页跳到下一页 ----
  const matches = (() => {
    if (!query.trim() || !pageText) return []
    const hits: number[] = []
    const q = query.toLowerCase()
    let from = 0
    const lower = pageText.toLowerCase()
    while (from <= lower.length) {
      const i = lower.indexOf(q, from)
      if (i < 0) break
      hits.push(i)
      from = i + q.length
    }
    return hits
  })()

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const layer = layerRef.current
      if (!layer || !pageText || !matches.length) {
        setSearchRects([])
        return
      }
      const idx = matches[Math.min(matchIdx, matches.length - 1)]
      setSearchRects(rectsForRange(layer, idx, idx + query.length))
    })
    return () => cancelAnimationFrame(raf)
  }, [matches, matchIdx, pageText, query])

  // ---- 划词：mouseup 弹色板 ----
  const [palette, setPalette] = useState<{ x: number; y: number; anchor: TextAnchor } | null>(null)
  const [active, setActive] = useState<{ x: number; y: number; annotation: PdfAnnotation } | null>(null)

  const handleMouseUp = useCallback(() => {
    setTimeout(() => {
      const layer = layerRef.current
      if (!layer) return
      const range = selectionRange(layer, pageTextRef.current)
      if (!range) {
        setPalette(null)
        return
      }
      const anchor = buildAnchor(pageTextRef.current, range.start, range.end)
      const sel = window.getSelection()
      const rect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null
      const origin = layer.getBoundingClientRect()
      setActive(null)
      setPalette({
        x: (rect ? rect.left - origin.left + rect.width / 2 : 0),
        y: (rect ? rect.top - origin.top : 0),
        anchor,
      })
    }, 0)
  }, [])

  const addHighlight = (color: string) => {
    if (!palette) return
    onAddAnnotation({ page: pageNum, anchor: palette.anchor, color })
    window.getSelection()?.removeAllRanges()
    setPalette(null)
  }

  const linkSelection = () => {
    if (!palette || !onLinkSelection) return
    onLinkSelection({ page: pageNum, anchor: palette.anchor, color: HIGHLIGHT_COLORS[0] })
    window.getSelection()?.removeAllRanges()
    setPalette(null)
  }

  useEffect(() => {
    if (!focusAnnotationId) return
    const annotation = annotations.find((item) => item.id === focusAnnotationId)
    if (!annotation) return
    setPageNum(annotation.page)
    setFocusedId(annotation.id)
    const timer = window.setTimeout(() => setFocusedId(null), 1800)
    return () => window.clearTimeout(timer)
  }, [focusAnnotationId, annotations])

  const gotoPage = (n: number) => {
    if (n >= 1 && n <= numPages) {
      setPageNum(n)
      setMatchIdx(0)
      setPalette(null)
      setActive(null)
    }
  }

  const stepZoom = (delta: number) => {
    const current = scaleMode === 'fit' ? 100 : scaleMode
    const next = Math.min(300, Math.max(50, current + delta))
    setScaleMode(next)
  }

  if (error) {
    return <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">PDF 打开失败：{error}</div>
  }
  if (!doc) {
    return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">正在加载 PDF…</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 控件栏 */}
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5 text-sm">
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={pageNum <= 1} onClick={() => gotoPage(pageNum - 1)} title="上一页">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input
            value={pageNum}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) gotoPage(Math.round(n))
            }}
            className="h-7 w-12 px-1 text-center"
            inputMode="numeric"
          />
          / {numPages}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={pageNum >= numPages} onClick={() => gotoPage(pageNum + 1)} title="下一页">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => stepZoom(-25)} title="缩小">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant={scaleMode === 'fit' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => setScaleMode('fit')}
          title="适应宽度"
        >
          适应宽度
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => stepZoom(25)} title="放大">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setMatchIdx(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const next = matches.length ? (matchIdx + 1) % matches.length : 0
              setMatchIdx(next)
              if (!matches.length && pageNum < numPages) gotoPage(pageNum + 1)
            }
          }}
          placeholder="页内搜索，回车下一个"
          className="h-7 w-40 text-xs"
        />
        {matches.length > 0 && <span className="text-xs text-muted-foreground">{Math.min(matchIdx + 1, matches.length)}/{matches.length}</span>}
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <Highlighter className="h-3.5 w-3.5" /> 选中文字即可高亮
        </span>
      </div>

      {/* 页面滚动区 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-muted/40 p-4">
        <div ref={pageRef} className="relative mx-auto bg-white shadow" onMouseUp={handleMouseUp}>
          <canvas ref={canvasRef} className="block" />
          <div ref={layerRef} className="absolute inset-0 overflow-hidden" />

          {/* 搜索匹配 */}
          {searchRects.map((r, i) => (
            <div
              key={`s-${i}`}
              className="pointer-events-none absolute border border-orange-400 bg-orange-200/40"
              style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            />
          ))}

          {/* 标注高亮 */}
          {highlights.map((h) =>
            h.missing ? null : h.rects.map((r, i) => (
              <div
                key={`${h.id}-${i}`}
                className={`absolute cursor-pointer opacity-60 hover:opacity-80 ${focusedId === h.id ? 'ring-2 ring-primary opacity-90' : ''}`}
                style={{ left: r.left, top: r.top, width: r.width, height: r.height, background: h.color }}
                onClick={(e) => {
                  const layer = layerRef.current
                  if (!layer) return
                  const origin = layer.getBoundingClientRect()
                  const a = annotations.find((x) => x.id === h.id)
                  if (!a) return
                  setPalette(null)
                  setActive({ x: e.clientX - origin.left, y: e.clientY - origin.top, annotation: a })
                }}
              />
            )),
          )}

          {/* 划词色板 */}
          {palette && (
            <div
              className="absolute z-20 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-md border bg-popover p-1 shadow-md"
              style={{ left: Math.max(40, palette.x), top: Math.max(30, palette.y - 6) }}
            >
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c}
                  className="h-5 w-5 rounded-full border border-black/20"
                  style={{ background: c }}
                  title="高亮"
                  onClick={() => addHighlight(c)}
                />
              ))}
              {onLinkSelection && (
                <Button size="sm" variant="secondary" className="ml-1 h-6 gap-1 px-2 text-xs" onClick={linkSelection} title="高亮并链接到右侧笔记">
                  <Link2 className="h-3 w-3" /> 链接到笔记
                </Button>
              )}
            </div>
          )}

          {/* 高亮评论框 */}
          {active && (
            <div
              className="absolute z-20 w-64 -translate-x-1/2 rounded-md border bg-popover p-2 shadow-md"
              style={{ left: Math.max(130, active.x), top: Math.max(10, active.y - 8) }}
            >
              <div className="mb-1 max-h-24 overflow-y-auto text-xs text-muted-foreground">{active.annotation.anchor.exact}</div>
              <textarea
                defaultValue={active.annotation.comment}
                placeholder="评论（可空）"
                className="mb-2 h-16 w-full resize-none rounded border bg-background px-2 py-1 text-xs"
                id={`pdf-comment-${active.annotation.id}`}
              />
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => onExportAnnotation(active.annotation)}>
                  导出到笔记
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs text-destructive"
                  onClick={() => {
                    onDeleteAnnotation(active.annotation.id)
                    setActive(null)
                  }}
                >
                  删除
                </Button>
                <Button
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => {
                    const el = document.getElementById(`pdf-comment-${active.annotation.id}`) as HTMLTextAreaElement | null
                    onUpdateAnnotation(active.annotation.id, el?.value ?? '')
                    setActive(null)
                  }}
                >
                  保存
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="h-4" />
      </div>
    </div>
  )
}
