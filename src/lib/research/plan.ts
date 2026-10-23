/**
 * 问题规划：把模型输出 / 题库候选合成「这一轮问的 3 道题」。
 * 纯逻辑模块：不碰 IO，所有函数可单测。
 *
 * 去重规则（第一轮的核心承诺）：
 * - 已答（answered）的题：任何一轮都不允许再出现（换措辞也不行 —— 按签名判）。
 * - 已跳过（skipped）的题：同一版本正文内不再出现；正文大改后允许再来（调用方传 excludeSkipped 控制）。
 * - 同一轮之内：签名互不相同，也不与历史 pending/later 重复。
 */
import { questionSignature, type ResearchCategory, type ResearchQuestion } from './bank'
import { answeredSignatures, contentHashOf, skippedSignatures, type ResearchSessionFile } from './session'

export interface PlannedQuestion {
  question: string
  why: string
  category: ResearchCategory
  source: 'bank' | 'ai'
  bankId?: string
}

export interface PlanOptions {
  /** 这一轮最多问几道题（产品定死 3 道） */
  limit: number
  /** true = 连跳过的题也排除（正文没变重新生成时）；false = 允许跳过的题重出（正文大改后） */
  excludeSkipped: boolean
}

/**
 * 合成一轮问题。aiQuestions 为模型产出（已校验、按模型给的优先级排序）；
 * 模型一道都没给时退回题库候选。返回的题目保证签名互不相同且不撞历史。
 */
export function planQuestions(
  aiQuestions: PlannedQuestion[] | null,
  bankCandidates: ResearchQuestion[],
  session: ResearchSessionFile,
  opts: PlanOptions,
): PlannedQuestion[] {
  const exclude = answeredSignatures(session)
  if (opts.excludeSkipped) for (const s of skippedSignatures(session)) exclude.add(s)
  // 还挂着的（pending/later）题不重复出；answered/skipped 由上面的集合按规则控制
  for (const it of session.items) {
    if (it.status === 'pending' || it.status === 'later') exclude.add(it.signature)
  }

  const seen = new Set<string>()
  const picked: PlannedQuestion[] = []
  const tryPick = (list: PlannedQuestion[]) => {
    for (const q of list) {
      if (picked.length >= opts.limit) return
      const sig = questionSignature(q.question)
      if (!sig || seen.has(sig) || exclude.has(sig)) continue
      seen.add(sig)
      picked.push(q)
    }
  }
  tryPick(aiQuestions ?? [])
  if (picked.length < opts.limit) {
    tryPick(
      bankCandidates.map((q) => ({
        question: q.text,
        why: q.why,
        category: q.category,
        source: 'bank' as const,
        bankId: q.id,
      })),
    )
  }
  return picked
}

/**
 * 正文版本判断：距离上次生成，正文是否发生了「重大修改」。
 * 第一轮用简单口径 —— 正文哈希变了就算重大（追问是轻量交互，宁多勿漏）。
 */
export function contentChanged(session: ResearchSessionFile, content: string): boolean {
  return session.contentHash !== contentHashOf(content)
}
