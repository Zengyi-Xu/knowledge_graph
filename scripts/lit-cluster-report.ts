/**
 * 文献聚类报告：直读 vault 的 `文献/*.md`，跑 `src/lib/litCluster.ts` 的两级聚类，
 * 打印每个簇的名字 / 规模 / 代表词 / 样例标题 / 内聚度，用来调参和验收。
 * 只读，不写 vault 里的任何文件（`--json` 才落一份报告到指定路径）。
 *
 *   npm run cluster:report -- --vault "D:\BaiduSyncdisk\Bibliotx\Vault"
 *   npm run cluster:report -- --vault "<v>" --top 10 --samples 5 --json .tmp-cluster/report.json
 *
 * 指标说明：
 * - 内聚度 intra：簇内随机点对的平均余弦相似度（抽样 200 对）；
 * - 提升 lift = intra / 全局平均相似度，> 1 才算「比瞎猜更聚」；
 * - 覆盖 cover：簇内出现率最高的分类段占簇的比例（分类噪声大时低，不代表聚类差）。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Note } from '@/types/note'
import { clusterLiterature, clusterTermsOf } from '@/lib/litCluster'
import { baseOf, parseNoteMarkdown } from '@/lib/vaultFormat'

const args = process.argv.slice(2)
const argValue = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const vaultArg = argValue('--vault')
if (!vaultArg) throw new Error('请用 --vault <目录> 指定笔记库')
const vault = path.resolve(vaultArg)
const topK = argValue('--top') ? Number(argValue('--top')) : undefined
const samples = Number(argValue('--samples') ?? 3)
const jsonPath = argValue('--json')
const litDir = path.join(vault, '文献')
if (!fs.existsSync(litDir)) throw new Error(`vault 结构不符（缺 文献/ 目录）：${vault}`)

/** 只用来快速判断这条 md 是不是文献笔记（其余字段一律交给应用自己的解析器） */
const field = (text: string, name: string) => (text.match(new RegExp(`^${name}:\\s*(.*)$`, 'm')) ?? [])[1]

const notes: Note[] = []
for (const file of fs.readdirSync(litDir).filter((f) => f.endsWith('.md'))) {
  const text = fs.readFileSync(path.join(litDir, file), 'utf8')
  if (field(text, 'type') !== 'literature') continue
  // 走应用自己的解析器：报告里的簇必须和界面里看到的一致（否则调参数就是刻舟求剑）
  const { note } = parseNoteMarkdown(text, baseOf(file))
  if (note.type !== 'literature') continue
  notes.push(note)
}

const t0 = Date.now()
const tree = clusterLiterature(notes, topK ? { topK } : {})
const elapsed = Date.now() - t0

if (!tree) {
  console.log(`文献 ${notes.length} 篇：低于聚类阈值，视图会直接铺开节点（不聚类）`)
  process.exit(0)
}

// ---- 内聚度：抽样点对的平均余弦相似度 ----
const byId = new Map(notes.map((n) => [n.id, n]))
const tfOf = new Map(notes.map((n) => [n.id, clusterTermsOf(n)]))
const globalDf = new Map<string, number>()
for (const tf of tfOf.values()) for (const key of tf.keys()) globalDf.set(key, (globalDf.get(key) ?? 0) + 1)
const globalIdf = new Map([...globalDf].map(([key, df]) => [key, Math.log(1 + notes.length / df)]))
const vectorOf = (id: string): Map<string, number> => {
  const tf = tfOf.get(id)!
  const out = new Map<string, number>()
  let norm = 0
  for (const [key, count] of tf) {
    const w = (1 + Math.log(count)) * (globalIdf.get(key) ?? 0)
    if (w <= 0) continue
    out.set(key, w)
    norm += w * w
  }
  norm = Math.sqrt(norm)
  if (norm > 0) for (const [key, w] of out) out.set(key, w / norm)
  return out
}
const vectors = new Map(notes.map((n) => [n.id, vectorOf(n.id)]))
const cosine = (a: Map<string, number>, b: Map<string, number>) => {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let s = 0
  for (const [key, w] of small) s += w * (large.get(key) ?? 0)
  return s
}
let seed = 12345
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pairSamples = (ids: string[], pairs: number) => {
  if (ids.length < 2) return 0
  let sum = 0
  let count = 0
  for (let i = 0; i < pairs; i++) {
    const a = ids[Math.floor(rnd() * ids.length)]
    const b = ids[Math.floor(rnd() * ids.length)]
    if (a === b) continue
    sum += cosine(vectors.get(a)!, vectors.get(b)!)
    count++
  }
  return count === 0 ? 0 : sum / count
}
const globalSim = pairSamples(notes.map((n) => n.id), 4000)

