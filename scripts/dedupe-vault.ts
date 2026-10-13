/**
 * 文献库去重：合并 Zotero 里重复条目造成的重复笔记。
 *
 * 分组规则：先按 DOI（小写）分组；剩余的按「归一化标题」分组。
 * 保留挑选：有真实分类 > 有本机 PDF > 有 DOI > created 最早 > 文件名序。
 * 合并动作（只做并集，不丢数据）：
 * - collections / tags / attachments 取并集，历史占位「未分类」「方向:未分类」不写入；
 * - zoteroKeys 取全部 key 的并集（主 key 优先选有本机 PDF 的那个），这样重复执行官方同步
 *   仍能按 key 匹配回这一篇，不会再长出重复文献；
 * - PDF 计数取各组员之和（只统计原本写过计数的）；
 * - 被合并项的正文若不在保留项里，追加到保留项正文末尾（带来源标注），不因去重丢正文。
 * 安全：
 * - 默认只预览：逐组打印保留项 / 被合并项 / 风险标记；--report <path> 可落 JSON 报告；
 * - --apply 才写盘：先备份本次会改动的文件到 .backups/dedupe-<时间戳>/，再合并文件、删被合并文件、原子更新 meta.json；
 * - 标题只近似相等的组视为「可疑组」，默认跳过并列出来，加 --merge-suspect 才合并；
 * - --fix-placeholders 额外清理全库历史占位「未分类」分类与「方向:未分类」标签。
 * 幂等：再跑一次应为「0 组」。
 *
 * 用法：npm run dedupe:vault -- --vault "<vault>" [--apply] [--report <file>] [--merge-suspect] [--fix-placeholders]
 */
import fs from 'node:fs'
import path from 'node:path'
import { UNCLASSIFIED, UNCLASSIFIED_TAG, mergeCollections } from '@/lib/zoteroMeta'

const args = process.argv.slice(2)
const argValue = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const vault = path.resolve(argValue('--vault') ?? 'D:/BaiduSyncdisk/Bibliotx/Vault')
const apply = args.includes('--apply')
const mergeSuspect = args.includes('--merge-suspect')
const fixPlaceholders = args.includes('--fix-placeholders')
const reportPath = argValue('--report')
const litDir = path.join(vault, '文献')
const metaFile = path.join(vault, 'meta.json')

interface NoteFile {
  file: string
  full: string
  text: string
  id: string
  title: string
  doi: string
  key: string
  keys: string[]
  created: string
  collections: string[]
  tags: string[]
  attachments: string[]
  authors: string
  venue: string
  year: string
  citekey: string
  pdfsTotal?: number
  pdfsAvailable?: number
  body: string
}

