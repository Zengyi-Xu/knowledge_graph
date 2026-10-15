import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNotes } from '@/hooks/useNotes'
import { NoteList } from '@/components/NoteList'
import { NoteEditor } from '@/components/NoteEditor'
import type { Filters } from '@/components/GraphView'
import { makeCitekey } from '@/lib/citekey'
import { toLiteratureMeta } from '@/lib/literatureMeta'
import type { ImportedLit } from '@/lib/literature'
import type { ZoteroSyncUpdate } from '@/lib/zoteroSync'
import { ConflictDialog } from '@/components/ConflictDialog'
import { FolderMoveDialog } from '@/components/FolderMoveDialog'
import { NOTE_TYPE_META, GRADE_META } from '@/types/note'
import type { NoteType, Grade, Note } from '@/types/note'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  Network,
  NotebookText,
  Upload,
  FileUp,
  FolderSync,
  FolderOpen,
  HardDrive,
  Settings2,
  Save,
  PanelLeft,
  RefreshCw,
  Columns2,
  BookOpen,
  Sparkles,
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
import { chooseVaultDir, listVault, openVaultDir, vaultSupported } from '@/lib/vaultFs'
import { Switch } from '@/components/ui/switch'
import { APP_NAME, ENV_LABEL, isDevApp, readSetting, storageKey, writeSetting } from '@/lib/env'
import { loadPhysics, savePhysics, type GraphPhysics } from '@/lib/graphPhysics'

const GraphView = lazy(() => import('@/components/GraphView').then((m) => ({ default: m.GraphView })))
const LiteratureView = lazy(() => import('@/components/LiteratureView').then((m) => ({ default: m.LiteratureView })))
const PdfReadingWorkspace = lazy(() => import('@/components/PdfReadingWorkspace').then((m) => ({ default: m.PdfReadingWorkspace })))
const AiPanel = lazy(() => import('@/components/AiPanel').then((m) => ({ default: m.AiPanel })))

type View = 'notes' | 'graph' | 'both' | 'literature'

const AI_LOG_KEY = 'ai-log-v1'
interface AiLogEntry {
  at: number
  applied: number
  created: number
  updated: number
}

/** AI 运行日志（脱敏：时间/条数，不含内容不含 key），失败不阻塞 */
function appendAiLog(entry: AiLogEntry) {
  try {
    const list = JSON.parse(readSetting(AI_LOG_KEY) ?? '[]') as AiLogEntry[]
    list.unshift(entry)
    writeSetting(AI_LOG_KEY, JSON.stringify(list.slice(0, 50)))
  } catch {
    /* 日志失败静默 */
  }
}

