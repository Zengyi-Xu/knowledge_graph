/**
 * 把本机已有的 PDF 认回文献笔记：按「Zotero 附件文件名 → 文献标题」在指定目录里搜 PDF，
 * 命中后把绝对路径写进笔记 front matter 的 `localPdf` 字段（只记路径，不复制、不移动文件）。
 *
 *   npm run pdf:link -- --vault "<vault>"                       # dry-run：逐条预览会写什么
 *   npm run pdf:link -- --vault "<vault>" --loose                # 词集相似度也纳入（0.7 起，人工确认）
 *   npm run pdf:link -- --vault "<vault>" --search "D:\某目录"   # 追加搜索目录（可多次）
 *   npm run pdf:link -- --vault "<vault>" --report <file.json>   # 落 JSON 报告
 *   npm run pdf:link -- --vault "<vault>" --apply                # 写盘：先备份改动文件
 *
 * 匹配顺序（置信度递减）：
 *   1) 笔记的 Zotero 条目在库里登记的 PDF 附件文件名 == 磁盘上的文件名（换过附件 key 也能认回来）→ 1.00
 *   2) 文献标题（归一化后）与文件名完全相同 → 1.00
 *   3) 标题与文件名互相包含 → 0.95
 *   4) 词集 Jaccard ≥ 0.4 → 0.5 + Jaccard×0.45（默认阈值 0.92，--loose 降到 0.70）
 * 已经能打开的笔记（zoteroAvailablePdfCount > 0 或已有 localPdf）默认跳过。
 */
import fs from 'node:fs'
import path from 'node:path'
import { indexKeysFor, matchScore } from '@/lib/pdfMatch'
import { cleanLiteratureTitle } from '@/lib/titleClean'
// @ts-expect-error 纯 JS 的 zip 备份助手（无类型声明，脚本不走 tsc）
import { writeBackupZip, freshZipPath } from './lib/backup-zip.cjs'

/* eslint-disable @typescript-eslint/no-require-imports */
const repoRoot = path.join(__dirname, '..')
const { pdfFileNamesForItems } = require(path.join(repoRoot, 'electron', 'zoteroFs.cjs'))

const args = process.argv.slice(2)
const argValue = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const argAll = (name: string): string[] => args.flatMap((value, index) => (value === name && args[index + 1] ? [args[index + 1]] : []))

const vaultArg = argValue('--vault')
if (!vaultArg) throw new Error('请用 --vault <目录> 指定笔记库')
const vault = path.resolve(vaultArg)
const zoteroDb = argValue('--db')
  ?? process.env.KG_ZOTERO_DB
  ?? path.join(process.env.APPDATA ?? '', 'Zotero', 'Zotero', 'zotero.sqlite')
const apply = args.includes('--apply')
const loose = args.includes('--loose')
const minScore = Number(argValue('--min-score') ?? (loose ? 0.7 : 0.92))
const reportPath = argValue('--report')
const searchRoots = [
  ...argAll('--search'),
  ...(argAll('--search').length ? [] : [
    path.join(path.dirname(zoteroDb), 'storage'),
    path.join(process.env.USERPROFILE ?? '', 'Zotero', 'storage'),
  ]),
].map((dir) => path.resolve(dir))
const litDir = path.join(vault, '文献')
if (!fs.existsSync(litDir)) throw new Error(`vault 结构不符（缺 文献/ 目录）：${vault}`)

// ---- 扫磁盘上的 PDF，建「归一化文件名 → 路径」索引（保留第一份命中的） ----
const byName = new Map<string, string>()
let scanned = 0
const walk = (dir: string, depth: number) => {
  if (depth > 6) return
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, depth + 1)
    else if (entry.name.toLowerCase().endsWith('.pdf')) {
      scanned++
      for (const key of indexKeysFor(entry.name)) if (!byName.has(key)) byName.set(key, full)
    }
  }
}
for (const root of searchRoots) walk(root, 0)
console.log(`搜索目录 ${searchRoots.length} 个，索引 PDF ${scanned} 份（去重键 ${byName.size}）`)

// ---- 读笔记 ----
interface Target { file: string; full: string; text: string; id: string; title: string; keys: string[]; hasLocal: boolean }
const field = (text: string, name: string) => (text.match(new RegExp(`^${name}:\\s*(.*)$`, 'm')) ?? [])[1]
const unquote = (value: string | undefined) => {
  if (!value) return ''
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) } catch { return value.slice(1, -1) }
  }
  return value
}
const targets: Target[] = []
const skipped: string[] = []
for (const file of fs.readdirSync(litDir).filter((f) => f.endsWith('.md'))) {
  const full = path.join(litDir, file)
  const text = fs.readFileSync(full, 'utf8')
  if (field(text, 'type') !== 'literature') continue
  const title = cleanLiteratureTitle(unquote(field(text, 'title'))) || file.replace(/\.md$/, '')
  const id = unquote(field(text, 'id')) || ''
  const keys = new Set<string>()
  try { for (const k of JSON.parse(field(text, 'zoteroKeys') ?? '[]')) keys.add(String(k)) } catch { /* ignore */ }
  const single = unquote(field(text, 'zoteroKey'))
  if (single) keys.add(single)
  const available = Number(field(text, 'zoteroAvailablePdfCount') ?? '0') || 0
  const hasLocal = available > 0 || Boolean(field(text, 'localPdf'))
  if (hasLocal) { skipped.push(file); continue }
  targets.push({ file, full, text, id, title, keys: [...keys], hasLocal })
}
console.log(`文献 ${targets.length + skipped.length} 篇；已有本地 PDF 跳过 ${skipped.length} 篇；待匹配 ${targets.length} 篇`)

