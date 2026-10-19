/**
 * vault 会话：目录选择、从目录加载（首屏只读普通笔记、文献分批载入）、装载门禁、
 * 「未纳管 md」计数与 hydrated/active 状态。
 *
 * 这里同时提供 `useVaultLedger()`：内存状态与磁盘的对应关系（哪些文件写过、索引长什么样、
 * 目录快照、门禁、冲突表……）。它是各 vault hook 之间唯一共享的可变状态，全部是 ref，
 * 不参与渲染。写盘在 `useVaultWriter.ts`，外部改动轮询在 `useVaultWatcher.ts`。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Note } from '@/types/note'
import {
  baseNameOf,
  parseMeta,
  parseNoteMarkdown,
  toMarkdown,
  type VaultIndexEntry,
  type WrittenNote,
} from '@/lib/vaultFormat'
import { VAULT_DIR_KEY, isDesktop, listVault, readVaultTexts, resolvedVaultDir } from '@/lib/vaultFs'
import { writeSetting } from '@/lib/env'
import { LITERATURE_BATCH_SIZE, readVaultBatch, splitVaultEntries, VaultLoadGate } from '@/lib/vaultLoad'
import { isExplicitlyEmpty, readCachedNotes, seedNotes } from '@/lib/noteStore'

/** 文献正文分批载入的进度；null = 已装载完成 */
export type VaultLoading = { loaded: number; total: number } | null

/** 磁盘上的 md 快照，用于发现外部改动（mtime + size） */
export interface FileStamp {
  mtimeMs: number
  size: number
}

/** 装载期间本地与外部同时改动的笔记：保留本地，等用户选磁盘版本 */
export interface VaultConflict {
  remote: Note | null
  text: string | null
  file: string
}

/** 账本上挂的界面 setter（状态本身分别归 session / useVaultConflicts 所有） */
export interface VaultLedgerUi {
  setLoading: (value: VaultLoading) => void
  setError: (value: string | null) => void
  setUnmanaged: (value: number) => void
  setConflicts: (value: number) => void
}

export interface VaultLedger {
  notesRef: MutableRefObject<Note[]>
  indexRef: MutableRefObject<VaultIndexEntry[] | null>
  writtenRef: MutableRefObject<Map<string, WrittenNote>>
  metaRef: MutableRefObject<string>
  filesRef: MutableRefObject<Map<string, FileStamp>>
  dirRef: MutableRefObject<string>
  activeRef: MutableRefObject<boolean>
  busyRef: MutableRefObject<boolean>
  pendingRef: MutableRefObject<boolean>
  loadGateRef: MutableRefObject<VaultLoadGate>
  loadEpochRef: MutableRefObject<number>
  readyGateRef: MutableRefObject<VaultLoadGate | null>
  loadConflictsRef: MutableRefObject<Map<string, VaultConflict>>
  conflictReadyRef: MutableRefObject<boolean>
  ui: VaultLedgerUi
}

/** 建立（并记住）vault 账本；只在首次渲染时创建一次 */
export function useVaultLedger(): VaultLedger {
  const ref = useRef<VaultLedger | null>(null)
  if (!ref.current) {
    const noop = () => {}
    ref.current = {
      notesRef: { current: [] },
      indexRef: { current: null },
      writtenRef: { current: new Map() },
      metaRef: { current: '' },
      filesRef: { current: new Map() },
      dirRef: { current: '' },
      activeRef: { current: false },
      busyRef: { current: false },
      pendingRef: { current: false },
      loadGateRef: { current: new VaultLoadGate() },
      loadEpochRef: { current: 0 },
      readyGateRef: { current: null },
      loadConflictsRef: { current: new Map() },
      conflictReadyRef: { current: false },
      ui: { setLoading: noop, setError: noop, setUnmanaged: noop, setConflicts: noop },
    }
  }
  return ref.current
}

export interface VaultSessionOptions {
  ledger: VaultLedger
  setNotes: Dispatch<SetStateAction<Note[]>>
}

export interface VaultSessionApi {
  /** 当前笔记目录 */
  dir: string
  /** 切换目录（数据来源改为新目录）；有未处理的冲突时拒绝 */
  setDir: (dir: string) => void
  /** 是否真的以 vault 目录作为存储（桌面版 + 目录可读） */
  active: boolean
  /** 文献分批载入进度 */
  loading: VaultLoading
  error: string | null
  /** 目录里不属于本应用的 md 数量（本应用不会读写它们） */
  unmanaged: number
  hydrated: boolean
}

