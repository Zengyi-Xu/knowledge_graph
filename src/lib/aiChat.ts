/**
 * AI 自由提问：上下文拼装与消息构造。
 * 只做纯函数，方便在面板外单独验证；不包含任何网络调用。
 */
import type { Note } from '@/types/note'

export type AiProviderId = 'kimi' | 'deepseek'
export type ContextScope = 'none' | 'note' | 'links'

export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export const PROVIDER_LABEL: Record<AiProviderId, string> = {
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
}

export const CONTEXT_SCOPE_LABEL: Record<ContextScope, string> = {
  none: '不附笔记',
  note: '当前笔记',
  links: '当前笔记 + 关联',
}

export const CHAT_SYSTEM_PROMPT = `你是知识图谱笔记软件里的 AI 助手。请用中文、以 Markdown 回答，直接给结论，必要时列出步骤。
用户可能附带一篇或多篇笔记片段作为参考资料；没有附带时不要假设你知道笔记内容。
你只能回答问题，不能修改笔记；不要声称已写入或已修改任何笔记，也不要输出 operations JSON。
引用笔记标题时使用 [[标题]] 双链格式。`

export interface NoteContext {
  text: string
  /** 实际附上的笔记标题（用于界面提示） */
  titles: string[]
  truncated: boolean
}

export interface NoteContextOptions {
  /** 总字符上限；超出后截断并标记 */
  maxChars?: number
  /** 「关联」范围最多带几篇其它笔记 */
  maxLinked?: number
}

/** 从正文里取 [[标题]]（支持 [[标题|别名]]；去重、保持出现顺序） */
function wikiLinks(content: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of content.matchAll(/\[\[([^[\]|]+)(?:\|[^[\]]*)?\]\]/g)) {
    const title = match[1].trim()
    if (!title || seen.has(title)) continue
    seen.add(title)
    out.push(title)
  }
  return out
}

function noteBlock(note: Note): string {
  const meta = [
    `标题：${note.title}`,
    `类型：${note.type}`,
    note.tags.length ? `标签：${note.tags.map((t) => `#${t}`).join(' ')}` : '',
  ].filter(Boolean)
  return `${meta.join('\n')}\n\n${note.content}`
}

/**
 * 按范围收集笔记上下文。
 * - note：只带当前笔记
 * - links：当前笔记 + 它双链到的笔记 + 反向链接到它的笔记（按标题匹配，最多 maxLinked 篇）
 */
export function noteContextFor(
  notes: Note[],
  active: Note | null | undefined,
  scope: ContextScope,
  options: NoteContextOptions = {},
): NoteContext {
  if (scope === 'none' || !active) return { text: '', titles: [], truncated: false }
  const maxChars = options.maxChars ?? 60_000
  const maxLinked = options.maxLinked ?? 8
  const included: Note[] = [active]
  const ids = new Set([active.id])

  if (scope === 'links') {
    const byTitle = new Map(notes.map((n) => [n.title.trim(), n]))
    for (const title of wikiLinks(active.content)) {
      const target = byTitle.get(title)
      if (target && !ids.has(target.id) && included.length <= maxLinked) {
        ids.add(target.id)
        included.push(target)
      }
    }
    for (const note of notes) {
      if (included.length > maxLinked) break
      if (ids.has(note.id)) continue
      if (wikiLinks(note.content).includes(active.title.trim())) {
        ids.add(note.id)
        included.push(note)
      }
    }
  }

  const titles: string[] = []
  let text = ''
  let truncated = false
  for (const note of included) {
    const block = noteBlock(note)
    if (text.length + block.length > maxChars) {
      const remain = Math.max(0, maxChars - text.length)
      if (remain > 200) {
        text += (text ? '\n\n---\n\n' : '') + block.slice(0, remain) + '\n\n（内容已截断）'
        titles.push(note.title)
      }
      truncated = true
      break
    }
    text += (text ? '\n\n---\n\n' : '') + block
    titles.push(note.title)
  }
  return { text, titles, truncated }
}

/**
 * 把上下文附在第一条 user 消息前（后续轮次复用同一段前缀，保证多轮语境一致）。
 * 传入的 messages 不会被修改。
 */
export function withNoteContext(messages: AiChatMessage[], context: string): AiChatMessage[] {
  if (!context.trim()) return messages
  const index = messages.findIndex((m) => m.role === 'user')
  if (index < 0) return messages
  const copy = messages.map((m) => ({ ...m }))
  copy[index] = {
    role: 'user',
    content: `以下是用户允许你参考的笔记内容（可能被截断）：\n\n${context}\n\n---\n\n${copy[index].content}`,
  }
  return copy
}

/** 只保留最近 N 条，避免长对话把上下文撑爆 */
export function trimChatHistory(messages: AiChatMessage[], maxMessages = 20): AiChatMessage[] {
  if (messages.length <= maxMessages) return messages
  return messages.slice(messages.length - maxMessages)
}
