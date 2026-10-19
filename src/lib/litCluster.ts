/**
 * 文献分层聚类：把上千篇文献聚成两层簇，供「仅文献」图谱做「大簇 → 小簇 → 文献」的下钻。
 *
 * 特征（都在本地算，不写任何文件）：
 * - Zotero 分类路径的每一段（`01_论文库/Modulation / OFDM / 调制` → `调制`、`ofdm`…）；
 * - 标签（跳过 `期刊:` / `年份:` 这类每条都不同的噪声标签）；
 * - 标题词（英文/数字按词，中文按二元组 —— 单字太泛、三元组太稀疏）。
 * 三类词项分别加权，tf-idf 后 L2 归一化，相似度用余弦（归一化后即点积）。
 *
 * 算法：两级球面 k-means，k-means++ 初始化 + 固定种子 PRNG → 同一份数据每次结果一致
 * （图谱里簇的落位、颜色、下钻路径都不会自己变）。两级都在同一个稀疏词表上做点积，
 * 2000 篇量级是百毫秒级；纯函数、不依赖 React，脚本与自测共用。
 */
import type { Note } from '@/types/note'

export interface LitCluster {
  /** 簇 id：顶层 `c0`、子层 `c0.1`；稳定，可作 React key 与下钻路径 */
  id: string
  /** 显示名（由簇内最具代表性的词项生成） */
  label: string
  /** 名称来源词（前几个，供报告与调试） */
  terms: string[]
  /** 起名候选词（按分数降序，兄弟簇重名时依次改用它） */
  candidates: string[]
  /** 内聚度：成员与簇心相似度的均值（0~1，越大越紧） */
  cohesion: number
  /** 成员节点 id */
  memberIds: string[]
  children: LitCluster[]
}

export interface LitClusterTree {
  /** 顶层簇（大节点） */
  roots: LitCluster[]
  /** 全部簇（含子簇）按 id 索引 */
  byId: Map<string, LitCluster>
  /** 父簇 id（顶层为 null），面包屑与「返回」用 */
  parentById: Map<string, string | null>
  /** 节点 id -> 从顶层到所属叶子簇的 id 链（下钻到「某篇文献在哪」用） */
  chainById: Map<string, string[]>
}

export interface LitClusterOptions {
  /** 顶层簇数；不给则按文献数自适应（6~12） */
  topK?: number
  /** 成员数 ≥ 该值的簇才再分小簇 */
  splitMin?: number
  /** 每个小簇的目标规模（篇） */
  subSize?: number
  /** 小簇数量上限 */
  maxSub?: number
  /** 文献数低于该值不做聚类（视图直接铺开节点更清楚） */
  minTotal?: number
  /** 随机种子（固定值 → 可复现） */
  seed?: number
  /** k-means 重启次数：多次取最优，避免落到「一大两碎片」的局部解 */
  restarts?: number
  /**
   * 是否再分一层小簇（默认 true）。
   * 「仅文献」图谱只要一级：点一下大簇就铺开它的成员文献（见 GraphView），
   * 所以那边传 false；离线报告留着两层，用来判断一个大簇内部是不是同质的。
   */
  subLevels?: boolean
}

export const CLUSTER_DEFAULTS = {
  splitMin: 56,
  subSize: 28,
  maxSub: 12,
  minTotal: 60,
  seed: 20261016,
  restarts: 4,
  subLevels: true,
}

/** 词项来源前缀：分类段 / 标签 / 标题词，分开计数（同名不同源不算同一个词） */
const COLL = 'c:'
const TAG = 't:'
const WORD = 'w:'

const COLL_WEIGHT = 1.4
const TAG_WEIGHT = 0.7
const WORD_WEIGHT = 1

/** 命名时分类段的加成：分类名比标题片段更像个「簇名」 */
const NAME_COLL_BOOST = 2.6
/** 命名候选的出现率下限（分类段一对多，摊薄后更低一些） */
const NAME_MIN_SHARE = 0.34
const NAME_MIN_SHARE_COLL = 0.2
/** 全局出现率超过该值的词项不能当簇名：「01_论文库」这种每篇都挂的段没有任何区分度。
 *  idf = log(1 + N/df)，所以 idf < log3 就等价于 df > N/2，不用另外传 df 表。 */