const readField = (text: string, field: string): string | undefined => {
  const m = text.match(new RegExp(`^${field}:\\s*(.*)$`, 'm'))
  if (!m) return undefined
  let v = m[1].trim()
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
  return v.replace(/\\"/g, '"')
}
const readArray = (text: string, field: string): string[] => {
  const raw = readField(text, field)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw.replace(/\\"/g, '"'))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
const readNumber = (text: string, field: string): number | undefined => {
  const raw = readField(text, field)
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined
}
/** front matter 与正文分开：磁盘格式固定是 `---\n字段\n---\n\n正文` */
const splitNote = (text: string) => {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!m) return { head: '', body: text.trim() }
  return { head: m[0].endsWith('\n') ? m[0] : m[0] + '\n', body: text.slice(m[0].length).trim() }
}
const normalizeTitle = (s: string) => (s || '').toLowerCase().replace(/[\s\-–—_]+/g, '').replace(/[：:，,。.、()（）[\]【】"'\\(]/g, '')
const unique = <T,>(values: T[]): T[] => [...new Set(values)]

if (!fs.existsSync(metaFile) || !fs.existsSync(litDir)) throw new Error(`vault 结构不符：${vault}`)
const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
const metaById = new Map<string, { id: string; file: string; title: string }>(meta.notes.map((n: { id: string; file: string; title: string }) => [n.id, n]))

const files = fs.readdirSync(litDir).filter((f) => f.endsWith('.md'))
const notes: NoteFile[] = []
for (const file of files) {
  const full = path.join(litDir, file)
  const text = fs.readFileSync(full, 'utf8')
  if (readField(text, 'type') !== 'literature') continue
  const id = readField(text, 'id') ?? ''
  notes.push({
    file,
    full,
    text,
    id,
    title: readField(text, 'title') ?? file.replace(/\.md$/, ''),
    doi: (readField(text, 'doi') ?? '').toLowerCase(),
    key: readField(text, 'zoteroKey') ?? '',
    keys: readArray(text, 'zoteroKeys'),
    created: readField(text, 'created') ?? '',
    collections: readArray(text, 'collections'),
    tags: readArray(text, 'tags'),
    attachments: readArray(text, 'attachments'),
    authors: readField(text, 'authors') ?? '',
    venue: readField(text, 'venue') ?? '',
    year: readField(text, 'year') ?? '',
    citekey: readField(text, 'citekey') ?? '',
    pdfsTotal: readNumber(text, 'zoteroPdfCount'),
    pdfsAvailable: readNumber(text, 'zoteroAvailablePdfCount'),
    body: splitNote(text).body,
  })
}
console.log(`文献文件 ${files.length} 个，其中 literature ${notes.length} 篇；meta 条目 ${meta.notes.length}`)

// —— 分组：并查集。同一 DOI ⇒ 同篇；标题相近且 DOI 不冲突（至少一边为空）⇒ 同篇 ——
const parent = new Map<string, string>()
const find = (x: string): string => {
  let r = x
  while (parent.get(r) !== r) r = parent.get(r) as string
  while (parent.get(x) !== r) { const next = parent.get(x) as string; parent.set(x, r); x = next }
  return r
}
const union = (a: string, b: string) => {
  const ra = find(a), rb = find(b)
  if (ra !== rb) parent.set(rb, ra)
}
for (const n of notes) parent.set(n.file, n.file)

const byDoi = new Map<string, NoteFile[]>()
for (const n of notes) {
  if (!n.doi) continue
  byDoi.set(n.doi, [...(byDoi.get(n.doi) ?? []), n])
}
for (const group of byDoi.values()) {
  for (let i = 1; i < group.length; i++) union(group[0].file, group[i].file)
}

const byTitle = new Map<string, NoteFile[]>()
for (const n of notes) {
  const key = normalizeTitle(n.title)
  byTitle.set(key, [...(byTitle.get(key) ?? []), n])
}
/** 标题近似判定：去掉标点与大小写后，短标题应是长标题的前缀段（防误合并不同论文） */
const similarTitles = (a: NoteFile, b: NoteFile) => {
  const ta = normalizeTitle(a.title), tb = normalizeTitle(b.title)
  const short = ta.length <= tb.length ? ta : tb
  const probe = short.slice(0, Math.max(20, Math.floor(short.length * 0.8)))
  return ta.startsWith(probe) && tb.startsWith(probe)
}
for (const group of byTitle.values()) {
  if (group.length < 2) continue
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j]
      if (a.doi && b.doi && a.doi !== b.doi) {
        console.log(`（跳过）标题相同但 DOI 冲突：${a.file} | ${b.file}`)
        continue
      }
      if (!similarTitles(a, b)) {
        console.log(`（跳过）标题相近但相差过大：${a.title.slice(0, 40)} ≠ ${b.title.slice(0, 40)}`)
        continue
      }
      union(a.file, b.file)
    }
  }
}
const byRoot = new Map<string, NoteFile[]>()
for (const n of notes) {
  const root = find(n.file)
  byRoot.set(root, [...(byRoot.get(root) ?? []), n])
}
const groups = [...byRoot.values()].filter((g) => g.length > 1)

/** 悬空 meta 条目：指向的文件已不存在（历史合并/手工删除留下的） */
const dangling = meta.notes.filter((n: { file: string }) => !fs.existsSync(path.join(vault, n.file)))
if (dangling.length) {
  console.log(`悬空 meta 条目：${dangling.length} 条（如 ${dangling[0].file}）`)
}

const score = (n: NoteFile) => [
  n.collections.filter((c) => c && c !== UNCLASSIFIED).length > 0 ? 1 : 0,
  (n.pdfsAvailable ?? 0) > 0 ? 1 : 0,
  (n.pdfsTotal ?? 0) > 0 ? 1 : 0,
  n.doi ? 1 : 0,
]
const better = (a: NoteFile, b: NoteFile) => {
  const sa = score(a), sb = score(b)
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i]
  if (a.created !== b.created) return a.created < b.created ? 1 : -1 // created 早者胜
  return a.file < b.file ? 1 : -1
}

