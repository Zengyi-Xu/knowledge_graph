import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { NOTE_TYPE_META, GRADE_META } from '@/types/note'
import type { Note, NoteType, Grade, LiteratureMeta } from '@/types/note'
import { emptyLiterature } from '@/types/note'
import { makeCitekey } from '@/lib/citekey'
import { PreviewContent } from './PreviewContent'
import type { PreviewTheme } from './PreviewContent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Trash2, Download, Check, Upload, Palette, MoreVertical, RefreshCw, Pencil, ClipboardCopy, Sparkles, ExternalLink, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { readSetting, writeSetting } from '@/lib/env'
import { attachmentsSupported, openPdfExternal } from '@/lib/attachments'

const THEME_KEY = 'preview-theme-v1'
const CUSTOM_THEME_KEY = 'custom-preview-theme-v1'
const EDITOR_MODE_KEY = 'editor-mode-v1'
const WysiwygEditor = lazy(() => import('./WysiwygEditor'))
const LiteratureAttachments = lazy(() => import('./LiteratureAttachments').then((module) => ({ default: module.LiteratureAttachments })))

async function copyCitation(note: Note, format: 'gb' | 'apa' | 'bibtex') {
  const { copyCitationFor } = await import('@/lib/copyCitation')
  await copyCitationFor(note, format)
}

async function copyWordCitation(note: Note) {
  const [{ litToCSL }, { writeCitationClipboard }] = await Promise.all([import('@/lib/literature'), import('@/lib/rtfField')])
  await writeCitationClipboard([litToCSL(note)], 'gb')
}

function savedTheme(): PreviewTheme {
  const value = readSetting(THEME_KEY)
  return value === 'paper' || value === 'night' || value === 'vue-light' || value === 'vue-night' || value === 'custom'
    ? value
    : 'default'
}

interface Props {
  note: Note
  allNotes: Note[]
  onChange: (patch: Partial<Note>) => void
  onDelete: () => void
  onOpenNote: (id: string) => void
  onCreateNote: (title: string) => void
  /** 汇总笔记专属：「AI 更新」入口（未提供则不显示提示条） */
  onAiUpdate?: () => void
  /** true：左源码右渲染同时显示；false：保留「预览/编辑」切换 */
  splitView?: boolean
}

