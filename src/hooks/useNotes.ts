/**
 * 笔记 API 的门面（facade）：把 vault 的各个关注点拼成一个对外接口。
 *
 * 一次编辑的完整链路：
 * `useNotes()` 暴露的操作改内存 → `useVaultWriter` 防抖写盘 → `useVaultWriter` 经门禁
 * 调 `planVaultWrite`/`writeVaultPlan` 落盘；外部改动由 `useVaultWatcher` 轮询采纳。
 * 加载编排与「装载门禁」在 `useVaultSession`，冲突取舍在 `useVaultConflicts`，
 * 双链与图谱边在 `useNoteLinks`，纯数据操作在 `src/lib/noteStore.ts`。
 *
 * `NotesApi` 是这个门面的返回类型，界面组件只依赖它。
 */
import { useCallback, useEffect, useState } from 'react'
import type { Note } from '@/types/note'
import { createNotesFrom, mergeNotesByTitle, patchNotes, sanitizeIncomingNotes, markExplicitlyEmpty, clearExplicitlyEmpty, readCachedNotes } from '@/lib/noteStore'
import { isDesktop, resolvedVaultDir } from '@/lib/vaultFs'
import { useVaultLedger, useVaultSession, type VaultLoading } from '@/hooks/useVaultSession'
import { useVaultWriter } from '@/hooks/useVaultWriter'
import { useVaultWatcher } from '@/hooks/useVaultWatcher'
import { useVaultConflicts } from '@/hooks/useVaultConflicts'
import { useNoteLinks } from '@/hooks/useNoteLinks'

export type { VaultLoading } from '@/hooks/useVaultSession'

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
  loading: VaultLoading
  conflicts: number
  /**
   * 写入门禁（判定层在 src/lib/vaultGate.ts，落盘层在 vaultFormat.ts）。
   * `ids` = 只读笔记（磁盘声明了更高格式 / 本客户端不具备的能力）；`reason` = 状态栏提示语。
   *
   * TODO(待接线)：判定层与落盘层已就绪，界面层还没接上 `decideVaultGate()`——
   * 这里先给「无限制」默认值，行为与接线前一致（不会误判只读，也不会误写：
   * 落盘层 vaultFormat 仍会按磁盘声明过滤）。接线方案见 docs/VAULT_WRITE_GATE.md。
   */
  gate: { ids: Set<string>; reason: string | null }
}

export function useNotes() {
  const ledger = useVaultLedger()
  // vault 已配置时不先反序列化一份可能含数千文献的旧 localStorage 缓存。
  const [notes, setNotes] = useState<Note[]>(() => (isDesktop() && resolvedVaultDir() ? [] : readCachedNotes()))

  // 账本上的 notesRef 必须领先于加载/写盘读取它（effect 顺序：本 effect 最先注册）
  const notesRef = ledger.notesRef
  useEffect(() => {
    notesRef.current = notes
  }, [notesRef, notes])

  const conflicts = useVaultConflicts({ ledger, setNotes })
  const session = useVaultSession({ ledger, setNotes })
  const writer = useVaultWriter({ ledger, session, notes })
  const watcher = useVaultWatcher({ ledger, session, setNotes })
  const links = useNoteLinks(notes)

  // 最后一批 notes 提交后解锁装载门禁，并立刻补一次写盘（避免 flush 读到上一轮 React 状态）。
  const { loading } = session
  const { flush } = writer
  useEffect(() => {
    const gate = ledger.readyGateRef.current
    if (!loading && gate && gate === ledger.loadGateRef.current) {
      gate.complete = true
      ledger.readyGateRef.current = null
      void flush()
    }
  }, [ledger, loading, flush])

  // ------------------------------------------------------------- 笔记操作

  const createNotes = useCallback(
    (partials: Partial<Note>[]): Note[] => {
      const incoming = createNotesFrom(partials)
      setNotes((prev) => [...incoming].reverse().concat(prev))
      return incoming
    },
    [],
  )

  const createNote = useCallback((partial: Partial<Note> = {}): Note => createNotes([partial])[0], [createNotes])

  const updateNotes = useCallback((patches: { id: string; patch: Partial<Note> }[]) => {
    setNotes((prev) => patchNotes(prev, patches))
  }, [])

  const updateNote = useCallback((id: string, patch: Partial<Note>) => {
    setNotes((prev) => patchNotes(prev, [{ id, patch }]))
  }, [])

  const deleteNote = useCallback(
    (id: string) => {
      setNotes((prev) => {
        const remaining = prev.filter((n) => n.id !== id)
        // 用户主动删光所有笔记时置位，避免下次启动被同步数据/种子"复活"
        if (remaining.length === 0 && (!ledger.activeRef.current || ledger.loadGateRef.current.complete)) {
          markExplicitlyEmpty()
        }
        return remaining
      })
    },
    [ledger],
  )

  /** 用一批笔记整体替换本地数据（用于「从 notes.json 重新载入」/导入备份） */
  const replaceAll = useCallback(
    (incoming: Note[]): number => {
      if (ledger.activeRef.current && !ledger.loadGateRef.current.complete) {
        throw new Error('文献尚未完整加载，请等待后再替换全库')
      }
      const next = sanitizeIncomingNotes(incoming)
      setNotes(next)
      if (next.length > 0) clearExplicitlyEmpty()
      return next.length
    },
    [ledger],
  )

  /** 按标题合并一批笔记（同标题更新，新标题新增），避免出现重复节点 */
  const mergeByTitle = useCallback(
    (incoming: Note[]): { added: number; updated: number } => {
      if (ledger.activeRef.current && !ledger.loadGateRef.current.complete) {
        throw new Error('文献尚未完整加载，请等待后再合并全库')
      }
      const result = mergeNotesByTitle(notes, incoming)
      setNotes(result.notes)
      if (result.notes.length > 0) clearExplicitlyEmpty()
      return { added: result.added, updated: result.updated }
    },
    [notes, ledger],
  )

  const vault: VaultStatus = {
    dir: session.dir,
    active: session.active,
    saving: writer.saving,
    savedAt: writer.savedAt,
    externalAt: watcher.externalAt,
    unmanaged: session.unmanaged,
    error: session.error,
    loading: session.loading,
    conflicts: conflicts.count,
    gate: { ids: new Set<string>(), reason: null },
  }

  return {
    notes,
    hydrated: session.hydrated,
    createNote,
    createNotes,
    updateNote,
    updateNotes,
    resolveVaultConflicts: conflicts.resolve,
    deleteNote,
    replaceAll,
    mergeByTitle,
    resolveLink: links.resolveLink,
    edges: links.edges,
    vault,
    setVaultDir: session.setDir,
    watchVault: watcher.watchVault,
    setWatchVault: watcher.setWatchVault,
    flushVault: writer.flush,
  }
}

export type NotesApi = ReturnType<typeof useNotes>
