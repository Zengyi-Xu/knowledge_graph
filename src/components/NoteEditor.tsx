import { useMemo, useRef, useState } from 'react'
import { NOTE_TYPE_META, GRADE_META } from '@/types/note'
import type { Note, NoteType, Grade } from '@/types/note'
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
import { Trash2, Download, Check, Upload, Palette, MoreVertical } from 'lucide-react'
import { toast } from 'sonner'
import { readSetting, writeSetting } from '@/lib/env'

const THEME_KEY = 'preview-theme-v1'
const CUSTOM_THEME_KEY = 'custom-preview-theme-v1'

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
  /** true：左源码右渲染同时显示；false：保留「预览/编辑」切换 */
  splitView?: boolean
}

export function NoteEditor({ note, allNotes, onChange, onDelete, onOpenNote, onCreateNote, splitView = false }: Props) {
  const [tagInput, setTagInput] = useState('')
  const [tab, setTab] = useState<'edit' | 'preview'>('preview')
  const [theme, setTheme] = useState<PreviewTheme>(savedTheme)
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
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={note.type}
            onValueChange={(v) => onChange({ type: v as NoteType, ...(v !== 'person' ? { grade: '' as Grade } : {}) })}
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

      {/* 编辑区：分栏（源码 | 渲染）或 预览/编辑切换 */}
      {splitView ? (
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
      )}
    </div>
  )
}