const plans = groups.map((group) => {
  const sorted = [...group].sort((a, b) => better(a, b)).reverse()
  const keeper = sorted[0]
  const losers = sorted.slice(1)
  const collections = mergeCollections(group.flatMap((n) => n.collections), [])
  const tags = unique(group.flatMap((n) => n.tags)).filter((tag) => tag !== UNCLASSIFIED_TAG)
  const attachments = unique(group.flatMap((n) => n.attachments))
  const allKeys = unique(group.flatMap((n) => [...n.keys, ...(n.key ? [n.key] : [])]))
  const pdfCarrier = sorted.find((n) => (n.pdfsAvailable ?? 0) > 0)
  const primaryKey = (pdfCarrier ?? keeper).key || allKeys[0] || ''
  const zoteroKeys = unique([primaryKey, ...keeper.keys.filter((k) => k !== primaryKey), ...allKeys].filter(Boolean))
  const sum = (pick: (n: NoteFile) => number | undefined) => {
    const values = group.map(pick).filter((v): v is number => typeof v === 'number')
    return values.length ? values.reduce((a, b) => a + b, 0) : undefined
  }
  // 被合并项正文：逐条记录，稍后按“不在保留项正文里”过滤后追加，避免丢正文
  const bodies = losers
    .map((n) => ({ file: n.file, title: n.title, body: n.body.trim() }))
    .filter((entry) => entry.body)
  // 可疑组：组内标题只是近似相等（normalizeTitle 后不完全一致），可能误合并不同论文
  const keeperNorm = normalizeTitle(keeper.title)
  const suspect = losers.some((n) => normalizeTitle(n.title) !== keeperNorm)
  const riskyBodies = bodies.length > 0
  return { keeper, losers, merged: { collections, tags, attachments }, zoteroKey: primaryKey, zoteroKeys, pdfsTotal: sum((n) => n.pdfsTotal), pdfsAvailable: sum((n) => n.pdfsAvailable), bodies, suspect, riskyBodies }
})

const suspectPlans = plans.filter((p) => p.suspect)
const bodyPlans = plans.filter((p) => p.riskyBodies)
const actionable = mergeSuspect ? plans : plans.filter((p) => !p.suspect)
console.log(`重复组：${plans.length} 组，涉及 ${plans.reduce((s, g) => s + g.losers.length + 1, 0)} 篇，可合并 ${plans.reduce((s, g) => s + g.losers.length, 0)} 篇`)
if (suspectPlans.length) console.log(`其中可疑组（标题只是近似相等）${suspectPlans.length} 组：${mergeSuspect ? '本次会合并（--merge-suspect 已开启）' : '默认跳过，加 --merge-suspect 才合并'}`)
if (bodyPlans.length) console.log(`其中 ${bodyPlans.length} 组里被合并项带有正文：正文会追加到保留项末尾，不丢（备份里也有原件）`)
for (const p of plans.slice(0, 5)) {
  console.log(`· ${p.keeper.title.slice(0, 50)}：保留 ${p.keeper.file.slice(0, 40)}，合并 ${p.losers.length} 条；分类 ${p.merged.collections.length} 个，key ${p.zoteroKeys.length} 个${p.suspect ? '（可疑）' : ''}`)
}

/** 全库历史占位清理（--fix-placeholders）：真实分类存在时「未分类」必须消失 */
const placeholderFixes = fixPlaceholders
  ? notes
      .map((n) => ({
        note: n,
        collections: mergeCollections(n.collections, []),
        tags: n.tags.filter((tag) => tag !== UNCLASSIFIED_TAG),
      }))
      .filter((entry) => entry.collections.join('\u0000') !== entry.note.collections.join('\u0000') || entry.tags.join('\u0000') !== entry.note.tags.join('\u0000'))
  : []

