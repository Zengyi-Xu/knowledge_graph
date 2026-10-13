import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { uid, extractLinks } from '@/types/note'
import type { Note } from '@/types/note'
import {
  baseNameOf,
  parseMeta,
  parseNoteMarkdown,
  planVaultWrite,
  relPathFor,
  toMarkdown,
  type VaultIndexEntry,
  type WrittenNote,
} from '@/lib/vaultFormat'
import {
  VAULT_DIR_KEY,
  VAULT_WATCH_KEY,
  isDesktop,
  listVault,
  readVaultTexts,
  writeVaultPlan,
} from '@/lib/vaultFs'
import { APP_NAME, readSetting, removeSetting, writeSetting } from '@/lib/env'
import { LITERATURE_BATCH_SIZE, readVaultBatch, splitVaultEntries, VaultLoadGate } from '@/lib/vaultLoad'

const STORAGE_KEY = 'notes-v1'
/** 用户主动清空所有笔记时置位，避免下次启动又被种子/同步数据"复活" */
const EMPTY_FLAG = 'empty-v1'

/** 本地改动 → 写 md 的防抖时间 */
const WRITE_DEBOUNCE = 500
/** 轮询 vault 目录、感知外部（Obsidian/编辑器）改动的间隔 */
const POLL_INTERVAL = 3000

function isExplicitlyEmpty(): boolean {
  try {
    return readSetting(EMPTY_FLAG) === '1'
  } catch {
    return false
  }
}

