/**
 * 图谱数据模型：节点度数、双链边、档位准入。
 * 纯函数、不依赖 React，组件与自测共用，方便直接验证。
 */
import type { Note } from '@/types/note'
import { extractLinks } from '@/types/note'
import type { TopicEdge } from '@/lib/topicLinks'

/** 文献显示档位（决定哪些文献进入图谱） */
export type GraphTier = 'no-literature' | 'linked' | 'all' | 'literature-only'

/** 标题（小写）-> 笔记 索引，用于把 [[双链]] 解析成目标节点 */
export function buildTitleIndex(notes: Note[]): Map<string, Note> {
  const map = new Map<string, Note>()
  for (const n of notes) map.set(n.title.toLowerCase(), n)
  return map
}

/**
 * 文献「与普通笔记（非文献）的 [[双链]]」度数。
 * linked（仅有关联）档的唯一准入依据：文献间话题边、文献↔文献双链都不计入。
 */
export function computeNoteDegrees(notes: Note[], titleIndex: Map<string, Note>): Map<string, number> {
  const noteDegreeById = new Map<string, number>()
  const bump = (id: string) => noteDegreeById.set(id, (noteDegreeById.get(id) ?? 0) + 1)
  for (const n of notes) {
    for (const t of extractLinks(n.content)) {
      const o = titleIndex.get(t.toLowerCase())
      if (!o || o.id === n.id) continue
      const nIsLit = n.type === 'literature'
      const oIsLit = o.type === 'literature'
      // 只有一端是文献、另一端是普通笔记时，才给该文献计一条「与笔记的关联」
      if (nIsLit !== oIsLit) bump(nIsLit ? n.id : o.id)
    }
  }
  return noteDegreeById
}

/**
 * 全量度数：[[双链]] + 文献间话题边。
 * 只用于视觉表现（疏布模式节点半径 / 枢纽判定 / 螺旋落位），不用于档位准入。
 */
export function computeDegreeById(
  notes: Note[],
  titleIndex: Map<string, Note>,
  topicEdges: TopicEdge[],
): Map<string, number> {
  const degreeById = new Map<string, number>()
  const bump = (id: string) => degreeById.set(id, (degreeById.get(id) ?? 0) + 1)
  for (const n of notes) {
    for (const t of extractLinks(n.content)) {
      const o = titleIndex.get(t.toLowerCase())
      if (!o || o.id === n.id) continue
      bump(n.id)
      bump(o.id)
    }
  }
  for (const e of topicEdges) {
    bump(e.a)
    bump(e.b)
  }
  return degreeById
}

export interface GraphEdge {
  source: string
  target: string
}

/** 全量 [[双链]] 无向边：解析目标、去自环、按节点 id 去重（同一对只保留一条） */
export function buildWikilinkEdges(notes: Note[], titleIndex: Map<string, Note>): GraphEdge[] {
  const edgeKeys = new Set<string>()
  const edges: GraphEdge[] = []
  for (const n of notes) {
    for (const t of extractLinks(n.content)) {
      const o = titleIndex.get(t.toLowerCase())
      if (!o || o.id === n.id) continue
      const key = n.id < o.id ? `${n.id}|${o.id}` : `${o.id}|${n.id}`
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)
      edges.push({ source: n.id, target: o.id })
    }
  }
  return edges
}

/**
 * 选出「需要构建话题边」的文献：只包含该档位下真正会显示的文献。
 * 话题边只在两端都显示时才保留，对隐藏文献做 O(n²) 纯浪费——
 * linked 档因此只对少量「与笔记有关联」的文献计算，而不是全部约 2000 篇。
 */
export function selectTopicLiterature(
  allLiterature: Note[],
  noteDegreeById: Map<string, number>,
  tier: GraphTier,
  threshold: number,
): Note[] {
  if (tier === 'no-literature') return []
  if (tier === 'linked') {
    return allLiterature.filter((n) => literatureLinkedVisible(noteDegreeById.get(n.id), threshold))
  }
  return allLiterature // all / literature-only
}

/** linked 档文献是否显示：与普通笔记的双链数 ≥ threshold 才保留 */
export function literatureLinkedVisible(noteDegree: number | undefined, threshold: number): boolean {
  return (noteDegree ?? 0) >= threshold
}
