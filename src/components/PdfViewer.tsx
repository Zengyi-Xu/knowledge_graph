/**
 * PDF 阅读器：canvas 渲染（PDF.js）+ 可选中复制的 textLayer + 划词高亮标注。
 * 不放宽 Markdown sanitizer，不引入 iframe/object/embed。
 *
 * 浏览模式：连续滚动 / 单页 / 双页（双页可切换起始奇偶：1+2 起，或封面单独一页后 2+3 起）。
 * 键盘 PageUp/PageDown 与方向键翻页（连续模式下滚动）；单页/双页下滚轮滚到页边自动翻页。
 * 缩放：适应宽度 / 50%~300%；当前页文字搜索。
 *
 * 高亮锚定走 src/lib/pdfAnchor.ts：exact 命中 → prefix+suffix 模糊兜底 → 失效不丢数据。
 * 同一条高亮的多个覆盖矩形合并成一条 SVG path 并集绘制（配合 mix-blend-multiply）：
 * 相邻文本行的补偿重叠只会着色一次，不会再叠出深色横带。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Search,
  Highlighter,
  Link2,
  ScrollText,
  File,
  Columns2,
  FlipHorizontal2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { readSetting, writeSetting } from '@/lib/env'
import { buildAnchor, locateAnchor, type TextAnchor } from '@/lib/pdfAnchor'
import type { PdfAnnotation } from '@/lib/attachments'
import './pdfTextLayer.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/** textContent 条目（只取 str） */
interface TextItemLike {
  str?: string
}

/** 高亮色板（黄/绿/蓝/红/紫） */
const HIGHLIGHT_COLORS = ['#ffd54a', '#a8e6a3', '#90caf9', '#ef9a9a', '#ce93d8']
/** 划词预览：浅莫兰迪蓝，避免原生选区那种高饱和深蓝。 */
const SELECTION_PREVIEW_COLOR = '#c3d0d7'

/** 页与页之间的间距 / 滚动容器内边距（与 className 里的 p-4、gap 保持一致） */
const PAGE_GAP = 16
const PAGE_PAD = 16
/** 拿不到页面尺寸时的占位纵横比（A4 竖版） */
const PLACEHOLDER_RATIO = 1.414

const VIEW_MODE_KEY = 'pdf-view-mode-v1'
const DOUBLE_PARITY_KEY = 'pdf-double-parity-v1'

type ViewMode = 'scroll' | 'single' | 'double'
/** 双页起始奇偶：0 = [1,2] [3,4]…；1 = 封面 [1] 单独，之后 [2,3] [4,5]… */
type DoubleParity = 0 | 1

function savedViewMode(): ViewMode {
  const value = readSetting(VIEW_MODE_KEY)
  return value === 'single' || value === 'double' ? value : 'scroll'
}

function savedParity(): DoubleParity {
  return readSetting(DOUBLE_PARITY_KEY) === '1' ? 1 : 0
}

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

interface PaletteState {
  page: number
  x: number
  y: number
  anchor: TextAnchor
}

interface ActiveState {
  page: number
  x: number
  y: number
  annotation: PdfAnnotation
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
  // getClientRects() 返回的是字形级矩形。不同 span/字形之间通常会有极小的
  // 浮点误差缝隙，逐个绘制时就会把高亮切断。按行合并相邻矩形，并只做
  // 亚像素级的边缘补偿；真正的换行仍保持为独立矩形。
  const lines: Rect[][] = []
  for (const rect of rects) {
    const line = lines.find((items) => {
      const sample = items[0]
      const tolerance = Math.max(1, Math.min(sample.height, rect.height) * 0.35)
      return Math.abs(sample.top + sample.height / 2 - (rect.top + rect.height / 2)) <= tolerance
    })
    if (line) line.push(rect)
    else lines.push([rect])
  }

