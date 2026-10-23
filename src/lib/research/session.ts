/**
 * 单篇笔记的追问记录：问过什么、答了什么、状态如何、正文改到哪一版。
 * 纯逻辑模块：不碰 IO，所有函数可单测。
 *
 * 关键不变量：
 * - 已答（answered）的问题绝不换措辞重新追问：按签名排除（见 plan.ts）。
 * - contentHash 记录最近一次生成时的正文版本；正文大改后允许重新检查，
 *   但「重新检查」同样不能重复已解决的问题。
 * - 回答只是草稿（draft），inserted 标记是否已经过用户确认插进正文。
 */
import { z } from 'zod'
import { RESEARCH_CATEGORIES, questionSignature } from './bank'

export const RESEARCH_SESSION_FORMAT = 'kaust-kg-research-session'

export const sessionItemSchema = z.object({
  id: z.string().min(1).max(120),
  round: z.number().int().min(1),
  question: z.string().min(4).max(500),
  why: z.string().max(300).default(''),
  category: z.enum(RESEARCH_CATEGORIES),
  source: z.enum(['bank', 'ai']),
  bankId: z.string().max(120).optional(),
  signature: z.string().min(1).max(200),
  status: z.enum(['pending', 'answered', 'skipped', 'later']),
  /** 回答草稿（用户手改，绝不自动改正文） */
  draft: z.string().max(50_000).default(''),
  /** 是否已经用户确认插入正文 */
  inserted: z.boolean().default(false),
  /** 生成时实际使用的模型来源（界面要显示） */
  model: z.string().max(120).default(''),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
})
export type ResearchSessionItem = z.infer<typeof sessionItemSchema>

export const researchSessionFileSchema = z.object({
  format: z.literal(RESEARCH_SESSION_FORMAT),
  version: z.literal(1),
  noteId: z.string().min(1).max(200),
  /** 最近一次生成时的正文版本（djb2 hex） */
  contentHash: z.string().max(32),
  generatedAt: z.number().int().min(0),
  roundCount: z.number().int().min(0),
  items: z.array(sessionItemSchema).max(500),
})
export type ResearchSessionFile = z.infer<typeof researchSessionFileSchema>

/** djb2 字符串散列（十六进制）—— 只用于「正文变没变」的版本判断，不用于安全场景 */
export function contentHashOf(content: string): string {
  let h1 = 5381
  let h2 = 52711
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i)
    h1 = ((h1 * 33) ^ c) >>> 0
    h2 = ((h2 * 31) ^ c) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

export function newSession(noteId: string, content: string, now: number): ResearchSessionFile {
  return {
    format: RESEARCH_SESSION_FORMAT,
    version: 1,
    noteId,
    contentHash: contentHashOf(content),
    generatedAt: now,
    roundCount: 0,
    items: [],
  }
}

/** 追加一轮问题（round + 1）；调用方负责先按签名去重 */
export function appendRound(
  session: ResearchSessionFile,
  round: Array<{
    question: string
    why: string
    category: ResearchSessionItem['category']
    source: 'bank' | 'ai'
    bankId?: string
    model: string
  }>,
  now: number,
  idGen: () => string,
): ResearchSessionFile {
  const nextRound = session.roundCount + 1
  const items = round.map((r) =>
    sessionItemSchema.parse({
      id: idGen(),
      round: nextRound,
      question: r.question,
      why: r.why,
      category: r.category,
      source: r.source,
      bankId: r.bankId,
      signature: questionSignature(r.question),
      status: 'pending',
      draft: '',
      inserted: false,
      model: r.model,
      createdAt: now,
      updatedAt: now,
    }),
  )
  return { ...session, roundCount: nextRound, generatedAt: now, items: [...session.items, ...items] }
}

export type SessionPatch = Partial<Pick<ResearchSessionItem, 'status' | 'draft' | 'inserted'>>

/** 状态迁移：pending/later → answered | skipped | later；skipped → later（改变主意） */
const ALLOWED: Record<ResearchSessionItem['status'], ResearchSessionItem['status'][]> = {
  pending: ['answered', 'skipped', 'later'],
  later: ['answered', 'skipped', 'pending'],
  skipped: ['later'],
  answered: [], // 已答是终态；改回答直接改 draft
}

export function patchItem(
  session: ResearchSessionFile,
  itemId: string,
  patch: SessionPatch,
  now: number,
): ResearchSessionFile {
  const items = session.items.map((it) => {
    if (it.id !== itemId) return it
    const next = { ...it, updatedAt: now }
    if (patch.status && patch.status !== it.status) {
      if (!ALLOWED[it.status].includes(patch.status)) {
        throw new Error(`状态不能从「${it.status}」变为「${patch.status}」`)
      }
      next.status = patch.status
    }
    if (patch.draft !== undefined) next.draft = patch.draft
    if (patch.inserted !== undefined) next.inserted = patch.inserted
    return next
  })
  return { ...session, items }
}

/** 已解决问题的签名集合 —— 重新生成时绝不允许这些题再出现 */
export function answeredSignatures(session: ResearchSessionFile): Set<string> {
  return new Set(session.items.filter((it) => it.status === 'answered').map((it) => it.signature))
}

/** 用户明确跳过的签名 —— 同版本正文内不再追问；正文大改（contentHash 变）后可再来 */
export function skippedSignatures(session: ResearchSessionFile): Set<string> {
  return new Set(session.items.filter((it) => it.status === 'skipped').map((it) => it.signature))
}

/** 所有问过的签名（含 pending/later）—— 一轮之内不重复出题 */
export function askedSignatures(session: ResearchSessionFile): Set<string> {
  return new Set(session.items.map((it) => it.signature))
}

/** 某一轮的题目（roundCount = n 的那一轮） */
export function roundItems(session: ResearchSessionFile, round: number): ResearchSessionItem[] {
  return session.items.filter((it) => it.round === round)
}

/** 未解决的题目：pending + later（按轮次、时间排序） */
export function unresolvedItems(session: ResearchSessionFile): ResearchSessionItem[] {
  return session.items
    .filter((it) => it.status === 'pending' || it.status === 'later')
    .sort((a, b) => b.round - a.round || b.createdAt - a.createdAt)
}
