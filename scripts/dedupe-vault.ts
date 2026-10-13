/**
 * 文献库去重：合并 Zotero 里重复条目造成的重复笔记。
 *
 * 分组规则：先按 DOI（小写）分组；剩余的按「归一化标题」分组。
 * 保留挑选：有分类 > 有本机 PDF > 有 DOI > created 最早 > 文件名序。
 * 合并动作：collections / tags / attachments 取并集；缺的字段从被合并项补；正文以保留项为准。
 * 写盘：--apply 时先整库备份（.backups/dedupe-<时间戳>/），再删被合并文件、原子更新 meta.json。
 * 幂等：再跑一次应为「0 组」。
 *
 * 用法：npm run dedupe:vault -- --vault "<vault>" [--apply]
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const vaultArg = args.indexOf('--vault')
const vault = path.resolve(vaultArg >= 0 ? args[vaultArg + 1] : 'D:/BaiduSyncdisk/Bibliotx/Vault')
const apply = args.includes('--apply')
const litDir = path.join(vault, '文献')
const metaFile = path.join(vault, 'meta.json')

const readField = (text, field) => {
  const m = text.match(new RegExp(`^${field}:\\s*(.*)$`, 'm'))
  if (!m) return undefined
  let v = m[1].trim()
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
  return v.replace(/\\"/g, '"')
}
const readArray = (text, field) => {
  const raw = readField(text, field)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw.replace(/\\"/g, '"'))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
const normalizeTitle = (s) => (s || '').toLowerCase().replace(/[\s\-–—_]+/g, '').replace(/[：:，,。.、()（）[\]【】"'\\(]/g, '')

if (!fs.existsSync(metaFile) || !fs.existsSync(litDir)) throw new Error(`vault 结构不符：${vault}`)
const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
const metaById = new Map(meta.notes.map((n) => [n.id, n]))

const files = fs.readdirSync(litDir).filter((f) => f.endsWith('.md'))
const notes = []
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
    created: readField(text, 'created') ?? '',
    collections: readArray(text, 'collections'),
    tags: readArray(text, 'tags'),
    attachments: readArray(text, 'attachments'),
    authors: readField(text, 'authors') ?? '',
    venue: readField(text, 'venue') ?? '',
    year: readField(text, 'year') ?? '',
    citekey: readField(text, 'citekey') ?? '',
    pdfs: Number(readField(text, 'zoteroAvailablePdfCount') ?? '0') || 0,
    body: text.slice(text.indexOf('\n---', 4) + 4).trim(),
  })
}
console.log(`文献文件 ${files.length} 个，其中 literature ${notes.length} 篇；meta 条目 ${meta.notes.length}`)

// —— 分组：并查集。同一 DOI ⇒ 同篇；标题相近且 DOI 不冲突（至少一边为空）⇒ 同篇 ——
const parent = new Map()
const find = (x) => {
  let r = x
  while (parent.get(r) !== r) r = parent.get(r)
  while (parent.get(x) !== r) { const next = parent.get(x); parent.set(x, r); x = next }
  return r
}
const union = (a, b) => {
  const ra = find(a), rb = find(b)
  if (ra !== rb) parent.set(rb, ra)
}
for (const n of notes) parent.set(n.file, n.file)

const byDoi = new Map()
for (const n of notes) {
  if (!n.doi) continue
  byDoi.set(n.doi, [...(byDoi.get(n.doi) ?? []), n])
}
for (const group of byDoi.values()) {
  for (let i = 1; i < group.length; i++) union(group[0].file, group[i].file)
}

const byTitle = new Map()
for (const n of notes) {
  const key = normalizeTitle(n.title)
  byTitle.set(key, [...(byTitle.get(key) ?? []), n])
}
/** 标题近似判定：去掉标点与大小写后，短标题应是长标题的前缀段（防误合并不同论文） */
const similarTitles = (a, b) => {
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
const byRoot = new Map()
for (const n of notes) {
  const root = find(n.file)
  byRoot.set(root, [...(byRoot.get(root) ?? []), n])
}
const groups = [...byRoot.values()].filter((g) => g.length > 1)

/** 悬空 meta 条目：指向的文件已不存在（历史合并/手工删除留下的） */
const dangling = meta.notes.filter((n) => !fs.existsSync(path.join(vault, n.file)))
if (dangling.length) {
  console.log(`悬空 meta 条目：${dangling.length} 条（如 ${dangling[0].file}）`)
  if (apply) {
    const stale = new Set(dangling.map((n) => n.id))
    meta.notes = meta.notes.filter((n) => !stale.has(n.id))
  }
}

const score = (n) => [
  n.collections.filter((c) => c && c !== '未分类').length > 0 ? 1 : 0,
  n.pdfs > 0 ? 1 : 0,
  n.doi ? 1 : 0,
]
const better = (a, b) => {
  const sa = score(a), sb = score(b)
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i]
  if (a.created !== b.created) return a.created < b.created ? 1 : -1 // created 早者胜
  return a.file < b.file ? 1 : -1
}

