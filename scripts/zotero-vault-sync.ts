/**
 * Zotero → 本地笔记库的批量同步脚本（可重复运行、幂等）。
 *
 *   npm run zotero:sync -- --vault "D:\...\Vault" --db "D:\...\Zotero\zotero.sqlite"
 *   npm run zotero:sync -- --vault ... --db ... --apply
 *
 * 行为：
 * - 只读打开 Zotero（绝不写入），排除 attachment / annotation / note；
 * - 读 vault 的 meta.json 与索引登记的 md，用 parseNoteMarkdown 还原现有笔记；
 * - 匹配（zoteroKey > DOI > 标题归一化）→ 合并分类/标签、补空缺元数据、刷新 PDF 状态；
 * - 未匹配书目 → 新建 `文献/` 里的 literature 笔记（id = zotero-<key>，幂等）；
 * - 默认 dry-run：只写报告，不动 vault；--apply 时先建带时间戳的完整备份再写盘；
 * - 写盘走 planVaultWrite + vaultFs.writeVault，未纳管的 md 一律不碰，删除数必须为 0。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseMeta, parseNoteMarkdown, planVaultWrite, type VaultIndexEntry, type WrittenNote } from '@/lib/vaultFormat'
import { baseNameOf } from '@/lib/vaultFormat'
import type { Note } from '@/types/note'
import { planZoteroImport, type ZoteroImportStats } from '@/lib/zoteroImport'
import type { ZoteroItem } from '@/lib/zoteroSync'

/* eslint-disable @typescript-eslint/no-require-imports */
// 打包成 cjs 后运行：electron/*.cjs 直接从仓库目录 require（__dirname 是产物目录）
const repoRoot = path.join(__dirname, '..')
const { listVault, readVaultFiles, writeVault } = require(path.join(repoRoot, 'electron', 'vaultFs.cjs'))
const { readZotero } = require(path.join(repoRoot, 'electron', 'zoteroFs.cjs'))

interface Args {
  vault: string
  db: string
  apply: boolean
  report?: string
  limit?: number
}

function parseArgs(argv: string[]): Args {
  const value = (name: string) => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const vault = value('--vault')
  const db = value('--db')
  if (!vault) throw new Error('缺少 --vault：请给出笔记库目录的绝对路径')
  if (!db) throw new Error('缺少 --db：请给出 zotero.sqlite 的绝对路径')
  const limit = value('--limit')
  return {
    vault: path.resolve(vault),
    db: path.resolve(db),
    apply: argv.includes('--apply'),
    report: value('--report'),
    limit: limit ? Number(limit) : undefined,
  }
}

function timestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** 备份 meta.json 与磁盘上全部 md（含未纳管文件），保留相对目录结构 */
async function backupVault(vault: string, mdNames: string[], metaText: string | null, dir: string): Promise<void> {
  for (const name of mdNames) {
    const target = path.join(dir, name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.join(vault, name), target)
  }
  if (metaText !== null) await fs.writeFile(path.join(dir, 'meta.json'), metaText, 'utf8')
}