export function NoteEditor({ note, allNotes, onChange, onDelete, onOpenNote, onCreateNote, onAiUpdate, splitView = false }: Props) {
  const [tagInput, setTagInput] = useState('')
  const [tab, setTab] = useState<'edit' | 'preview'>('preview')
  const [theme, setTheme] = useState<PreviewTheme>(savedTheme)
  const [editorMode, setEditorMode] = useState<'classic' | 'wysiwyg'>(() => readSetting(EDITOR_MODE_KEY) === 'classic' ? 'classic' : 'wysiwyg')
  const [customTheme, setCustomTheme] = useState(() => {
    try {
  return JSON.parse(readSetting(CUSTOM_THEME_KEY) ?? 'null') as { name: string; css: string } | null
    } catch {
      return null
    }
  })
  const cssRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [saved, setSaved] = useState(false)

  const selectTheme = (value: PreviewTheme) => {
    setTheme(value)
    writeSetting(THEME_KEY, value)
  }

  const importTheme = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.css') || file.size > 500_000) {
      toast.error('请选择小于 500 KB 的 Typora CSS 文件')
      return
    }
    const custom = { name: file.name.replace(/\.css$/i, ''), css: await file.text() }
    try {
    writeSetting(CUSTOM_THEME_KEY, JSON.stringify(custom))
      setCustomTheme(custom)
      selectTheme('custom')
      setTab('preview')
      toast.success(`已导入主题「${custom.name}」`)
    } catch {
      toast.error('主题无法保存：本地存储空间不足')
    }
  }

  const markSaved = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  // [[ 自动补全
  const [linkSuggest, setLinkSuggest] = useState<{ pos: number; query: string } | null>(null)
  const linkCandidates = useMemo(() => {
    if (!linkSuggest) return []
    const q = linkSuggest.query.toLowerCase()
    return allNotes
      .filter((n) => n.id !== note.id && n.title.toLowerCase().includes(q))
      .slice(0, 6)
  }, [linkSuggest, allNotes, note.id])

  const handleContentChange = (v: string) => {
    onChange({ content: v })
    const ta = taRef.current
    if (!ta) return
    const upto = v.slice(0, ta.selectionStart)
    const m = upto.match(/\[\[([^[\]]*)$/)
    if (m) {
      setLinkSuggest({ pos: ta.selectionStart - m[0].length, query: m[1] })
    } else {
      setLinkSuggest(null)
    }
  }

  const insertLink = (title: string) => {
    const ta = taRef.current
    if (!ta || !linkSuggest) return
    const before = note.content.slice(0, linkSuggest.pos)
    const after = note.content.slice(ta.selectionStart)
    const next = `${before}[[${title}]]${after}`
    onChange({ content: next })
    setLinkSuggest(null)
    requestAnimationFrame(() => {
      ta.focus()
      const p = linkSuggest.pos + title.length + 4
      ta.setSelectionRange(p, p)
    })
  }

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '')
    if (t && !note.tags.includes(t)) onChange({ tags: [...note.tags, t] })
    setTagInput('')
  }

  const exportMd = () => {
    const fm = [
      '---',
      `type: ${note.type}`,
      ...(note.grade ? [`grade: ${note.grade}`] : []),
      `tags: [${note.tags.join(', ')}]`,
      `updated: ${new Date(note.updatedAt).toISOString().slice(0, 10)}`,
      '---',
      '',
      note.content,
    ].join('\n')
    const blob = new Blob([fm], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${note.title.replace(/[\\/:*?"<>|]/g, '_')}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const confirmDelete = () => {
    if (confirm(`确定删除笔记「${note.title}」吗？`)) onDelete()
  }

  // 左：Markdown 源码
  const editorBody = (
    <>
      <Textarea
        ref={taRef}
        value={note.content}
        onChange={(e) => {
          handleContentChange(e.target.value)
          markSaved()
        }}
        placeholder={'用 Markdown 记录，用 [[笔记标题]] 建立关联，用 #标签 标记主题。\n\n## 小节标题\n- 列表项\n- [ ] 待办项\n**重点**、*斜体*、`代码`、~~删除线~~\n> 引用\n\n| 表头 | 表头 |\n|:---|---:|\n| 单元格 | 单元格 |\n\n[链接](https://example.com)\n```\n代码块\n```'}
        className="h-full resize-none rounded-none border-0 p-3 font-mono text-base focus-visible:ring-0 md:p-4 md:text-sm"
      />
      {linkSuggest && linkCandidates.length > 0 && (
        <div className="absolute left-2 right-2 top-2 z-10 max-h-60 overflow-y-auto rounded-md border bg-popover shadow-md md:left-4 md:right-auto md:top-4 md:w-64">
          {linkCandidates.map((c) => (
            <button
              key={c.id}
              className="block min-h-11 w-full truncate px-3 py-1.5 text-left text-sm hover:bg-accent md:min-h-0"
              onClick={() => insertLink(c.title)}
            >
              {c.title}
            </button>
          ))}
        </div>
      )}
    </>
  )

  // 右：渲染结果
  const previewBody = (
    <PreviewContent
      content={note.content}
      notes={allNotes}
      onOpenNote={onOpenNote}
      onCreateNote={onCreateNote}
      theme={theme}
      customCss={customTheme?.css ?? ''}
    />
  )

  const themeControls = (
    <div className="flex min-w-0 items-center gap-2">
      <Select value={editorMode} onValueChange={(value) => {
        const mode = value === 'wysiwyg' ? 'wysiwyg' : 'classic'
        setEditorMode(mode)
        writeSetting(EDITOR_MODE_KEY, mode)
        setLinkSuggest(null)
      }}>
        <SelectTrigger className="h-11 w-[8rem] min-w-0 md:h-8" aria-label="编辑模式"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="wysiwyg">所见即所得</SelectItem>
          <SelectItem value="classic">经典模式</SelectItem>
        </SelectContent>
      </Select>
      <Palette className="hidden h-4 w-4 text-muted-foreground md:block" aria-hidden="true" />
      <Select value={theme} onValueChange={(v) => selectTheme(v as PreviewTheme)}>
        <SelectTrigger className="h-11 w-[9rem] min-w-0 md:h-8 md:w-[140px]" aria-label="阅读主题">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">默认</SelectItem>
          <SelectItem value="paper">纸页</SelectItem>
          <SelectItem value="night">夜读</SelectItem>
          <SelectItem value="vue-light">Vue 浅色</SelectItem>
          <SelectItem value="vue-night">Vue 深色</SelectItem>
          {customTheme && <SelectItem value="custom">{customTheme.name}</SelectItem>}
        </SelectContent>
      </Select>
      <input
        ref={cssRef}
        type="file"
        accept=".css,text/css"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void importTheme(file)
          e.target.value = ''
        }}
      />
      <Button
        variant="outline"
        size="icon"
        className="hidden h-8 w-8 md:inline-flex"
        title="导入 Typora CSS 主题"
        aria-label="导入 Typora CSS 主题"
        onClick={() => cssRef.current?.click()}
      >
        <Upload className="h-4 w-4" />
      </Button>
    </div>
  )

  // 编辑区：分栏（源码 | 渲染）或 预览/编辑切换
  const editorArea = editorMode === 'wysiwyg' ? (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 md:px-4">
        <span className="text-xs text-muted-foreground">正文即打即排版，与 Word 一致；Markdown 自动保存</span>
        {themeControls}
      </div>
      <Suspense fallback={<div className="p-4 text-sm text-muted-foreground" role="status">正在加载编辑器…</div>}>
        <WysiwygEditor key={note.id} value={note.content} noteId={note.id} notes={allNotes}
          onChange={(content) => { onChange({ content }); markSaved() }}
          onOpenNote={onOpenNote} onCreateNote={onCreateNote} theme={theme} customCss={customTheme?.css ?? ''} />
      </Suspense>
    </div>
  ) : splitView ? (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 md:px-4">
        <span className="text-xs text-muted-foreground">左：Markdown 源码 · 右：渲染结果</span>
        {themeControls}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 w-1/2 border-r">{editorBody}</div>
        <div className="min-h-0 w-1/2 overflow-hidden">{previewBody}</div>
      </div>
    </div>
  ) : (
    <Tabs value={tab} onValueChange={(v) => setTab(v as 'edit' | 'preview')} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 md:px-4">
        <TabsList>
          <TabsTrigger value="preview">预览</TabsTrigger>
          <TabsTrigger value="edit">编辑</TabsTrigger>
        </TabsList>
        {themeControls}
      </div>
      <div className="relative min-h-0 flex-1">
        {tab === 'edit' ? editorBody : previewBody}
      </div>
    </Tabs>
  )

  return (
    <div className="flex h-full flex-col">
      {/* 头部：标题与元信息 */}
      <div className="space-y-3 border-b p-3 md:p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start">
          <Input
            value={note.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="笔记标题"
            className="h-11 min-w-0 flex-1 text-base font-semibold md:h-10 md:text-lg"
          />
          {/* 手机：次要操作收进菜单，功能不减，并让标题独占一行；
              桌面：保留原有并排图标按钮 */}
          <div className="flex shrink-0 items-center justify-end gap-2 md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11"
                  title="更多操作（导出 / 导入主题 / 删除）"
                  aria-label="更多操作"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem className="min-h-11" onSelect={() => exportMd()}>
                  <Download className="mr-2 h-4 w-4" />
                  导出为 Obsidian 兼容 .md
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={() => cssRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  导入 Typora CSS 主题
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => confirmDelete()}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  删除笔记
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <Button variant="outline" size="icon" onClick={exportMd} title="导出为 Obsidian 兼容的 .md 文件">
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={confirmDelete} title="删除笔记">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
        {note.type === 'summary' && onAiUpdate && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">此笔记由 AI 统筹生成，可人工修订。</span>
            <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onAiUpdate}>
              <Sparkles className="mr-1 h-3 w-3" /> AI 更新
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={note.type}
            onValueChange={(v) => {
              const t = v as NoteType
              onChange({
                type: t,
                ...(t !== 'person' ? { grade: '' as Grade } : {}),
                // 切到文献时补一个空元数据对象，编辑区才有所依托
                ...(t === 'literature' && !note.literature
                  ? { literature: emptyLiterature() }
                  : {}),
              })
            }}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(NOTE_TYPE_META).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: v.color }} />
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {note.type === 'person' && (
            <Select value={note.grade || 'none'} onValueChange={(v) => onChange({ grade: (v === 'none' ? '' : v) as Grade })}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="年级/身份" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未设置</SelectItem>
                {Object.entries(GRADE_META).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {note.tags.map((t) => (
              <Badge
                key={t}
                variant="secondary"
                className="cursor-pointer"
                title="点击移除"
                onClick={() => onChange({ tags: note.tags.filter((x) => x !== t) })}
              >
                #{t} ×
              </Badge>
            ))}
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag()
                }
              }}
              onBlur={addTag}
              placeholder="+ 标签"
              className="h-11 w-24 text-sm md:h-7 md:text-xs"
            />
          </div>
          <span className="text-xs text-muted-foreground md:ml-auto">
            {saved && (
              <span className="mr-2 inline-flex items-center text-green-600">
                <Check className="mr-0.5 h-3 w-3" />已保存
              </span>
            )}
            更新于 {new Date(note.updatedAt).toLocaleString('zh-CN')}
          </span>
        </div>
      </div>

      {/* 文献元数据编辑区：仅文献类型显示 */}
      {note.type === 'literature' && (
        <LiteratureFields note={note} allNotes={allNotes} onChange={onChange} />
      )}

      {/* 编辑区；文献笔记外包一层附件工作区（附件工具条 + 可拖拽 PDF 面板） */}
      {note.type === 'literature' ? (
        <Suspense fallback={editorArea}>
          <LiteratureAttachments note={note} onChange={onChange}>
            {editorArea}
          </LiteratureAttachments>
        </Suspense>
      ) : (
        editorArea
      )}
    </div>
  )
}

