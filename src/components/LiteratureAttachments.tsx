/**
 * 文献笔记的附件工作区：附件列表（添加/打开/删除）+ 右侧可拖拽缩放的 PDF 阅读面板。
 * 浏览器版无桌面文件 API 时降级显示「仅桌面版可用」，核心笔记功能不受影响。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileText, FolderOpen, Paperclip, Trash2, Upload } from 'lucide-react'
import type { Note } from '@/types/note'
import { uid } from '@/types/note'
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
import { PdfViewer, type NewAnnotation } from '@/components/PdfViewer'

interface Props {
  note: Note
  onChange: (patch: Partial<Note>) => void
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

export function LiteratureAttachments({ note, onChange, children }: Props) {
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
      onChange({ literature: { ...(cur ?? { authors: [], venue: '', year: '', doi: '', citekey: '', attachments: [] }), attachments: [...(cur?.attachments ?? []), id] } })
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 附件工具条 */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 md:px-4">
        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">附件</span>
        {!supported && <span className="text-xs text-muted-foreground">（附件仅桌面版可用）</span>}
        {supported && attachments.length === 0 && <span className="text-xs text-muted-foreground">（尚无附件）</span>}
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
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-3 w-3" /> 添加 PDF
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
      </div>

      {/* 编辑区 + PDF 面板（可拖拽分栏） */}
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize={open ? '55%' : '100%'} minSize="30%" className="min-h-0">
          {children}
        </Panel>
        {open && (
          <>
            <Separator className="w-1 bg-border hover:bg-primary/40" />
            <Panel defaultSize="45%" minSize="25%" className="min-h-0">
              <div className="flex h-full flex-col border-l bg-background">
                <div className="flex items-center gap-2 border-b px-2 py-1.5 text-xs">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate" title={open.fileName}>{open.fileName}</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={closeViewer}>
                    关闭
                  </Button>
                </div>
                <div className="min-h-0 flex-1">
                  <PdfViewer
                    data={open.data}
                    annotations={open.annotations.items}
                    onAddAnnotation={handleAdd}
                    onUpdateAnnotation={handleUpdateComment}
                    onDeleteAnnotation={handleDelete}
                    onExportAnnotation={handleExport}
                  />
                </div>
              </div>
            </Panel>
          </>
        )}
      </Group>

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
