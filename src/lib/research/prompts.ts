/**
 * 研究追问的 prompt 构造与模型输出校验。
 * 纯逻辑模块：不碰 IO，所有函数可单测。
 *
 * 隐私边界（第一轮的硬约束）：
 * - 生成追问只发送：当前笔记的标题/类型/主题/标签 + 正文截断 + 题库候选题干。
 * - 云端「深入分析」只发送：当前笔记、当前问答草稿、用户明确勾选的相关笔记。
 *   绝不发送整个笔记库 / 整个题库 / 历史对话。
 */
import { z } from 'zod'
import type { Note } from '@/types/note'
import { CATEGORY_LABEL, RESEARCH_CATEGORIES, type ResearchQuestion } from './bank'
import type { ResearchSessionItem } from './session'
import type { PlannedQuestion } from './plan'

/** 从模型输出里抠 JSON：优先 ```json 代码块，否则取第一个 { 到最后一个 }（与 aiOps.extractJsonText 同口径） */
function extractJsonText(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return ''
  return raw.slice(start, end + 1)
}

/** 正文截断上限：本地小模型上下文有限，追问也只需要领会大意 */
export const NOTE_CONTENT_LIMIT = 8000

export function truncateNoteContent(content: string): { text: string; truncated: boolean } {
  if (content.length <= NOTE_CONTENT_LIMIT) return { text: content, truncated: false }
  const head = content.slice(0, NOTE_CONTENT_LIMIT / 2)
  const tail = content.slice(content.length - NOTE_CONTENT_LIMIT / 2)
  return { text: `${head}\n\n…（中间省略 ${content.length - NOTE_CONTENT_LIMIT} 字）…\n\n${tail}`, truncated: true }
}

export interface GenerationInput {
  note: Note
  topic: string
  bankCandidates: ResearchQuestion[]
  /** 已答/跳过/问过的题干签名 —— 模型不许再出这些题（即便换措辞） */
  excludeTexts: string[]
}

export function buildGenerationPrompt(input: GenerationInput): { system: string; prompt: string } {
  const { text, truncated } = truncateNoteContent(input.note.content)
  const categoryDesc = RESEARCH_CATEGORIES.map((c) => `- ${c} = ${CATEGORY_LABEL[c]}`).join('\n')
  const bankBlock = input.bankCandidates.length
    ? input.bankCandidates
        .map((q, i) => `${i + 1}. [${q.category}] ${q.text}${q.why ? `（价值：${q.why}）` : ''}`)
        .join('\n')
    : '（题库暂无可候选的问题）'
  const excludeBlock = input.excludeTexts.length
    ? input.excludeTexts.map((t) => `- ${t}`).join('\n')
    : '（无）'

  const system = `你是研究笔记的追问助手。用户刚保存了一篇笔记，你要提出恰好 3 个有内容针对性的研究问题，帮助用户把笔记做得更扎实。

硬要求：
- 每个问题必须引用笔记里的具体对象、结论、方法或明显缺口，禁止泛泛提问（例如禁止「这篇笔记讲了什么」「作者结论可靠吗」这类不用读笔记也能问的问题）。
- 每个问题附一句「为什么值得问」（why），点出它对研究的具体价值。
- 问题类型（category）必须是给定枚举之一。
- 可以借鉴题库候选的提问角度，但必须结合笔记内容具体化改写，不得照抄题干。
- 绝不要提出「排除清单」里已问过/已解决的问题（包括换措辞的同义问题）。
- 3 个问题里把最值得思考的一道放在第一位。
- 只输出 JSON，不要输出任何其他文字。`

  const prompt = `笔记信息：
- 标题：${input.note.title}
- 类型：${input.note.type}
- 主题：${input.topic || '（未设）'}
- 标签：${input.note.tags.join('、') || '（无）'}
${truncated ? '- 正文（已截断）\n' : ''}${text}

问题类型枚举：
${categoryDesc}

题库候选（供借鉴角度，不要照抄）：
${bankBlock}

排除清单（这些题已经问过或已解决，绝不要再出）：
${excludeBlock}

请输出 JSON（不要 markdown 代码块之外的任何文字）：
{"questions":[{"category":"<枚举之一>","question":"<具体问题，10~300字>","why":"<一句话说明价值>"},…共3个…]}`

  return { system, prompt }
}

