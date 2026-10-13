import type { Note } from '@/types/note'
import { uid } from '@/types/note'
import { baseNameOf, parseNoteMarkdown, type VaultIndexEntry, type WrittenNote } from '@/lib/vaultFormat'

export const LITERATURE_BATCH_SIZE = 64

/** 只凭索引判断文献；首屏不用逐文件 stat 或打开文献正文。 */
export function splitVaultEntries(entries: VaultIndexEntry[]) {
  const foreground: VaultIndexEntry[] = []
  const literature: VaultIndexEntry[] = []
  for (const entry of entries) {
    const file = entry.file.replace(/\\/g, '/')
    ;(file.startsWith('文献/') ? literature : foreground).push(entry)
  }
  return { foreground, literature }
}

export interface VaultLoadedBatch {
  notes: Note[]
  index: VaultIndexEntry[]
  written: Map<string, WrittenNote>
  source: Map<string, string>
}

/** 由调用方保存 seenIds 跨批次去重，未读/读失败的条目不会被假装为空笔记。 */
export async function readVaultBatch(
  entries: VaultIndexEntry[],
  read: (names: string[]) => Promise<Map<string, string>>,
  seenIds: Set<string>,
): Promise<VaultLoadedBatch> {
  const texts = await read(entries.map((entry) => entry.file))
  const batch: VaultLoadedBatch = { notes: [], index: [], written: new Map(), source: new Map() }
  for (const entry of entries) {
    const text = texts.get(entry.file.replace(/\\/g, '/')) ?? texts.get(entry.file)
    if (text == null) continue // 仅明确 ENOENT 才会缺席；读失败由 read 抛出。
    const parsed = parseNoteMarkdown(text, baseNameOf(entry.file))
    const note = parsed.note
    if (seenIds.has(note.id)) note.id = uid()
    seenIds.add(note.id)
    batch.notes.push(note)
    batch.source.set(note.id, text)
    batch.index.push({ id: note.id, file: entry.file, title: note.title })
    if (!parsed.needsRewrite) batch.written.set(note.id, { file: entry.file, text })
  }
  return batch
}

/** 加载期间禁止任何写盘/同步快照，避免部分工作集被当成全库。 */
export class VaultLoadGate {
  complete = false
  pending = false
  canFlush() {
    if (this.complete) return true
    this.pending = true
    return false
  }
}