const NAME_MIN_IDF = Math.log(3)

/** 标题词里的高频噪声（与 topicLinks 的口径一致，不复用那份是为了让本模块自足） */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'on', 'in', 'with', 'to', 'by', 'at', 'from',
  'using', 'via', 'based', 'new', 'study', 'analysis', 'approach', 'review', 'research',
  '基于', '研究', '方法', '一种', '以及', '通过',
])

/**
 * 起名时要排除的词：量纲、序号，以及「multi/high/system/transmission」这类到处都是的泛词。
 * （聚类特征里保留它们不影响相似度 —— idf 自然会压低；但拿它们当簇名等于没名字。）
 */
const NAME_NOISE = new Set([
  'gb', 'kb', 'mb', 'tb', 'pb', 'gbps', 'mbps', 'kbps', 'tbps', 'gs', 'db', 'dbm', 'hz', 'khz',
  'mhz', 'ghz', 'thz', 'nm', 'um', 'mm', 'cm', 'km', 'ms', 'us', 'ns', 'ps', 'fs', 'mw', 'kw',
  'mv', 'kv', 'ma', 'bit', 'bits', 'byte', 'bytes', 'pcs', 'i', 'ii', 'iii', 'iv',
  'multi', 'over', 'high', 'low', 'new', 'novel', 'single', 'based', 'using', 'via', 'large',
  'small', 'smart', 'key', 'future', 'current', 'system', 'systems', 'transmission',
  'performance', 'design', 'analysis', 'applications', 'application', 'technology',
  'approach', 'method', 'methods', 'results', 'study', 'efficient', 'improved', 'enhanced',
  'experimental', 'demonstration', 'review', 'survey', 'challenges', 'recent', 'advances',
  'progress', 'towards', 'toward', 'issue', 'letter', 'letters', 'applied', 'physics',
  'science', 'ieee', 'vol', 'pp', 'optical', 'optics', 'wavelength',
])

/** 小于该规模的子簇并进最像的兄弟簇（几篇的簇在下钻界面里只是噪声） */
const MIN_CHILD = 8

const CJK = '\u4e00-\u9fff'

/** 标题切词：英文/数字按非字母数字切开；中文按二元组（单字标题保留单字） */
export function clusterTitleWords(title: string): string[] {
  const out: string[] = []
  for (const part of title.toLowerCase().split(new RegExp(`[^a-z0-9${CJK}]+`))) {
    if (!part) continue
    if (/^[a-z0-9]+$/.test(part)) {
      if (part.length > 1 && !STOP_WORDS.has(part)) out.push(part)
      continue
    }
    const chars = [...part]
    if (chars.length === 1) {
      if (!STOP_WORDS.has(chars[0])) out.push(chars[0])
      continue
    }
    for (let i = 0; i < chars.length - 1; i++) {
      const bigram = chars[i] + chars[i + 1]
      if (!STOP_WORDS.has(bigram)) out.push(bigram)
    }
  }
  return out
}

/** 一篇文献的加权词项（tf，同一词项累加） */
export function clusterTermsOf(note: Note): Map<string, number> {
  const tf = new Map<string, number>()
  const add = (key: string, weight: number) => tf.set(key, (tf.get(key) ?? 0) + weight)
  for (const path of note.literature?.collections ?? []) {
    for (const seg of path.split('/')) {
      const s = seg.trim().toLowerCase()
      if (s) add(COLL + s, COLL_WEIGHT)
    }
  }
  for (const tag of note.tags) {
    if (/^(期刊|年份):/.test(tag)) continue
    const s = tag.trim().toLowerCase()
    if (s) add(TAG + s, TAG_WEIGHT)
  }
  for (const w of clusterTitleWords(note.title)) add(WORD + w, WORD_WEIGHT)
  return tf
}