const generationItemSchema = z.object({
  category: z.enum(RESEARCH_CATEGORIES),
  question: z.string().min(10).max(300),
  why: z.string().min(2).max(200),
})

export type ParseGenerationResult =
  | { ok: true; questions: PlannedQuestion[] }
  | { ok: false; error: string; rawPreview: string }

/**
 * 解析模型输出：抠 JSON → 逐项校验。本地小模型常会多吐一两项不合法的
 * （比如编一个不存在的类别），逐项丢弃而不是整批拒绝；全部不合法才算失败。
 */
export function parseGenerationOutput(raw: string): ParseGenerationResult {
  const text = extractJsonText(raw)
  if (!text) return { ok: false, error: '模型输出里没有找到 JSON', rawPreview: raw.slice(0, 500) }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`, rawPreview: raw.slice(0, 500) }
  }
  const list =
    json && typeof json === 'object' && Array.isArray((json as { questions?: unknown }).questions)
      ? ((json as { questions: unknown[] }).questions ?? []).slice(0, 8)
      : null
  if (!list) {
    return { ok: false, error: '输出格式校验失败：缺少 questions 数组', rawPreview: raw.slice(0, 500) }
  }
  const questions: PlannedQuestion[] = []
  for (const item of list) {
    const parsed = generationItemSchema.safeParse(item)
    if (!parsed.success) continue
    questions.push({
      question: parsed.data.question.trim(),
      why: parsed.data.why.trim(),
      category: parsed.data.category,
      source: 'ai',
    })
  }
  if (!questions.length) {
    return { ok: false, error: '模型没有给出任何可用的问题（逐项校验均未通过）', rawPreview: raw.slice(0, 500) }
  }
  return { ok: true, questions }
}

export interface DeepDiveInput {
  note: Note
  /** 用户已答/想深入的问题与草稿 */
  items: ResearchSessionItem[]
  /** 用户明确勾选的相关笔记（默认空） */
  relatedNotes: Note[]
  task: string
}

/** 云端深入分析：材料清单完全由调用方显式给定 */
export function buildDeepDivePrompt(input: DeepDiveInput): { system: string; prompt: string } {
  const { text } = truncateNoteContent(input.note.content)
  const qaBlock = input.items
    .map((it) => `Q（${CATEGORY_LABEL[it.category]}）：${it.question}\nA（草稿）：${it.draft || '（未作答）'}`)
    .join('\n\n')
  const relatedBlock = input.relatedNotes
    .map((n) => {
      const t = truncateNoteContent(n.content)
      return `### ${n.title}\n${t.text}`
    })
    .join('\n\n')
  const system = '你是研究综述助手。基于用户给定的一篇笔记和若干问答，做深入分析：跨材料比较、复杂逻辑审查、指出论证漏洞与值得深挖的方向。只依据给定材料，不要臆造引用。'
  const prompt = `任务：${input.task}

## 当前笔记：${input.note.title}
${text}

## 研究追问与回答草稿
${qaBlock || '（无）'}
${relatedBlock ? `\n## 用户选择的相关笔记\n${relatedBlock}\n` : ''}
请用 Markdown 输出分析（可用 ## 小节）。`
  return { system, prompt }
}

/** 把已答问题与草稿排成待插入正文的 Markdown 段落（实现移到 insert.ts：
 *  本模块引 zod，而 NoteEditor 静态引用这里会把 zod 拉进编辑器场景） */
export { buildInsertSection, appendToContent } from './insert'

