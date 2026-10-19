/**
 * 外部 PDF（`localPdf` / Zotero）的第一页快照：详情页附件区用来「看见」这篇文献的 PDF。
 *
 * 只在「这份 PDF 本次会话已经读过」时才去渲染（字节来自 pdfSource.ts 的会话缓存）：
 * 打开笔记不会顺带跨桥读整份 PDF，pdfjs 也留在懒加载 chunk 里，不进首屏/编辑路径
 * —— 这是 docs/BUNDLE_BUDGET.md 里「PdfViewer + pdf.worker 只在 PDF 场景加载」的硬约束。
 */
import { useEffect, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { FileText } from 'lucide-react'
import { loadPdfSourceCached, pdfSourceKey, type PdfSource } from '@/lib/pdfSource'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/** 快照渲染宽度（canvas px）：显示尺寸约 28×36 CSS px，留两倍以上余量给高分屏 */
const RENDER_WIDTH = 64
/** 会话内的快照缓存（dataURL），键与 pdfSource 的字节缓存一致 */
const shots = new Map<string, string>()
const SHOTS_MAX = 8
const BOX = 'h-9 w-7'

interface Props {
  /** 调用方只在字节已读过（externalReady）时挂载本组件，因此这里不做「要不要读」的判断 */
  source: PdfSource
}

export function PdfSnapshot({ source }: Props) {
  const key = pdfSourceKey(source)
  const [shot, setShot] = useState<string | null>(() => shots.get(key) ?? null)

  useEffect(() => {
    const ready = shots.get(key)
    setShot(ready ?? null)
    if (ready) return
    let cancelled = false
    void (async () => {
      // pdf.js 6 上销毁文档要走 loading task（PDFDocumentProxy 没有 destroy）
      let task: ReturnType<typeof pdfjsLib.getDocument> | null = null
      try {
        const loaded = await loadPdfSourceCached(source)
        // pdf.js 会把 data 的底层 buffer 交给 worker（原引用随之失效），传副本保护会话缓存
        task = pdfjsLib.getDocument({ data: new Uint8Array(loaded.data) })
        const doc = await task.promise
        const page = await doc.getPage(1)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(viewport.width))
        canvas.height = Math.max(1, Math.floor(viewport.height))
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        await page.render({ canvas, canvasContext: ctx, viewport }).promise
        const url = canvas.toDataURL('image/png')
        shots.set(key, url)
        while (shots.size > SHOTS_MAX) {
          const oldest = shots.keys().next().value
          if (oldest === undefined) break
          shots.delete(oldest)
        }
        if (!cancelled) setShot(url)
      } catch {
        /* 读不到 / 渲染不了就保持占位图标；打开失败的原因由阅读入口提示 */
      } finally {
        if (task) void task.destroy().catch(() => {})
      }
    })()
    return () => {
      cancelled = true
    }
    // `key` 已编码 loadPdfSource 用到的全部来源字段，故不必也不应按 source 的对象身份重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (shot) {
    return <img src={shot} alt="" className={`${BOX} shrink-0 rounded-sm border object-cover object-top`} />
  }
  return (
    <span className={`${BOX} flex shrink-0 items-center justify-center rounded-sm border bg-muted/40`}>
      <FileText className="h-3 w-3 text-muted-foreground" />
    </span>
  )
}
