import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { toast } from 'sonner'
import { BookOpen, ExternalLink, FileText, Link2, PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { Note } from '@/types/note'
import { uid } from '@/types/note'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import { readSetting } from '@/lib/env'
import type { PreviewTheme } from '@/lib/previewTheme'
import type { NewAnnotation } from '@/components/PdfViewer'
import {
  PDF_ANNOTATIONS_FORMAT,
  readAnnotations,
  saveAnnotations,
  type PdfAnnotation,
  type PdfAnnotationsFile,
} from '@/lib/attachments'
import { annotationStoreId, loadPdfSourceCached, openPdfSourceExternally, preferredPdfSource, type LoadedPdf } from '@/lib/pdfSource'
import { appendPdfReference, pdfReferenceIdFromHref, referencedAnnotationIds } from '@/lib/pdfReference'

const PdfViewer = lazy(() => import('./PdfViewer').then((module) => ({ default: module.PdfViewer })))
// 笔记栏与主界面「所见即所得」共用同一个编辑器（Vditor 按需加载，只在打开阅读工作台时拉取）
const WysiwygEditor = lazy(() => import('./WysiwygEditor'))

const THEME_KEY = 'preview-theme-v1'
const CUSTOM_THEME_KEY = 'custom-preview-theme-v1'

function savedTheme(): PreviewTheme {
  const value = readSetting(THEME_KEY)
  return value === 'paper' || value === 'night' || value === 'vue-light' || value === 'vue-night' || value === 'custom'
    ? value
    : 'default'
}

function savedCustomCss(): string {
  try {
    return (JSON.parse(readSetting(CUSTOM_THEME_KEY) ?? 'null') as { css?: string } | null)?.css ?? ''
  } catch {
    return ''
  }
}

interface Props {
  note: Note
  notes: Note[]
  onChange: (patch: Partial<Note>) => void
  onClose: () => void
  onOpenNote: (id: string) => void
  onCreateNote: (title: string) => void
}

export function PdfReadingWorkspace({ note, notes, onChange, onClose, onOpenNote, onCreateNote }: Props) {
  const isMobile = useIsMobile()
  const sourceKey = [
    note.id,
    note.literature?.localPdf ?? '',
    note.literature?.zoteroKey ?? '',
    (note.literature?.zoteroKeys ?? []).join(','),
    note.literature?.zoteroAvailablePdfCount ?? '',
    note.literature?.attachments?.[0] ?? '',
  ].join('\u0000')
  // 编辑正文会产生新的 note 对象；PDF 来源没变时不能重新读取整份文件。
  // sourceKey 已编码 preferredPdfSource 读取的全部 note 字段，故以其为唯一依赖；
  // 这里的窄依赖是有意为之（避免每次编辑正文都重读 PDF），不是漏写 note。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const source = useMemo(() => preferredPdfSource(note), [sourceKey])
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null)
  const [annotations, setAnnotations] = useState<PdfAnnotationsFile | null>(null)
  const [error, setError] = useState('')
  const [notesOpen, setNotesOpen] = useState(true)
  const [focusAnnotationId, setFocusAnnotationId] = useState<string | null>(null)
  const saveTimer = useRef<number | null>(null)
  const pendingSave = useRef<{ id: string; json: PdfAnnotationsFile } | null>(null)

  // 来源变化时清空旧的读取结果（render 期调整，替代旧 effect 开头的同步 setState）
  const [loadedSourceKey, setLoadedSourceKey] = useState<string | null>(null)
  if (loadedSourceKey !== sourceKey) {
    setLoadedSourceKey(sourceKey)
    setLoaded(null)
    setAnnotations(null)
    setError('')
  }

  // 无可用 PDF 时直接给提示；异步读取错误仍走 error 状态
  const displayError = error || (source ? '' : '这篇文献没有可读取的本地 PDF')

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  useEffect(() => {
    if (!source) return
    let cancelled = false
    void (async () => {
      try {
        const pdf = await loadPdfSourceCached(source)
        const storeId = annotationStoreId(note.id, source)
        const saved = await readAnnotations(storeId)
        if (cancelled) return
        setLoaded(pdf)
        setAnnotations(saved ?? {
          format: PDF_ANNOTATIONS_FORMAT,
          version: 1,
          fileName: pdf.fileName,
          items: [],
        })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'PDF 读取失败')
      }
    })()
    return () => { cancelled = true }
  }, [note.id, source])

  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    const pending = pendingSave.current
    pendingSave.current = null
    if (pending) void saveAnnotations(pending.id, pending.json).catch(() => toast.error('PDF 标注保存失败'))
  }, [note.id, source])

  const persist = useCallback((next: PdfAnnotationsFile) => {
    if (!source) return
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    pendingSave.current = { id: annotationStoreId(note.id, source), json: next }
    saveTimer.current = window.setTimeout(() => {
      const pending = pendingSave.current
      pendingSave.current = null
      if (pending) void saveAnnotations(pending.id, pending.json).catch(() => toast.error('PDF 标注保存失败'))
    }, 350)
  }, [note.id, source])

  const addAnnotation = useCallback((draft: NewAnnotation): PdfAnnotation | null => {
    if (!annotations) return null
    const annotation: PdfAnnotation = { id: uid(), ...draft, comment: '', createdAt: Date.now() }
    const next = { ...annotations, items: [...annotations.items, annotation] }
    setAnnotations(next)
    persist(next)
    return annotation
  }, [annotations, persist])

  const updateAnnotations = useCallback((fn: (items: PdfAnnotation[]) => PdfAnnotation[]) => {
    if (!annotations) return
    const next = { ...annotations, items: fn(annotations.items) }
    setAnnotations(next)
    persist(next)
  }, [annotations, persist])

  const linkSelection = (draft: NewAnnotation) => {
    if (!loaded) return
    const annotation = addAnnotation(draft)
    if (!annotation) return
    onChange({ content: appendPdfReference(note.content, annotation, loaded.fileName) })
    setFocusAnnotationId(annotation.id)
    toast.success(`已链接到笔记：PDF 第 ${annotation.page} 页`)
  }

  const linkedIds = useMemo(() => referencedAnnotationIds(note.content), [note.content])
  const linked = useMemo(
    () => (annotations?.items ?? []).filter((item) => linkedIds.has(item.id)),
    [annotations, linkedIds],
  )

  const handleReferenceClick = (event: ReactMouseEvent) => {
    const path = event.nativeEvent.composedPath()
    const anchor = path.find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement)
    if (!anchor) return
    const id = pdfReferenceIdFromHref(anchor.getAttribute('href') ?? '')
    if (!id) return
    event.preventDefault()
    if (!(annotations?.items.some((item) => item.id === id))) {
      toast.error('这条 PDF 链接对应的标注不存在或已经失效')
      return
    }
    setFocusAnnotationId(id)
  }

  const openExternal = async () => {
    if (!source) return
    try {
      await openPdfSourceExternally(source)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '系统阅读器打开失败')
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-background" onClickCapture={handleReferenceClick}>
      <header className="flex min-h-12 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon" onClick={onClose} title="返回（Esc）"><X className="h-4 w-4" /></Button>
        <FileText className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={note.title}>{note.title}</div>
          <div className="truncate text-xs text-muted-foreground">{loaded?.fileName ?? 'PDF 阅读工作台'}</div>
        </div>
        <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => void openExternal()} disabled={!source}>
          <ExternalLink className="mr-1 h-3.5 w-3.5" /> <span className="hidden md:inline">系统阅读器</span>
        </Button>
        <Button variant={notesOpen ? 'secondary' : 'outline'} size="sm" className="h-11 md:h-8" onClick={() => setNotesOpen((value) => !value)}>
          {notesOpen ? <PanelRightClose className="mr-1 h-3.5 w-3.5" /> : <PanelRightOpen className="mr-1 h-3.5 w-3.5" />}
          <span className="hidden md:inline">{notesOpen ? '隐藏笔记' : '显示笔记'}</span>
        </Button>
      </header>

      <div className="min-h-0 flex-1">
        {displayError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground" />
            <p className="max-w-xl text-sm text-destructive">{displayError}</p>
            {source && <Button variant="outline" onClick={() => void openExternal()}>改用系统阅读器</Button>}
          </div>
        ) : !loaded || !annotations ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在读取 PDF 与标注…</div>
        ) : (
          <Group orientation={isMobile ? 'vertical' : 'horizontal'} className="h-full min-h-0">
            <Panel defaultSize={notesOpen ? '68%' : '100%'} minSize="45%" className="min-h-0">
              <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">正在加载 PDF 阅读器…</div>}>
                <PdfViewer
                  data={loaded.data}
                  annotations={annotations.items}
                  onAddAnnotation={(draft) => { addAnnotation(draft) }}
                  onUpdateAnnotation={(id, comment) => updateAnnotations((items) => items.map((item) => item.id === id ? { ...item, comment } : item))}
                  onDeleteAnnotation={(id) => updateAnnotations((items) => items.filter((item) => item.id !== id))}
                  onExportAnnotation={(item) => onChange({ content: appendPdfReference(note.content, item, loaded.fileName) })}
                  onLinkSelection={linkSelection}
                  focusAnnotationId={focusAnnotationId}
                />
              </Suspense>
            </Panel>
            {notesOpen && (
              <>
                <Separator className={isMobile ? 'h-1 bg-border hover:bg-primary/40' : 'w-1 bg-border hover:bg-primary/40'} />
                <Panel defaultSize="32%" minSize="22%" className="min-h-0">
                  <div className="flex h-full min-h-0 flex-col border-l bg-card">
                    <div className="flex items-center gap-2 border-b px-3 py-2">
                      <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">PDF 链接 {linked.length}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">笔记自动保存</span>
                    </div>
                    {linked.length > 0 && (
                      <div className="flex max-h-28 gap-1 overflow-x-auto border-b p-2">
                        {linked.map((item) => (
                          <Button key={item.id} variant="outline" size="sm" className="h-auto min-w-32 max-w-52 justify-start px-2 py-1 text-left" onClick={() => setFocusAnnotationId(item.id)}>
                            <span className="truncate text-xs">p.{item.page} · {item.anchor.exact}</span>
                          </Button>
                        ))}
                      </div>
                    )}
                    <div className="flex min-h-0 flex-1 flex-col">
                      <Suspense fallback={<div className="p-4 text-sm text-muted-foreground" role="status">正在加载所见即所得编辑器…</div>}>
                        <WysiwygEditor
                          key={note.id}
                          value={note.content}
                          noteId={note.id}
                          notes={notes}
                          onChange={(content) => onChange({ content })}
                          onOpenNote={onOpenNote}
                          onCreateNote={onCreateNote}
                          theme={savedTheme()}
                          customCss={savedCustomCss()}
                        />
                      </Suspense>
                    </div>
                  </div>
                </Panel>
              </>
            )}
          </Group>
        )}
      </div>
    </div>
  )
}
