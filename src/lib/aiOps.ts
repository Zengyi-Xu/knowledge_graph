/**
 * AI 产出的 operations JSON：schema（zod）、容错解析、与本地笔记的对照落地计划。
 * 模型只是提案者：校验不过整批拒绝，解析不到目标笔记的单条标记为错误，绝不静默丢弃。
 *
 * 三类操作：
 * - create：新建笔记（summary 汇总 / literature 文献 / other 等）
 * - update：按 id 或标题定位，改 content（整篇替换，AI 写作场景）
 * - retag：按 id 或标题定位，加/减标签（不动正文）
 */
import { z } from 'zod'
import type { Note, NoteType } from '@/types/note'

export const NOTE_TYPES: NoteType[] = ['person', 'task', 'skill', 'question', 'literature', 'summary', 'other']

const noteTypeSchema = z.enum(NOTE_TYPES as [NoteType, ...NoteType[]])

const createOpSchema = z.object({
  type: z.literal('create'),
  noteType: noteTypeSchema,
  title: z.string().min(1).max(300),
  tags: z.array(z.string().min(1).max(100)).max(50).default([]),
  content: z.string().max(200_000).default(''),
})

const updateOpSchema = z.object({
  type: z.literal('update'),
  id: z.string().max(100).optional(),
  title: z.string().max(300).optional(),
  tags: z.array(z.string().min(1).max(100)).max(50).optional(),
  content: z.string().max(200_000).optional(),
})

const retagOpSchema = z.object({
  type: z.literal('retag'),
  id: z.string().max(100).optional(),
  title: z.string().max(300).optional(),
  addTags: z.array(z.string().min(1).max(100)).max(50).default([]),
  removeTags: z.array(z.string().min(1).max(100)).max(50).default([]),
})

export const aiOperationSchema = z.discriminatedUnion('type', [createOpSchema, updateOpSchema, retagOpSchema])
export type AiOperation = z.infer<typeof aiOperationSchema>

export const aiOperationsSchema = z.object({
  operations: z.array(aiOperationSchema).max(500),
})

/** 从模型输出里抠 JSON：优先 ```json 代码块，否则找第一个 { 到最后一个 } */
export function extractJsonText(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return ''
  return raw.slice(start, end + 1)
}

export type ParseOpsResult =
  | { ok: true; ops: AiOperation[] }
  | { ok: false; error: string; rawPreview: string }

/** 解析 + 校验。失败返回 AI 原始输出预览（截断）便于排查。 */
export function parseAiOperations(raw: string): ParseOpsResult {
  const text = extractJsonText(raw)
  if (!text) {
    return { ok: false, error: '输出里没有找到 JSON 对象', rawPreview: raw.slice(0, 500) }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    return {
      ok: false,
      error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`,
      rawPreview: raw.slice(0, 500),
    }
  }
  const result = aiOperationsSchema.safeParse(json)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('；')
    return { ok: false, error: `schema 校验失败：${issues}`, rawPreview: raw.slice(0, 500) }
  }
  return { ok: true, ops: result.data.operations }
}

export type PlannedOp =
  | { kind: 'create'; op: Extract<AiOperation, { type: 'create' }> }
  | { kind: 'update'; op: Extract<AiOperation, { type: 'update' | 'retag' }>; target: Note }
  | { kind: 'error'; op: AiOperation; reason: string }

/**
 * 把操作解析到本地笔记：按 id 精确匹配，否则按标题（trim 后完全相等）。
 * create 恒合法；解析不到目标的记为 error（UI 展示，不会应用）。
 */
export function resolveOps(ops: AiOperation[], notes: Note[]): PlannedOp[] {
  const byId = new Map(notes.map((n) => [n.id, n]))
  const byTitle = new Map<string, Note>()
  for (const n of notes) {
    const key = n.title.trim()
    if (!byTitle.has(key)) byTitle.set(key, n)
  }
  return ops.map((op) => {
    if (op.type === 'create') return { kind: 'create', op }
    const target = (op.id && byId.get(op.id)) || (op.title && byTitle.get(op.title.trim()))
    if (!target) {
      return {
        kind: 'error',
        op,
        reason: `找不到目标笔记（id=${op.id ?? ''} 标题=${op.title ?? ''}）`,
      }
    }
    return { kind: 'update', op, target }
  })
}

/** 汇总给 UI 的变更摘要行 */
export function describeOp(p: PlannedOp): string {
  if (p.kind === 'create') return `新建「${p.op.title}」（${p.op.noteType}）${p.op.tags.length ? `，标签 ${p.op.tags.map((t) => `#${t}`).join(' ')}` : ''}`
  if (p.kind === 'error') return `⚠ ${p.reason}`
  const { op, target } = p
  if (op.type === 'retag') {
    const parts: string[] = []
    if (op.addTags.length) parts.push(`+${op.addTags.map((t) => `#${t}`).join(' ')}`)
    if (op.removeTags.length) parts.push(`-${op.removeTags.map((t) => `#${t}`).join(' ')}`)
    return `「${target.title}」${parts.join(' ') || '（无标签变化）'}`
  }
  const parts: string[] = []
  if (op.content !== undefined) parts.push('正文整篇替换')
  if (op.tags) parts.push(`标签设为 ${op.tags.map((t) => `#${t}`).join(' ')}`)
  return `「${target.title}」${parts.join('；') || '（无变化）'}`
}
