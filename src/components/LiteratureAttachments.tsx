/**
 * 文献笔记的附件工作区：附件列表（添加/打开/删除）+ 右侧可拖拽缩放的 PDF 阅读面板。
 * 浏览器版无桌面文件 API 时降级显示「仅桌面版可用」，核心笔记功能不受影响。
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { FileText, FolderOpen, Maximize2, Paperclip, Trash2, Upload } from 'lucide-react'
import { setInlinePdfPanelOpen, useInlinePdfPanelSlot } from '@/lib/inlinePdfPanel'
import type { Note } from '@/types/note'
import { uid, emptyLiterature } from '@/types/note'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Group, Panel, Separator } from 'react-resizable-panels'
import {
  PDF_ANNOTATIONS_FORMAT,
  addPdfToVault,
  attachmentsSupported,
  listAttachmentFiles,
  readAnnotations,
  readPdf,
  removeAttachment,
  saveAnnotations,
  type PdfAnnotation,
  type PdfAnnotationsFile,
} from '@/lib/attachments'
import { annotationStoreId, cachedPdfSource, externalPdfSource, loadPdfSourceCached } from '@/lib/pdfSource'
import { clearLocalPdfMatch, ensureLocalPdfMatches, localPdfFallbackVersion, subscribeLocalPdfFallback } from '@/lib/localPdfFallback'
import type { NewAnnotation } from '@/components/PdfViewer'

const PdfViewer = lazy(() => import('./PdfViewer').then((module) => ({ default: module.PdfViewer })))
const PdfSnapshot = lazy(() => import('./PdfSnapshot').then((module) => ({ default: module.PdfSnapshot })))

interface Props {
  note: Note
  onChange: (patch: Partial<Note>) => void
  /** 与文献表 PDF 徽标同一个入口（全屏阅读工作台）；未提供则不显示该按钮 */
  onFullscreenRead?: (noteId: string) => void
  children: React.ReactNode
}

interface OpenState {
  id: string
  fileName: string
  data: Uint8Array
  annotations: PdfAnnotationsFile
  missing: boolean
}