console.log(`重复组：${groups.length} 组，涉及 ${groups.reduce((s, g) => s + g.length, 0)} 篇，可删 ${groups.reduce((s, g) => s + g.length - 1, 0)} 篇`)
const plans = groups.map((group) => {
  const sorted = [...group].sort((a, b) => better(a, b)).reverse()
  const keeper = sorted[0]
  const losers = sorted.slice(1)
  const merged = {
    collections: [...new Set([...group.flatMap((n) => n.collections)])],
    tags: [...new Set([...group.flatMap((n) => n.tags)])],
    attachments: [...new Set([...group.flatMap((n) => n.attachments)])],
  }
  const contentRisk = losers.filter((n) => n.body)
  return { keeper, losers, merged, contentRisk }
})
const risky = plans.filter((p) => p.contentRisk.length)
console.log(`其中 ${risky.length} 组里被合并项带有正文（正文会被丢弃，备份里可找回）`)
for (const p of plans.slice(0, 3)) {
  console.log(`· ${p.keeper.title.slice(0, 50)}：保留 ${p.keeper.file.slice(0, 40)}，合并 ${p.losers.length} 条；分类并集 ${p.merged.collections.length} 个`)
}

if (!apply) {
  console.log('\n（dry-run）加 --apply 才会写盘')
  process.exit(0)
}

// —— 应用 ——
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = path.join(vault, '.backups', `dedupe-${stamp}`)
fs.mkdirSync(path.join(backup, '文献'), { recursive: true })
fs.copyFileSync(metaFile, path.join(backup, 'meta.json'))
for (const p of plans) {
  for (const f of [p.keeper, ...p.losers]) {
    fs.copyFileSync(f.full, path.join(backup, '文献', f.file))
  }
}

const replaceLine = (text, field, value) => {
  const line = `${field}: ${JSON.stringify(value)}`
  const re = new RegExp(`^${field}:.*$`, 'm')
  return re.test(text) ? text.replace(re, line) : text.replace(/^---\n/, `---\n${line}\n`)
}

let removed = 0
for (const { keeper, losers, merged } of plans) {
  let text = keeper.text
  text = replaceLine(text, 'collections', merged.collections)
  text = replaceLine(text, 'tags', merged.tags)
  text = replaceLine(text, 'attachments', merged.attachments)
  for (const field of ['authors', 'venue', 'year', 'doi', 'citekey']) {
    if (!readField(text, field) && readField(losers[0].text, field)) {
      text = replaceLine(text, field, readField(losers[0].text, field))
    }
  }
  fs.writeFileSync(keeper.full, text, 'utf8')
  for (const l of losers) {
    fs.rmSync(l.full, { force: true })
    const rel = path.posix.join('文献', l.file)
    meta.notes = meta.notes.filter((n) => {
      const stale = n.id === l.id || n.file === rel
      if (stale && n.id) metaById.delete(n.id)
      return !stale
    })
    removed++
  }
  const keeperMeta = metaById.get(keeper.id)
  if (keeperMeta && keeperMeta.title !== keeper.title) keeperMeta.title = keeper.title
}
meta.updated = new Date().toISOString()
fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n', 'utf8')

console.log(`\n已合并 ${plans.length} 组，删除 ${removed} 个文件；meta 现有 ${meta.notes.length} 条`)
console.log(`备份：${backup}`)
console.log('（Zotero 库本身仍有重复；下次同步会按 DOI/标题匹配回合并后的笔记，不会重新长出来。）')