function seedNotes(): Note[] {
  const now = Date.now()
  return [
    {
      id: uid(),
      title: '使用指南',
      type: 'other',
      grade: '',
      tags: ['指南'],
      content: `欢迎使用${APP_NAME}！

## 这个工具是做什么的

把一个团队/课题组里的信息整理成互相跳转的笔记：谁完成了什么工作、你可以向谁寻求哪方面的帮助。

## 七种笔记类型

- **人物** — 记录某位同事：研究方向、技能、性格、可以帮你什么（存到 人物 文件夹）
- **项目** — 课题组的项目、paper、实验任务（存到 项目 文件夹）
- **技能** — 具体技术点（如某个软件、实验方法）（存到 技能 文件夹）
- **学习** — 你想学的东西、想问的问题（存到 学习 文件夹）
- **文献** — 论文条目：作者、期刊、DOI、PDF 附件、引用复制（存到 文献 文件夹）
- **汇总** — 主题/周期性的综述，通常由 AI 统筹生成（存到 汇总 文件夹）
- **其他** — 任何不方便归类的内容（存到 Inbox 文件夹）

**类型决定文件夹**：勾选哪一类，这篇笔记就落到对应的子文件夹；改类型时会弹窗确认，然后连同文件一起迁移过去。

## 如何建立联系

在笔记正文中用双方括号引用其他笔记，例如：[[示例人物 张三]]。
被引用的笔记会在图谱视图中与当前笔记连线。

## 标签与年级

- 用 #标签 的形式给笔记打标签，如 #机器学习 #电镜
- 人物笔记可以设置「年级/身份」（教授/博后/博士/硕士…），图谱可按此筛选

## 图谱视图

切换到「图谱」页面后，可以：

1. 按**类型**筛选（只看人物、只看任务…）
2. 按**年级**筛选（只看博士生…）
3. 按**标签**筛选
4. 点击节点进入**焦点模式**，只显示与该节点直接相连的笔记，简化复杂图谱
5. 拖动节点调整布局

桌面版的笔记保存在你选择的 vault 目录里：每篇一个 .md 文件（带 frontmatter），按类型放进对应的子文件夹；
vault 根目录另有一个 meta.json 索引。可以用 Obsidian 直接打开这个目录；本应用不会改动目录里不属于它的 md 文件。`,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      title: '示例人物 张三',
      type: 'person',
      grade: 'phd',
      tags: ['示例', '机器学习'],
      content: `这是一篇**示例人物**笔记，了解用法后可以删除。

## 基本信息

- 年级：博士生（三年级）
- 方向：#机器学习 在材料筛选中的应用

## 他完成过的工作

- 参与了 [[示例项目 某材料数据库]] 的搭建
- 熟悉 Python 和 [[技能示例 PyTorch]]

## 可以寻求的帮助

- 问代码问题很耐心，可以约每周讨论
- 借得到某仪器的预约权限

关联：[[使用指南]]`,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      title: '示例项目 某材料数据库',
      type: 'task',
      grade: '',
      tags: ['示例', '数据库'],
      content: `示例项目笔记。

## 简介

课题组维护的某材料性质数据库。

## 相关成员

- [[示例人物 张三]] 负责数据清洗
- 需要 [[技能示例 PyTorch]] 做模型训练`,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      title: '技能示例 PyTorch',
      type: 'skill',
      grade: '',
      tags: ['示例', '编程'],
      content: `示例技能笔记。

深度学习框架。[[示例人物 张三]] 用它搭过 GNN 模型。

可以在 #学习 笔记里记录你想学的 PyTorch 知识点。`,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

function load(): Note[] {
  try {
    const raw = readSetting(STORAGE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as Note[]
    }
    // 本地无数据：返回空，由同步/种子逻辑决定初始内容
    return []
  } catch {
    /* ignore */
  }
  return []
}

export interface VaultStatus {
  dir: string
  /** 当前是否真的以 vault 目录作为存储（桌面版 + 目录可读） */
  active: boolean
  saving: boolean
  savedAt: number | null
  /** 最近一次外部改动被采纳的时间 */
  externalAt: number | null
  /** 目录里不属于本应用的 md 数量（本应用不会读写它们） */
  unmanaged: number
  error: string | null
  /** 文献正文分批载入期间可操作普通笔记，写盘/全库同步等待加载完成。 */
  loading: { loaded: number; total: number } | null
  conflicts: number
}

export function useNotes() {
  // vault 已配置时不先反序列化一份可能含数千文献的旧 localStorage 缓存。
  const [notes, setNotes] = useState<Note[]>(() => isDesktop() && (readSetting(VAULT_DIR_KEY) || window.knowledgeGraphDesktop?.defaultVaultDir) ? [] : load())
  const [hydrated, setHydrated] = useState(false)

  const [vaultDir, setVaultDirState] = useState<string>(() => {
    try {
      return readSetting(VAULT_DIR_KEY) || window.knowledgeGraphDesktop?.defaultVaultDir || ''
    } catch {
      return ''
    }
  })
  const [vaultActive, setVaultActive] = useState(false)
  const [loadRevision, setLoadRevision] = useState(0)
  const [vaultSaving, setVaultSaving] = useState(false)
  const [vaultSavedAt, setVaultSavedAt] = useState<number | null>(null)
  const [vaultExternalAt, setVaultExternalAt] = useState<number | null>(null)
  const [vaultUnmanaged, setVaultUnmanaged] = useState(0)
  const [vaultError, setVaultError] = useState<string | null>(null)
  const [vaultLoading, setVaultLoading] = useState<VaultStatus['loading']>(null)
  const [vaultConflicts, setVaultConflicts] = useState(0)
  const [watchVault, setWatchVault] = useState<boolean>(() => {
    try {
      return readSetting(VAULT_WATCH_KEY) !== '0'
    } catch {
      return true
    }
  })

  // ---- vault 账本：内存状态与磁盘的对应关系 ----
  const notesRef = useRef(notes)
  const indexRef = useRef<VaultIndexEntry[] | null>(null)
  const writtenRef = useRef<Map<string, WrittenNote>>(new Map())
  const metaRef = useRef('')
  const filesRef = useRef<Map<string, { mtimeMs: number; size: number }>>(new Map())
  const dirRef = useRef(vaultDir)
  const activeRef = useRef(false)
  const busyRef = useRef(false)
  const pendingRef = useRef(false)
  const loadGateRef = useRef(new VaultLoadGate())
  const loadEpochRef = useRef(0)
  const readyGateRef = useRef<VaultLoadGate | null>(null)
  const loadConflictsRef = useRef<Map<string, { remote: Note | null; text: string | null; file: string }>>(new Map())
  const conflictReadyRef = useRef(false)
  const flushRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    notesRef.current = notes
  }, [notes])
  useEffect(() => {
    dirRef.current = vaultDir
  }, [vaultDir])
  useEffect(() => {
    activeRef.current = vaultActive
  }, [vaultActive])
  useEffect(() => {
    // 最后一批 notes 提交后解锁，避免 flush 读到上一轮 React 状态。
    const gate = readyGateRef.current
    if (!vaultLoading && gate && gate === loadGateRef.current) {
      gate.complete = true
      readyGateRef.current = null
      void flushRef.current()
    }
  }, [vaultLoading])

  const setVaultDir = useCallback((dir: string) => {
    if (loadConflictsRef.current.size) throw new Error('请先选择保留本地或采用磁盘版本，未保存的冲突编辑不会被丢弃')
    loadEpochRef.current++
    activeRef.current = false
    loadGateRef.current = new VaultLoadGate()
    readyGateRef.current = null
    writeSetting(VAULT_DIR_KEY, dir)
    dirRef.current = dir
    setVaultDirState(dir)
    setLoadRevision((revision) => revision + 1)
  }, [])

  // -------------------------------------------------------------- 从目录加载

  /**
   * 读取 vault 目录并替换内存状态。
   * 返回 true 表示成功接管该目录（调用方应停止使用 localStorage 作为存储）。
   */
  const loadFromVault = useCallback(async (dir: string, cancelled: () => boolean, gate: VaultLoadGate): Promise<boolean> => {
    // 已纳管库的首屏只读 meta 和普通笔记，目录递归/stat 全部放到首屏之后。
    const metaText = (await readVaultTexts(dir, ['meta.json'])).get('meta.json') ?? null
    if (cancelled()) return false
    const index = metaText ? parseMeta(metaText) : null

    if (!index) {
      const listing = await listVault(dir)
      if (cancelled()) return false
      if (!listing?.exists) {
        setVaultError(`读不到 vault 目录：${dir}`)
        return false
      }
      if (metaText !== null || listing.meta !== null) throw new Error('meta.json 无法识别或加载期间已改变，已暂停写盘以保护原索引')
      // 目录里没有 meta.json：把当前内存里的笔记整体写进去，建立 vault。
      // 目录里已有的其他 md 一律不读、不改，只是在分配文件名时避让。
      indexRef.current = null
      writtenRef.current = new Map()
      metaRef.current = ''
      filesRef.current = new Map(listing.md.map((f) => [f.name, { mtimeMs: f.mtimeMs, size: f.size }]))
      gate.complete = true
      if (notesRef.current.length === 0) {
        const cached = load()
        notesRef.current = cached
        setNotes(cached)
      }
      setVaultUnmanaged(listing.md.length)
      setVaultError(null)
      return true
    }

    const { foreground, literature } = splitVaultEntries(index.notes)
    const seenIds = new Set<string>()
    const first = await readVaultBatch(foreground, (names) => readVaultTexts(dir, names), seenIds)
    if (cancelled()) return false
    const loadedIndex = [...first.index]
    // 保留全索引直到所有正文成功加载；gate 禁止部分 notes 被用于 deletes。
    indexRef.current = index.notes
    writtenRef.current = first.written
    metaRef.current = metaText ?? ''
    notesRef.current = first.notes
    setNotes(first.notes)
    setVaultError(null)
    setVaultLoading({ loaded: 0, total: literature.length })
    window.setTimeout(() => {
      void (async () => {
        try {
          if (cancelled()) return
          const listing = await listVault(dir)
          if (cancelled()) return
          if (!listing?.exists) throw new Error('加载期间 vault 目录不可读')
          if ((listing.meta ?? '') !== metaText) throw new Error('加载期间 meta.json 被外部修改，请重新选择目录后加载')
          filesRef.current = new Map(listing.md.map((f) => [f.name, { mtimeMs: f.mtimeMs, size: f.size }]))
          const owned = new Set(index.notes.map((entry) => entry.file))
          setVaultUnmanaged(listing.md.filter((f) => !owned.has(f.name)).length)
          // 普通笔记在首读和扫描之间可能被外部改写。重新读正文，不能把新 mtime
          // 误当成旧正文的快照；同时保留首屏期间已经发生的本地编辑。
          const fresh = await readVaultTexts(dir, first.index.map((entry) => entry.file))
          if (cancelled()) return
          const replacement = new Map<string, Note | null>()
          const initialById = new Map(first.notes.map((note) => [note.id, note]))
          for (const entry of first.index) {
            const text = fresh.get(entry.file) ?? null
            if (text === first.source.get(entry.id)) continue
            const local = notesRef.current.find((note) => note.id === entry.id)
            const initial = initialById.get(entry.id)!
            const remote = text === null ? null : { ...parseNoteMarkdown(text, baseNameOf(entry.file)).note, id: entry.id }
            if (!local || toMarkdown(local) !== toMarkdown(initial)) {
              loadConflictsRef.current.set(entry.id, { remote, text, file: entry.file })
              continue
            }
            replacement.set(entry.id, remote)
            if (remote && text !== null) writtenRef.current.set(entry.id, { file: entry.file, text })
            else writtenRef.current.delete(entry.id)
            const slot = loadedIndex.findIndex((item) => item.id === entry.id)
            if (remote) loadedIndex[slot] = { ...entry, title: remote.title }
            else loadedIndex.splice(slot, 1)
          }
          if (replacement.size) setNotes((prev) => prev.flatMap((note) => {
            if (!replacement.has(note.id)) return [note]
            const remote = replacement.get(note.id)
            return remote ? [remote] : []
          }))
          for (let offset = 0; offset < literature.length; offset += LITERATURE_BATCH_SIZE) {
            if (cancelled()) return
            const batch = await readVaultBatch(literature.slice(offset, offset + LITERATURE_BATCH_SIZE), (names) => readVaultTexts(dir, names), seenIds)
            if (cancelled()) return
            loadedIndex.push(...batch.index)
            for (const [id, written] of batch.written) writtenRef.current.set(id, written)
            setNotes((prev) => [...prev, ...batch.notes])
            setVaultLoading({ loaded: Math.min(offset + LITERATURE_BATCH_SIZE, literature.length), total: literature.length })
            // 让 React 提交和用户输入在批次间得到机会，慢盘不会锁住界面。
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
          }
          if (cancelled()) return
          // 慢盘加载可能持续很久，扫描后的外部索引修改也要在解锁写盘前发现。
          const finalMeta = (await readVaultTexts(dir, ['meta.json'])).get('meta.json') ?? null
          if (cancelled()) return
          if (finalMeta !== metaText) throw new Error('文献加载期间 meta.json 被外部修改，请重新选择目录后加载')
          indexRef.current = loadedIndex
          if (loadConflictsRef.current.size) {
            conflictReadyRef.current = true
            setVaultConflicts(loadConflictsRef.current.size)
            setVaultError(`${loadConflictsRef.current.size} 篇普通笔记在加载期间同时被本地和外部修改，已保留本地并暂停写盘，请选择冲突版本`)
            return
          }
          readyGateRef.current = gate
          setVaultLoading(null)
        } catch (error) {
          if (cancelled()) return
          // 保持 gate 关闭：即使用户点保存/自动保存，也不会误删尚未读完的文献。
          setVaultError(`文献加载失败，已暂停写盘保护原文件：${error instanceof Error ? error.message : String(error)}`)
        }
      })()
    }, 0)
    return true
  }, [])

  // 启动 / 切换目录时的数据来源：vault 优先，其次 localStorage + 仓库 notes.json
  useEffect(() => {
    let cancelled = false
    const epoch = ++loadEpochRef.current
    const stale = () => cancelled || epoch !== loadEpochRef.current
    const gate = new VaultLoadGate()
    loadGateRef.current = gate
    loadConflictsRef.current = new Map()
    conflictReadyRef.current = false
    setVaultConflicts(0)
    activeRef.current = false
    setVaultActive(false)
    setVaultLoading(null)
    setHydrated(false)
    ;(async () => {
      if (isDesktop() && vaultDir) {
        let ok = false
        try {
          ok = await loadFromVault(vaultDir, stale, gate)
        } catch (error) {
          if (!stale()) setVaultError(`读取 vault 失败，未写入原目录：${error instanceof Error ? error.message : String(error)}`)
        }
        if (stale()) return
        if (ok) {
          activeRef.current = true
          setVaultActive(true)
          // 空目录首次建立 vault：用内置示例起步，和浏览器版行为一致
          if (indexRef.current === null && notesRef.current.length === 0 && !isExplicitlyEmpty()) {
            setNotes(seedNotes())
          }
          setHydrated(true)
          return
        }
        setVaultActive(false)
        if (notesRef.current.length === 0) {
          const cached = load()
          notesRef.current = cached
          setNotes(cached)
        }
      } else {
        setVaultActive(false)
      }

      if (isExplicitlyEmpty()) {
        if (!stale()) setHydrated(true)
        return
      }
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}notes.json`, { cache: 'no-cache' })
        if (r.ok) {
          const arr = await r.json()
          if (!stale() && Array.isArray(arr) && arr.length > 0) {
            setNotes((prev) => (prev.length > 0 ? prev : (arr as Note[])))
          } else if (!stale()) {
            setNotes((prev) => (prev.length > 0 ? prev : seedNotes()))
          }
        }
      } catch {
        /* 仓库里没有 notes.json */
      }
      if (!stale()) setNotes((prev) => (prev.length > 0 ? prev : seedNotes()))
      if (!stale()) setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [vaultDir, loadRevision, loadFromVault])

  // ------------------------------------------------------------ 写入 vault

  const flushVault = useCallback(async () => {
    const dir = dirRef.current
    const gate = loadGateRef.current
    if (!dir || !activeRef.current) return
    if (!loadGateRef.current.canFlush()) return
    if (busyRef.current) {
      pendingRef.current = true
      return
    }

    const current = notesRef.current
    const plan = planVaultWrite(
      current,
      indexRef.current,
      [...filesRef.current.keys()],
      writtenRef.current,
      metaRef.current,
    )
    if (plan.writes.length === 0 && plan.deletes.length === 0 && plan.metaSkipped) return

    busyRef.current = true
    setVaultSaving(true)
    try {
      await writeVaultPlan(dir, plan)
      if (gate !== loadGateRef.current || dir !== dirRef.current) return

      const writtenInPlan = new Map(plan.writes.map((w) => [w.id, w]))
      const nextWritten = new Map<string, WrittenNote>()
      for (const n of current) {
        const w = writtenInPlan.get(n.id)
        if (w) {
          nextWritten.set(n.id, { file: w.file, text: w.text })
          continue
        }
        const file = plan.names.get(n.id) ?? relPathFor(n)
        const prev = writtenRef.current.get(n.id)
        nextWritten.set(n.id, prev && prev.file === file ? prev : { file, text: toMarkdown(n) })
      }
      writtenRef.current = nextWritten
      indexRef.current = plan.index
      metaRef.current = plan.meta
      setVaultSavedAt(Date.now())
      setVaultError(null)

      // 刷新磁盘快照（mtime 已被我们改写），顺带更新「未纳管」数量
      const listing = await listVault(dir)
      if (gate !== loadGateRef.current || dir !== dirRef.current) return
      if (listing?.exists) {
        filesRef.current = new Map(listing.md.map((f) => [f.name, { mtimeMs: f.mtimeMs, size: f.size }]))
        const owned = new Set(plan.index.map((e) => e.file))
        setVaultUnmanaged(listing.md.filter((f) => !owned.has(f.name)).length)
      }
    } catch (error) {
      if (gate === loadGateRef.current) setVaultError(`写入 vault 失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      busyRef.current = false
      setVaultSaving(false)
      if (pendingRef.current) {
        pendingRef.current = false
        void flushRef.current()
      }
    }
  }, [])

  useEffect(() => {
    flushRef.current = flushVault
  }, [flushVault])

  // 本地改动 → 防抖写盘（vault 模式写 md；否则沿用 localStorage 单文件）
  useEffect(() => {
    if (!hydrated) return
    if (!vaultActive) {
      try {
        if (notes.length > 0) removeSetting(EMPTY_FLAG)
        if (!writeSetting(STORAGE_KEY, JSON.stringify(notes))) {
          setVaultError('浏览器本地存储写入失败（可能已满），当前编辑尚未持久化；请导出备份或连接笔记目录')
        }
      } catch {
        /* ignore */
      }
      return
    }
    const timer = window.setTimeout(() => void flushVault(), WRITE_DEBOUNCE)
    return () => window.clearTimeout(timer)
  }, [notes, hydrated, vaultActive, flushVault])

  // ------------------------------------------------- 监听目录外部改动

  const pollVault = useCallback(async () => {
    const dir = dirRef.current
    const gate = loadGateRef.current
    if (!dir || !activeRef.current || busyRef.current || !loadGateRef.current.complete) return
    const listing = await listVault(dir)
    if (gate !== loadGateRef.current || dir !== dirRef.current) return
    if (!listing || !listing.exists) return

    const prevFiles = filesRef.current
    const nowNames = new Set(listing.md.map((f) => f.name))
    const changed = listing.md
      .filter((f) => {
        const p = prevFiles.get(f.name)
        return !p || p.mtimeMs !== f.mtimeMs || p.size !== f.size
      })
      .map((f) => f.name)
    const removed = [...prevFiles.keys()].filter((n) => !nowNames.has(n))

    const index = indexRef.current ?? []
    const ownedFiles = new Set(index.map((e) => e.file))
    const byFile = new Map(index.map((e) => [e.file, e]))
    const metaChanged = (listing.meta ?? '') !== metaRef.current

    if (changed.length === 0 && removed.length === 0 && !metaChanged) return

    const changedOwned = changed.filter((n) => ownedFiles.has(n))
    const removedOwned = removed.filter((n) => ownedFiles.has(n))
    const unmanaged = listing.md.filter((f) => !ownedFiles.has(f.name)).length

    const snapshot = () =>
      new Map(listing.md.map((f) => [f.name, { mtimeMs: f.mtimeMs, size: f.size }]))

    if (changedOwned.length === 0 && removedOwned.length === 0) {
      filesRef.current = snapshot()
      if (metaChanged) metaRef.current = listing.meta ?? ''
      setVaultUnmanaged(unmanaged)
      return
    }

    const texts = await readVaultTexts(dir, changedOwned)
    if (gate !== loadGateRef.current || dir !== dirRef.current) return
    const current = notesRef.current
    const next = [...current]
    let touched = false
    let keptLocal = 0

    for (const name of changedOwned) {
      const entry = byFile.get(name)!
      const text = texts.get(name)
      if (text == null) continue
      const ledger = writtenRef.current.get(entry.id)
      // 磁盘内容与账本一致 → 只是 mtime 变动（多半是我们自己刚写的），忽略
      if (ledger && ledger.text === text) continue

      const i = next.findIndex((n) => n.id === entry.id)
      const localText = i >= 0 ? toMarkdown(next[i]) : null
      if (ledger && localText !== null && localText !== ledger.text) {
        // 本地有未写盘的编辑，同时磁盘也被改了：保留本地，交给用户决定
        keptLocal++
        continue
      }

      const parsed = parseNoteMarkdown(text, baseNameOf(name)).note
      parsed.id = entry.id
      if (i >= 0) next[i] = parsed
      else next.push(parsed)
      writtenRef.current.set(entry.id, { file: name, text })
      indexRef.current = (indexRef.current ?? []).map((e) =>
        e.id === entry.id ? { ...e, title: parsed.title } : e,
      )
      touched = true
    }

    for (const name of removedOwned) {
      const entry = byFile.get(name)!
      const i = next.findIndex((n) => n.id === entry.id)
      const ledger = writtenRef.current.get(entry.id)
      const localText = i >= 0 ? toMarkdown(next[i]) : null
      if (ledger && localText !== null && localText !== ledger.text) {
        keptLocal++
        continue
      }
      if (i >= 0) next.splice(i, 1)
      writtenRef.current.delete(entry.id)
      indexRef.current = (indexRef.current ?? []).filter((e) => e.id !== entry.id)
      touched = true
    }

    filesRef.current = snapshot()
    if (metaChanged) metaRef.current = listing.meta ?? ''
    setVaultUnmanaged(unmanaged)
    if (touched) {
      setNotes(next)
      setVaultExternalAt(Date.now())
      setVaultError(null)
    }
    if (keptLocal > 0) {
      setVaultError(`目录里有 ${keptLocal} 篇笔记被外部改动，但本地也有未保存的编辑，已保留本地版本`)
    }
  }, [])

  useEffect(() => {
    writeSetting(VAULT_WATCH_KEY, watchVault ? '1' : '0')
    if (!watchVault || !vaultActive || !hydrated) return
    const dir = vaultDir
    const timer = window.setInterval(() => {
      void pollVault().catch((error) => {
        if (dir === dirRef.current) setVaultError(`检测目录改动失败：${error instanceof Error ? error.message : String(error)}`)
      })
    }, POLL_INTERVAL)
    return () => window.clearInterval(timer)
  }, [watchVault, vaultActive, hydrated, vaultDir, pollVault])

  // ------------------------------------------------------------- 笔记操作

  const resolveVaultConflicts = useCallback((version: 'local' | 'disk') => {
    if (!conflictReadyRef.current || !loadConflictsRef.current.size) return
    const conflicts = loadConflictsRef.current
    for (const [id, conflict] of conflicts) {
      if (conflict.text !== null) writtenRef.current.set(id, { file: conflict.file, text: conflict.text })
      else writtenRef.current.delete(id)
    }
    if (version === 'disk') {
      setNotes((prev) => {
        const currentIds = new Set(prev.map((note) => note.id))
        const next = prev.flatMap((note) => {
          const conflict = conflicts.get(note.id)
          return conflict ? conflict.remote ? [conflict.remote] : [] : [note]
        })
        for (const [id, conflict] of conflicts) if (!currentIds.has(id) && conflict.remote) next.push(conflict.remote)
        return next
      })
      indexRef.current = (indexRef.current ?? []).flatMap((entry) => {
        const conflict = conflicts.get(entry.id)
        return conflict ? conflict.remote ? [{ ...entry, title: conflict.remote.title }] : [] : [entry]
      })
    }
    loadConflictsRef.current = new Map()
    conflictReadyRef.current = false
    setVaultConflicts(0)
    setVaultError(null)
    readyGateRef.current = loadGateRef.current
    setVaultLoading(null)
  }, [])

  const createNotes = useCallback((partials: Partial<Note>[]): Note[] => {
    const now = Date.now()
    const incoming: Note[] = partials.map((partial) => ({
      id: uid(),
      title: partial.title ?? '未命名笔记',
      type: partial.type ?? 'other',
      grade: partial.grade ?? '',
      tags: partial.tags ?? [],
      content: partial.content ?? '',
      createdAt: now,
      updatedAt: now,
      ...(partial.literature ? { literature: partial.literature } : {}),
    }))
    setNotes((prev) => [...incoming].reverse().concat(prev))
    return incoming
  }, [])

  const createNote = useCallback((partial: Partial<Note> = {}): Note => createNotes([partial])[0], [createNotes])

  const updateNotes = useCallback((patches: { id: string; patch: Partial<Note> }[]) => {
    const byId = new Map(patches.map(({ id, patch }) => [id, patch]))
    const now = Date.now()
    setNotes((prev) => prev.map((n) => {
      const patch = byId.get(n.id)
      return patch ? { ...n, ...patch, updatedAt: now } : n
    }))
  }, [])

  const updateNote = useCallback((id: string, patch: Partial<Note>) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)),
    )
  }, [])

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => {
      const remaining = prev.filter((n) => n.id !== id)
      // 用户主动删光所有笔记时置位，避免下次启动被同步数据/种子"复活"
      if (remaining.length === 0 && (!activeRef.current || loadGateRef.current.complete)) {
        writeSetting(EMPTY_FLAG, '1')
      }
      return remaining
    })
  }, [])

  /** 用一批笔记整体替换本地数据（用于「从 notes.json 重新载入」/导入备份） */
  const replaceAll = useCallback((incoming: Note[]) => {
    if (activeRef.current && !loadGateRef.current.complete) throw new Error('文献尚未完整加载，请等待后再替换全库')
    const now = Date.now()
    const next: Note[] = incoming
      .filter((n) => n && typeof n.title === 'string' && typeof n.content === 'string')
      .map((n) => ({
        id: n.id || uid(),
        title: n.title,
        type: n.type ?? 'other',
        grade: n.grade ?? '',
        tags: Array.isArray(n.tags) ? n.tags : [],
        content: n.content,
        createdAt: n.createdAt ?? now,
        updatedAt: n.updatedAt ?? now,
        ...(n.literature ? { literature: n.literature } : {}),
      }))
    setNotes(next)
    try {
      if (next.length > 0) removeSetting(EMPTY_FLAG)
    } catch {
      /* ignore */
    }
    return next.length
  }, [])

  /** 按标题合并一批笔记（同标题更新，新标题新增），避免出现重复节点 */
  const mergeByTitle = useCallback(
    (incoming: Note[]) => {
      if (activeRef.current && !loadGateRef.current.complete) throw new Error('文献尚未完整加载，请等待后再合并全库')
      const now = Date.now()
      const pending = new Map<string, Note>()
      for (const raw of incoming) {
        if (raw && typeof raw.title === 'string' && typeof raw.content === 'string') {
          pending.set(raw.title.toLowerCase(), raw)
        }
      }
      let updated = 0
      const next: Note[] = notes.map((n) => {
        const key = n.title.toLowerCase()
        const raw = pending.get(key)
        if (!raw) return n
        pending.delete(key)
        updated++
        return {
          ...n,
          type: raw.type ?? n.type,
          grade: raw.grade ?? n.grade,
          tags: Array.isArray(raw.tags) ? raw.tags : n.tags,
          content: raw.content,
          updatedAt: now,
          ...(raw.literature ? { literature: raw.literature } : {}),
        }
      })
      let added = 0
      for (const raw of pending.values()) {
        next.unshift({
          id: raw.id || uid(),
          title: raw.title,
          type: raw.type ?? 'other',
          grade: raw.grade ?? '',
          tags: Array.isArray(raw.tags) ? raw.tags : [],
          content: raw.content,
          createdAt: raw.createdAt ?? now,
          updatedAt: raw.updatedAt ?? now,
          ...(raw.literature ? { literature: raw.literature } : {}),
        })
        added++
      }
      setNotes(next)
      try {
        if (next.length > 0) removeSetting(EMPTY_FLAG)
      } catch {
        /* ignore */
      }
      return { added, updated }
    },
    [notes],
  )

  /** 标题 -> 笔记 的索引（用于解析 wikilink） */
  const byTitle = useMemo(() => {
    const map = new Map<string, Note>()
    for (const n of notes) {
      map.set(n.title.toLowerCase(), n)
    }
    return map
  }, [notes])

  const resolveLink = useCallback(
    (title: string): Note | undefined => byTitle.get(title.toLowerCase()),
    [byTitle],
  )

  /** 图谱边：sourceId -> targetId 集合 */
  const edges = useMemo(() => {
    const set = new Set<string>()
    for (const n of notes) {
      for (const t of extractLinks(n.content)) {
        const target = byTitle.get(t.toLowerCase())
        if (target && target.id !== n.id) {
          const key = n.id < target.id ? `${n.id}|${target.id}` : `${target.id}|${n.id}`
          set.add(key)
        }
      }
    }
    return [...set].map((k) => {
      const [a, b] = k.split('|')
      return { source: a, target: b }
    })
  }, [notes, byTitle])

  const vault: VaultStatus = {
    dir: vaultDir,
    active: vaultActive,
    saving: vaultSaving,
    savedAt: vaultSavedAt,
    externalAt: vaultExternalAt,
    unmanaged: vaultUnmanaged,
    error: vaultError,
    loading: vaultLoading,
    conflicts: vaultConflicts,
  }

  return {
    notes,
    hydrated,
    createNote,
    createNotes,
    updateNote,
    updateNotes,
    resolveVaultConflicts,
    deleteNote,
    replaceAll,
    mergeByTitle,
    resolveLink,
    edges,
    vault,
    setVaultDir,
    watchVault,
    setWatchVault,
    flushVault,
  }
}

export type NotesApi = ReturnType<typeof useNotes>