/** 稀疏向量：词表下标 + 权重（已 L2 归一化） */
interface Vec {
  id: string
  idx: Int32Array
  w: Float64Array
  /** 原始 tf（命名时算「簇内出现率」用，不去重） */
  tf: Map<string, number>
}

/** 固定种子 PRNG（mulberry32）：保证同一份数据每次聚类结果一致 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 建词表 + idf + 归一化稀疏向量（dim = 词表规模，子层聚类必须沿用同一维度） */
function buildVectors(notes: Note[]): { vocab: Map<string, number>; vecs: Vec[]; idf: Map<string, number>; dim: number } {
  const raw = notes.map((n) => ({ id: n.id, tf: clusterTermsOf(n) }))
  const df = new Map<string, number>()
  for (const doc of raw) for (const key of doc.tf.keys()) df.set(key, (df.get(key) ?? 0) + 1)
  const vocab = new Map<string, number>()
  const idf = new Map<string, number>()
  const n = raw.length
  for (const [key, count] of df) {
    vocab.set(key, vocab.size)
    idf.set(key, Math.log(1 + n / count))
  }
  const vecs = raw.map((doc) => {
    const idx: number[] = []
    const val: number[] = []
    let norm = 0
    for (const [key, tf] of doc.tf) {
      const weight = (1 + Math.log(tf)) * (idf.get(key) ?? 0)
      if (weight <= 0) continue
      idx.push(vocab.get(key)!)
      val.push(weight)
      norm += weight * weight
    }
    norm = Math.sqrt(norm)
    const w = new Float64Array(val.length)
    for (let i = 0; i < val.length; i++) w[i] = norm > 0 ? val[i] / norm : 0
    return { id: doc.id, idx: Int32Array.from(idx), w, tf: doc.tf }
  })
  return { vocab, vecs, idf, dim: vocab.size }
}

/** 余弦相似度（文档已归一化，质心每次迭代后也归一化，所以就是点积） */
function dot(v: Vec, centroid: Float64Array): number {
  let s = 0
  for (let i = 0; i < v.idx.length; i++) s += v.w[i] * centroid[v.idx[i]]
  return s
}

interface KMeansResult {
  /** 每个输入向量的簇号（下标与入参一致） */
  assign: Int32Array
  /** 归一化质心 */
  centroids: Float64Array[]
}

/**
 * 球面 k-means（k-means++ 初始化）。`dim` 是词表规模（稀疏下标的上界），
 * 子层聚类沿用顶层那一份词表，所以必须显式传入——不能按下标最大值自己猜。
 * 空簇用「离自己质心最远的点」顶上；迭代到分配不再变化或到达上限。
 */