/** 文献笔记的元数据编辑区：作者（一行一个）、venue、year、doi、citekey */
function LiteratureFields({
  note,
  allNotes,
  onChange,
}: {
  note: Note
  allNotes: Note[]
  onChange: (patch: Partial<Note>) => void
}) {
  const lit = note.literature ?? emptyLiterature()
  const [editingKey, setEditingKey] = useState(false)

  const patch = (p: Partial<LiteratureMeta>) => onChange({ literature: { ...lit, ...p } })
  const existingKeys = useMemo(
    () =>
      new Set(
        allNotes.filter((n) => n.id !== note.id && n.literature?.citekey).map((n) => n.literature!.citekey),
      ),
    [allNotes, note.id],
  )

  // 按「第一作者姓 + 年份 + 标题首词」重新生成，撞名自动追加后缀
  const regenerate = () => {
    patch({ citekey: makeCitekey(lit, note.title, existingKeys) })
    setEditingKey(false)
  }

  // DOI / 文献链接：裸 DOI 补 https://doi.org/ 前缀；已是 URL 则原样打开
  const doi = lit.doi.trim()
  const doiUrl = doi ? (/^https?:\/\//i.test(doi) ? doi : `https://doi.org/${encodeURIComponent(doi)}`) : null
  const pdfIds = lit.attachments ?? []
  const openLocalPdf = async () => {
    if (!pdfIds.length) return
    try {
      const error = await openPdfExternal(pdfIds[0])
      if (error) toast.error(`打开 PDF 失败：${error}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '打开 PDF 失败')
    }
  }

  return (
    <div className="space-y-2 border-b p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">文献信息</span>
        <span className="text-xs text-muted-foreground">作者一行一个，如 Zhang, San</span>
        {doiUrl && (
          <Button variant="outline" size="sm" className="h-7 text-xs" title={doiUrl} onClick={() => window.open(doiUrl, '_blank', 'noopener')}>
            <ExternalLink className="mr-1 h-3 w-3" /> 打开文献
          </Button>
        )}
        {pdfIds.length > 0 && attachmentsSupported() && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            title="用系统默认程序（如 PDF 阅读器）打开本地 PDF"
            onClick={() => void openLocalPdf()}
          >
            <FileText className="mr-1 h-3 w-3" /> 本地 PDF{pdfIds.length > 1 ? ` (${pdfIds.length})` : ''}
          </Button>
        )}
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs">
                <ClipboardCopy className="mr-1 h-3 w-3" /> 复制引用
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void copyCitation(note, 'gb')}>GB/T 7714</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyCitation(note, 'apa')}>APA</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyCitation(note, 'bibtex')}>BibTeX</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void copyWordCitation(note)}>
                插入 Word 引用（域代码）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <Textarea
          value={lit.authors.join('\n')}
          onChange={(e) =>
            patch({ authors: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })
          }
          placeholder={'作者（一行一个）\nZhang, San\nLi, Si'}
          className="min-h-20 resize-none font-mono text-sm"
        />
        <div className="grid content-start gap-2">
          <Input
            value={lit.venue}
            onChange={(e) => patch({ venue: e.target.value })}
            placeholder="期刊 / 会议（可为空）"
            className="h-9 text-sm"
          />
          <div className="flex gap-2">
            <Input
              value={lit.year === '' ? '' : String(lit.year)}
              onChange={(e) => {
                const s = e.target.value.trim()
                patch({ year: /^\d{1,4}$/.test(s) ? Number(s) : '' })
              }}
              placeholder="年份"
              inputMode="numeric"
              className="h-9 w-24 text-sm"
            />
            <Input
              value={lit.doi}
              onChange={(e) => patch({ doi: e.target.value })}
              placeholder="DOI（可为空）"
              className="h-9 min-w-0 flex-1 font-mono text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            {editingKey ? (
              <Input
                value={lit.citekey}
                onChange={(e) => patch({ citekey: e.target.value.trim() })}
                onBlur={() => setEditingKey(false)}
                autoFocus
                placeholder="citekey"
                className="h-9 w-48 font-mono text-sm"
              />
            ) : (
              <code className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                {lit.citekey || '（未生成 citekey）'}
              </code>
            )}
            <Button variant="outline" size="icon" className="h-8 w-8" title="按作者/年份/标题重新生成" onClick={regenerate}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              title="手动修改 citekey"
              onClick={() => setEditingKey(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