export function useVaultSession({ ledger, setNotes }: VaultSessionOptions): VaultSessionApi {
  const [dir, setDirState] = useState<string>(() => {
    try {
      return resolvedVaultDir() || ''
    } catch {
      return ''
    }
  })
  const [active, setActive] = useState(false)
  const [loadRevision, setLoadRevision] = useState(0)
  const [loading, setLoading] = useState<VaultLoading>(null)
  const [error, setError] = useState<string | null>(null)
  const [unmanaged, setUnmanaged] = useState(0)
  const [hydrated, setHydrated] = useState(false)

  // loading / error / unmanaged 归本 hook 所有，但其它 hook 也要能写（写盘失败、外部改动）
  ledger.ui.setLoading = setLoading
  ledger.ui.setError = setError
  ledger.ui.setUnmanaged = setUnmanaged

  useEffect(() => {
    ledger.dirRef.current = dir
  }, [ledger, dir])
  useEffect(() => {
    ledger.activeRef.current = active
  }, [ledger, active])

  const setDir = useCallback(
    (next: string) => {
      if (ledger.loadConflictsRef.current.size) {
        throw new Error('请先选择保留本地或采用磁盘版本，未保存的冲突编辑不会被丢弃')
      }
      ledger.loadEpochRef.current++
      ledger.activeRef.current = false
      ledger.loadGateRef.current = new VaultLoadGate()
      ledger.readyGateRef.current = null
      writeSetting(VAULT_DIR_KEY, next)
      ledger.dirRef.current = next
      setDirState(next)
      setLoadRevision((revision) => revision + 1)
    },
    [ledger],
  )

  // -------------------------------------------------------------- 从目录加载

  /**
   * 读取 vault 目录并替换内存状态。
   * 返回 true 表示成功接管该目录（调用方应停止使用 localStorage 作为存储）。
   */
  const loadFromVault = useCallback(
    async (vaultDir: string, cancelled: () => boolean, gate: VaultLoadGate): Promise<boolean> => {
      // 已纳管库的首屏只读 meta 和普通笔记，目录递归/stat 全部放到首屏之后。
      const metaText = (await readVaultTexts(vaultDir, ['meta.json'])).get('meta.json') ?? null
      if (cancelled()) return false
      const index = metaText ? parseMeta(metaText) : null

      if (!index) {
        const listing = await listVault(vaultDir)
        if (cancelled()) return false
        if (!listing?.exists) {
          setError(`读不到 vault 目录：${vaultDir}`)
          return false
        }
        if (metaText !== null || listing.meta !== null) {
          throw new Error('meta.json 无法识别或加载期间已改变，已暂停写盘以保护原索引')
        }
        // 目录里没有 meta.json：把当前内存里的笔记整体写进去，建立 vault。
        // 目录里已有的其他 md 一律不读、不改，只是在分配文件名时避让。
        ledger.indexRef.current = null
        ledger.writtenRef.current = new Map()
        ledger.metaRef.current = ''
        ledger.filesRef.current = new Map(listing.md.map((f) => [f.name, { mtimeMs: f.mtimeMs, size: f.size }]))
        gate.complete = true
        if (ledger.notesRef.current.length === 0) {
          const cached = readCachedNotes()
          ledger.notesRef.current = cached
          setNotes(cached)
        }
        setUnmanaged(listing.md.length)
        setError(null)
        return true
      }

      const { foreground, literature } = splitVaultEntries(index.notes)
      const seenIds = new Set<string>()
      const first = await readVaultBatch(foreground, (names) => readVaultTexts(vaultDir, names), seenIds)
      if (cancelled()) return false
      const loadedIndex = [...first.index]
      // 保留全索引直到所有正文成功加载；gate 禁止部分 notes 被用于 deletes。
      ledger.indexRef.current = index.notes
      ledger.writtenRef.current = first.written
      ledger.metaRef.current = metaText ?? ''
      ledger.notesRef.current = first.notes
      setNotes(first.notes)
      setError(null)
      setLoading({ loaded: 0, total: literature.length })
      window.setTimeout(() => {
        void (async () => {
          try {
            if (cancelled()) return
            const listing = await listVault(vaultDir)
            if (cancelled()) return
            if (!listing?.exists) throw new Error('加载期间 vault 目录不可读')
            if ((listing.meta ?? '') !== metaText) {
              throw new Error('加载期间 meta.json 被外部修改，请重新选择目录后加载')
            }
            ledger.filesRef.current = new Map(listing.md.map((f) => [f.name, { mtimeMs: f.mtimeMs, size: f.size }]))
            const owned = new Set(index.notes.map((entry) => entry.file))
            setUnmanaged(listing.md.filter((f) => !owned.has(f.name)).length)
            // 普通笔记在首读和扫描之间可能被外部改写。重新读正文，不能把新 mtime
            // 误当成旧正文的快照；同时保留首屏期间已经发生的本地编辑。
            const fresh = await readVaultTexts(vaultDir, first.index.map((entry) => entry.file))
            if (cancelled()) return
            const replacement = new Map<string, Note | null>()
            const initialById = new Map(first.notes.map((note) => [note.id, note]))
            for (const entry of first.index) {
              const text = fresh.get(entry.file) ?? null
              if (text === first.source.get(entry.id)) continue
              const local = ledger.notesRef.current.find((note) => note.id === entry.id)
              const initial = initialById.get(entry.id)!
              const remote = text === null ? null : { ...parseNoteMarkdown(text, baseNameOf(entry.file)).note, id: entry.id }
              if (!local || toMarkdown(local) !== toMarkdown(initial)) {
                ledger.loadConflictsRef.current.set(entry.id, { remote, text, file: entry.file })
                continue
              }
              replacement.set(entry.id, remote)
              if (remote && text !== null) ledger.writtenRef.current.set(entry.id, { file: entry.file, text })
              else ledger.writtenRef.current.delete(entry.id)
              const slot = loadedIndex.findIndex((item) => item.id === entry.id)
              if (remote) loadedIndex[slot] = { ...entry, title: remote.title }
              else loadedIndex.splice(slot, 1)
            }
            if (replacement.size) {
              setNotes((prev) =>
                prev.flatMap((note) => {
                  if (!replacement.has(note.id)) return [note]
                  const remote = replacement.get(note.id)
                  return remote ? [remote] : []
                }),
              )
            }
            for (let offset = 0; offset < literature.length; offset += LITERATURE_BATCH_SIZE) {
              if (cancelled()) return
              const batch = await readVaultBatch(
                literature.slice(offset, offset + LITERATURE_BATCH_SIZE),
                (names) => readVaultTexts(vaultDir, names),
                seenIds,
              )
              if (cancelled()) return
              loadedIndex.push(...batch.index)
              for (const [id, written] of batch.written) ledger.writtenRef.current.set(id, written)
              setNotes((prev) => [...prev, ...batch.notes])
              setLoading({ loaded: Math.min(offset + LITERATURE_BATCH_SIZE, literature.length), total: literature.length })
              // 让 React 提交和用户输入在批次间得到机会，慢盘不会锁住界面。
              await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
            }
            if (cancelled()) return
            // 慢盘加载可能持续很久，扫描后的外部索引修改也要在解锁写盘前发现。
            const finalMeta = (await readVaultTexts(vaultDir, ['meta.json'])).get('meta.json') ?? null
            if (cancelled()) return
            if (finalMeta !== metaText) throw new Error('文献加载期间 meta.json 被外部修改，请重新选择目录后加载')
            ledger.indexRef.current = loadedIndex
            if (ledger.loadConflictsRef.current.size) {
              ledger.conflictReadyRef.current = true
              ledger.ui.setConflicts(ledger.loadConflictsRef.current.size)
              setError(
                `${ledger.loadConflictsRef.current.size} 篇普通笔记在加载期间同时被本地和外部修改，已保留本地并暂停写盘，请选择冲突版本`,
              )
              return
            }
            ledger.readyGateRef.current = gate
            setLoading(null)
          } catch (loadError) {
            if (cancelled()) return
            // 保持 gate 关闭：即使用户点保存/自动保存，也不会误删尚未读完的文献。
            setError(`文献加载失败，已暂停写盘保护原文件：${loadError instanceof Error ? loadError.message : String(loadError)}`)
          }
        })()
      }, 0)
      return true
    },
    [ledger, setNotes],
  )

  // 启动 / 切换目录时的数据来源：vault 优先，其次 localStorage + 仓库 notes.json
  useEffect(() => {
    let cancelled = false
    const epoch = ++ledger.loadEpochRef.current
    const stale = () => cancelled || epoch !== ledger.loadEpochRef.current
    const gate = new VaultLoadGate()
    ledger.loadGateRef.current = gate
    ledger.loadConflictsRef.current = new Map()
    ledger.conflictReadyRef.current = false
    ledger.ui.setConflicts(0)
    ledger.activeRef.current = false
    setActive(false)
    setLoading(null)
    setHydrated(false)
    ;(async () => {
      if (isDesktop() && dir) {
        let ok = false
        try {
          ok = await loadFromVault(dir, stale, gate)
        } catch (loadError) {
          if (!stale()) setError(`读取 vault 失败，未写入原目录：${loadError instanceof Error ? loadError.message : String(loadError)}`)
        }
        if (stale()) return
        if (ok) {
          ledger.activeRef.current = true
          setActive(true)
          // 空目录首次建立 vault：用内置示例起步，和浏览器版行为一致
          if (ledger.indexRef.current === null && ledger.notesRef.current.length === 0 && !isExplicitlyEmpty()) {
            setNotes(seedNotes())
          }
          setHydrated(true)
          return
        }
        setActive(false)
        if (ledger.notesRef.current.length === 0) {
          const cached = readCachedNotes()
          ledger.notesRef.current = cached
          setNotes(cached)
        }
      } else {
        setActive(false)
      }

      if (isExplicitlyEmpty()) {
        if (!stale()) setHydrated(true)
        return
      }
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}notes.json`, { cache: 'no-cache' })
        if (response.ok) {
          const arr = await response.json()
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
  }, [dir, loadRevision, loadFromVault, ledger, setNotes])

  return { dir, setDir, active, loading, error, unmanaged, hydrated }
}
