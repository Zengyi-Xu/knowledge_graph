/**
 * 加载期冲突：普通笔记在「首屏读取」和「扫描后重读」之间同时被本地和外部修改。
 *
 * 此时不做任何自动取舍 —— 本地编辑留在内存里、写盘保持暂停，由用户选择
 * 保留本地（'local'）还是采用磁盘版本（'disk'）。选完之后才重新打开装载门禁。
 */
import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Note } from '@/types/note'
import type { VaultLedger } from '@/hooks/useVaultSession'

export interface VaultConflictsOptions {
  ledger: VaultLedger
  setNotes: Dispatch<SetStateAction<Note[]>>
}

export interface VaultConflictsApi {
  count: number
  resolve: (version: 'local' | 'disk') => void
}

export function useVaultConflicts({ ledger, setNotes }: VaultConflictsOptions): VaultConflictsApi {
  const [count, setCount] = useState(0)
  // 装载期间由 useVaultSession 报告冲突数量
  ledger.ui.setConflicts = setCount

  const resolve = useCallback(
    (version: 'local' | 'disk') => {
      if (!ledger.conflictReadyRef.current || !ledger.loadConflictsRef.current.size) return
      const conflicts = ledger.loadConflictsRef.current
      for (const [id, conflict] of conflicts) {
        if (conflict.text !== null) ledger.writtenRef.current.set(id, { file: conflict.file, text: conflict.text })
        else ledger.writtenRef.current.delete(id)
      }
      if (version === 'disk') {
        setNotes((prev) => {
          const currentIds = new Set(prev.map((note) => note.id))
          const next = prev.flatMap((note) => {
            const conflict = conflicts.get(note.id)
            return conflict ? (conflict.remote ? [conflict.remote] : []) : [note]
          })
          for (const [id, conflict] of conflicts) if (!currentIds.has(id) && conflict.remote) next.push(conflict.remote)
          return next
        })
        ledger.indexRef.current = (ledger.indexRef.current ?? []).flatMap((entry) => {
          const conflict = conflicts.get(entry.id)
          return conflict ? (conflict.remote ? [{ ...entry, title: conflict.remote.title }] : []) : [entry]
        })
      }
      ledger.loadConflictsRef.current = new Map()
      ledger.conflictReadyRef.current = false
      setCount(0)
      ledger.ui.setError(null)
      ledger.readyGateRef.current = ledger.loadGateRef.current
      ledger.ui.setLoading(null)
    },
    [ledger, setNotes],
  )

  return { count, resolve }
}
