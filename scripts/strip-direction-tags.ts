/**
 * 一次性清理：删掉笔记里旧版压平写入的「方向:<一级分类>」标签。
 *
 *   npm run tags:strip-direction -- --vault "<vault>"                    # dry-run：只出报告，不改文件
 *   npm run tags:strip-direction -- --vault "<vault>" --report r.json    # dry-run + 落 JSON 报告
 *   npm run tags:strip-direction -- --vault "<vault>" --apply            # 写盘：逐文件备份后只改 tags 行
 *
 * 为什么：分类只由 `literature.collections`（完整路径的树）承担。旧版把树压平写进 `方向:` 标签，
 * 分类被清空后标签却还留着 —— 界面「未分类」的篇目仍挂着「方向:01_论文库」（实测 454 篇），
 * 于是两处分类说法互相矛盾。
 *
 * 只做减法：除 `tags:` 那一行外，文件其余字节逐字节保持原样（脚本内有前缀/后缀断言 +
 * parseNoteMarkdown 回读校验）；不新建、不删除任何文件；--apply 先备份到
 * `<vault>/.backups/direction-tags-<时间戳>/`。跑一次即收敛，再跑应为 0 变动。
 * 规则层已同步改掉（同步/去重也会清这些标签），所以新写入不会再产生它们。
 */
import fs from 'node:fs'
import path from 'node:path'
import { isDirectionTag } from '@/lib/zoteroMeta'
import { parseNoteMarkdown } from '@/lib/vaultFormat'

const args = process.argv.slice(2)
const argValue = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const vaultArg = argValue('--vault')
if (!vaultArg) throw new Error('请用 --vault <目录> 指定笔记库')
const vault = path.resolve(vaultArg)
const apply = args.includes('--apply')
const reportPath = argValue('--report')
if (!fs.existsSync(vault)) throw new Error(`笔记库不存在：${vault}`)

/** 备份/附件/同步目录不参与：里面是快照与二进制，不是活笔记 */
const SKIP_DIRS = new Set(['.backups', 'attachments', 'sync', 'node_modules', '.git'])

const files: string[] = []
const walk = (dir: string, rel: string) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const nextRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(path.join(dir, entry.name), nextRel)
    } else if (entry.name.endsWith('.md')) {
      files.push(nextRel)
    }
  }
}
walk(vault, '')

interface Change {
  rel: string
  removed: string[]
  kept: string[]
  /** 只有 tags 行不同，其余逐字节相同 */
  next: string
}

const changes: Change[] = []
/** collections 为空（界面显示「未分类」）却挂着「方向:」标签 —— 两处分类互相矛盾的那批 */
const unclassifiedDrift: string[] = []
const unparsable: string[] = []
const byValue = new Map<string, number>()
let removedTotal = 0

for (const rel of files) {
  const abs = path.join(vault, rel)
  const text = fs.readFileSync(abs, 'utf8')
  const line = /^tags:[ \t]*(.*?)\r?$/m.exec(text)
  if (!line) continue
  let tags: unknown
  try {
    tags = JSON.parse(line[1])
  } catch {
    unparsable.push(rel)
    continue
  }
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) {
    unparsable.push(rel)
    continue
  }
  const all = tags as string[]
  const removed = all.filter(isDirectionTag)
  if (!removed.length) continue
  const kept = all.filter((tag) => !isDirectionTag(tag))
  for (const tag of removed) byValue.set(tag, (byValue.get(tag) ?? 0) + 1)
  removedTotal += removed.length

  const head = text.slice(0, line.index)
  const tail = text.slice(line.index + line[0].length)
  const eol = line[0].endsWith('\r') ? '\r' : ''
  const next = `${head}tags: ${JSON.stringify(kept)}${eol}${tail}`
  // 自检一：除 tags 行外逐字节不变
  if (!next.startsWith(head) || !next.endsWith(tail) || next.length - text.length === 0) {
    throw new Error(`写入自检失败（除 tags 行外有改动）：${rel}`)
  }
  // 自检二：改完仍是应用能读的笔记，且 tags 回读一致
  const before = parseNoteMarkdown(text, path.basename(rel, '.md'))
  const after = parseNoteMarkdown(next, path.basename(rel, '.md'))
  if (JSON.stringify(after.note.tags) !== JSON.stringify(kept) || after.note.id !== before.note.id || after.note.type !== before.note.type) {
    throw new Error(`回读校验失败：${rel}`)
  }
  const collections = (before.note.literature?.collections ?? []).filter((c) => c.trim() && c.trim() !== '未分类')
  if (!collections.length) unclassifiedDrift.push(rel)
  changes.push({ rel, removed, kept, next })
}

console.log(`扫描 md：${files.length} 篇；需要清理：${changes.length} 篇（共删「方向:」标签 ${removedTotal} 条）`)
if (byValue.size) {
  console.log('按标签值分布：')
  for (const [value, count] of [...byValue.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${value}: ${count}`)
}
console.log(`其中 ${unclassifiedDrift.length} 篇在界面里本来就是「未分类」（collections 为空）—— 就是这次要消除的矛盾`)
if (unparsable.length) console.log(`无法解析的 tags 行（跳过不动）：${unparsable.length} 篇 → ${unparsable.slice(0, 5).join('、')}`)
console.log('\n样例（前 8 篇）：')
for (const change of changes.slice(0, 8)) {
  console.log(`  ${change.rel.slice(0, 60)}`)
  console.log(`      删 ${change.removed.join('、')}；留 ${change.kept.length} 个标签`)
}

const report = {
  vault,
  generatedAt: new Date().toISOString(),
  mode: apply ? 'apply' : 'dry-run',
  counts: {
    scannedMd: files.length,
    changedFiles: changes.length,
    removedTags: removedTotal,
    unclassifiedDrift: unclassifiedDrift.length,
    unparsable: unparsable.length,
  },
  byValue: Object.fromEntries([...byValue.entries()].sort((a, b) => b[1] - a[1])),
  unclassifiedDrift,
  files: changes.map((change) => ({ file: change.rel, removed: change.removed, keptCount: change.kept.length })),
}
if (reportPath) {
  const target = path.resolve(reportPath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(`\n报告：${target}`)
}

if (!apply) {
  console.log('\n（dry-run）不改任何文件；确认无误后加 --apply 写盘')
  process.exit(0)
}
if (!changes.length) {
  console.log('\n没有需要清理的笔记')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = path.join(vault, '.backups', `direction-tags-${stamp}`)
let written = 0
for (const change of changes) {
  const abs = path.join(vault, change.rel)
  const backupFile = path.join(backup, change.rel)
  fs.mkdirSync(path.dirname(backupFile), { recursive: true })
  if (!fs.existsSync(backupFile)) fs.copyFileSync(abs, backupFile)
  fs.writeFileSync(abs, change.next, 'utf8')
  written++
}
console.log(`\n已清理 ${written} 篇（删「方向:」标签 ${removedTotal} 条）；备份：${backup}`)
