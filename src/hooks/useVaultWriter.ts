/**
 * vault 写盘：把内存里的笔记增量写回目录（md + meta.json），
 * 本地改动做防抖，非 vault 模式退回 localStorage 单文件缓存。
 *
 * 写盘前先问门禁（`VaultLoadGate`）：文献还没读完 / 加载失败 / 有未处理冲突时一律不写，
 * 避免把「部分工作集」当成全库而误删文献。真正的删除/未纳管判断在 `planVaultWrite`（冻结单元）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note } from '@/types/note'
import { planVaultWrite, relPathFor, toMarkdown, type WrittenNote } from '@/lib/vaultFormat'
import { listVault, writeVaultPlan } from '@/lib/vaultFs'
import { clearExplicitlyEmpty, writeCachedNotes } from '@/lib/noteStore'
import type { VaultLedger, VaultSessionApi } from '@/hooks/useVaultSession'

/** 本地改动 → 写 md 的防抖时间 */
export const WRITE_DEBOUNCE = 500

export interface VaultWriterOptions {
  ledger: VaultLedger
  session: VaultSessionApi
  notes: Note[]
}

export interface VaultWriterApi {
  /** 立刻写一次（写不进去时保持原状，绝不半途删文件） */
  flush: () => Promise<void>
  saving: boolean
  savedAt: number | null
}

export function useVaultWriter({ ledger, session, notes }: VaultWriterOptions): VaultWriterApi {
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const flushRef = useRef<() => Promise<void>>(async () => {})

  const flush = useCallback(async () => {
    const dir = ledger.dirRef.current
    const gate = ledger.loadGateRef.current
    if (!dir || !ledger.activeRef.current) return
    if (!gate.canFlush()) return
    if (ledger.busyRef.current) {
      ledger.pendingRef.current = true
      return
    }

    const current = ledger.notesRef.current
    const plan = planVaultWrite(
      current,
      ledger.indexRef.current,
      [...ledger.filesRef.current.keys()],
      ledger.writtenRef.current,
      ledger.metaRef.current,
    )
    if (plan.writes.length === 0 && plan.deletes.length === 0 && plan.metaSkipped) return

    ledger.busyRef.current = true
    setSaving(true)
    try {
      await writeVaultPlan(dir, plan)
      if (gate !== ledger.loadGateRef.current || dir !== ledger.dirRef.current) return

      const writtenInPlan = new Map(plan.writes.map((w) => [w.id, w]))
      const nextWritten = new Map<string, WrittenNote>()
      for (const note of current) {
        const w = writtenInPlan.get(note.id)
        if (w) {
          nextWritten.set(note.id, { file: w.file, text: w.text })
          continue
        }
        const file = plan.names.get(note.id) ?? relPathFor(note)
        const prev = ledger.writtenRef.current.get(note.id)
        nextWritten.set(note.id, prev && prev.file === file ? prev : { file, text: toMarkdown(note) })
      }
      ledger.writtenRef.current = nextWritten
      ledger.indexRef.current = plan.index
      ledger.metaRef.current = plan.meta
      setSavedAt(Date.now())
      ledger.ui.setError(null)

      // 刷新磁盘快照（mtime 已被我们改写），顺带更新「未纳管」数量
      const listing = await listVault(dir)
      if (gate !== ledger.loadGateRef.current || dir !== ledger.dirRef.current) return
      if (listing?.exists) {
        ledger.filesRef.current = new Map(listing.md.map((f) => [f.name, { mtimeMs: f.mtimeMs, size: f.size }]))
        const owned = new Set(plan.index.map((e) => e.file))
        ledger.ui.setUnmanaged(listing.md.filter((f) => !owned.has(f.name)).length)
      }
    } catch (writeError) {
      if (gate === ledger.loadGateRef.current) {
        ledger.ui.setError(`写入 vault 失败：${writeError instanceof Error ? writeError.message : String(writeError)}`)
      }
    } finally {
      ledger.busyRef.current = false
      setSaving(false)
      if (ledger.pendingRef.current) {
        ledger.pendingRef.current = false
        void flushRef.current()
      }
    }
  }, [ledger])

  useEffect(() => {
    flushRef.current = flush
  }, [flush])

  const active = session.active
  const setError = ledger.ui.setError
  useEffect(() => {
    if (!session.hydrated) return
    if (!active) {
      if (notes.length > 0) clearExplicitlyEmpty()
      if (!writeCachedNotes(notes)) {
        setError('浏览器本地存储写入失败（可能已满），当前编辑尚未持久化；请导出备份或连接笔记目录')
      }
      return
    }
    const timer = window.setTimeout(() => void flush(), WRITE_DEBOUNCE)
    return () => window.clearTimeout(timer)
  }, [notes, session.hydrated, active, flush, setError])

  return { flush, saving, savedAt }
}