const report = {
  vault,
  mode: apply ? 'apply' : 'dry-run',
  generatedAt: new Date().toISOString(),
  flags: { mergeSuspect, fixPlaceholders },
  counts: {
    literature: notes.length,
    meta: meta.notes.length,
    groups: plans.length,
    suspectGroups: suspectPlans.length,
    groupsWithBodies: bodyPlans.length,
    mergedThisRun: actionable.length,
    placeholderFixes: placeholderFixes.length,
    dangling: dangling.length,
  },
  groups: plans.map((p) => ({
    keep: { file: p.keeper.file, title: p.keeper.title, id: p.keeper.id },
    merge: p.losers.map((n) => ({ file: n.file, title: n.title, id: n.id, body: n.body ? n.body.slice(0, 200) : '' })),
    suspect: p.suspect,
    zoteroKey: p.zoteroKey,
    zoteroKeys: p.zoteroKeys,
    collections: p.merged.collections,
    tags: p.merged.tags,
    attachments: p.merged.attachments,
    bodiesToAppend: p.bodies.map((b) => b.file),
  })),
  placeholderFixIds: placeholderFixes.map((entry) => entry.note.id),
}
if (reportPath) {
  const target = path.resolve(reportPath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(`报告：${target}`)
}

if (!apply) {
  console.log('\n（dry-run）不改任何文件；确认无误后加 --apply 写盘')
  process.exit(0)
}

// —— 应用 ——
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = path.join(vault, '.backups', `dedupe-${stamp}`)
fs.mkdirSync(path.join(backup, '文献'), { recursive: true })
fs.copyFileSync(metaFile, path.join(backup, 'meta.json'))
const backedUp = new Set<string>()
const backupFile = (note: NoteFile) => {
  if (backedUp.has(note.file)) return
  backedUp.add(note.file)
  fs.copyFileSync(note.full, path.join(backup, '文献', note.file))
}
for (const p of actionable) for (const n of [p.keeper, ...p.losers]) backupFile(n)
for (const entry of placeholderFixes) backupFile(entry.note)

const replaceLine = (text: string, field: string, value: unknown, number = false) => {
  const line = `${field}: ${number ? value : JSON.stringify(value)}`
  const re = new RegExp(`^${field}:.*$`, 'm')
  return re.test(text) ? text.replace(re, line) : text.replace(/^---\n/, `---\n${line}\n`)
}

let removed = 0
let bodyAppended = 0
for (const p of actionable) {
  const { head, body } = splitNote(p.keeper.text)
  let text = head
  text = replaceLine(text, 'collections', p.merged.collections)
  text = replaceLine(text, 'tags', p.merged.tags)
  text = replaceLine(text, 'attachments', p.merged.attachments)
  if (p.zoteroKey) text = replaceLine(text, 'zoteroKey', p.zoteroKey)
  if (p.zoteroKeys.length) text = replaceLine(text, 'zoteroKeys', p.zoteroKeys)
  if (p.pdfsTotal !== undefined) text = replaceLine(text, 'zoteroPdfCount', p.pdfsTotal, true)
  if (p.pdfsAvailable !== undefined) text = replaceLine(text, 'zoteroAvailablePdfCount', p.pdfsAvailable, true)
  for (const field of ['authors', 'venue', 'year', 'doi', 'citekey']) {
    if (!readField(text, field) && readField(p.losers[0].text, field)) {
      text = replaceLine(text, field, readField(p.losers[0].text, field))
    }
  }

  // 正文：保留项原正文 + 追加“不在保留项里”的被合并项正文（带来源标注）
  const seen = new Set<string>([body])
  const extras: string[] = []
  for (const entry of p.bodies) {
    if ([...seen].some((existing) => existing.includes(entry.body))) continue
    seen.add(entry.body)
    extras.push(`---\n\n**合并自重复条目「${entry.title}」**（原文件：${entry.file}）\n\n${entry.body}`)
  }
  bodyAppended += extras.length
  const finalBody = [body, ...extras].filter(Boolean).join('\n\n')
  fs.writeFileSync(p.keeper.full, `---\n${text.replace(/^---\n/, '').replace(/\n$/, '')}${finalBody ? `\n\n${finalBody}` : ''}`, 'utf8')

  for (const l of p.losers) {
    fs.rmSync(l.full, { force: true })
    const rel = path.posix.join('文献', l.file)
    meta.notes = meta.notes.filter((n: { id: string; file: string }) => {
      const stale = n.id === l.id || n.file === rel
      if (stale && n.id) metaById.delete(n.id)
      return !stale
    })
    removed++
  }
  const keeperMeta = metaById.get(p.keeper.id)
  if (keeperMeta && keeperMeta.title !== p.keeper.title) keeperMeta.title = p.keeper.title
}

let placeholderFixed = 0
for (const entry of placeholderFixes) {
  const { head, body } = splitNote(entry.note.text)
  let text = head
  text = replaceLine(text, 'collections', entry.collections)
  text = replaceLine(text, 'tags', entry.tags)
  fs.writeFileSync(entry.note.full, `---\n${text.replace(/^---\n/, '').replace(/\n$/, '')}${body ? `\n\n${body}` : ''}`, 'utf8')
  placeholderFixed++
}

if (dangling.length) {
  const stale = new Set(dangling.map((n: { id: string }) => n.id))
  meta.notes = meta.notes.filter((n: { id: string }) => !stale.has(n.id))
}
meta.updated = new Date().toISOString()
fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n', 'utf8')

console.log(`\n已合并 ${actionable.length} 组，删除 ${removed} 个文件，追加正文片段 ${bodyAppended} 处`)
if (suspectPlans.length && !mergeSuspect) console.log(`跳过可疑组 ${suspectPlans.length} 组（加 --merge-suspect 再合并）`)
if (fixPlaceholders) console.log(`清理占位「未分类」：${placeholderFixed} 篇`)
console.log(`meta 现有 ${meta.notes.length} 条；备份：${backup}`)
console.log('（合并后的笔记带全部 zoteroKeys，重复运行官方同步不会重新长出重复文献。）')
