/**
 * 话题相关度边：让文献之间按「相关性」自组织成簇。
 * 两种信号合成（都是纯本地计算，不写进 md）：
 *
 * - 共现边（强）：两篇文献的 Zotero 分类（collections）Jaccard ≥ 阈值 → 边，权重 = Jaccard。
 *   共享的分类越「专属」（小圈子），权重越高。
 * - 文本相似边（弱）：标题分词（英文按词、CJK 按单字）后 overlap = |∩|/min(|A|,|B|)，
 *   共享词 ≥2 且 overlap ≥ 阈值 → 候选边。
 *
 * 防爆炸：每个节点最多保留 maxPerNode 条话题边（按权重排序），全局上限 MAX_TOTAL。
 * 度数大的 hub 不会让图谱变成毛球。
 */
import type { Note } from '@/types/note'

export interface TopicEdge {
  a: string
  b: string
  /** 0~1，越大越相关 */
  weight: number
  kind: 'collection' | 'title'
}

export interface TopicLinkOptions {
  /** 分类 Jaccard 阈值（默认 1/3） */
  collectionJaccard?: number
  /** 标题 overlap 阈值（默认 0.5） */
  titleOverlap?: number
  /** 每篇文献最多保留的话题边数（默认 8） */
  maxPerNode?: number
  /** 全局话题边硬上限（默认 40000） */
  maxTotal?: number
}

export const TOPIC_DEFAULTS = {
  collectionJaccard: 1 / 3,
  titleOverlap: 0.5,
  maxPerNode: 8,
  maxTotal: 40_000,
}

/** 标题分词：小写英文/数字按非字母数字切开；中日韩单字成词；去掉高频停用词 */
export function tokenize(title: string): string[] {
  const out: string[] = []
  for (const part of title.toLowerCase().split(/[^a-z0-9一-鿿]+/)) {
    if (!part) continue
    if (/^[a-z0-9]+$/.test(part)) {
      if (part.length > 1 && !STOP_WORDS.has(part)) out.push(part)
    } else {
      for (const ch of part) {
        if (!STOP_WORDS.has(ch)) out.push(ch)
      }
    }
  }
  return out
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'on', 'in', 'with', 'to', 'by', 'at', 'from',
  'using', 'via', 'based', 'new', 'study', 'analysis', 'approach', 'review', 'research',
  '的', '与', '及', '和', '在', '基于', '研究', '方法', '一种', '以及', '通过', '对', '用',
])

/** 计算一篇文献的话题特征（边构建前先算好，避免重复分词） */
export function litProfile(n: Note): { collections: Set<string>; tokens: Set<string> } {
  return {
    collections: new Set(n.literature?.collections ?? []),
    tokens: new Set(tokenize(n.title)),
  }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

function overlap(a: Set<string>, b: Set<string>): number {
  const min = Math.min(a.size, b.size)
  if (min === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / min
}

/**
 * 构建文献间话题边。O(n²) 两两比对，n≈2300 时约 100ms 级，
 * 调用方按 (id|updatedAt|collections) 签名缓存。
 */
export function buildTopicEdges(
  literature: Note[],
  options: TopicLinkOptions = {},
): TopicEdge[] {
  const { collectionJaccard, titleOverlap, maxPerNode, maxTotal } = { ...TOPIC_DEFAULTS, ...options }
  const profiles = literature.map((n) => ({ id: n.id, ...litProfile(n) }))

  // 每个节点的候选边按权重收集，最后统一截断到 maxPerNode
  const cand = new Map<string, { other: string; weight: number; kind: TopicEdge['kind'] }[]>()
  const push = (a: string, b: string, weight: number, kind: TopicEdge['kind']) => {
    if (!cand.has(a)) cand.set(a, [])
    cand.get(a)!.push({ other: b, weight, kind })
  }

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i]
    for (let j = i + 1; j < profiles.length; j++) {
      const q = profiles[j]
      const cj = jaccard(p.collections, q.collections)
      if (cj >= collectionJaccard) {
        push(p.id, q.id, cj, 'collection')
        push(q.id, p.id, cj, 'collection')
        continue // 已有强共现，不再叠文本边
      }
      const to = overlap(p.tokens, q.tokens)
      if (to >= titleOverlap) {
        let shared = 0
        for (const t of p.tokens) if (q.tokens.has(t)) shared++
        if (shared >= 2) {
          push(p.id, q.id, to * 0.8, 'title')
          push(q.id, p.id, to * 0.8, 'title')
        }
      }
    }
  }

  // 每个节点只保留自己的 top-maxPerNode；边必须双向互相选中才成立
  // （否则热门节点的度数会被「别人选中它」无限堆高，hub 变毛球）
  const keptBy = new Map<string, Map<string, { weight: number; kind: TopicEdge['kind'] }>>()
  for (const [id, list] of cand) {
    list.sort((x, y) => y.weight - x.weight)
    keptBy.set(
      id,
      new Map(list.slice(0, maxPerNode).map((c) => [c.other, { weight: c.weight, kind: c.kind }])),
    )
  }

  const edges = new Map<string, TopicEdge>()
  for (const [id, partners] of keptBy) {
    for (const [other, meta] of partners) {
      // 只从字典序小的一侧落边，避免重复
      if (id >= other) continue
      if (!keptBy.get(other)?.has(id)) continue
      if (edges.size >= maxTotal) break
      edges.set(`${id}|${other}`, { a: id, b: other, weight: meta.weight, kind: meta.kind })
    }
  }
  return [...edges.values()]
}