// ---- Zotero 附件文件名（用于「换了 key 但文件还在」的情况） ----
let attachmentNames: Record<string, { name: string }[]> = {}
if (zoteroDb && fs.existsSync(zoteroDb)) {
  const allKeys = [...new Set(targets.flatMap((t) => t.keys))]
  try {
    attachmentNames = pdfFileNamesForItems(zoteroDb, allKeys)
    console.log(`Zotero 库里有附件记录的条目：${Object.keys(attachmentNames).length} / ${allKeys.length}`)
  } catch (error) {
    console.log(`（Zotero 库读取失败，跳过附件名匹配：${error instanceof Error ? error.message : error}）`)
  }
}

// ---- 逐条匹配 ----
interface Hit { target: Target; pdf: string; score: number; via: string }
const hits: Hit[] = []
const unmatched: Target[] = []
const allCandidates = [...byName.values()]
/** 先算出所有候选命中，再按分数从高到低分配：一个 PDF 只归一篇笔记（避免通用标题撞同一份文件） */
const proposals: Hit[] = []
for (const target of targets) {
  let hit: Hit | null = null
  // 1) Zotero 附件文件名（含去前缀版本）
  for (const key of target.keys) {
    for (const file of attachmentNames[key] ?? []) {
      for (const indexKey of indexKeysFor(file.name)) {
        const found = byName.get(indexKey)
        if (found) { hit = { target, pdf: found, score: 1, via: 'zotero-attachment' }; break }
      }
      if (hit) break
    }
    if (hit) break
  }
  // 2) 标题本身进索引（完全相同）
  if (!hit) {
    for (const indexKey of indexKeysFor(target.title)) {
      const found = byName.get(indexKey)
      if (found) { hit = { target, pdf: found, score: 1, via: 'title-exact' }; break }
    }
  }
  // 3) 逐个候选打分（先按长度粗筛，避免全量比对）
  if (!hit) {
    let best: { pdf: string; score: number; via: string } | null = null
    for (const candidate of allCandidates) {
      const name = path.basename(candidate)
      if (Math.abs(name.length - target.title.length) > Math.max(name.length, target.title.length) * 0.8) continue
      const result = matchScore(target.title, name)
      if (result.score >= minScore && (!best || result.score > best.score)) best = { pdf: candidate, score: result.score, via: result.via }
    }
    if (best) hit = { target, ...best }
  }
  if (hit) proposals.push(hit)
  else unmatched.push(target)
}
// 互斥分配：同一份 PDF 只给分最高的一篇；同分时按标题与文件名更接近的优先
proposals.sort((a, b) => b.score - a.score || (a.target.title.length - b.target.title.length))
const usedPdf = new Set<string>()
for (const hit of proposals) {
  if (usedPdf.has(hit.pdf)) { unmatched.push(hit.target); continue }
  usedPdf.add(hit.pdf)
  hits.push(hit)
}

const byVia = new Map<string, number>()
for (const hit of hits) byVia.set(hit.via, (byVia.get(hit.via) ?? 0) + 1)
console.log(`\n匹配到 PDF：${hits.length} 篇`)
for (const [via, count] of [...byVia.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${via}: ${count}`)
console.log(`未匹配：${unmatched.length} 篇`)
console.log('\n样例（前 12 条）：')
for (const hit of hits.slice(0, 12)) {
  console.log(`  [${hit.score.toFixed(2)} ${hit.via}] ${hit.target.title.slice(0, 42)}`)
  console.log(`      → ${hit.pdf}`)
}

const report = {
  vault,
  generatedAt: new Date().toISOString(),
  mode: apply ? 'apply' : 'dry-run',
  minScore,
  searchRoots,
  counts: { scanned, targets: targets.length, skipped: skipped.length, matched: hits.length, unmatched: unmatched.length },
  byVia: Object.fromEntries(byVia),
  matches: hits.map((hit) => ({ file: hit.target.file, title: hit.target.title, pdf: hit.pdf, score: hit.score, via: hit.via })),
  unmatched: unmatched.map((t) => ({ file: t.file, title: t.title })),
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

// ---- 写盘：在 front matter 里补 localPdf ----
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = freshZipPath(path.join(vault, '.backups', `pdf-link-${stamp}.zip`))
const willWrite = hits.filter((hit) => !new RegExp(`^localPdf:`, 'm').test(hit.target.text))
const backupEntries: { name: string; data: Buffer }[] = []
const backedUp = new Set<string>()
for (const hit of willWrite) {
  if (backedUp.has(hit.target.file)) continue
  backedUp.add(hit.target.file)
  backupEntries.push({ name: `文献/${hit.target.file}`, data: fs.readFileSync(hit.target.full) })
}
writeBackupZip(backup, backupEntries)
let written = 0
for (const hit of willWrite) {
  const line = `localPdf: ${JSON.stringify(hit.pdf)}`
  const text = hit.target.text
  let next: string
  const anchors = ['zoteroKeys:', 'zoteroKey:', 'doi:']
  const anchor = anchors.map((a) => ({ a, index: text.search(new RegExp(`^${a}.*$`, 'm')) })).filter((x) => x.index >= 0).sort((x, y) => y.index - x.index)[0]
  if (anchor) {
    const lineEnd = text.indexOf('\n', anchor.index)
    next = `${text.slice(0, lineEnd + 1)}${line}\n${text.slice(lineEnd + 1)}`
  } else {
    const tagsIndex = text.search(/^tags:.*$/m)
    next = tagsIndex >= 0
      ? `${text.slice(0, tagsIndex)}${line}\n${text.slice(tagsIndex)}`
      : text.replace(/^---\n/, `---\n${line}\n`)
  }
  fs.writeFileSync(hit.target.full, next, 'utf8')
  written++
}
console.log(`\n已写入 localPdf：${written} 篇；备份：${backup}`)