  return lines.flatMap((line) => {
    line.sort((a, b) => a.left - b.left)
    const merged: Rect[] = []
    for (const rect of line) {
      const previous = merged[merged.length - 1]
      // 同一行属于同一个连续选区时，把字间空格也纳入高亮；空格没有
      // glyph rect，按间隙阈值合并会留下截图中那种竖直白缝。
      if (previous) {
        const right = Math.max(previous.left + previous.width, rect.left + rect.width)
        previous.left = Math.min(previous.left, rect.left)
        previous.width = right - previous.left
        previous.top = Math.min(previous.top, rect.top)
        previous.height = Math.max(previous.top + previous.height, rect.top + rect.height) - previous.top
      } else {
        // 上下各外扩 1px，让相邻文本行轻微重叠；PDF 的行框常有约 1px
        // 浮点间隙，不补偿就会出现贯穿整行的白色横缝。重叠区域的颜色加深
        // 由 SVG 并集路径（同一条 path 只着色一次）兜住。
        merged.push({ ...rect, left: rect.left - 0.75, width: rect.width + 1.5, top: rect.top - 1, height: rect.height + 2 })
      }
    }
    return merged
  })
}

/** 一组矩形 → 一条 SVG path（nonzero 填充下重叠区域只着色一次，multiply 不再叠深） */
function rectsToPath(rects: Rect[]): string {
  return rects
    .map((r) => `M${r.left.toFixed(2)} ${r.top.toFixed(2)}h${r.width.toFixed(2)}v${r.height.toFixed(2)}h${(-r.width).toFixed(2)}z`)
    .join(' ')
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

interface PageDims {
  w: number
  h: number
}

interface PageViewProps {
  doc: PDFDocumentProxy
  page: number
  /** 连续模式下只有靠近视口的页才真正渲染；其余画占位框 */
  shouldRender: boolean
  scaleMode: 'fit' | number
  /** 「适应宽度」下每一页可用的 CSS 宽度（双页时已除以 2） */
  fitWidth: number
  /** scale=1 的页面尺寸（未知时 undefined，占位用 A4 比例估算） */
  dims?: PageDims
  annotations: PdfAnnotation[]
  focusedId: string | null
  /** 当前页内的搜索命中区间（仅搜索当前所在页） */
  searchRange: { start: number; length: number } | null
  selectionRects: Rect[] | null
  palette: PaletteState | null
  active: ActiveState | null
  canLink: boolean
  onText: (page: number, text: string) => void
  onRegister: (page: number, holder: HTMLElement | null, layer: HTMLElement | null) => void
  onSelectMouseUp: (page: number) => void
  onHighlightClick: (page: number, id: string, clientX: number, clientY: number) => void
  onPickColor: (color: string) => void
  onLink: () => void
  onExportAnnotation: (a: PdfAnnotation) => void
  onUpdateAnnotation: (id: string, comment: string) => void
  onDeleteAnnotation: (id: string) => void
  onCloseActive: () => void
}

/** 单页视图：canvas + textLayer + 本页高亮/搜索/选区覆盖层；弹层（色板/评论）也挂在本页坐标系里 */
const PdfPageView = memo(function PdfPageView({
  doc,
  page,
  shouldRender,
  scaleMode,
  fitWidth,
  dims,
  annotations,
  focusedId,
  searchRange,
  selectionRects,
  palette,
  active,
  canLink,
  onText,
  onRegister,
  onSelectMouseUp,
  onHighlightClick,
  onPickColor,
  onLink,
  onExportAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onCloseActive,
}: PageViewProps) {
  const holderRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<PageDims | null>(null)
  const [text, setText] = useState('')
  const [highlights, setHighlights] = useState<{ id: string; color: string; rects: Rect[]; missing?: boolean }[]>([])
  const [searchRects, setSearchRects] = useState<Rect[]>([])
  const [renderError, setRenderError] = useState('')

  // 占位尺寸： dims 已知按真实纵横比，否则按 A4 估算（渲染完成后校正）
  const placeholder = useMemo<PageDims>(() => {
    const zoom = scaleMode === 'fit' ? null : (scaleMode / 100) * 0.75
    if (dims) {
      const w = zoom ? dims.w * zoom : fitWidth
      return { w, h: (w * dims.h) / dims.w }
    }
    const w = zoom ? 612 * zoom : fitWidth
    return { w, h: w * PLACEHOLDER_RATIO }
  }, [dims, scaleMode, fitWidth])

  // ---- 渲染本页（canvas + textLayer） ----
  useEffect(() => {
    if (!shouldRender) return
    let cancelled = false
    // fitWidth 随容器宽度变化会重跑本 effect：上一轮的 render() 可能还在画，
    // pdf.js 不允许同一 canvas 并发 render —— 清理时必须取消上一个 RenderTask/TextLayer
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null
    let textLayerTask: { cancel: () => void; render: () => Promise<void> } | null = null
    const render = async () => {
      const pdfPage = await doc.getPage(page)
      if (cancelled) return
      const base = pdfPage.getViewport({ scale: 1 })
      const scale = scaleMode === 'fit' ? fitWidth / base.width : (scaleMode / 100) * 0.75
      const dpr = window.devicePixelRatio || 1
      // canvas 后备分辨率按 DPR 放大；textLayer 要的是 CSS 尺寸的 viewport（pdf.js 内部再乘 DPR）
      const viewport = pdfPage.getViewport({ scale: scale * dpr })
      const cssViewport = dpr === 1 ? viewport : pdfPage.getViewport({ scale })

      const canvas = canvasRef.current
      const layer = layerRef.current
      const holder = holderRef.current
      if (!canvas || !layer || !holder) return
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${Math.floor(cssViewport.width)}px`
      canvas.style.height = `${Math.floor(cssViewport.height)}px`
      holder.style.width = canvas.style.width
      holder.style.height = canvas.style.height
      setSize({ w: cssViewport.width, h: cssViewport.height })
      // pdf.js 6 读的是 --total-scale-factor，值必须是 CSS 缩放比（--font-height 是无缩放值）
      layer.style.setProperty('--total-scale-factor', String(cssViewport.scale))

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      renderTask = pdfPage.render({ canvas, canvasContext: ctx, viewport })
      try {
        await renderTask.promise
      } catch (e) {
        // 被取消的重渲染是常态（容器宽度变化），不是错误
        if (e instanceof Error && e.name === 'RenderingCancelledException') return
        throw e
      }
      if (cancelled) return

      const textContent = (await pdfPage.getTextContent()) as unknown as { items: TextItemLike[] }
      if (cancelled) return
      const pageText = textContent.items.map((it) => it.str ?? '').join('')
      setText(pageText)
      onText(page, pageText)

      layer.replaceChildren()
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: pdfPage.streamTextContent(),
        container: layer,
        viewport: cssViewport,
      })
      textLayerTask = textLayer
      await textLayer.render()
    }
    render().catch((e) => {
      if (!cancelled) setRenderError(e instanceof Error ? e.message : String(e))
    })
    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayerTask?.cancel()
    }
  }, [doc, page, shouldRender, scaleMode, fitWidth, onText])

  // ---- 本页高亮：锚定 → 覆盖矩形（rAF 里 setState，避免 effect 内同步 setState 级联） ----
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const layer = layerRef.current
      if (!layer || !text) {
        setHighlights([])
        return
      }
      const mine = annotations.filter((a) => a.page === page)
      const out: { id: string; color: string; rects: Rect[]; missing?: boolean }[] = []
      for (const a of mine) {
        const match = locateAnchor(text, a.anchor)
        if (match.status === 'missing') {
          out.push({ id: a.id, color: a.color, rects: [], missing: true })
          continue
        }
        out.push({ id: a.id, color: a.color, rects: rectsForRange(layer, match.index, match.index + match.length) })
      }
      setHighlights(out)
    })
    return () => cancelAnimationFrame(raf)
  }, [annotations, page, text, size])

  // ---- 本页搜索命中矩形 ----
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const layer = layerRef.current
      if (!layer || !text || !searchRange) {
        setSearchRects([])
        return
      }
      setSearchRects(rectsForRange(layer, searchRange.start, searchRange.start + searchRange.length))
    })
    return () => cancelAnimationFrame(raf)
  }, [searchRange, text, size])

  // ---- 登记 holder/layer 给外层（滚动定位、划词取锚） ----
  useEffect(() => {
    onRegister(page, holderRef.current, layerRef.current)
    return () => onRegister(page, null, null)
  }, [page, onRegister, shouldRender])

  if (!shouldRender) {
    return (
      <div
        ref={holderRef}
        data-pdf-page={page}
        className="relative mx-auto flex items-center justify-center bg-white shadow"
        style={{ width: placeholder.w, height: placeholder.h }}
      >
        <span className="text-xs text-muted-foreground/60">第 {page} 页</span>
      </div>
    )
  }

  return (
    <div
      ref={holderRef}
      data-pdf-page={page}
      className="relative mx-auto bg-white shadow"
      style={{ width: placeholder.w, height: placeholder.h }}
      onMouseUp={() => onSelectMouseUp(page)}
    >
      <canvas ref={canvasRef} className="block" />
      <div ref={layerRef} className="textLayer absolute inset-0 overflow-hidden" />
      {renderError && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-destructive">本页渲染失败：{renderError}</div>
      )}

      {/* 搜索匹配（保持方块+描边，与命中词一一对应） */}
      {searchRects.map((r, i) => (
        <div
          key={`s-${i}`}
          className="pointer-events-none absolute border border-orange-400 bg-orange-200/40"
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}

      {/* 选区预览 + 标注高亮：每条标注的所有矩形合并成一条 path 并集绘制，
          整层 multiply 混合（白底染成高亮色、黑字仍是黑字）。
          相邻行的补偿重叠在同一条 path 里只着色一次，不会再叠出深色横带；
          不能用半透明色块直接盖文字（会把正文冲淡成灰）。 */}
      {size && (highlights.length > 0 || (selectionRects?.length ?? 0) > 0) && (
        <svg
          className="pointer-events-none absolute inset-0 mix-blend-multiply"
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
        >
          {selectionRects && selectionRects.length > 0 && (
            <path d={rectsToPath(selectionRects)} fill={SELECTION_PREVIEW_COLOR} />
          )}
          {highlights.map((h) =>
            h.missing || h.rects.length === 0 ? null : (
              <path
                key={h.id}
                d={rectsToPath(h.rects)}
                fill={h.color}
                className="pointer-events-auto cursor-pointer"
                style={
                  focusedId === h.id
                    ? { stroke: 'hsl(var(--primary))', strokeWidth: 2, strokeLinejoin: 'round' }
                    : undefined
                }
                onClick={(e) => onHighlightClick(page, h.id, e.clientX, e.clientY)}
              />
            ),
          )}
        </svg>
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
              onClick={() => onPickColor(c)}
            />
          ))}
          {canLink && (
            <Button size="sm" variant="secondary" className="ml-1 h-6 gap-1 px-2 text-xs" onClick={onLink} title="高亮并链接到右侧笔记">
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
                onCloseActive()
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
                onCloseActive()
              }}
            >
              保存
            </Button>
          </div>
        </div>
      )}
    </div>
  )
})

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
  const [viewMode, setViewModeState] = useState<ViewMode>(savedViewMode)
  const [parity, setParityState] = useState<DoubleParity>(savedParity)
  const [scaleMode, setScaleMode] = useState<'fit' | number>('fit')
  const [containerW, setContainerW] = useState(800)
  const [query, setQuery] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const [textsVersion, setTextsVersion] = useState(0)
  const [palette, setPalette] = useState<PaletteState | null>(null)
  const [active, setActive] = useState<ActiveState | null>(null)
  const [selection, setSelection] = useState<{ page: number; rects: Rect[] } | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [prevFocusId, setPrevFocusId] = useState<string | null>(null)
  /** 连续模式：接近视口的页才真正渲染（页码集合） */
  const [nearPages, setNearPages] = useState<ReadonlySet<number>>(() => new Set([1]))

  // 外部把 focusAnnotationId 从 null 切到某个标注时，跳页并高亮该标注（render 期调整，避免 effect 里的同步 setState）
  // 先把 undefined 归一成 null：否则「没传这个 prop」时 undefined !== null 恒成立，渲染期 setState 会死循环
  // （React 「Too many re-renders」→ 整页白屏；详情页右侧面板就是这么炸的）
  const focusId = focusAnnotationId ?? null
  if (focusId !== prevFocusId) {
    setPrevFocusId(focusId)
    const annotation = focusId ? annotations.find((item) => item.id === focusId) : undefined
    if (annotation) {
      setPageNum(annotation.page)
      setFocusedId(focusId)
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const pageElsRef = useRef(new Map<number, HTMLElement>())
  const layersRef = useRef(new Map<number, HTMLElement>())
  const pageTextsRef = useRef(new Map<number, string>())
  const dimsRef = useRef(new Map<number, PageDims>())
  const [dimsVersion, setDimsVersion] = useState(0)
  const observedRef = useRef<{ renderObserver: IntersectionObserver; currentObserver: IntersectionObserver } | null>(null)
  // dimsVersion 只是「尺寸预取进度」的版本号：读到它，占位框才会随预取进度重算纵横比
  void dimsVersion

  // ---- 加载文档 ----
  useEffect(() => {
    let cancelled = false
    const pageTexts = pageTextsRef.current
    const dims = dimsRef.current
    const pageEls = pageElsRef.current
    const layers = layersRef.current
    // pdf.js 会把 data 的 buffer 转移给 worker（调用后原 Uint8Array 失效）：
    // 来源字节可能来自 pdfSource.ts 的会话缓存，这里必须传副本，否则第二次打开同一份 PDF 就是空的
    const task = pdfjsLib.getDocument({ data: new Uint8Array(data) })
    task.promise
      .then((d) => {
        // 已取消时文档由下面的 cleanup（task.destroy）负责销毁：pdf.js 6 的 PDFDocumentProxy 没有 destroy
        if (cancelled) return
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
      setDoc(null)
      pageTexts.clear()
      dims.clear()
      pageEls.clear()
      layers.clear()
    }
  }, [data])

  // ---- 预取各页 scale=1 尺寸（占位框纵横比 + 适应宽度的分母），空闲时顺序取，不阻塞首屏 ----
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    void (async () => {
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p).catch(() => null)
        if (cancelled || !page) return
        const v = page.getViewport({ scale: 1 })
        dimsRef.current.set(p, { w: v.width, h: v.height })
        if (p === 1 || p % 8 === 0) setDimsVersion((v) => v + 1)
      }
      setDimsVersion((v) => v + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [doc])

  // ---- 容器宽度跟踪（适应宽度 / 双页分栏都依赖它） ----
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setContainerW(el.clientWidth))
    })
    setContainerW(el.clientWidth)
    observer.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [doc])

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode)
    writeSetting(VIEW_MODE_KEY, mode)
    setPalette(null)
    setSelection(null)
    setActive(null)
    if (mode === 'scroll') {
      // 切进连续模式：先把当前页纳入渲染集合，再滚到它，避免跳回文档开头
      setNearPages((prev) => new Set(prev).add(pageNum))
      requestAnimationFrame(() => {
        pageElsRef.current.get(pageNum)?.scrollIntoView({ block: 'start' })
      })
    }
  }

  const toggleParity = () => {
    setParityState((p) => {
      const next: DoubleParity = p === 0 ? 1 : 0
      writeSetting(DOUBLE_PARITY_KEY, String(next))
      return next
    })
    setPageNum((n) => normalizeSpread(n, 'double', parity === 0 ? 1 : 0, numPages)[0])
  }

  /** 当前模式下「这一屏」包含哪些页（单页/滚动 = 自己；双页 = 所在对页） */
  const spreadOf = useCallback(
    (n: number): number[] => normalizeSpread(n, viewMode, parity, numPages),
    [viewMode, parity, numPages],
  )

  const spread = spreadOf(pageNum)

  const clearTransient = () => {
    setMatchIdx(0)
    setPalette(null)
    setSelection(null)
    setActive(null)
  }

  const gotoPage = useCallback(
    (n: number) => {
      if (!numPages) return
      const clamped = Math.min(numPages, Math.max(1, Math.round(n)))
      setPageNum((current) => {
        const next = normalizeSpread(clamped, viewMode, parity, numPages)[0]
        if (next !== current) clearTransient()
        return next
      })
      if (viewMode === 'scroll') {
        // 等一帧让目标页至少挂上占位框再滚；前面的页从占位渲染成真实内容后高度会变，
        // 延时再校正一次，避免跳到目标页上方几屏
        requestAnimationFrame(() => {
          pageElsRef.current.get(clamped)?.scrollIntoView({ block: 'start' })
        })
        window.setTimeout(() => {
          pageElsRef.current.get(clamped)?.scrollIntoView({ block: 'start' })
        }, 350)
      }
    },
    [numPages, viewMode, parity],
  )

  const stepPage = useCallback(
    (delta: number) => {
      const step = viewMode === 'double' ? 2 : 1
      gotoPage(spreadOf(pageNum)[0] + delta * step)
    },
    [viewMode, pageNum, spreadOf, gotoPage],
  )

  // ---- 连续模式：视口附近的页才渲染；最可见的页成为「当前页」 ----
  useEffect(() => {
    if (viewMode !== 'scroll' || !doc) return
    const root = scrollRef.current
    if (!root) return
    const ratios = new Map<number, number>()
    const near = new Set<number>([1])
    const renderObserver = new IntersectionObserver(
      (entries) => {
        let changed = false
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.pdfPage)
          if (!page) continue
          if (entry.isIntersecting) {
            if (!near.has(page)) {
              near.add(page)
              changed = true
            }
          } else if (near.delete(page)) {
            changed = true
          }
        }
        if (changed) setNearPages(new Set(near))
      },
      { root, rootMargin: '150% 0px' },
    )
    const currentObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.pdfPage)
          if (!page) continue
          ratios.set(page, entry.intersectionRatio)
        }
        let best = 0
        let bestRatio = 0
        for (const [page, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio
            best = page
          }
        }
        if (best > 0) setPageNum(best)
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    )
    for (const [, el] of pageElsRef.current) {
      renderObserver.observe(el)
      currentObserver.observe(el)
    }
    observedRef.current = { renderObserver, currentObserver }
    return () => {
      renderObserver.disconnect()
      currentObserver.disconnect()
      observedRef.current = null
    }
  }, [viewMode, doc, numPages])

  /** 页外壳的 callback ref：登记元素；连续模式下补挂到观察器（占位→内容切换时元素身份不变，无需重挂） */
  const registerPage = useCallback((page: number, holder: HTMLElement | null, layer: HTMLElement | null) => {
    if (holder) {
      pageElsRef.current.set(page, holder)
      observedRef.current?.renderObserver.observe(holder)
      observedRef.current?.currentObserver.observe(holder)
    } else {
      const old = pageElsRef.current.get(page)
      if (old && observedRef.current) {
        observedRef.current.renderObserver.unobserve(old)
        observedRef.current.currentObserver.unobserve(old)
      }
      pageElsRef.current.delete(page)
    }
    if (layer) layersRef.current.set(page, layer)
    else layersRef.current.delete(page)
  }, [])

  const handleText = useCallback((page: number, text: string) => {
    if (pageTextsRef.current.get(page) === text) return
    pageTextsRef.current.set(page, text)
    setTextsVersion((v) => v + 1)
  }, [])

  // ---- 搜索：当前页内全部匹配，回车下一个；本页没有就翻到下一页 ----
  const matches = useMemo(() => {
    void textsVersion // 页文本到位后重算
    const text = pageTextsRef.current.get(pageNum) ?? ''
    if (!query.trim() || !text) return []
    const hits: number[] = []
    const q = query.toLowerCase()
    let from = 0
    const lower = text.toLowerCase()
    while (from <= lower.length) {
      const i = lower.indexOf(q, from)
      if (i < 0) break
      hits.push(i)
      from = i + q.length
    }
    return hits
  }, [query, pageNum, textsVersion])

  const searchRange = useMemo(
    () =>
      query.trim() && matches.length
        ? { start: matches[Math.min(matchIdx, matches.length - 1)], length: query.length }
        : null,
    [query, matches, matchIdx],
  )

  // ---- 划词：mouseup 弹色板 ----
  const handleSelectMouseUp = useCallback((page: number) => {
    setTimeout(() => {
      const layer = layersRef.current.get(page)
      if (!layer) return
      const text = pageTextsRef.current.get(page) ?? ''
      const range = selectionRange(layer, text)
      if (!range) {
        setPalette(null)
        setSelection(null)
        return
      }
      const anchor = buildAnchor(text, range.start, range.end)
      const previewRects = rectsForRange(layer, range.start, range.end)
      const sel = window.getSelection()
      const rect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null
      const origin = layer.getBoundingClientRect()
      setActive(null)
      setSelection({ page, rects: previewRects })
      setPalette({
        page,
        x: rect ? rect.left - origin.left + rect.width / 2 : 0,
        y: rect ? rect.top - origin.top : 0,
        anchor,
      })
      // PDF.js 把一行拆成大量带 transform 的 span；浏览器原生选区会在
      // span/空格边界显示深浅条纹。锚点取完后清掉原生选区，改画连续预览。
      sel?.removeAllRanges()
    }, 0)
  }, [])

  const handleHighlightClick = useCallback(
    (page: number, id: string, clientX: number, clientY: number) => {
      const layer = layersRef.current.get(page)
      if (!layer) return
      const origin = layer.getBoundingClientRect()
      const a = annotations.find((x) => x.id === id)
      if (!a) return
      setPalette(null)
      setSelection(null)
      setActive({ page, x: clientX - origin.left, y: clientY - origin.top, annotation: a })
    },
    [annotations],
  )

  const pickColor = (color: string) => {
    if (!palette) return
    onAddAnnotation({ page: palette.page, anchor: palette.anchor, color })
    window.getSelection()?.removeAllRanges()
    setPalette(null)
    setSelection(null)
  }

  const linkSelection = () => {
    if (!palette || !onLinkSelection) return
    onLinkSelection({ page: palette.page, anchor: palette.anchor, color: HIGHLIGHT_COLORS[0] })
    window.getSelection()?.removeAllRanges()
    setPalette(null)
    setSelection(null)
  }

  useEffect(() => {
    if (!focusedId) return
    const timer = window.setTimeout(() => setFocusedId(null), 1800)
    return () => window.clearTimeout(timer)
  }, [focusedId])

  // 连续模式下定位标注：滚到那一页
  useEffect(() => {
    if (viewMode !== 'scroll' || !focusedId) return
    const annotation = annotations.find((item) => item.id === focusedId)
    if (!annotation) return
    requestAnimationFrame(() => {
      pageElsRef.current.get(annotation.page)?.scrollIntoView({ block: 'start' })
    })
    // focusedId 只由外部定位动作触发，annotations 更新不应重复滚动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, viewMode])

  // ---- 键盘翻页 / 滚动（输入控件与笔记编辑器里不抢按键） ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable=true], [contenteditable=""]')) return
      const el = scrollRef.current
      if (viewMode === 'scroll') {
        if (!el) return
        if (e.key === 'PageDown') {
          e.preventDefault()
          el.scrollBy({ top: el.clientHeight * 0.9 })
        } else if (e.key === 'PageUp') {
          e.preventDefault()
          el.scrollBy({ top: -el.clientHeight * 0.9 })
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          el.scrollBy({ top: 120 })
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          el.scrollBy({ top: -120 })
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          gotoPage(pageNum + 1)
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          gotoPage(pageNum - 1)
        } else if (e.key === 'Home') {
          e.preventDefault()
          el.scrollTo({ top: 0 })
        } else if (e.key === 'End') {
          e.preventDefault()
          el.scrollTo({ top: el.scrollHeight })
        }
        return
      }
      if (e.key === 'PageDown' || e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        stepPage(1)
      } else if (e.key === 'PageUp' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        stepPage(-1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        gotoPage(1)
      } else if (e.key === 'End') {
        e.preventDefault()
        gotoPage(numPages)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewMode, pageNum, numPages, gotoPage, stepPage])

  // ---- 单页/双页：滚轮滚到页边上/下沿后继续滚 = 翻页 ----
  useEffect(() => {
    if (viewMode === 'scroll') return
    const el = scrollRef.current
    if (!el) return
    let lastFlip = 0
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return // 留给浏览器缩放
      const atTop = el.scrollTop <= 2
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
      if ((e.deltaY > 0 && atBottom) || (e.deltaY < 0 && atTop)) {
        e.preventDefault()
        const now = Date.now()
        if (now - lastFlip > 280) {
          lastFlip = now
          stepPage(e.deltaY > 0 ? 1 : -1)
        }
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [viewMode, stepPage])

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

  /** 「适应宽度」下每页可用宽度：双页时减去间距后对半分 */
  const fitWidth = Math.max(
    120,
    (containerW - PAGE_PAD * 2 - (viewMode === 'double' ? PAGE_GAP : 0)) / (viewMode === 'double' ? 2 : 1),
  )

  const spreadLabel = spread.length > 1 ? `${spread[0]}-${spread[spread.length - 1]}` : String(spread[0])
  const pagesToRender = viewMode === 'scroll' ? Array.from({ length: numPages }, (_, i) => i + 1) : spread

  const pageViewProps = {
    doc,
    scaleMode,
    fitWidth,
    annotations,
    focusedId,
    canLink: Boolean(onLinkSelection),
    onText: handleText,
    onRegister: registerPage,
    onSelectMouseUp: handleSelectMouseUp,
    onHighlightClick: handleHighlightClick,
    onPickColor: pickColor,
    onLink: linkSelection,
    onExportAnnotation,
    onUpdateAnnotation,
    onDeleteAnnotation,
    onCloseActive: () => setActive(null),
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 控件栏 */}
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5 text-sm">
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={pageNum <= 1} onClick={() => stepPage(-1)} title="上一页（PageUp / ←）">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input
            value={viewMode === 'double' ? spreadLabel : String(pageNum)}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && e.target.value.trim() !== '') gotoPage(n)
            }}
            className={`h-7 px-1 text-center ${viewMode === 'double' ? 'w-14' : 'w-12'}`}
            inputMode="numeric"
            aria-label="页码"
          />
          / {numPages}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={spread[spread.length - 1] >= numPages}
          onClick={() => stepPage(1)}
          title="下一页（PageDown / →）"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button
          variant={viewMode === 'scroll' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => setViewMode('scroll')}
          title="连续滚动"
          aria-label="连续滚动"
        >
          <ScrollText className="h-4 w-4" />
        </Button>
        <Button
          variant={viewMode === 'single' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => setViewMode('single')}
          title="单页"
          aria-label="单页"
        >
          <File className="h-4 w-4" />
        </Button>
        <Button
          variant={viewMode === 'double' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => setViewMode('double')}
          title="双页对开"
          aria-label="双页对开"
        >
          <Columns2 className="h-4 w-4" />
        </Button>
        {viewMode === 'double' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-1.5 text-xs"
            onClick={toggleParity}
            title={parity === 0 ? '当前从 1+2 页起排；点击切换为封面单独一页（2+3 起）' : '当前封面单独一页；点击切换为从 1+2 页起排'}
          >
            <FlipHorizontal2 className="h-4 w-4" />
            {parity === 0 ? '1+2 起' : '封面'}
          </Button>
        )}
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

      {/* 页面区 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-muted/40 p-4">
        <div className={viewMode === 'double' ? 'flex items-start justify-center' : 'flex flex-col'} style={{ gap: PAGE_GAP }}>
          {pagesToRender.map((page) => (
            <PdfPageView
              key={page}
              page={page}
              shouldRender={viewMode !== 'scroll' || nearPages.has(page)}
              dims={dimsRef.current.get(page)}
              searchRange={page === pageNum ? searchRange : null}
              selectionRects={selection?.page === page ? selection.rects : null}
              palette={palette?.page === page ? palette : null}
              active={active?.page === page ? active : null}
              {...pageViewProps}
            />
          ))}
        </div>
        <div className="h-4" />
      </div>
    </div>
  )
}

/** 当前屏页码归一：双页模式取所在对页的第一页 */
function normalizeSpread(n: number, viewMode: ViewMode, parity: DoubleParity, numPages: number): number[] {
  const clamped = Math.max(1, Math.min(numPages || n, n))
  if (viewMode !== 'double') return [clamped]
  if (parity === 1 && clamped === 1) return [1]
  const start = parity === 0 ? (clamped % 2 === 1 ? clamped : clamped - 1) : clamped % 2 === 0 ? clamped : clamped - 1
  const pages = [start]
  if (numPages === 0 || start + 1 <= numPages) pages.push(start + 1)
  return pages
}
