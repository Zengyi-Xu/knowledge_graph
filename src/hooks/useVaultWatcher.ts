/**
 * 目录外部改动轮询：Obsidian / 编辑器改过的 md 会被采纳进内存，
 * 外部删除的笔记从内存里移除，meta.json 被外部改动时同步索引。
 *
 * 只看 meta.json 索引里登记过的文件（未纳管的 md 一律不读不改），
 * 磁盘内容与账本一致时忽略（多半是我们自己刚写的，只是 mtime 变了）；
 * 本地有未写盘的编辑时就保留本地并提示用户，不覆盖任何一边。
 */
import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Note } from '@/types/note'
import { baseNameOf, parseNoteMarkdown, toMarkdown } from '@/lib/vaultFormat'
import { VAULT_WATCH_KEY, listVault, readVaultTexts } from '@/lib/vaultFs'
import { readSetting, writeSetting } from '@/lib/env'
import type { VaultLedger, VaultSessionApi } from '@/hooks/useVaultSession'

/** 轮询 vault 目录、感知外部改动的间隔 */
export const POLL_INTERVAL = 3000

export interface VaultWatcherOptions {
  ledger: VaultLedger
  session: VaultSessionApi
  setNotes: Dispatch<SetStateAction<Note[]>>
}

export interface VaultWatcherApi {
  watchVault: boolean
  setWatchVault: Dispatch<SetStateAction<boolean>>
  /** 最近一次外部改动被采纳的时间 */
  externalAt: number | null
  poll: () => Promise<void>
}

export function useVaultWatcher({ ledger, session, setNotes }: VaultWatcherOptions): VaultWatcherApi {
  const [externalAt, setExternalAt] = useState<number | null>(null)
  const [watchVault, setWatchVault] = useState<boolean>(() => {
    try {
      return readSetting(VAULT_WATCH_KEY) !== '0'
    } catch {
      return true
    }
  })

  const poll = useCallback(async () => {
    const dir = ledger.dirRef.current
    const gate = ledger.loadGateRef.current
    if (!dir || !ledger.activeRef.current || ledger.busyRef.current || !gate.complete) return
    const listing = await listVault(dir)
    if (gate !== ledger.loadGateRef.current || dir !== ledger.dirRef.current) return
    if (!listing || !listing.exists) return

    const prevFiles = ledger.filesRef.current
    const nowNames = new Set(listing.md.map((f) => f.name))
    const changed = listing.md
      .filter((f) => {
        const prev = prevFiles.get(f.name)
        return !prev || prev.mtimeMs !== f.mtimeMs || prev.size !== f.size
      })
      .map((f) => f.name)
    const removed = [...prevFiles.keys()].filter((name) => !nowNames.has(name))

    const index = ledger.indexRef.current ?? []
    const ownedFiles = new Set(index.map((e) => e.file))
    const byFile = new Map(index.map((e) => [e.file, e]))
    const metaChanged = (listing.meta ?? '') !== ledger.metaRef.current

    if (changed.length === 0 && removed.length === 0 && !metaChanged) return

    const changedOwned = changed.filter((name) => ownedFiles.has(name))
    const removedOwned = removed.filter((name) => ownedFiles.has(name))
    const unmanaged = listing.md.filter((f) => !ownedFiles.has(f.name)).length

    const snapshot = () => new Map(listing.md.map((f) => [f.name, { mtimeMs: f.mtimeMs, size: f.size }]))

    if (changedOwned.length === 0 && removedOwned.length === 0) {
      ledger.filesRef.current = snapshot()
      if (metaChanged) ledger.metaRef.current = listing.meta ?? ''
      ledger.ui.setUnmanaged(unmanaged)
      return
    }

    const texts = await readVaultTexts(dir, changedOwned)
    if (gate !== ledger.loadGateRef.current || dir !== ledger.dirRef.current) return
    const current = ledger.notesRef.current
    const next = [...current]
    let touched = false
    let keptLocal = 0

    for (const name of changedOwned) {
      const entry = byFile.get(name)!
      const text = texts.get(name)
      if (text == null) continue
      const writtenEntry = ledger.writtenRef.current.get(entry.id)
      // 磁盘内容与账本一致 → 只是 mtime 变动（多半是我们自己刚写的），忽略
      if (writtenEntry && writtenEntry.text === text) continue

      const i = next.findIndex((n) => n.id === entry.id)
      const localText = i >= 0 ? toMarkdown(next[i]) : null
      if (writtenEntry && localText !== null && localText !== writtenEntry.text) {
        // 本地有未写盘的编辑，同时磁盘也被改了：保留本地，交给用户决定
        keptLocal++
        continue
      }

      const parsed = parseNoteMarkdown(text, baseNameOf(name)).note
      parsed.id = entry.id
      if (i >= 0) next[i] = parsed
      else next.push(parsed)
      ledger.writtenRef.current.set(entry.id, { file: name, text })
      ledger.indexRef.current = (ledger.indexRef.current ?? []).map((e) =>
        e.id === entry.id ? { ...e, title: parsed.title } : e,
      )
      touched = true
    }

    for (const name of removedOwned) {
      const entry = byFile.get(name)!
      const i = next.findIndex((n) => n.id === entry.id)
      const written = ledger.writtenRef.current.get(entry.id)
      const localText = i >= 0 ? toMarkdown(next[i]) : null
      if (written && localText !== null && localText !== written.text) {
        keptLocal++
        continue
      }
      if (i >= 0) next.splice(i, 1)
      ledger.writtenRef.current.delete(entry.id)
      ledger.indexRef.current = (ledger.indexRef.current ?? []).filter((e) => e.id !== entry.id)
      touched = true
    }

    ledger.filesRef.current = snapshot()
    if (metaChanged) ledger.metaRef.current = listing.meta ?? ''
    ledger.ui.setUnmanaged(unmanaged)
    if (touched) {
      setNotes(next)
      setExternalAt(Date.now())
      ledger.ui.setError(null)
    }
    if (keptLocal > 0) {
      ledger.ui.setError(`目录里有 ${keptLocal} 篇笔记被外部改动，但本地也有未保存的编辑，已保留本地版本`)
    }
  }, [ledger, setNotes])

  useEffect(() => {
    writeSetting(VAULT_WATCH_KEY, watchVault ? '1' : '0')
    if (!watchVault || !session.active || !session.hydrated) return
    const dir = session.dir
    const timer = window.setInterval(() => {
      void poll().catch((pollError) => {
        if (dir === ledger.dirRef.current) {
          ledger.ui.setError(`检测目录改动失败：${pollError instanceof Error ? pollError.message : String(pollError)}`)
        }
      })
    }, POLL_INTERVAL)
    return () => window.clearInterval(timer)
  }, [ledger, watchVault, session.active, session.hydrated, session.dir, poll])

  return { watchVault, setWatchVault, externalAt, poll }
}