function formatSize(bytes: number): string {
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`
  if (bytes >= 1 << 10) return `${Math.round(bytes / (1 << 10))} KB`
  return `${bytes} B`
}

/** 快照占位框：尺寸与 PdfSnapshot 的 BOX 一致，避免出图时跳一下；不引入 pdfjs（那是懒加载 chunk） */
function SnapshotPlaceholder() {
  return (
    <span className="flex h-9 w-7 shrink-0 items-center justify-center rounded-sm border bg-muted/40">
      <FileText className="h-3 w-3 text-muted-foreground" />
    </span>
  )
}

export function LiteratureAttachments({ note, onChange, onFullscreenRead, children }: Props) {
  const lit = note.literature
  const supported = attachmentsSupported()
  const fileRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState<OpenState | null>(null)
  const [sizes, setSizes] = useState<Map<string, number>>(new Map())
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [removing, setRemoving] = useState<string | null>(null)
  const saveTimer = useRef<number | null>(null)
  const litRef = useRef(lit)
  litRef.current = lit

  const attachments = useMemo(() => lit?.attachments ?? [], [lit])

  /** 应用外的 PDF（localPdf / Zotero）：详情页同样要能看见并打开，而不只是文献表的徽标 */
  const external = useMemo(() => externalPdfSource(note), [note])
  // 直接打开某一篇（没经过文献列表）时也要问一次兜底匹配；ensureLocalPdfMatches 幂等
  useEffect(() => {
    ensureLocalPdfMatches([note])
  }, [note])
  // 匹配是异步回来的：订阅模块级 store，到达后这一块跟着重渲染
  useSyncExternalStore(subscribeLocalPdfFallback, localPdfFallbackVersion, localPdfFallbackVersion)
  const rememberLocalPdf = (path: string) => {
    if (!litRef.current) return
    onChange({ literature: { ...litRef.current, localPdf: path } })
    clearLocalPdfMatch(note.id)
    toast('已记到这篇笔记的「本地 PDF」')
  }
  const externalStoreId = external ? annotationStoreId(note.id, external) : ''
  // 字节已经读过（本会话打开过这份 PDF）才出快照：否则打开笔记就要跨桥读整份文件
  const externalReady = Boolean(external && cachedPdfSource(external))
  /** 顶层布局给的挂载点：并列视图下把阅读面板 portal 到独立一列（图谱会让出宽度），没有就地渲染 */
  const pdfSlot = useInlinePdfPanelSlot()
  // 面板展开与否要上报给布局（App 用它决定分栏），卸载或关掉面板就撤回
  useEffect(() => {
    setInlinePdfPanelOpen(open !== null)
    return () => setInlinePdfPanelOpen(false)
  }, [open])

  // 附件文件名 / 大小来自磁盘（标注 JSON 顶部的 fileName + list 的 size）
  useEffect(() => {
    if (!supported || !attachments.length) return
    let cancelled = false
    void (async () => {
      try {
        const [files, ...anns] = await Promise.all([
          listAttachmentFiles(),
          ...attachments.map((id) => readAnnotations(id)),
        ])
        if (cancelled) return
        const sizeMap = new Map<string, number>()
        const nameMap = new Map<string, string>()
        const present = new Set(files.map((f) => f.name))
        const missingSet = new Set<string>()
        attachments.forEach((id, i) => {
          if (!present.has(`attachments/${id}.pdf`)) missingSet.add(id)
          nameMap.set(id, anns[i]?.fileName ?? `${id}.pdf`)
          const stat = files.find((f) => f.name === `attachments/${id}.pdf`)
          if (stat) sizeMap.set(id, stat.size)
        })
        setSizes(sizeMap)
        setNames(nameMap)
        setMissing(missingSet)
      } catch {
        /* 列表失败就保持现状 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [supported, attachments])

  const persist = useCallback((id: string, json: PdfAnnotationsFile) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void saveAnnotations(id, json).catch(() => toast.error('标注保存失败'))
    }, 500)
  }, [])

  const addPdf = async (file: File) => {
    try {
      const id = await addPdfToVault(file)
      const cur = litRef.current
      onChange({ literature: { ...(cur ?? emptyLiterature()), attachments: [...(cur?.attachments ?? []), id] } })
      toast.success(`已添加附件「${file.name}」`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '添加附件失败')
    }
  }

  const openAttachment = async (id: string) => {
    try {
      const [data, anns] = await Promise.all([readPdf(id), readAnnotations(id)])
      if (!data) {
        setMissing((s) => new Set(s).add(id))
        toast.error('附件文件缺失（可能已被移出 attachments/ 目录）')
        return
      }
      setOpen({
        id,
        fileName: anns?.fileName ?? names.get(id) ?? `${id}.pdf`,
        data,
        annotations: anns ?? { format: 'kaust-kg-pdf-annotations', version: 1, fileName: `${id}.pdf`, items: [] },
        missing: false,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '打开附件失败')
    }
  }

  /**
   * 打开应用外的 PDF：就地读进右侧面板，标注落在 pdfref-<笔记 id> 上
   * —— 与全屏阅读工作台同一份标注（annotationStoreId），两边看到的高亮一致。
   */
  const openExternalPdf = async () => {
    if (!external) return
    try {
      const loaded = await loadPdfSourceCached(external)
      const saved = await readAnnotations(externalStoreId)
      setOpen({
        id: externalStoreId,
        fileName: saved?.fileName ?? loaded.fileName,
        data: loaded.data,
        annotations: saved ?? { format: PDF_ANNOTATIONS_FORMAT, version: 1, fileName: loaded.fileName, items: [] },
        missing: false,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '打开 PDF 失败')
    }
  }

  const closeViewer = () => setOpen(null)

  const updateAnnotations = (fn: (items: PdfAnnotation[]) => PdfAnnotation[]) => {
    if (!open) return
    const next: PdfAnnotationsFile = { ...open.annotations, items: fn(open.annotations.items) }
    setOpen({ ...open, annotations: next })
    persist(open.id, next)
  }

  const handleAdd = (a: NewAnnotation) => {
    updateAnnotations((items) => [
      ...items,
      { id: uid(), page: a.page, color: a.color, anchor: a.anchor, comment: '', createdAt: Date.now() },
    ])
  }

  const handleUpdateComment = (id: string, comment: string) => {
    updateAnnotations((items) => items.map((x) => (x.id === id ? { ...x, comment } : x)))
  }

  const handleDelete = (id: string) => {
    updateAnnotations((items) => items.filter((x) => x.id !== id))
  }

  /** 导出到笔记：把高亮追加到文献笔记正文末尾（走 updateNote，不直接改文件） */
  const handleExport = (a: PdfAnnotation) => {
    const line = `> ${a.anchor.exact.replace(/\n+/g, ' ')} — p.${a.page} [${open?.fileName ?? '附件'}]`
    const content = note.content.trimEnd()
    onChange({ content: content ? `${content}\n\n${line}\n` : `${line}\n` })
    toast.success('已导出到笔记正文')
  }

  const confirmRemove = async (id: string) => {
    try {
      await removeAttachment(id)
      const cur = litRef.current
      if (cur) onChange({ literature: { ...cur, attachments: cur.attachments.filter((x) => x !== id) } })
      if (open?.id === id) closeViewer()
      toast.success('已删除附件')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除附件失败')
    } finally {
      setRemoving(null)
    }
  }

  /** 就地渲染时的 PDF 面板：与 portal 出去的那一份是同一个元素树 */
  const pdfPanel = open && (
    <>
      <div className="flex items-center gap-2 border-b px-2 py-1.5 text-xs">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate" title={open.fileName}>{open.fileName}</span>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={closeViewer}>
          关闭
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="p-4 text-sm text-muted-foreground" role="status">正在加载 PDF 阅读器…</div>}>
          <PdfViewer
            data={open.data}
            annotations={open.annotations.items}
            onAddAnnotation={handleAdd}
            onUpdateAnnotation={handleUpdateComment}
            onDeleteAnnotation={handleDelete}
            onExportAnnotation={handleExport}
          />
        </Suspense>
      </div>
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 附件工具条 */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 md:px-4">
        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">附件</span>
        {!supported && <span className="text-xs text-muted-foreground">（附件仅桌面版可用）</span>}
        {/* 应用外的 PDF（localPdf / Zotero）：不复制进 vault，也不该被误报成「无附件」。
            芯片只说明「这份 PDF 是什么」，操作按钮和「添加文件」并列在右 */}
        {external && (
          <span className="flex items-center rounded-md border bg-background p-0.5 text-xs">
            <button
              type="button"
              onClick={() => void openExternalPdf()}
              className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent"
              title={
                external.kind === 'local'
                  ? '在软件内阅读这篇文献的本地 PDF（可划词高亮）'
                  : external.kind === 'local-scan'
                    ? '本机 PDF 目录里按标题匹配到这份文件（还没记进笔记）；点击在软件内阅读'
                    : '在软件内阅读 Zotero 里的这篇 PDF（可划词高亮）'
              }
            >
              {/* 快照是懒加载 chunk（含 pdfjs）：只有字节已经读过才挂载它，否则打开笔记就白下 1MB */}
              {externalReady ? (
                <Suspense fallback={<SnapshotPlaceholder />}>
                  <PdfSnapshot source={external} />
                </Suspense>
              ) : (
                <SnapshotPlaceholder />
              )}
              <span className="text-muted-foreground">
                {external.kind === 'local' ? '本地 PDF' : external.kind === 'local-scan' ? '匹配到的本地 PDF' : 'Zotero PDF'}
              </span>
            </button>
          </span>
        )}
        {/* 兜底匹配只是一份提名：按钮独立于芯片（芯片里的图标没人看得出能点），点一下才写进笔记 */}
        {external?.kind === 'local-scan' && (
          <Button variant="secondary" size="sm" className="h-6 px-2 text-xs" onClick={() => rememberLocalPdf(external.path)}>
            <Paperclip className="h-3 w-3" /> 记到这篇笔记
          </Button>
        )}
        {supported && attachments.length === 0 && !external && <span className="text-xs text-muted-foreground">（尚无附件）</span>}
        {supported &&
          attachments.map((id) => (
            <span key={id} className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs">
              <FileText className="h-3 w-3 text-muted-foreground" />
              <span className={missing.has(id) ? 'text-destructive line-through' : ''}>
                {names.get(id) ?? `${id}.pdf`}
              </span>
              {sizes.has(id) && <span className="text-muted-foreground">{formatSize(sizes.get(id)!)}</span>}
              {missing.has(id) && <span className="text-destructive">文件缺失</span>}
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                title="在右侧打开阅读"
                onClick={() => void openAttachment(id)}
              >
                <FolderOpen className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-destructive"
                title="删除附件"
                onClick={() => setRemoving(id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </span>
          ))}
        {supported && (
          <>
            {/* 叫「添加文件」而不是「添加 PDF」：有 localPdf / Zotero PDF 的篇目本来就有 PDF，
                叫「添加 PDF」会让人以为这篇现在没有 PDF（用户反馈） */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              title="把 PDF 复制进 vault 的 attachments/ 作为笔记附件"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-1 h-3 w-3" /> 添加文件
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void addPdf(f)
                e.target.value = ''
              }}
            />
          </>
        )}
        {/* 全屏阅读：箭头从芯片里拿出来，独立成一个和「添加文件」并列的按钮
            （用户反馈：藏在芯片里看不出是个按钮） */}
        {onFullscreenRead && (external || attachments.length > 0) && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            title="在软件内全屏阅读（与文献表 PDF 徽标同一入口）"
            onClick={() => onFullscreenRead(note.id)}
          >
            <Maximize2 className="mr-1 h-3 w-3" /> 全屏阅读
          </Button>
        )}
      </div>

      {/* 编辑区 + PDF 面板：布局给了挂载点（并列视图）就把面板 portal 到独立一列
          —— 面板才有上下一整列、图谱也才知道该收窄；没有挂载点（单栏视图、手机端）就就地分栏 */}
      {open && pdfSlot ? (
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      ) : (
        <Group orientation="horizontal" className="min-h-0 flex-1">
          <Panel defaultSize={open ? '55%' : '100%'} minSize="30%" className="min-h-0">
            {children}
          </Panel>
          {open && (
            <>
              <Separator className="w-1 bg-border hover:bg-primary/40" />
              <Panel defaultSize="45%" minSize="25%" className="min-h-0">
                <div className="flex h-full flex-col border-l bg-background">{pdfPanel}</div>
              </Panel>
            </>
          )}
        </Group>
      )}
      {open && pdfSlot && createPortal(<div className="flex h-full min-h-0 flex-col">{pdfPanel}</div>, pdfSlot)}

      <AlertDialog open={removing !== null} onOpenChange={(v) => !v && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除附件？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{removing ? (names.get(removing) ?? `${removing}.pdf`) : ''}」及其全部标注，且不可恢复。
              笔记正文里已导出的高亮文本不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removing && void confirmRemove(removing)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
