import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNotes } from '@/hooks/useNotes'
import { NoteList } from '@/components/NoteList'
import { NoteEditor } from '@/components/NoteEditor'
import { GraphView } from '@/components/GraphView'
import type { Filters } from '@/components/GraphView'
import { ConflictDialog } from '@/components/ConflictDialog'
import { NOTE_TYPE_META, GRADE_META } from '@/types/note'
import type { NoteType, Grade, Note } from '@/types/note'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Network,
  NotebookText,
  Upload,
  FileUp,
  FolderSync,
  Settings2,
  Save,
  PanelLeft,
  RefreshCw,
  Columns2,
  MoreVertical,
} from 'lucide-react'
import { toast, Toaster } from 'sonner'
import {
  AUTO_SYNC_KEY,
  SYNC_BASELINE_KEY,
  SYNC_PATH_KEY,
  downloadNotes,
  isDesktop,
  parseNotes,
  readSyncFileText,
  saveNotesToSyncFile,
  serializeNotes,
} from '@/lib/syncFile'
import { Switch } from '@/components/ui/switch'
import { useIsMobile } from '@/hooks/use-mobile'

type View = 'notes' | 'graph' | 'both'

export default function App() {
  const api = useNotes()
  const { notes, hydrated, replaceAll } = api
  // 手机断点来自仓库已有的 useIsMobile()（matchMedia），不散落全局事件监听
  const isMobile = useIsMobile()
  const [view, setView] = useState<View>('notes')
  // 「并列」是图谱 + 编辑器的左右并排，手机上两栏都不可用：
  // 手机端把视图降级到「笔记」，并从折叠状态的列表进入详情（配合抽屉式列表）
  const effectiveView: View = isMobile && view === 'both' ? 'notes' : view
  const [activeId, setActiveId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(() => localStorage.getItem('note-graph-list-open') !== '0')
  const [filters, setFilters] = useState<Filters>({ types: new Set(), grades: new Set(), tags: new Set(), search: '' })
  const fileRef = useRef<HTMLInputElement>(null)
  const mdRef = useRef<HTMLInputElement>(null)
  const [syncPath, setSyncPath] = useState(() => localStorage.getItem(SYNC_PATH_KEY) ?? '')
  const [autoSync, setAutoSync] = useState(() => localStorage.getItem(AUTO_SYNC_KEY) === '1')
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [conflict, setConflict] = useState<{ local: Note[]; remote: Note[] } | null>(null)

  const active = notes.find((n) => n.id === activeId) ?? notes[0] ?? null

  // ---- 双向同步：基线 + 引用 ----
  const notesRef = useRef(notes)
  useEffect(() => {
    notesRef.current = notes
  }, [notes])
  const baselineRef = useRef<string>('')
  const setBaseline = useCallback((v: string) => {
    baselineRef.current = v
    try {
      localStorage.setItem(SYNC_BASELINE_KEY, v)
    } catch {
      /* ignore */
    }
  }, [])
  useEffect(() => {
    baselineRef.current = localStorage.getItem(SYNC_BASELINE_KEY) ?? ''
  }, [])
  const busyRef = useRef(false)
  const conflictRef = useRef(false)
  useEffect(() => {
    conflictRef.current = conflict !== null
  }, [conflict])
  const firstCheckDoneRef = useRef(false)
  const snoozeRef = useRef('')

  const allTags = useMemo(() => {
    const s = new Set<string>()
    for (const n of notes) for (const t of n.tags) s.add(t)
    return [...s].sort()
  }, [notes])

  const tagGroups = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const t of allTags) {
      const i = t.indexOf(':')
      const key = i >= 0 ? t.slice(0, i) : ''
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(t)
    }
    const order = ['功能', '材料', '器件']
    return [...groups.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0])
      const ib = order.indexOf(b[0])
      if (ia >= 0 && ib >= 0) return ia - ib
      if (ia >= 0) return -1
      if (ib >= 0) return 1
      return a[0].localeCompare(b[0], 'zh')
    })
  }, [allTags])

  const toggle = (set: Set<string>, v: string, key: keyof Filters) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    setFilters((f) => ({ ...f, [key]: next }))
  }

  const openNote = (id: string) => {
    setActiveId(id)
    // 并列模式下只切换当前笔记，不离开并列布局
    setView((v) => (v === 'both' ? 'both' : 'notes'))
  }

  const createNote = (title?: string) => {
    const n = api.createNote(title ? { title, content: '' } : {})
    setActiveId(n.id)
    setView((v) => (v === 'both' ? 'both' : 'notes'))
    return n
  }

  const exportJson = () => {
    downloadNotes(notes, `kaust-notes-${new Date().toISOString().slice(0, 10)}.json`)
    toast.success('已导出全部笔记为 JSON 备份')
  }

  const importJson = async (file: File) => {
    try {
      const arr = JSON.parse(await file.text()) as Note[]
      if (!Array.isArray(arr)) throw new Error('bad format')
      const { added, updated } = api.mergeByTitle(arr)
      toast.success(`已导入：新增 ${added} 篇，按标题更新 ${updated} 篇`)
    } catch {
      toast.error('导入失败：不是有效的 JSON 备份文件')
    }
  }

  const reloadFromJson = async () => {
    if (!window.confirm('将用仓库里的 notes.json 覆盖当前本地笔记，本地尚未同步的改动会丢失。继续？')) return
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}notes.json`, { cache: 'no-cache' })
      if (!r.ok) throw new Error('not found')
      const arr = (await r.json()) as Note[]
      if (!Array.isArray(arr)) throw new Error('bad format')
      const count = api.replaceAll(arr)
      setActiveId(null)
      setFocusId(null)
      toast.success(`已从 notes.json 重新载入 ${count} 篇笔记`)
    } catch {
      toast.error('重新载入失败：读不到 notes.json')
    }
  }

  const importMd = async (file: File) => {
    const text = await file.text()
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n?/)
    const get = (k: string) => fmMatch?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim()
    let type: NoteType = 'other'
    let grade: Grade = ''
    let tags: string[] = []
    let content = text
    if (fmMatch) {
      content = text.slice(fmMatch[0].length)
      const t = get('type')
      if (t && t in NOTE_TYPE_META) type = t as NoteType
      const g = get('grade')
      if (g && g in GRADE_META) grade = g as Grade
      const tg = get('tags')
      if (tg) tags = tg.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
    }
    const title = get('title') ?? file.name.replace(/\.md$/i, '')
    const n = api.createNote({ title, type, grade, tags, content: content.trim() })
    setActiveId(n.id)
    toast.success(`已导入「${title}」`)
  }

  const chooseSyncFile = useCallback(async () => {
    const desk = window.knowledgeGraphDesktop
    if (!desk) {
      toast.info('请使用桌面版选择同步文件；浏览器版会下载 JSON 文件')
      return null
    }
    const selected = await desk.chooseSyncFile()
    if (!selected) return null
    localStorage.setItem(SYNC_PATH_KEY, selected)
    setSyncPath(selected)
    toast.success('已设置同步文件位置')
    return selected
  }, [])

  /** 把本地笔记写入同步文件，并把当前内容记为「已一致」基线 */
  const pushToFile = useCallback(
    async (silent = false) => {
      if (!syncPath) return false
      if (!window.knowledgeGraphDesktop) return false
      try {
        const json = serializeNotes(notesRef.current)
        await saveNotesToSyncFile(notesRef.current, syncPath)
        setBaseline(json)
        setLastSyncAt(Date.now())
        if (!silent) toast.success('已保存到同步文件')
        return true
      } catch {
        if (!silent) toast.error('同步文件保存失败，请检查路径')
        return false
      }
    },
    [syncPath, setBaseline],
  )

  /** 比较本地与同步文件：谁改了推谁；两边都改了就开冲突面板 */
  const checkSync = useCallback(async () => {
    if (!autoSync || !syncPath) return
    if (busyRef.current || conflictRef.current) return
    if (!window.knowledgeGraphDesktop?.readSyncFile) return
    busyRef.current = true
    try {
      const remoteText = await readSyncFileText(syncPath)
      if (remoteText === null) {
        // 文件还不存在：以本地为准创建
        await pushToFile(true)
        return
      }
      const remoteNotes = parseNotes(remoteText)
      if (!remoteNotes) return
      const remoteJson = serializeNotes(remoteNotes)
      const localJson = serializeNotes(notesRef.current)
      if (remoteJson === localJson) {
        if (baselineRef.current !== localJson) setBaseline(localJson)
        return
      }
      const remoteChanged = remoteJson !== baselineRef.current
      const localChanged = localJson !== baselineRef.current
      if (remoteChanged && !localChanged) {
        replaceAll(remoteNotes)
        setBaseline(remoteJson)
        toast.info(`已从同步文件载入 ${remoteNotes.length} 篇笔记`)
        return
      }
      if (!remoteChanged && localChanged) {
        await pushToFile(true)
        return
      }
      if (remoteJson === snoozeRef.current) return
      setConflict({ local: notesRef.current, remote: remoteNotes })
    } catch {
      /* 读取失败就跳过这一轮 */
    } finally {
      busyRef.current = false
      firstCheckDoneRef.current = true
    }
  }, [autoSync, syncPath, pushToFile, replaceAll, setBaseline])

  const checkRef = useRef(checkSync)
  useEffect(() => {
    checkRef.current = checkSync
  }, [checkSync])

  // 轮询同步文件
  useEffect(() => {
    if (!autoSync || !syncPath || !hydrated) return
    const tick = () => void checkRef.current()
    tick()
    const timer = window.setInterval(tick, 2500)
    return () => window.clearInterval(timer)
  }, [autoSync, syncPath, hydrated])

  // 本地改动 → 防抖写回文件
  useEffect(() => {
    if (!autoSync || !syncPath || !hydrated || conflict) return
    if (!firstCheckDoneRef.current) return
    const timer = window.setTimeout(() => void pushToFile(true), 900)
    return () => window.clearTimeout(timer)
  }, [autoSync, syncPath, hydrated, conflict, notes, pushToFile])

  const syncNow = useCallback(
    async (quiet = false) => {
      if (!syncPath) {
        if (!quiet) {
          if (isDesktop()) {
            await chooseSyncFile()
          } else {
            downloadNotes(notes, 'notes.json')
            toast.success('已下载 notes.json，可放入同步文件夹')
          }
        }
        return
      }
      setSyncing(true)
      try {
        await pushToFile(quiet)
      } finally {
        setSyncing(false)
      }
    },
    [syncPath, chooseSyncFile, notes, pushToFile],
  )

  const applyConflict = (merged: Note[]) => {
    replaceAll(merged)
    setConflict(null)
    snoozeRef.current = ''
    const json = serializeNotes(merged)
    setBaseline(json)
    toast.success(`已合并为 ${merged.length} 篇笔记`)
  }

  useEffect(() => {
    localStorage.setItem(AUTO_SYNC_KEY, autoSync ? '1' : '0')
  }, [autoSync])

  useEffect(() => {
    localStorage.setItem('note-graph-list-open', listOpen ? '1' : '0')
  }, [listOpen])

  // 手机：选中笔记后自动收起列表抽屉，让「列表 → 详情」这一步即完成导航
  // （桌面端列表是常驻侧栏，不收起）
  useEffect(() => {
    if (isMobile) setListOpen(false)
  }, [activeId, isMobile])

  const filterPanel = (
    <div className="shrink-0 space-y-4 overflow-y-auto rounded-lg border bg-card p-3 text-sm xl:w-52">
      <div>
        <div className="mb-1.5 font-medium">按类型</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(NOTE_TYPE_META).map(([k, v]) => (
            <Badge
              key={k}
              variant={filters.types.has(k) ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => toggle(filters.types, k, 'types')}
            >
              <span className="mr-1 h-2 w-2 rounded-full" style={{ background: v.color }} />
              {v.label}
            </Badge>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 font-medium">按年级/身份（人物）</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(GRADE_META).map(([k, v]) => (
            <Badge
              key={k}
              variant={filters.grades.has(k) ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => toggle(filters.grades, k, 'grades')}
            >
              {v}
            </Badge>
          ))}
        </div>
      </div>
      {tagGroups.length > 0 && (
        <div>
          <div className="mb-1.5 font-medium">按标签（同组内「或」、跨组「与」）</div>
          {tagGroups.map(([prefix, ts]) => (
            <div key={prefix || '其他'} className="mb-2">
              {prefix && <div className="mb-1 text-xs text-muted-foreground">{prefix}</div>}
              <div className="flex flex-wrap gap-1.5">
                {ts.map((t) => (
                  <Badge
                    key={t}
                    variant={filters.tags.has(t) ? 'default' : 'secondary'}
                    className="cursor-pointer"
                    onClick={() => toggle(filters.tags, t, 'tags')}
                  >
                    #{prefix ? t.slice(t.indexOf(':') + 1) : t}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {(filters.types.size > 0 || filters.grades.size > 0 || filters.tags.size > 0) && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setFilters({ types: new Set(), grades: new Set(), tags: new Set(), search: '' })}
        >
          清除全部筛选
        </Button>
      )}
    </div>
  )

  const editorFor = (n: Note, split: boolean) => (
    <NoteEditor
      key={n.id}
      note={n}
      allNotes={notes}
      splitView={split}
      onChange={(p) => api.updateNote(n.id, p)}
      onDelete={() => {
        api.deleteNote(n.id)
        setActiveId(null)
      }}
      onOpenNote={openNote}
      onCreateNote={(t) => createNote(t)}
    />
  )

  /* 手机上由「更多操作」菜单复用的动作，与桌面按钮调用同一批函数，功能不删减 */
  const onPickSyncFile = () => void chooseSyncFile()
  const onReloadFromJson = () => void reloadFromJson()
  const onImportBackup = () => fileRef.current?.click()
  const onImportMd = () => mdRef.current?.click()

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* 顶栏：手机上标题收起、按钮组换行并把次要操作收进菜单 */}
      <header className="flex h-auto min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 md:h-14 md:flex-nowrap md:px-4 md:py-0">
        <Network className="h-5 w-5 shrink-0 text-primary" />
        <h1 className="hidden shrink-0 text-base font-bold md:block">本地笔记图谱</h1>
        <span className="hidden shrink-0 text-xs text-muted-foreground md:block">{notes.length} 篇笔记</span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          <input ref={mdRef} type="file" accept=".md,.markdown" className="hidden" onChange={(e) => e.target.files?.[0] && importMd(e.target.files[0])} />

          {/* 桌面：保留原有的并排按钮 */}
          <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => void syncNow()}>
            <Save className="mr-1 h-3.5 w-3.5" /> 保存到同步文件
          </Button>
          <Button variant="outline" size="icon" className="hidden md:inline-flex" title="选择同步文件" aria-label="选择同步文件" onClick={onPickSyncFile}>
            <FolderSync className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="hidden md:inline-flex" title="用仓库里的 notes.json 覆盖本地笔记" onClick={onReloadFromJson}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> 重新载入
          </Button>
          <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={onImportBackup}>
            <Upload className="mr-1 h-3.5 w-3.5" /> 导入备份
          </Button>
          <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={onImportMd}>
            <FileUp className="mr-1 h-3.5 w-3.5" /> 导入 .md
          </Button>
          <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={exportJson}>导出备份</Button>

          {/* 手机：同步与导出/导入收进菜单，功能不减 */}
          <div className="flex items-center gap-2 md:hidden">
            <Button variant="outline" size="icon" className="h-11 w-11" title="选择同步文件" aria-label="选择同步文件" onClick={onPickSyncFile}>
              <FolderSync className="h-4 w-4" />
            </Button>
            <Button size="sm" className="h-11" onClick={() => void syncNow()}>
              <Save className="mr-1 h-4 w-4" /> 保存到同步文件
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-11 w-11" title="更多操作" aria-label="更多操作">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem className="min-h-11" onSelect={onReloadFromJson}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  重新载入 notes.json
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={onImportBackup}>
                  <Upload className="mr-2 h-4 w-4" />
                  导入 JSON 备份
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={onImportMd}>
                  <FileUp className="mr-2 h-4 w-4" />
                  导入 .md
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="min-h-11" onSelect={exportJson}>
                  <Save className="mr-2 h-4 w-4" />
                  导出备份
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* 同步状态栏 */}
      <div className="flex items-center gap-3 border-b bg-muted/20 px-4 py-1.5 text-xs text-muted-foreground">
        <Settings2 className="h-3.5 w-3.5" />
        <span className="truncate" title={syncPath || '尚未选择同步文件'}>
          {syncPath ? `同步文件：${syncPath}` : '尚未选择同步文件（点右边文件夹图标选一个）'}
        </span>
        {conflict && <span className="shrink-0 text-destructive">有冲突待处理</span>}
        <label
          className="ml-auto flex min-h-11 shrink-0 cursor-pointer items-center gap-2 py-1 md:min-h-0 md:py-0"
          title={
            !syncPath
              ? '请先点文件夹图标选择同步文件'
              : autoSync
                ? '开启中：本地改动会写回文件，文件被外部改动会拉进应用；关闭即切断同步'
                : '开启后双向同步（可随时关闭以切断）'
          }
        >
          <span>双向同步</span>
          <Switch checked={autoSync} onCheckedChange={setAutoSync} disabled={!syncPath} aria-label="双向同步" />
        </label>
        {syncing && <span>处理中…</span>}
        {!syncing && lastSyncAt && <span>已同步 {new Date(lastSyncAt).toLocaleTimeString()}</span>}
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* 笔记列表：桌面是常驻侧栏；手机改为覆盖在正文之上的抽屉，
            这样正文能拿到完整的手机宽度（256px 侧栏 + 360px 屏幕放不下） */}
        {listOpen && (
          <>
            {/* 手机抽屉遮罩：点一下关闭列表 */}
            <div
              className="absolute inset-0 z-10 bg-black/30 md:hidden"
              onClick={() => setListOpen(false)}
              aria-hidden="true"
            />
            <aside className="absolute inset-y-0 left-0 z-20 w-[78%] max-w-64 shrink-0 border-r bg-background shadow-xl md:static md:z-auto md:w-64 md:bg-muted/30 md:shadow-none">
              <NoteList notes={notes} activeId={active?.id ?? null} onSelect={openNote} onCreate={() => createNote()} />
            </aside>
          </>
        )}

        {/* 右侧主区 */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5 border-b px-2 py-2 md:gap-3 md:px-4">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 md:h-9 md:w-9"
              title={listOpen ? '收起笔记列表' : '展开笔记列表'}
              aria-label={listOpen ? '收起笔记列表' : '展开笔记列表'}
              onClick={() => setListOpen((v) => !v)}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <Tabs value={effectiveView} onValueChange={(v) => setView(v as View)} className="min-w-0">
              <TabsList>
                {/* 手机：标签只留图标，避免三个文字标签把主区最小宽度撑到约 228px */}
                <TabsTrigger value="notes" className="px-1.5 md:px-2">
                  <NotebookText className="h-4 w-4 md:mr-1.5" />
                  <span className="hidden md:inline">笔记</span>
                </TabsTrigger>
                <TabsTrigger value="graph" className="px-1.5 md:px-2">
                  <Network className="h-4 w-4 md:mr-1.5" />
                  <span className="hidden md:inline">图谱</span>
                </TabsTrigger>
                {/* 「并列」是图谱+编辑器的左右并排，手机上两栏都不可用，故只在平板及以上出现 */}
                <TabsTrigger value="both" className="hidden px-1.5 md:inline-flex md:px-2">
                  <Columns2 className="h-4 w-4 md:mr-1.5" />
                  <span className="hidden md:inline">并列</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {effectiveView !== 'notes' && (
              <span className="hidden text-xs text-muted-foreground md:inline">
                单击节点选中，再次单击打开笔记 · 右键聚焦/取消聚焦 · 拖动可移动节点
              </span>
            )}
          </div>

          {effectiveView === 'notes' ? (
            active ? (
              <div className="min-h-0 flex-1">{editorFor(active, true)}</div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-muted-foreground">
                <Button onClick={() => createNote()}>新建第一篇笔记</Button>
              </div>
            )
          ) : effectiveView === 'graph' ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 xl:flex-row">
              {filterPanel}
              <div className="min-w-0 flex-1">
                <GraphView notes={notes} onOpenNote={openNote} filters={filters} focusId={focusId} onFocusChange={setFocusId} />
              </div>
            </div>
          ) : (
            /* 并列：手机上改为上下堆叠，「并列」标签本身也在手机端隐藏（见上） */
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:flex-row">
              <div className="min-h-0 min-w-0 flex-1 md:h-auto">
                <GraphView notes={notes} onOpenNote={openNote} filters={filters} focusId={focusId} onFocusChange={setFocusId} />
              </div>
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border bg-card">
                {active ? (
                  editorFor(active, false)
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    从左侧列表选一篇笔记
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {conflict && (
        <ConflictDialog
          local={conflict.local}
          remote={conflict.remote}
          onCancel={() => {
            snoozeRef.current = serializeNotes(conflict.remote)
            setConflict(null)
          }}
          onApply={applyConflict}
        />
      )}

      <Toaster position="bottom-right" richColors />
    </div>
  )
}