/** 取一个尚未占用的备份目录（同一秒内重复运行时加后缀） */
async function freshDir(base: string): Promise<string> {
  await fs.mkdir(path.dirname(base), { recursive: true })
  for (let i = 0; i < 50; i++) {
    const dir = i === 0 ? base : `${base}-${i + 1}`
    try {
      await fs.mkdir(dir, { recursive: false })
      return dir
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error(`无法创建备份目录：${base}`)
}

/** 读回 vault：索引登记的 md → 笔记（与运行时 useNotes 的规则一致） */
async function loadVaultNotes(vault: string) {
  const listing = await listVault(vault)
  if (!listing.exists) throw new Error(`笔记库不存在：${vault}`)
  const index = parseMeta(listing.meta ?? '')
  if (!index) throw new Error('meta.json 缺失或格式不符（缺少 kaust-kg-vault 标记）：为安全起见不做批量写入')
  const entries: VaultIndexEntry[] = index.notes
  const texts = new Map<string, string>()
  for (const batch of chunk(entries, 128)) {
    const files = await readVaultFiles(vault, batch.map((e) => e.file))
    for (const file of files) if (typeof file.text === 'string') texts.set(file.name, file.text)
  }

  const notes: Note[] = []
  const written = new Map<string, WrittenNote>()
  const loadedIndex: VaultIndexEntry[] = []
  const seenIds = new Set<string>()
  const staleEntries: VaultIndexEntry[] = []
  let needsRewrite = 0
  for (const entry of entries) {
    const text = texts.get(entry.file) ?? texts.get(entry.file.replace(/\\/g, '/'))
    if (text == null) continue // 索引里有、磁盘上没有：不动它，也不删
    const parsed = parseNoteMarkdown(text, baseNameOf(entry.file))
    // 同一篇正文被两个索引条目指着（历史上大小写不同名导致互相覆盖）：
    // 正文里的 id 才是事实来源，后出现的那个索引条目是陈旧的，跳过即可（不删文件）
    if (seenIds.has(parsed.note.id)) {
      staleEntries.push(entry)
      continue
    }
    seenIds.add(parsed.note.id)
    if (parsed.needsRewrite) needsRewrite++
    else written.set(parsed.note.id, { file: entry.file, text })
    notes.push(parsed.note)
    loadedIndex.push({ id: parsed.note.id, file: entry.file, title: parsed.note.title })
  }
  return { listing, index, entries, notes, written, loadedIndex, needsRewrite, staleEntries }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function summarizeCollections(items: ZoteroItem[]) {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const path of item.collectionPaths) {
      const top = path.split('/')[0]
      counts.set(top, (counts.get(top) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const started = Date.now()
  const read = readZotero(args.db) as { collections: string[]; items: ZoteroItem[] }
  const items = args.limit ? read.items.slice(0, args.limit) : read.items
  const loaded = await loadVaultNotes(args.vault)
  const plan = planZoteroImport(items, loaded.notes)
  const writePlan = planVaultWrite(plan.notes, loaded.loadedIndex, loaded.listing.md.map((m) => m.name), loaded.written, loaded.listing.meta ?? '')

  // 写盘计划里的「更新」= 匹配到且有变化 + 需要规范化重写的旧笔记；新建的也在 writes 里
  const writeIds = new Set(writePlan.writes.map((w) => w.id))
  const createdInWrites = plan.createdIds.filter((id) => writeIds.has(id)).length
  const zoteroWrites = plan.updatedIds.filter((id) => writeIds.has(id)).length
  const extraWrites = writePlan.writes.length - createdInWrites - zoteroWrites

  const stats: ZoteroImportStats = plan.stats
  const stamp = timestamp()
  const backupDir = await freshDir(path.join(args.vault, '.backups', `${args.apply ? 'zotero-import' : 'zotero-preview'}-${stamp}`))
  if (args.apply) await backupVault(args.vault, loaded.listing.md.map((m) => m.name), loaded.listing.meta, backupDir)

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    vault: args.vault,
    zoteroDb: args.db,
    elapsedMs: Date.now() - started,
    backupDir,
    counts: {
      zoteroItems: stats.zoteroItems,
      indexEntries: loaded.entries.length,
      notesLoaded: loaded.notes.length,
      matched: stats.matched,
      matchedByKey: stats.matchedByKey,
      matchedByDoi: stats.matchedByDoi,
      matchedByTitle: stats.matchedByTitle,
      created: stats.created,
      updated: stats.updated,
      unchanged: stats.unchanged,
      needsRewrite: loaded.needsRewrite,
      mdWrites: writePlan.writes.length,
      deletes: writePlan.deletes.length,
      duplicateTitles: plan.duplicateTitles,
      unmanagedMd: loaded.listing.md.length - loaded.entries.length,
      staleIndexEntries: loaded.staleEntries.length,
      extraWrites,
      metaSkipped: writePlan.metaSkipped,
    },
    classification: {
      withCollections: stats.withCollections,
      unclassified: stats.unclassified,
      zoteroCollections: read.collections.length,
      topLevel: summarizeCollections(items).slice(0, 40),
    },
    pdf: {
      withPdfRecords: stats.withPdfRecords,
      withAvailablePdf: stats.withAvailablePdf,
      availablePdfTotal: stats.availablePdfTotal,
    },
    createdSample: plan.createdIds.slice(0, 20).map((id) => {
      const note = plan.notes.find((n) => n.id === id)
      return note ? { id, title: note.title, collections: note.literature?.collections ?? [] } : { id }
    }),
    updatedSample: plan.updatedIds.slice(0, 20).map((id) => {
      const note = plan.notes.find((n) => n.id === id)
      return note ? { id, title: note.title, collections: note.literature?.collections ?? [] } : { id }
    }),
    createdIds: plan.createdIds,
    updatedIds: plan.updatedIds,
    deletes: writePlan.deletes,
  }

  await fs.writeFile(path.join(backupDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')

  console.log(`模式：${report.mode}${args.apply ? '' : '（不动笔记库，只出报告）'}`)
  console.log(`Zotero 书目：${stats.zoteroItems} 条（有分类 ${stats.withCollections} / 未分类 ${stats.unclassified}）`)
  console.log(`匹配到已有文献笔记：${stats.matched}（key ${stats.matchedByKey} / DOI ${stats.matchedByDoi} / 标题 ${stats.matchedByTitle}）`)
  console.log(`新建：${stats.created}；更新：${stats.updated}；无变化：${stats.unchanged}；待规范化：${loaded.needsRewrite}`)
  console.log(`写盘：${writePlan.writes.length} 个 md；删除：${writePlan.deletes.length}（必须为 0）；meta 是否需更新：${!writePlan.metaSkipped}`)
  console.log(`PDF：本机可访问 ${stats.availablePdfTotal} 份，涉及 ${stats.withAvailablePdf} 条书目；有 PDF 记录 ${stats.withPdfRecords} 条`)
  console.log(`报告：${path.join(backupDir, 'report.json')}`)

  if (writePlan.deletes.length > 0) {
    console.error('检测到待删除文件，出于安全考虑拒绝写入：', writePlan.deletes)
    process.exitCode = 1
    return
  }

  if (args.apply) {
    const result = await writeVault(args.vault, {
      writes: writePlan.writes.map((w) => ({ file: w.file, text: w.text })),
      deletes: writePlan.deletes,
      meta: writePlan.metaSkipped ? null : writePlan.meta,
    })
    console.log(`已写入 md ${result.written} 个，删除 ${result.deleted} 个；备份：${backupDir}`)
  } else {
    console.log('dry-run 结束：确认统计无误后再加 --apply。')
  }
}

main().catch((error) => {
  console.error(`失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