export default function App() {
  const api = useNotes()
  const { notes, hydrated, replaceAll, vault } = api
  const loadingRef = useRef(true)
  loadingRef.current = !hydrated || Boolean(vault.loading) || vault.conflicts > 0
  const requireFullLibrary = () => {
    if (!loadingRef.current) return true
    toast.info('请等待笔记库加载完成，并处理文件冲突后再导入、导出或同步全库')
    return false
  }
  // 启动默认进「并列」视图（图谱 + 笔记同屏），不再默认单栏「笔记」
  const [view, setView] = useState<View>('both')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [readingNoteId, setReadingNoteId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(() => readSetting('list-open-v1') !== '0')
  const [filters, setFilters] = useState<Filters>({ types: new Set(), grades: new Set(), tags: new Set(), search: '' })
  const fileRef = useRef<HTMLInputElement>(null)
  const mdRef = useRef<HTMLInputElement>(null)
  const [syncPath, setSyncPath] = useState(() => readSetting(SYNC_PATH_KEY) ?? '')
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTask, setAiTask] = useState<import('@/lib/aiPrompts').AiTask | null>(null)
  const [autoSync, setAutoSync] = useState(() => readSetting(AUTO_SYNC_KEY) === '1')
  const [physics, setPhysics] = useState<GraphPhysics>(() => loadPhysics())
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [conflict, setConflict] = useState<{ local: Note[]; remote: Note[] } | null>(null)
  /** 改类型（= 换文件夹）时的待确认迁移 */
  const [typeMove, setTypeMove] = useState<{ note: Note; to: NoteType; patch: Partial<Note> } | null>(null)

  const active = notes.find((n) => n.id === activeId) ?? notes[0] ?? null
  const readingNote = notes.find((n) => n.id === readingNoteId) ?? null

  // ---- 双向同步：基线 + 引用 ----
  const notesRef = useRef(notes)
  useEffect(() => {
    notesRef.current = notes
  }, [notes])
  const baselineRef = useRef<string>('')
  const setBaseline = useCallback((v: string) => {
    baselineRef.current = v
    writeSetting(SYNC_BASELINE_KEY, v)
  }, [])
  useEffect(() => {
    baselineRef.current = readSetting(SYNC_BASELINE_KEY) ?? ''
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
    if (!hydrated) {
      toast.info('正在读取笔记目录，请等待普通笔记出现后再新建')
      return null
    }
    const n = api.createNote(title ? { title, content: '' } : {})
    setActiveId(n.id)
    setView((v) => (v === 'both' ? 'both' : 'notes'))
    return n
  }

  /** 文献导入：逐条创建 literature 笔记，citekey 撞名自动追加后缀 */
  const importLiterature = (items: ImportedLit[]) => {
    if (!requireFullLibrary()) return
    const existing = new Set(
      notes.filter((n) => n.literature?.citekey).map((n) => n.literature!.citekey),
    )
    const incoming = items.map((item) => {
      const citekey = makeCitekey({ authors: item.authors, year: item.year }, item.title, existing)
      existing.add(citekey)
      return {
        title: item.title || '未命名文献',
        type: 'literature' as const,
        grade: '' as const,
        tags: [],
        content: '',
        literature: toLiteratureMeta(item, citekey),
      }
    })
    const added = api.createNotes(incoming)
    const lastId = added.at(-1)?.id
    if (lastId) setActiveId(lastId)
    toast.success(`已导入 ${items.length} 篇文献`)
  }

  /** 应用 Zotero 同步计划：合并 collections、追加新标签、刷新 Zotero key 与 PDF 状态 */
  const applyZoteroSync = (updates: ZoteroSyncUpdate[]) => {
    if (!requireFullLibrary()) return
    const byId = new Map(notes.map((n) => [n.id, n]))
    const patches: { id: string; patch: Partial<Note> }[] = []
    for (const u of updates) {
      const note = byId.get(u.noteId)
      if (!note || !note.literature) continue
      patches.push({ id: u.noteId, patch: {
        tags: [...new Set([...note.tags.filter((tag) => !u.tagsToRemove.includes(tag)), ...u.tagsToAdd])],
        literature: {
          ...note.literature,
          collections: u.collections,
          zoteroKey: u.zoteroKey,
          zoteroKeys: u.zoteroKeys,
          zoteroPdfCount: u.zoteroPdfCount,
          zoteroAvailablePdfCount: u.zoteroAvailablePdfCount,
        },
      } })
    }
    api.updateNotes(patches)
    toast.success(`已同步 ${patches.length} 篇文献的分类与标签`)
  }

  /**
   * AI 统筹：应用确认后的 operations。
   * create 走 createNote；update/retag 按 id 或标题定位后 updateNote。
   * 运行日志写 localStorage（脱敏：只记任务、模型、条数）。
   */
  const applyAiOps = (ops: import('@/lib/aiOps').AiOperation[]) => {
    if (!requireFullLibrary()) return
    const byId = new Map(notes.map((n) => [n.id, n]))
    const byTitle = new Map(notes.map((n) => [n.title.trim(), n]))
    let created = 0
    let updated = 0
    for (const op of ops) {
      if (op.type === 'create') {
        api.createNote({ title: op.title, type: op.noteType, grade: '', tags: op.tags, content: op.content })
        created++
        continue
      }
      const target = (op.id && byId.get(op.id)) || (op.title && byTitle.get(op.title.trim()))
      if (!target) continue
      if (op.type === 'retag') {
        const next = new Set(target.tags)
        for (const t of op.addTags) next.add(t)
        for (const t of op.removeTags) next.delete(t)
        api.updateNote(target.id, { tags: [...next] })
      } else {
        api.updateNote(target.id, {
          ...(op.content !== undefined ? { content: op.content } : {}),
          ...(op.tags ? { tags: op.tags } : {}),
        })
      }
      updated++
    }
    appendAiLog({ at: Date.now(), applied: ops.length, created, updated })
  }

  const exportJson = () => {
    if (!requireFullLibrary()) return
    downloadNotes(notes, `knowledge-graph-notes-${new Date().toISOString().slice(0, 10)}.json`)
    toast.success('已导出全部笔记为 JSON 备份')
  }

  const importJson = async (file: File) => {
    if (!requireFullLibrary()) return
    try {
      const arr = JSON.parse(await file.text()) as Note[]
      if (!Array.isArray(arr)) throw new Error('bad format')
      const { added, updated } = api.mergeByTitle(arr)
      toast.success(`已导入：新增 ${added} 篇，按标题更新 ${updated} 篇`)
    } catch {
      toast.error('导入失败：不是有效的 JSON 备份文件')
    }
  }

  /** 用同步文件（notes.json）覆盖当前本地笔记；仓库不再内置 notes.json */
  const reloadFromJson = async () => {
    if (!requireFullLibrary()) return
    if (!isDesktop()) {
      toast.info('浏览器版没有本地文件读取权限，请用「导入备份」选择 JSON 文件')
      return
    }
    let path = syncPath
    if (!path) {
      const chosen = await chooseSyncFile()
      if (!chosen) return
      path = chosen
    }
    if (!window.confirm(`将用同步文件覆盖当前本地笔记：\n${path}\n\n本地尚未同步的改动会丢失。继续？`)) return
    try {
      const text = await readSyncFileText(path)
      if (text === null) throw new Error('not found')
      const arr = parseNotes(text)
      if (!arr) throw new Error('bad format')
      const count = replaceAll(arr)
      // 覆盖后本地与同步文件一致，刷新基线，避免下一轮轮询误判「两边都改了」
      setBaseline(serializeNotes(arr))
      setActiveId(null)
      setFocusId(null)
      toast.success(`已从同步文件重新载入 ${count} 篇笔记`)
    } catch {
      toast.error('重新载入失败：读不到有效的同步文件')
    }
  }

  const importMd = async (file: File) => {
    if (!hydrated) { toast.info('正在读取笔记目录，请稍后再导入'); return }
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

  /** 选择/切换本地笔记目录（vault：每篇一个 .md + 一个 meta.json 索引） */
  const pickVault = async () => {
    if (!requireFullLibrary()) return
    if (!vaultSupported()) {
      toast.info('浏览器版没有目录写入权限：请用桌面版，或继续使用浏览器本地存储')
      return
    }
    const dir = await chooseVaultDir()
    if (!dir) return
    if (dir === vault.dir) {
      toast.info('这已经是当前的笔记目录')
      return
    }
    const listing = await listVault(dir)
    if (!listing?.exists) {
      toast.error('读不到该目录，请换一个位置')
      return
    }
    if (listing.meta) {
      if (
        !window.confirm(
          `该目录已是一个笔记目录（${listing.md.length} 个 md 文件）。\n将用目录里的内容替换当前显示的 ${notes.length} 篇笔记，尚未落盘的改动会丢失。继续？`,
        )
      )
        return
    } else if (listing.md.length > 0) {
      if (
        !window.confirm(
          `该目录里有 ${listing.md.length} 个 md 文件，但没有 meta.json。\n当前 ${notes.length} 篇笔记会写入该目录（重名会加 -2 后缀），已有文件不会被读取或改动。继续？`,
        )
      )
        return
    } else if (notes.length > 0) {
      if (!window.confirm(`将把当前 ${notes.length} 篇笔记写入该目录：每篇一个 .md，并生成 meta.json。继续？`)) return
    }
    api.setVaultDir(dir)
    toast.success('已切换笔记目录，正在读取…')
  }

  const chooseSyncFile = useCallback(async () => {
    const desk = window.knowledgeGraphDesktop
    if (!desk) {
      toast.info('请使用桌面版选择同步文件；浏览器版会下载 JSON 文件')
      return null
    }
    const selected = await desk.chooseSyncFile()
    if (!selected) return null
    writeSetting(SYNC_PATH_KEY, selected)
    setSyncPath(selected)
    toast.success('已设置同步文件位置')
    return selected
  }, [])

  /** 把本地笔记写入同步文件，并把当前内容记为「已一致」基线 */
  const pushToFile = useCallback(
    async (silent = false) => {
      if (loadingRef.current) return false
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

  /** AI 运行前的硬门槛：先快照到同步文件，失败拒绝运行 */
  const ensureAiSnapshot = useCallback(async () => {
    if (!syncPath) {
      toast.error('AI 运行前需要快照：请先用顶栏「选择同步文件」按钮设置同步文件位置')
      return false
    }
    const ok = await pushToFile(true)
    if (!ok) toast.error('快照保存失败，已拒绝 AI 运行')
    return ok
  }, [syncPath, pushToFile])

  /** 比较本地与同步文件：谁改了推谁；两边都改了就开冲突面板 */
  const checkSync = useCallback(async () => {
    if (loadingRef.current) return
    if (!autoSync || !syncPath) return
    if (busyRef.current || conflictRef.current) return
    if (!window.knowledgeGraphDesktop?.readSyncFile) return
    busyRef.current = true
    try {
      const remoteText = await readSyncFileText(syncPath)
      if (loadingRef.current) return
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

  // vault 模式：同步文件默认放在 <vault>\sync\notes.json（只用于同步/备份）
  useEffect(() => {
    if (!api.vault.active || !api.vault.dir || syncPath) return
    const dir = api.vault.dir
    const sep = dir.includes('\\') ? '\\' : '/'
    const def = `${dir}${dir.endsWith(sep) ? '' : sep}sync${sep}notes.json`
    writeSetting(SYNC_PATH_KEY, def)
    setSyncPath(def)
  }, [api.vault.active, api.vault.dir, syncPath])

  // 轮询同步文件
  useEffect(() => {
    if (!autoSync || !syncPath || !hydrated || vault.loading || vault.conflicts > 0) return
    const tick = () => void checkRef.current()
    tick()
    const timer = window.setInterval(tick, 2500)
    return () => window.clearInterval(timer)
  }, [autoSync, syncPath, hydrated, vault.loading, vault.conflicts])

  // 本地改动 → 防抖写回文件
  useEffect(() => {
    if (!autoSync || !syncPath || !hydrated || vault.loading || vault.conflicts > 0 || conflict) return
    if (!firstCheckDoneRef.current) return
    const timer = window.setTimeout(() => void pushToFile(true), 900)
    return () => window.clearTimeout(timer)
  }, [autoSync, syncPath, hydrated, vault.loading, vault.conflicts, conflict, notes, pushToFile])

  const syncNow = useCallback(
    async (quiet = false) => {
      if (loadingRef.current) {
        if (!quiet) toast.info('笔记库仍在加载，完整加载后才能同步')
        return
      }
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
    if (!requireFullLibrary()) return
    replaceAll(merged)
    setConflict(null)
    snoozeRef.current = ''
    const json = serializeNotes(merged)
    setBaseline(json)
    toast.success(`已合并为 ${merged.length} 篇笔记`)
  }

  useEffect(() => {
    writeSetting(AUTO_SYNC_KEY, autoSync ? '1' : '0')
  }, [autoSync])

  useEffect(() => {
    writeSetting('list-open-v1', listOpen ? '1' : '0')
  }, [listOpen])

  // 图谱物理参数：改动即生效，并写入 localStorage（开发版/正式版各自独立）
  useEffect(() => {
    savePhysics(physics)
  }, [physics])

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
      onChange={(p) => {
        if (!hydrated) return
        // 改类型 = 换文件夹：先弹窗确认，确认后再连同文件一起迁移
        if (p.type && p.type !== n.type && api.vault.active) {
          setTypeMove({ note: n, to: p.type, patch: p })
          return
        }
        api.updateNote(n.id, p)
      }}
      onDelete={() => {
        if (!hydrated) return
        api.deleteNote(n.id)
        setActiveId(null)
      }}
      onOpenNote={openNote}
      onCreateNote={(t) => createNote(t)}
      onAiUpdate={
        n.type === 'summary'
          ? () => {
              setAiTask({ kind: 'update-summary', noteId: n.id })
              setAiOpen(true)
            }
          : undefined
      }
    />
  )

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* 顶栏 */}
      <header className="flex h-14 items-center gap-3 border-b px-4">
        <Network className="h-5 w-5 text-primary" />
        <h1 className="text-base font-bold">{APP_NAME}</h1>
        <span className="text-xs text-muted-foreground">本地条目 · {notes.length} 个条目</span>
        <span
          className={
            isDevApp()
              ? 'rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700'
              : 'rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'
          }
          title={
            isDevApp()
              ? `开发版：数据与正式版隔离（独立存储与用户目录）。${storageKey('notes-v1')}`
              : `正式版 v${ENV_LABEL}`
          }
        >
          {ENV_LABEL}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          <input ref={mdRef} type="file" accept=".md,.markdown" className="hidden" onChange={(e) => e.target.files?.[0] && importMd(e.target.files[0])} />
          <Button variant="outline" size="sm" onClick={() => void syncNow()}>
            <Save className="mr-1 h-3.5 w-3.5" /> 保存到同步文件
          </Button>
          <Button variant="outline" size="icon" title="选择同步文件" onClick={() => void chooseSyncFile()}>
            <FolderSync className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" title="用同步文件（notes.json）覆盖本地笔记" onClick={() => void reloadFromJson()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> 重新载入
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-1 h-3.5 w-3.5" /> 导入备份
          </Button>
          <Button variant="outline" size="sm" onClick={() => mdRef.current?.click()}>
            <FileUp className="mr-1 h-3.5 w-3.5" /> 导入 .md
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setAiTask(null); setAiOpen(true) }} title="调用本机 Kimi 模型网关，统筹整理笔记（改动需确认后落盘）">
            <Sparkles className="mr-1 h-3.5 w-3.5 text-amber-500" /> AI 统筹
          </Button>
          <Button variant="outline" size="sm" onClick={exportJson}>导出备份</Button>
        </div>
      </header>

      {/* 本地存储状态栏：vault（md + meta.json） */}
      <div className="flex items-center gap-3 border-b bg-muted/20 px-4 py-1.5 text-xs text-muted-foreground">
        <HardDrive className="h-3.5 w-3.5" />
        <span className="truncate" title={vault.dir || '尚未选择笔记目录'}>
          {vault.active
            ? `笔记目录：${vault.dir}（每篇一个 .md + meta.json 索引）`
            : vault.dir
              ? !hydrated ? `正在读取笔记目录：${vault.dir}` : `笔记目录不可用：${vault.dir} · 暂时用浏览器本地存储`
              : vaultSupported()
                ? isDevApp()
                  ? '开发版：尚未选择笔记目录（与正式版隔离）· 当前用浏览器本地存储（localStorage）'
                  : '尚未选择笔记目录 · 当前用浏览器本地存储（localStorage）'
                : '浏览器版 · 笔记存在浏览器本地存储（localStorage）'}
        </span>
        {vault.loading && <span className="shrink-0" role="status">
          {vault.loading.total ? `文献加载中 ${vault.loading.loaded}/${vault.loading.total}` : '检查笔记目录中…'}
        </span>}
        {vault.conflicts > 0 && <div className="flex shrink-0 items-center gap-2" role="alert">
          <span>{vault.conflicts} 篇笔记存在文件冲突，写盘已暂停</span>
          <Button size="sm" variant="outline" onClick={() => {
            if (window.confirm('采用磁盘中的版本会替换这些笔记尚未保存的本地编辑。继续？')) api.resolveVaultConflicts('disk')
          }}>采用磁盘版本</Button>
          <Button size="sm" variant="outline" onClick={() => {
            if (window.confirm('保留本地编辑会覆盖这些笔记在磁盘上的外部修改。继续？')) api.resolveVaultConflicts('local')
          }}>保留本地编辑</Button>
        </div>}
        {vault.active && vault.saving && <span className="shrink-0">写入中…</span>}
        {vault.active && !vault.saving && vault.savedAt && (
          <span className="shrink-0">已写入 {new Date(vault.savedAt).toLocaleTimeString()}</span>
        )}
        {vault.externalAt && <span className="shrink-0">已跟随目录改动 {new Date(vault.externalAt).toLocaleTimeString()}</span>}
        {vault.unmanaged > 0 && (
          <span className="shrink-0" title="这些 md 不在 meta.json 索引里，本应用不会读取、修改或删除它们">
            目录中另有 {vault.unmanaged} 个未纳管 md
          </span>
        )}
        {vault.error && <span className="shrink-0 text-destructive">{vault.error}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <label
            className="flex items-center gap-2"
            title="开启后每 3 秒检查一次目录：在 Obsidian/编辑器里的改动会自动进到应用"
          >
            <span>跟随目录改动</span>
            <Switch
              checked={api.watchVault}
              onCheckedChange={api.setWatchVault}
              disabled={!vault.active}
              aria-label="跟随目录改动"
            />
          </label>
          <Button variant="outline" size="sm" disabled={!vault.active} onClick={() => void api.flushVault()}>
            写入目录
          </Button>
          <Button variant="outline" size="sm" onClick={() => void pickVault()}>
            选择目录
          </Button>
          <Button
            variant="outline"
            size="icon"
            title="在文件管理器里打开笔记目录"
            disabled={!vault.active}
            onClick={() => void openVaultDir(vault.dir).then((err) => err && toast.error(err))}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 同步状态栏 */}
      <div className="flex items-center gap-3 border-b bg-muted/20 px-4 py-1.5 text-xs text-muted-foreground">
        <Settings2 className="h-3.5 w-3.5" />
        <span className="truncate" title={syncPath || '尚未选择同步文件'}>
          {syncPath ? `同步文件：${syncPath}` : '尚未选择同步文件（点右边文件夹图标选一个）'}
        </span>
        {conflict && <span className="shrink-0 text-destructive">有冲突待处理</span>}
        <label
          className="ml-auto flex shrink-0 items-center gap-2"
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

      <div className="flex min-h-0 flex-1">
        {/* 左侧：笔记列表（可整栏折叠） */}
        {listOpen && (
          <aside className="w-64 shrink-0 border-r bg-muted/30">
            <NoteList notes={notes} activeId={active?.id ?? null} onSelect={openNote} onCreate={() => createNote()} />
          </aside>
        )}

        {/* 右侧主区 */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b px-4 py-2">
            <Button
              variant="ghost"
              size="icon"
              title={listOpen ? '收起笔记列表' : '展开笔记列表'}
              onClick={() => setListOpen((v) => !v)}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList>
                <TabsTrigger value="notes">
                  <NotebookText className="mr-1.5 h-4 w-4" /> 笔记
                </TabsTrigger>
                <TabsTrigger value="graph">
                  <Network className="mr-1.5 h-4 w-4" /> 图谱
                </TabsTrigger>
                <TabsTrigger value="both">
                  <Columns2 className="mr-1.5 h-4 w-4" /> 并列
                </TabsTrigger>
                <TabsTrigger value="literature">
                  <BookOpen className="mr-1.5 h-4 w-4" /> 文献
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {view !== 'notes' && (
              <span className="text-xs text-muted-foreground">
                单击节点选中，再次单击打开笔记 · 右键聚焦/取消聚焦 · 拖动可移动节点
              </span>
            )}
          </div>

          <Suspense fallback={<div className="p-4 text-sm text-muted-foreground" role="status">正在打开视图…</div>}>
          {view === 'notes' ? (
            active && hydrated ? (
              <div className="min-h-0 flex-1">{editorFor(active, true)}</div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-muted-foreground">
                <Button disabled={!hydrated} onClick={() => createNote()}>{hydrated ? '新建第一篇笔记' : '正在读取笔记目录…'}</Button>
              </div>
            )
          ) : view === 'literature' ? (
            <LiteratureView notes={notes} onOpenNote={openNote} onReadPdf={setReadingNoteId} onImport={importLiterature} onApplySync={applyZoteroSync} />
          ) : view === 'graph' ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 xl:flex-row">
              {filterPanel}
              <div className="min-w-0 flex-1">
                <GraphView
                  notes={notes}
                  onOpenNote={openNote}
                  filters={filters}
                  focusId={focusId}
                  onFocusChange={setFocusId}
                  physics={physics}
                  onPhysicsChange={setPhysics}
                />
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 gap-3 p-3">
              <div className="min-w-0 flex-1">
                <GraphView
                  notes={notes}
                  onOpenNote={openNote}
                  filters={filters}
                  focusId={focusId}
                  onFocusChange={setFocusId}
                  physics={physics}
                  onPhysicsChange={setPhysics}
                />
              </div>
              <div className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-card">
                {active && hydrated ? (
                  editorFor(active, false)
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    从左侧列表选一篇笔记
                  </div>
                )}
              </div>
            </div>
          )}
          </Suspense>
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

      {typeMove && (
        <FolderMoveDialog
          note={typeMove.note}
          to={typeMove.to}
          onCancel={() => setTypeMove(null)}
          onConfirm={() => {
            api.updateNote(typeMove.note.id, typeMove.patch)
            toast.success(`已迁移到「${NOTE_TYPE_META[typeMove.to].label}」文件夹`)
            setTypeMove(null)
          }}
        />
      )}

      {aiOpen && <Suspense fallback={null}><AiPanel
        open={aiOpen}
        onClose={() => {
          setAiOpen(false)
          setAiTask(null)
        }}
        notes={notes}
        ensureSnapshot={ensureAiSnapshot}
        onApply={applyAiOps}
        onGoLiterature={() => setView('literature')}
        initialTask={aiTask}
      /></Suspense>}

      {readingNote && (
        <Suspense fallback={<div className="fixed inset-0 z-[80] flex items-center justify-center bg-background text-sm text-muted-foreground">正在打开 PDF 阅读工作台…</div>}>
          <PdfReadingWorkspace
            note={readingNote}
            notes={notes}
            onChange={(patch) => api.updateNote(readingNote.id, patch)}
            onClose={() => setReadingNoteId(null)}
            onOpenNote={openNote}
            onCreateNote={(title) => { createNote(title) }}
          />
        </Suspense>
      )}

      <Toaster position="bottom-right" richColors />
    </div>
  )
}
