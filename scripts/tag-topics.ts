/**
 * 主题建议 / 落盘：给非文献笔记补 `主题:<名称>` 标签。
 *
 * 两步走（默认只出建议，不改盘）：
 *   1) npm run topics:suggest -- --vault "<v>"
 *      → 写出 theme-plan/主题建议.md（人看）+ 主题建议.tsv（可改）
 *   2) 改完 TSV 的最后一列（留空 = 这篇不设主题），再
 *      npm run topics:apply -- --vault "<v>" --plan theme-plan/主题建议.tsv
 *
 * 安全：
 * - 只改 tags，正文与其它 front matter 原样保留；写盘前先做
 *   `toMarkdown(parseNoteMarkdown(原文)) === 原文` 的往返校验，不通过就跳过并报告；
 * - --apply 先把会改的 md 打进 `.backups/topics-<时间戳>.zip`，再逐篇原子写；
 * - 文献笔记（1896 篇空壳）不参与；已有主题的笔记默认跳过；
 * - 不删除任何文件，不动 meta.json（meta 只存 id↔路径）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseNoteMarkdown, toMarkdown } from '@/lib/vaultFormat'
import { TOPIC_PREFIX, isTopicTag, normalizeTopic, topicOf, withTopic } from '@/lib/topics'
// @ts-expect-error 纯 JS 的 zip 备份助手（无类型声明，脚本不走 tsc）
import { writeBackupZip, freshZipPath } from './lib/backup-zip.cjs'

const args = process.argv.slice(2)
const argValue = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const vaultArg = argValue('--vault')
if (!vaultArg) throw new Error('请用 --vault <目录> 指定笔记库')
const vault = path.resolve(vaultArg)
const apply = args.includes('--apply')
const planPath = argValue('--plan')
const outDir = path.resolve(argValue('--out') ?? 'theme-plan')

const TYPE_FOLDERS = new Set(['文献', '人物', '项目', '技能', '学习', 'Inbox'])
const SKIP_DIRS = new Set(['attachments', '.backups', 'sync', 'node_modules'])

interface IndexEntry {
  id: string
  file: string
  title: string
}

const metaFile = path.join(vault, 'meta.json')
if (!fs.existsSync(metaFile)) throw new Error(`找不到 ${metaFile}`)
const index = (JSON.parse(fs.readFileSync(metaFile, 'utf8')).notes ?? []) as IndexEntry[]

/** 目录名 → 主题（只认主题目录，不认类型目录） */
function topicFromDir(file: string): string {
  const dirs = path.posix.dirname(file.replace(/\\/g, '/')).split('/').filter((d) => d && d !== '.')
  if (!dirs.length) return ''
  const last = dirs[dirs.length - 1]
  if (TYPE_FOLDERS.has(last)) return ''
  // 类型目录下再套一层（技能/NCL 设备 SOP）时取最里层，它就是主题
  return dirs.length >= 2 || !TYPE_FOLDERS.has(dirs[0]) ? last : ''
}

const RULES: [RegExp, string][] = [
  [/(CML|啁啾|chirp|锁模|mode.?lock)/i, '啁啾管理激光与LiDAR'],
  [/(LiDAR|激光雷达|FMCW)/i, '啁啾管理激光与LiDAR'],
  [/(TFLN|铌酸锂|LiNbO3|薄膜锂)/i, 'TFLN异质集成'],
  [/(公路|车辆|交通|数据集)/i, '公路交通识别'],
  [/(NCL|洁净室|SOP)/i, 'NCL 设备 SOP'],
  [/(光通?信|DSP|相干|coherent)/i, '光通信DSP'],
  [/(量子|quantum)/i, '量子通信'],
  [/(C-band|C 波段|激光器|laser)/i, 'C-band激光'],
]

function suggestByKeywords(title: string, content: string): string {
  const haystack = `${title}\n${content.slice(0, 4000)}`
  for (const [pattern, topic] of RULES) if (pattern.test(haystack)) return topic
  return ''
}

const keyOfTitle = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase()

interface Managed {
  entry: IndexEntry
  full: string
  text: string
  title: string
  isLiterature: boolean
  topic: string
  roundTrip: boolean
}

const managed: Managed[] = []
const unmanaged: string[] = []
const managedFiles = new Set(index.map((e) => e.file.replace(/\\/g, '/')))

function walk(dir: string) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue
      walk(full)
      continue
    }
    if (!ent.name.endsWith('.md')) continue
    const rel = path.relative(vault, full).replace(/\\/g, '/')
    if (!managedFiles.has(rel)) unmanaged.push(rel)
  }
}
walk(vault)

for (const entry of index) {
  const full = path.join(vault, entry.file)
  if (!fs.existsSync(full)) continue
  const text = fs.readFileSync(full, 'utf8')
  let parsed
  try {
    parsed = parseNoteMarkdown(text, path.basename(entry.file, '.md')).note
  } catch (error) {
    console.warn(`跳过（解析失败）：${entry.file} — ${error instanceof Error ? error.message : error}`)
    continue
  }
  managed.push({
    entry,
    full,
    text,
    title: parsed.title || entry.title,
    isLiterature: parsed.type === 'literature',
    topic: topicOf(parsed),
    roundTrip: toMarkdown(parsed) === text,
  })
}

/** 未纳管文件按「标题 → 所在目录」提供主题线索（旧副本常常还在主题目录里） */
const hints = new Map<string, string>()
for (const rel of unmanaged) {
  const topic = topicFromDir(rel)
  if (!topic) continue
  const full = path.join(vault, rel)
  let title = path.basename(rel, '.md')
  try {
    title = parseNoteMarkdown(fs.readFileSync(full, 'utf8'), title).note.title || title
  } catch {
    /* 解析失败就用文件名 */
  }
  const key = keyOfTitle(title)
  if (!hints.has(key)) hints.set(key, topic)
}

