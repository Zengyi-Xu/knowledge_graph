/**
 * Zotero → 本地笔记库的批量同步脚本（可重复运行、幂等）。
 *
 *   npm run zotero:sync -- --vault "D:\...\Vault" --db "D:\...\Zotero\zotero.sqlite"
 *   npm run zotero:sync -- --vault ... --db ... --apply
 *   （可选：--report <file> 指定报告路径；--limit <n> 只同步前 n 条；--allow-missing 跳过读不到的索引文件；
 *    --prune 额外删掉笔记里已不存在于 Zotero 的分类路径与「方向:」标签）
 *
 * 行为：
 * - 只读打开 Zotero（绝不写入），排除 attachment / annotation / note；
 * - 读 vault 的 meta.json 与索引登记的 md，用 parseNoteMarkdown 还原现有笔记；
 * - 匹配（zoteroKey > DOI > 标题归一化）→ 合并分类/标签、补空缺元数据、刷新 PDF 状态；
 *   标签只补「期刊:」「年份:」，并清掉旧版压平的「方向:」标签（分类只由 collections 承担）；
 * - --prune：合并之后再做一次减法——Zotero 里已经删掉的分类路径会被清掉
 *   （清空后由界面按「未分类」动态显示，不落盘）。默认不加，保持
 *   「只做并集、不丢数据」的语义；跑一次即幂等，再跑应为 0 变动。
 * - 未匹配书目 → 新建 `文献/` 里的 literature 笔记（id = zotero-<key>，幂等）；
 * - 默认 dry-run：只出报告，不在 vault 里创建任何目录/文件；--apply 时先建带时间戳的完整备份再写盘；
 * - --report <file> 指定报告落盘位置；dry-run 未指定时落到系统临时目录。
 * - 索引里登记、磁盘上却读不到的文件（同步盘离线等）：直接中止同步，避免重建 meta.json 时丢索引；
 *   确认是永久删除后可用 --allow-missing 跳过并让这些条目退出索引。
 * - 写盘走 planVaultWrite + vaultFs.writeVault，未纳管的 md 一律不碰，删除数必须为 0。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseMeta, parseNoteMarkdown, planVaultWrite, type VaultIndexEntry, type WrittenNote } from '@/lib/vaultFormat'
import { baseNameOf } from '@/lib/vaultFormat'
import type { Note } from '@/types/note'
import { planZoteroImport, type ZoteroImportStats } from '@/lib/zoteroImport'
import { isDirectionTag } from '@/lib/zoteroMeta'
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
  allowMissing: boolean
  prune: boolean
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
    allowMissing: argv.includes('--allow-missing'),
    prune: argv.includes('--prune'),
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
async function loadVaultNotes(vault: string, allowMissing: boolean) {
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
  const missingEntries: VaultIndexEntry[] = []
  let needsRewrite = 0
  for (const entry of entries) {
    const text = texts.get(entry.file) ?? texts.get(entry.file.replace(/\\/g, '/'))
    // 索引里有、磁盘上读不到：多为同步盘离线/文件被外部删除。
    // 跳过它会让重建后的 meta.json 丢掉这条索引，所以默认中止（--allow-missing 才跳过）。
    if (text == null) {
      missingEntries.push(entry)
      continue
    }
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
  if (missingEntries.length && !allowMissing) {
    const sample = missingEntries.slice(0, 10).map((e) => `${e.file}（id ${e.id}）`).join('；')
    throw new Error(
      `索引里有 ${missingEntries.length} 个文件在磁盘上读不到（如 ${sample}）。` +
      '为避免重建 meta.json 时丢掉这些索引，本次同步中止：请确认笔记库完整（同步盘文件已在本机）后重试；' +
      '若文件确实已永久删除，可加 --allow-missing 让它们退出索引。',
    )
  }
  return { listing, index, entries, notes, written, loadedIndex, needsRewrite, staleEntries, missingEntries }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * 删掉笔记里已不存在于 Zotero 的分类路径，以及旧版压平写入的「方向:」标签（--prune）。
 * 只动 literature.collections 与 tags，不碰正文/其它字段；清空后不写「未分类」占位。
 */