function kmeans(vecs: Vec[], k: number, seed: number, dim: number, maxIter = 40): KMeansResult {
  const rng = mulberry32(seed)
  const kk = Math.max(1, Math.min(k, vecs.length))
  const centroids: Float64Array[] = []

  // k-means++：第一个质心随机取一篇，之后按 (1 - 最大相似度)² 采样
  centroids.push(normalize(vecs[Math.floor(rng() * vecs.length)], dim))
  while (centroids.length < kk) {
    const weights = vecs.map((v) => {
      let best = -Infinity
      for (const c of centroids) best = Math.max(best, dot(v, c))
      const d = Math.max(0, 1 - best)
      return d * d
    })
    const total = weights.reduce((a, b) => a + b, 0)
    if (total <= 0) {
      centroids.push(normalize(vecs[Math.floor(rng() * vecs.length)], dim))
      continue
    }
    let pick = rng() * total
    let chosen = weights.length - 1
    for (let i = 0; i < weights.length; i++) {
      pick -= weights[i]
      if (pick <= 0) {
        chosen = i
        break
      }
    }
    centroids.push(normalize(vecs[chosen], dim))
  }

  const assign = new Int32Array(vecs.length)
  const sim = new Float64Array(vecs.length)
  let changed = true
  for (let iter = 0; iter < maxIter && changed; iter++) {
    changed = false
    for (let i = 0; i < vecs.length; i++) {
      let best = -Infinity
      let bestK = 0
      for (let c = 0; c < centroids.length; c++) {
        const s = dot(vecs[i], centroids[c])
        if (s > best) {
          best = s
          bestK = c
        }
      }
      if (assign[i] !== bestK) {
        assign[i] = bestK
        changed = true
      }
      sim[i] = best
    }
    // 重算质心
    const sums = centroids.map(() => new Float64Array(dim))
    const counts = new Int32Array(centroids.length)
    for (let i = 0; i < vecs.length; i++) {
      const target = sums[assign[i]]
      for (let j = 0; j < vecs[i].idx.length; j++) target[vecs[i].idx[j]] += vecs[i].w[j]
      counts[assign[i]]++
    }
    for (let c = 0; c < centroids.length; c++) {
      if (counts[c] === 0) continue
      let norm = 0
      for (let d = 0; d < dim; d++) norm += sums[c][d] * sums[c][d]
      norm = Math.sqrt(norm)
      if (norm > 0) for (let d = 0; d < dim; d++) centroids[c][d] = sums[c][d] / norm
    }
    // 空簇：把离自己质心最远的点拎过去当新质心
    for (let c = 0; c < centroids.length; c++) {
      if (counts[c] > 0) continue
      let far = -1
      let farSim = Infinity
      for (let i = 0; i < vecs.length; i++) {
        if (sim[i] < farSim && counts[assign[i]] > 1) {
          farSim = sim[i]
          far = i
        }
      }
      if (far < 0) continue
      counts[assign[far]]--
      assign[far] = c
      sim[far] = -1
      const v = vecs[far]
      const fresh = new Float64Array(dim)
      for (let j = 0; j < v.idx.length; j++) fresh[v.idx[j]] = v.w[j]
      centroids[c] = fresh
    }
  }
  return { assign, centroids }
}

function normalize(v: Vec, dim: number): Float64Array {
  const out = new Float64Array(dim)
  let norm = 0
  for (let i = 0; i < v.idx.length; i++) {
    out[v.idx[i]] = v.w[i]
    norm += v.w[i] * v.w[i]
  }
  norm = Math.sqrt(norm)
  if (norm > 0) for (let d = 0; d < dim; d++) out[d] /= norm
  return out
}

/** 词项显示名：去掉来源前缀 */
function termName(key: string): string {
  return key.slice(2)
}
/** 分类词项排在前面、标题词排后面：簇名优先用分类名 */
function isCollectionTerm(key: string): boolean {
  return key.startsWith(COLL)
}

interface Named {
  label: string
  terms: string[]
  candidates: string[]
}

/**
 * 给一个簇起名：簇内出现率够高、且全局越「专属」越优先（出现率 × idf），分类段另有加成。
 * 两个字项分数接近时合成「A · B」。量纲/序号一类的词不进候选（见 NAME_NOISE）。
 */
function nameCluster(members: Vec[], idf: Map<string, number>): Named {
  const size = members.length
  if (size === 0) return { label: '未命名', terms: [], candidates: [] }
  const count = new Map<string, number>()
  for (const m of members) for (const key of m.tf.keys()) count.set(key, (count.get(key) ?? 0) + 1)
  const scored: { key: string; score: number }[] = []
  for (const [key, hits] of count) {
    const name = termName(key)
    const share = hits / size
    const isColl = isCollectionTerm(key)
    const idfValue = idf.get(key) ?? 0
    // 量纲/序号不进候选；纯数字符号（Zotero 里像 `26 04:04:57` 这种脏分类名）也不要；
    // 全局过半的词项（顶层分类段）也没有区分度
    if (NAME_NOISE.has(name) || /^\d+$/.test(name)) continue
    if (!/[a-z\u4e00-\u9fff]/i.test(name)) continue
    if (idfValue < NAME_MIN_IDF) continue
    const min = isColl ? NAME_MIN_SHARE_COLL : NAME_MIN_SHARE
    if (share < min) continue
    scored.push({ key, score: share * idfValue * (isColl ? NAME_COLL_BOOST : 1) })
  }
  scored.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1))
  if (scored.length === 0) return { label: '其他文献', terms: [], candidates: [] }
  const candidates: string[] = []
  for (const s of scored) {
    const name = termName(s.key)
    if (!candidates.includes(name)) candidates.push(name)
    if (candidates.length >= 8) break
  }
  const top = scored[0]
  const second = scored.find((s) => termName(s.key) !== termName(top.key))
  const label =
    second && second.score >= top.score * 0.55
      ? `${termName(top.key)} · ${termName(second.key)}`
      : termName(top.key)
  return { label: shortLabel(label), terms: candidates.slice(0, 4), candidates }
}

function shortLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 17)}…` : label
}

/**
 * 同一层的兄弟簇不能用同一个词打头（重名或「A · B」对「B · A」都会让人分不清点哪个）：
 * 按规模从大到小分配词，撞词的改用自己下一个候选词。
 */
function uniqueLabels(clusters: LitCluster[]): void {
  const usedTerms = new Set<string>()
  const sorted = [...clusters].sort(
    (a, b) => b.memberIds.length - a.memberIds.length || (a.id < b.id ? -1 : 1),
  )
  for (const c of sorted) {
    const head = c.label.split(' · ').filter((p) => p && p !== '…')
    if (head.length > 0 && !usedTerms.has(head[0])) {
      for (const p of head) usedTerms.add(p)
      continue
    }
    const alt = c.candidates.find((name) => !usedTerms.has(name))
    if (!alt) {
      for (const p of head) usedTerms.add(p)
      continue
    }
    c.label = shortLabel(alt)
    c.terms = [alt, ...c.terms.filter((t) => t !== alt)].slice(0, 4)
    usedTerms.add(alt)
  }
}

function makeCluster(id: string, members: Vec[], idf: Map<string, number>, cohesion: number): LitCluster {
  const named = nameCluster(members, idf)
  return {
    id,
    label: named.label,
    terms: named.terms,
    candidates: named.candidates,
    cohesion,
    memberIds: members.map((m) => m.id),
    children: [],
  }
}

interface Partition {
  /** 每组的成员下标（下标相对传进来的数组） */
  groups: number[][]
  /** 每组的内聚度：成员与该组组心相似度的均值（成员 1 篇时为 1） */
  cohesion: number[]
}

/**
 * 一次划分的质量，越像「一批真正的同类」越高：
 *   Σ 簇规模² × 簇内平均相似度²
 * 等价视角是「簇内点对相似度的总和」（簇内点对有 |c|²/2 对，而「与簇心的相似度」≈√(簇内平均相似度)）。
 * 直接用 Σ 规模×内聚度 是不行的：把两个不相干的簇合并起来也能刷分，
 * 实测会挑出「一大堆 + 一堆碎片」的解。
 */
function partitionScore(part: Partition): number {
  let score = 0
  for (let i = 0; i < part.groups.length; i++) {
    const size = part.groups[i].length
    score += size * size * part.cohesion[i] * part.cohesion[i]
  }
  return score
}

/** 按给定的分组重算组心，同时得到每组的规模与内聚度 */
function partitionOf(members: Vec[], groups: number[][], dim: number): Partition {
  const out: number[][] = []
  const cohesion: number[] = []
  for (const group of groups) {
    if (group.length === 0) continue
    const centroid = new Float64Array(dim)
    for (const i of group) {
      const v = members[i]
      for (let j = 0; j < v.idx.length; j++) centroid[v.idx[j]] += v.w[j]
    }
    let norm = 0
    for (let d = 0; d < dim; d++) norm += centroid[d] * centroid[d]
    norm = Math.sqrt(norm)
    if (norm > 0) for (let d = 0; d < dim; d++) centroid[d] /= norm
    let sum = 0
    for (const i of group) sum += dot(members[i], centroid)
    out.push(group)
    cohesion.push(sum / group.length)
  }
  return { groups: out, cohesion }
}

/**
 * 碎簇清理：规模 < minChild 的组并进「质心最接近」的兄弟组（不丢成员，覆盖不变）。
 * 分不出两个像样的组（数据太同质，k-means 只吐「一大两碎片」）时返回空数组 = 放弃这次划分。
 */
function pruneGroups(members: Vec[], run: KMeansResult, minChild: number): number[][] {
  const groups: number[][] = run.centroids.map(() => [])
  for (let i = 0; i < members.length; i++) groups[run.assign[i]].push(i)
  if (minChild <= 1) return groups.filter((g) => g.length > 0)
  const kept = groups.filter((g) => g.length >= minChild)
  if (kept.length < 2) return []
  for (const g of groups) {
    if (g.length >= minChild) continue
    for (const i of g) {
      let best = kept[0]
      let bestSim = -Infinity
      for (const k of kept) {
        const s = dot(members[i], run.centroids[run.assign[k[0]]])
        if (s > bestSim) {
          bestSim = s
          best = k
        }
      }
      best.push(i)
    }
  }
  return kept
}

/**
 * 跑 restarts 次 k-means，挑「碎片并入邻居之后」总分最高的那次。
 * k-means++ 的初值是按位置取的，单跑一次很容易落到「一大两碎片」的局部解上；
 * 多跑几次按调度后的划分质量选，同一份数据的结果就稳住了（成本是线性的：实测 1900 篇 ~0.2s）。
 */
function bestPartition(
  members: Vec[],
  k: number,
  seed: number,
  dim: number,
  restarts: number,
  minChild: number,
): Partition {
  let best: Partition | null = null
  let bestScore = -Infinity
  for (let r = 0; r < Math.max(1, restarts); r++) {
    const run = kmeans(members, k, seed + r * 104729, dim)
    const groups = pruneGroups(members, run, minChild)
    if (groups.length === 0) continue
    const part = partitionOf(members, groups, dim)
    const score = partitionScore(part)
    if (score > bestScore) {
      bestScore = score
      best = part
    }
  }
  return best ?? { groups: [], cohesion: [] }
}

/**
 * 把成员归到「最近的中心」：返回 成员 id -> 中心 id（中心自己归自己）。
 *
 * 先用**图谱距离**：所有中心同时做多源 BFS，谁先走到就归谁 —— 有边相连的成员按边走近的那个，
 * 和肉眼在图里看到的连边一致。但文献图很稀（本机实测：370 篇的簇里 206 篇根本没有通往任何中心的边），
 * 所以剩下的按**特征相似度**兜底归到最像的中心（还是聚类那套特征，见 clusterTermsOf），
 * 保证每个成员都能染上色，且同一份数据结果稳定（BFS 顺序与中心顺序都固定）。
 *
 * 图谱视图传 `subLevels: false` 只要一级；这里与层级无关，纯按传入的邻接算。
 */
export function assignHubIds(
  members: Note[],
  hubIds: string[],
  adjacency: Map<string, string[]>,
): Map<string, string> {
  const out = new Map<string, string>()
  const inView = new Set(members.map((n) => n.id))
  const seeds = hubIds.filter((id) => inView.has(id))
  const queue: string[] = []
  for (const id of seeds) {
    out.set(id, id)
    queue.push(id)
  }
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]
    const owner = out.get(current)!
    for (const next of adjacency.get(current) ?? []) {
      if (!inView.has(next) || out.has(next)) continue
      out.set(next, owner)
      queue.push(next)
    }
  }
  const rest = members.filter((n) => !out.has(n.id))
  if (rest.length === 0 || seeds.length === 0) return out

  // 兜底：与每个中心的特征相似度取最大（并列时取排在前面的中心）
  const byId = new Map(members.map((n) => [n.id, n]))
  const pool = [...rest, ...seeds.map((id) => byId.get(id)!)]
  const vecs = featureVectors(pool)
  const vecOf = new Map<string, Map<string, number>>()
  pool.forEach((n, i) => vecOf.set(n.id, vecs[i]))
  for (const n of rest) {
    const v = vecOf.get(n.id)!
    let best = seeds[0]
    let bestSim = -Infinity
    for (const hub of seeds) {
      const h = vecOf.get(hub)!
      const [small, large] = v.size <= h.size ? [v, h] : [h, v]
      let sim = 0
      for (const [key, weight] of small) sim += weight * (large.get(key) ?? 0)
      if (sim > bestSim) {
        bestSim = sim
        best = hub
      }
    }
    out.set(n.id, best)
  }
  return out
}

/** 给「兜底归属」用的轻量特征向量：同一批笔记各自 tf-idf 后 L2 归一化（不需要全局词表） */
function featureVectors(notes: Note[]): Map<string, number>[] {
  const tfs = notes.map((n) => clusterTermsOf(n))
  const df = new Map<string, number>()
  for (const tf of tfs) for (const key of tf.keys()) df.set(key, (df.get(key) ?? 0) + 1)
  return tfs.map((tf) => {
    const vec = new Map<string, number>()
    let norm = 0
    for (const [key, count] of tf) {
      const weight = (1 + Math.log(count)) * Math.log(1 + notes.length / (df.get(key) ?? 1))
      if (weight <= 0) continue
      vec.set(key, weight)
      norm += weight * weight
    }
    norm = Math.sqrt(norm)
    if (norm > 0) for (const [key, weight] of vec) vec.set(key, weight / norm)
    return vec
  })
}

/**
 * 文献分层聚类。文献太少（< minTotal）返回 null：视图直接铺开节点更清楚，不需要簇。
 */
export function clusterLiterature(notes: Note[], options: LitClusterOptions = {}): LitClusterTree | null {
  const { splitMin, subSize, maxSub, minTotal, seed, restarts, subLevels } = {
    ...CLUSTER_DEFAULTS,
    ...options,
  }
  if (notes.length < minTotal) return null
  // 先按 id 排序：k-means++ 的初值是按位置取的，输入顺序一变结果就变。
  // 排序后同一份文献（无论从 vault 索引还是按文件名装载）得到同一批簇、同一批簇 id，
  // 这样「下钻路径」「簇颜色」不会因为装载顺序不同而跳到别的簇上。
  const ordered = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const { vecs, idf, dim } = buildVectors(ordered)
  const topK = options.topK ?? Math.min(12, Math.max(6, Math.round(Math.sqrt(ordered.length / 18))))
  const top = bestPartition(vecs, topK, seed, dim, restarts, 1)

  const roots: LitCluster[] = []
  const byId = new Map<string, LitCluster>()
  const parentById = new Map<string, string | null>()
  const chainById = new Map<string, string[]>()

  top.groups.forEach((memberIdx, c) => {
    if (memberIdx.length === 0) return
    const rootId = `c${c}`
    const members = memberIdx.map((i) => vecs[i])
    const root = makeCluster(rootId, members, idf, top.cohesion[c])
    byId.set(rootId, root)
    parentById.set(rootId, null)
    for (const m of members) chainById.set(m.id, [rootId])

    if (subLevels && members.length >= splitMin) {
      const kSub = Math.min(maxSub, Math.max(2, Math.round(members.length / subSize)))
      const sub = bestPartition(members, kSub, seed + 7919 * (c + 1), dim, restarts, MIN_CHILD)
      // 分不出两个像样的子簇就不分层：下钻界面里「与预 1 篇」这种节点纯属噪声，进去还是同一批文献
      if (sub.groups.length >= 2) {
        sub.groups.forEach((idx, s) => {
          const subMembers = idx.map((i) => members[i])
          const childId = `${rootId}.${s}`
          const child = makeCluster(childId, subMembers, idf, sub.cohesion[s])
          byId.set(childId, child)
          parentById.set(childId, rootId)
          root.children.push(child)
          for (const m of subMembers) chainById.set(m.id, [rootId, childId])
        })
        uniqueLabels(root.children)
      }
    }
    roots.push(root)
  })

  // 顶层按规模降序：大节点排前面，报告与下钻入口都更好读（id 仍是聚类时的编号，不随排序变）
  uniqueLabels(roots)
  roots.sort((a, b) => b.memberIds.length - a.memberIds.length || (a.id < b.id ? -1 : 1))
  for (const r of roots) r.children.sort((a, b) => b.memberIds.length - a.memberIds.length || (a.id < b.id ? -1 : 1))
  return { roots, byId, parentById, chainById }
}
