/**
 * 研究问题库：本地、可编辑的通用研究问题集合（第一轮的核心数据之一）。
 * 纯逻辑模块：不碰 IO，所有函数可单测。
 *
 * 进入长期库的只有三个来源：内置种子（builtin）、用户手动新增（manual）、
 * 用户主动收藏 AI 生成的问题（ai-favorite）。AI 生成的问题绝不自动入库。
 */
import { z } from 'zod'
import type { NoteType } from '@/types/note'

export const RESEARCH_CATEGORIES = [
  'concept',
  'evidence',
  'method',
  'boundary',
  'connection',
  'action',
] as const
export type ResearchCategory = (typeof RESEARCH_CATEGORIES)[number]

export const CATEGORY_LABEL: Record<ResearchCategory, string> = {
  concept: '概念澄清',
  evidence: '证据核查',
  method: '方法审查',
  boundary: '边界与反例',
  connection: '知识连接',
  action: '下一步行动',
}

export const researchQuestionSchema = z.object({
  id: z.string().min(1).max(120),
  text: z.string().min(4).max(500),
  why: z.string().max(300).default(''),
  category: z.enum(RESEARCH_CATEGORIES),
  /** null = 全部笔记类型适用 */
  noteTypes: z.array(z.enum(['person', 'task', 'skill', 'question', 'literature', 'summary', 'other'] as [NoteType, ...NoteType[]])).nullable().default(null),
  /** 适用主题（空 = 不限） */
  topics: z.array(z.string().min(1).max(60)).max(20).default([]),
  /** 适用标签（空 = 不限） */
  tags: z.array(z.string().min(1).max(100)).max(20).default([]),
  source: z.enum(['builtin', 'ai-favorite', 'manual']),
  usedCount: z.number().int().min(0).default(0),
  answeredCount: z.number().int().min(0).default(0),
  favoriteCount: z.number().int().min(0).default(0),
  skippedCount: z.number().int().min(0).default(0),
  lastUsedAt: z.number().int().min(0).nullable().default(null),
  enabled: z.boolean().default(true),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
})
export type ResearchQuestion = z.infer<typeof researchQuestionSchema>

export const RESEARCH_BANK_FORMAT = 'kaust-kg-research-bank'
export const researchBankFileSchema = z.object({
  format: z.literal(RESEARCH_BANK_FORMAT),
  version: z.literal(1),
  questions: z.array(researchQuestionSchema).max(2000),
})
export type ResearchBankFile = z.infer<typeof researchBankFileSchema>

/** 问题签名：去空白、去标点、小写 —— 判断「同一道题」只看签名，不看措辞细节 */
export function questionSignature(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 200)
}

export interface QuestionContext {
  noteType: NoteType
  topic: string
  tags: string[]
  now: number
}

function daysBetween(a: number, b: number): number {
  return Math.abs(b - a) / 86_400_000
}

/**
 * 选题优先级：收藏/被答加权，被跳过减分；最近问过的降权（别老问同一道），
 * 从没用过的新题给机会；与当前笔记类型/主题/标签匹配的加权。
 * 分数只用于排序，不设门槛 —— 冷启动时题库全不匹配也要有题可问。
 */
export function bankScore(q: ResearchQuestion, ctx: QuestionContext): number {
  if (!q.enabled) return Number.NEGATIVE_INFINITY
  let score = q.favoriteCount * 3 + q.answeredCount * 2 - q.skippedCount * 2 + Math.min(q.usedCount, 10) * 0.2
  if (q.lastUsedAt) {
    // 近 10 天问过的最多扣 10 分，随时间衰减回 0
    score -= Math.max(0, 10 - daysBetween(q.lastUsedAt, ctx.now))
  } else {
    score += 5 // 从没用过的新题给机会
  }
  if (q.noteTypes && q.noteTypes.length) {
    score += q.noteTypes.includes(ctx.noteType) ? 4 : -2
  }
  const topic = ctx.topic.trim()
  if (q.topics.length && topic) score += q.topics.includes(topic) ? 3 : -1
  const tagSet = new Set(ctx.tags)
  if (q.tags.length) score += q.tags.filter((t) => tagSet.has(t)).length * 2
  return score
}

/** 从题库里挑 n 道候选（供给模型改写，或模型失败时的兜底） */
export function pickBankCandidates(
  bank: ResearchQuestion[],
  ctx: QuestionContext,
  n: number,
  excludeSignatures: ReadonlySet<string> = new Set(),
): ResearchQuestion[] {
  return bank
    .filter((q) => {
      if (!q.enabled) return false
      const sig = questionSignature(q.text)
      return sig && !excludeSignatures.has(sig)
    })
    .map((q) => ({ q, score: bankScore(q, ctx) }))
    .sort((a, b) => b.score - a.score || a.q.id.localeCompare(b.q.id))
    .slice(0, Math.max(0, n))
    .map((e) => e.q)
}

/** 应用事件计数：used（被拿去问）/answered/skipped/favorite 都走这里 */
export function touchQuestion(
  bank: ResearchQuestion[],
  id: string,
  event: 'used' | 'answered' | 'skipped' | 'favorite',
  now: number,
): ResearchQuestion[] {
  return bank.map((q) => {
    if (q.id !== id) return q
    const next = { ...q, updatedAt: now }
    if (event === 'used') {
      next.usedCount = q.usedCount + 1
      next.lastUsedAt = now
    } else if (event === 'answered') next.answeredCount = q.answeredCount + 1
    else if (event === 'skipped') next.skippedCount = q.skippedCount + 1
    else next.favoriteCount = q.favoriteCount + 1
    return next
  })
}

let builtinSeq = 0
function builtin(text: string, why: string, category: ResearchCategory, noteTypes: NoteType[] | null = null): ResearchQuestion {
  builtinSeq += 1
  const now = 1_700_000_000_000 // 固定时间：种子库不随当前时间漂移，测试可断言
  return researchQuestionSchema.parse({
    id: `builtin-${builtinSeq}`,
    text,
    why,
    category,
    noteTypes,
    topics: [],
    tags: [],
    source: 'builtin',
    createdAt: now,
    updatedAt: now,
  })
}

/** 内置种子：每类一道。通用题干由模型结合笔记内容改写后才会问给用户 */
export function defaultBank(): ResearchBankFile {
  builtinSeq = 0
  return {
    format: RESEARCH_BANK_FORMAT,
    version: 1,
    questions: [
      builtin('关键术语、变量或研究范围的定义在笔记里是否明确？', '定义不清会让后续所有推理都建立在不稳的地基上。', 'concept'),
      builtin('笔记里的核心结论有没有数据、引文或实验支撑？ weakest 的证据是哪一条？', '把「我以为」和「有证据」分开，是笔记可靠性的分水岭。', 'evidence'),
      builtin('方法部分的对照条件、参数设置或样本规模是否记录完整，别人能否据此复现？', '方法细节缺失会让结论无法复核，也挡住未来的自己。', 'method', ['literature', 'summary']),
      builtin('这个结论在什么条件下会不成立？有没有已知的反例或边界情形？', '写下适用边界，比重复结论本身更有研究价值。', 'boundary'),
      builtin('这篇笔记与库里哪些已有笔记或研究问题相互支持、相互矛盾或可以合并？', '孤立的知识点价值有限，连起来的才是知识图谱。', 'connection'),
      builtin('基于当前内容，最值得马上补做的一个实验或一篇阅读是什么？', '把笔记转成下一步行动，研究才会往前走。', 'action'),
    ],
  }
}