function pruneStaleCollections(
  notes: Note[],
  validPaths: Set<string>,
): { notes: Note[]; changed: number; removedPaths: number; removedTags: number; emptied: number; sample: string[] } {
  let changed = 0
  let removedPaths = 0
  let removedTags = 0
  let emptied = 0
  const sample: string[] = []
  const pruned = notes.map((note) => {
    const lit = note.literature
    if (!lit) return note
    const collections = lit.collections.filter((path) => validPaths.has(path))
    const tags = note.tags.filter((tag) => !isDirectionTag(tag))
    const droppedPaths = lit.collections.length - collections.length
    const droppedTags = note.tags.length - tags.length
    if (droppedPaths === 0 && droppedTags === 0) return note
    changed++
    removedPaths += droppedPaths
    removedTags += droppedTags
    if (lit.collections.length > 0 && collections.length === 0) emptied++
    if (sample.length < 10) sample.push(`${note.title}（-${droppedPaths} 分类 / -${droppedTags} 标签）`)
    return { ...note, tags, literature: { ...lit, collections } }
  })
  return { notes: pruned, changed, removedPaths, removedTags, emptied, sample }
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
  const loaded = await loadVaultNotes(args.vault, args.allowMissing)
  const plan = planZoteroImport(items, loaded.notes)
  // --prune：合并之后做减法，让分类树与 Zotero 当前状态一致（默认不做，保持只做并集）
  const validPaths = new Set(read.collections)
  const prune = args.prune ? pruneStaleCollections(plan.notes, validPaths) : null
  if (prune) plan.notes = prune.notes
  const writePlan = planVaultWrite(plan.notes, loaded.loadedIndex, loaded.listing.md.map((m) => m.name), loaded.written, loaded.listing.meta ?? '')

  // 写盘计划里的「更新」= 匹配到且有变化 + 需要规范化重写的旧笔记；新建的也在 writes 里
  const writeIds = new Set(writePlan.writes.map((w) => w.id))
  const createdInWrites = plan.createdIds.filter((id) => writeIds.has(id)).length
  const zoteroWrites = plan.updatedIds.filter((id) => writeIds.has(id)).length
  const extraWrites = writePlan.writes.length - createdInWrites - zoteroWrites

  const stats: ZoteroImportStats = plan.stats
  const stamp = timestamp()
  // dry-run 绝不在 vault 里创建目录/文件；--apply 才建带时间戳的完整备份
  let backupDir: string | null = null
  if (args.apply) {
    backupDir = await freshDir(path.join(args.vault, '.backups', `zotero-import-${stamp}`))
    await backupVault(args.vault, loaded.listing.md.map((m) => m.name), loaded.listing.meta, backupDir)
  }
  const reportPath = args.report
    ? path.resolve(args.report)
    : backupDir
      ? path.join(backupDir, 'report.json')
      : path.join(os.tmpdir(), 'knowledge-graph-zotero-reports', `report-${stamp}.json`)

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    vault: args.vault,
    zoteroDb: args.db,
    elapsedMs: Date.now() - started,
    backupDir,
    reportPath,
    allowMissing: args.allowMissing,
    missingIndexFiles: loaded.missingEntries.map((e) => e.file),
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
    prune: prune
      ? { changed: prune.changed, removedPaths: prune.removedPaths, removedTags: prune.removedTags, emptied: prune.emptied, sample: prune.sample }
      : null,
    deletes: writePlan.deletes,
  }

  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')

  console.log(`模式：${report.mode}${args.apply ? '' : '（不在笔记库建目录/文件，只出报告）'}`)
  console.log(`Zotero 书目：${stats.zoteroItems} 条（有分类 ${stats.withCollections} / 未分类 ${stats.unclassified}）`)
  console.log(`匹配到已有文献笔记：${stats.matched}（key ${stats.matchedByKey} / DOI ${stats.matchedByDoi} / 标题 ${stats.matchedByTitle}）`)
  console.log(`新建：${stats.created}；更新：${stats.updated}；无变化：${stats.unchanged}；待规范化：${loaded.needsRewrite}`)
  console.log(`写盘：${writePlan.writes.length} 个 md；删除：${writePlan.deletes.length}（必须为 0）；meta 是否需更新：${!writePlan.metaSkipped}`)
  console.log(`PDF：本机可访问 ${stats.availablePdfTotal} 份，涉及 ${stats.withAvailablePdf} 条书目；有 PDF 记录 ${stats.withPdfRecords} 条`)
  if (prune) console.log(`清理旧分类：${prune.changed} 篇有变动，删分类路径 ${prune.removedPaths} 条 / 「方向:」标签 ${prune.removedTags} 条；清空后变成未分类 ${prune.emptied} 篇`)
  if (loaded.missingEntries.length) console.log(`注意：${loaded.missingEntries.length} 个索引内文件读不到，已按 --allow-missing 跳过并让其退出索引`)
  console.log(`报告：${reportPath}`)

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