const notes = managed.filter((n) => !n.isLiterature)
const rows = notes.map((n) => {
  const hint = hints.get(keyOfTitle(n.title)) ?? ''
  const suggested = n.topic || hint || suggestByKeywords(n.title, n.text)
  const source = n.topic ? '已有主题' : hint ? '旧副本目录' : suggested ? '关键词' : ''
  return { ...n, suggested, source }
})

console.log(`笔记库：${vault}`)
console.log(`非文献笔记 ${notes.length} 篇；未纳管 md ${unmanaged.length} 个（只用作主题线索，不修改）`)
console.log(`建议有主题 ${rows.filter((r) => r.suggested).length} 篇；仍无主题 ${rows.filter((r) => !r.suggested).length} 篇`)
console.log(`往返校验不通过（会被跳过）：${notes.filter((r) => !r.roundTrip).length} 篇`)

if (!apply) {
  fs.mkdirSync(outDir, { recursive: true })
  const mdLines = [
    '# 主题建议',
    '',
    `由 \`npm run topics:suggest\` 生成；改动请编辑同目录的 \`主题建议.tsv\` 最后一列，然后跑 \`npm run topics:apply\`。`,
    '',
    '| 标题 | 类型 | 建议主题 | 依据 | 文件 |',
    '| --- | --- | --- | --- | --- |',
    ...rows
      .slice()
      .sort((a, b) => a.suggested.localeCompare(b.suggested, 'zh-CN') || a.title.localeCompare(b.title, 'zh-CN'))
      .map(
        (r) =>
          `| ${r.title.replace(/\|/g, '\\|')} | ${r.entry.file.split('/')[0]} | ${r.suggested || '（未定）'} | ${r.source || '—'} | ${r.entry.file} |`,
      ),
    '',
    '## 怎么改',
    '',
    `- TSV 最后一列就是最终主题，前面会自动加 \`${TOPIC_PREFIX}\`；留空 = 这篇不设主题；`,
    '- 同一主题请用完全相同的写法（大小写、空格都算不同主题）；',
    '- 应用后每篇笔记只保留一个主题标签，原有的其它标签不动。',
  ]
  const tsvLines = [
    ['id', 'file', 'title', 'topic'].join('\t'),
    ...rows.map((r) => [r.entry.id, r.entry.file, r.title, r.suggested].join('\t')),
  ]
  const mdFile = path.join(outDir, '主题建议.md')
  const tsvFile = path.join(outDir, '主题建议.tsv')
  fs.writeFileSync(mdFile, mdLines.join('\n'), 'utf8')
  fs.writeFileSync(tsvFile, tsvLines.join('\n'), 'utf8')
  console.log(`\n已写出：\n  ${mdFile}\n  ${tsvFile}`)
  console.log('改完 TSV 后：npm run topics:apply -- --vault "<v>" --plan "' + tsvFile + '"')
  process.exit(0)
}

// ---- apply ----
if (!planPath) throw new Error('--apply 需要 --plan <主题建议.tsv>（先用 topics:suggest 生成并检查）')
const planFile = path.resolve(planPath)
if (!fs.existsSync(planFile)) throw new Error(`找不到计划文件：${planFile}`)

const byId = new Map(managed.map((n) => [n.entry.id, n]))
const changes: { note: Managed; topic: string }[] = []
const skipped: string[] = []
for (const line of fs.readFileSync(planFile, 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.startsWith('id\t')) continue
  const [id, , , rawTopic] = line.split('\t')
  const topic = normalizeTopic(rawTopic ?? '')
  if (!topic) {
    skipped.push(`${id}（留空）`)
    continue
  }
  const note = byId.get(id)
  if (!note) {
    skipped.push(`${id}（索引里没有）`)
    continue
  }
  if (!note.roundTrip) {
    skipped.push(`${note.entry.file}（往返校验不通过，拒绝写入）`)
    continue
  }
  if (note.topic === topic) {
    skipped.push(`${note.entry.file}（已是「${topic}」）`)
    continue
  }
  changes.push({ note, topic })
}

if (!changes.length) {
  console.log('没有需要改的笔记（全部已是最新或留空）。')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = freshZipPath(path.join(vault, '.backups', `topics-${stamp}.zip`))
writeBackupZip(
  backup,
  changes.map(({ note }) => ({ name: note.entry.file, data: fs.readFileSync(note.full) })),
)
console.log(`已备份 ${changes.length} 个文件：${backup}`)

let written = 0
for (const { note, topic } of changes) {
  const parsed = parseNoteMarkdown(note.text, path.basename(note.entry.file, '.md')).note
  const nextTags = withTopic(parsed.tags, topic)
  if (!nextTags.some(isTopicTag)) throw new Error(`内部错误：${note.entry.file} 没写入主题标签`)
  const text = toMarkdown({ ...parsed, tags: nextTags })
  const tmp = `${note.full}.tmp-topics`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, note.full)
  written += 1
}
console.log(`\n已写入 ${written} 篇；跳过 ${skipped.length} 条`)
if (skipped.length) console.log('跳过明细：\n  ' + skipped.slice(0, 20).join('\n  ') + (skipped.length > 20 ? '\n  …' : ''))
console.log('恢复：用系统解压工具打开上面的 zip，按包内相对路径覆盖即可。')