const collectNames = (ids: string[]): { name: string; share: number }[] => {
  const count = new Map<string, number>()
  for (const id of ids) {
    const seen = new Set<string>()
    for (const p of byId.get(id)?.literature?.collections ?? []) {
      const seg = p.split('/').pop()?.trim()
      if (!seg || seen.has(seg)) continue
      seen.add(seg)
      count.set(seg, (count.get(seg) ?? 0) + 1)
    }
  }
  return [...count].map(([name, hits]) => ({ name, share: hits / ids.length })).sort((a, b) => b.share - a.share)
}

const lines: string[] = []
const push = (s: string) => {
  lines.push(s)
  console.log(s)
}
push(`文献 ${notes.length} 篇，顶层 ${tree.roots.length} 簇，耗时 ${elapsed}ms，全局平均相似度 ${globalSim.toFixed(3)}`)
push('')
for (const root of tree.roots) {
  const intra = pairSamples(root.memberIds, 200)
  const covers = collectNames(root.memberIds)
  push(`● ${root.label}   ${root.memberIds.length} 篇   intra ${intra.toFixed(3)}  lift ${(intra / (globalSim || 1)).toFixed(2)}  coh ${root.cohesion.toFixed(3)}`)
  push(`  词：${root.terms.join(' / ')}`)
  push(`  分类覆盖：${covers.slice(0, 3).map((c) => `${c.name} ${(c.share * 100).toFixed(0)}%`).join('，') || '（无分类）'}`)
  for (const n of root.memberIds.slice(0, samples)) push(`  · ${byId.get(n)!.title.slice(0, 70)}`)
  for (const child of root.children) {
    const ci = pairSamples(child.memberIds, 100)
    const cx = collectNames(child.memberIds)
    push(`  ├ ${child.label}  ${child.memberIds.length} 篇  intra ${ci.toFixed(3)}`)
    push(`  │   词：${child.terms.join(' / ')}`)
    push(`  │   分类：${cx.slice(0, 2).map((c) => `${c.name} ${(c.share * 100).toFixed(0)}%`).join('，') || '（无分类）'}`)
    for (const n of child.memberIds.slice(0, Math.min(2, samples))) push(`  │   · ${byId.get(n)!.title.slice(0, 66)}`)
  }
  push('')
}

if (jsonPath) {
  const out = path.resolve(jsonPath)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        total: notes.length,
        elapsedMs: elapsed,
        globalSim,
        roots: tree.roots.map((r) => ({
          id: r.id,
          label: r.label,
          terms: r.terms,
          size: r.memberIds.length,
          intra: pairSamples(r.memberIds, 200),
          covers: collectNames(r.memberIds).slice(0, 5),
          children: r.children.map((c) => ({
            id: c.id,
            label: c.label,
            terms: c.terms,
            size: c.memberIds.length,
            intra: pairSamples(c.memberIds, 100),
            covers: collectNames(c.memberIds).slice(0, 5),
          })),
        })),
      },
      null,
      2,
    ),
  )
  console.log(`报告已写入 ${out}`)
}
