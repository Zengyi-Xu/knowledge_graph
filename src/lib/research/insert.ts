/**
 * 追问回答插入正文的段落组装（无第三方依赖：本模块被 NoteEditor 静态引用，
 * 不能在这里引 zod —— 否则编辑器 chunk 会把 zod 拉进 preview/edit/pdf 场景）。
 */
import type { ResearchSessionItem } from './session'

/** 把已答问题与草稿排成待插入正文的 Markdown 段落（用户确认后才调用） */
export function buildInsertSection(items: ResearchSessionItem[]): string {
  const lines = ['## 研究追问', '']
  for (const it of items) {
    lines.push(`### ${it.question}`)
    lines.push('')
    if (it.why) lines.push(`> 为什么值得问：${it.why}`, '')
    lines.push(it.draft.trim() || '（待补充）')
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/** 插入正文：正文末尾追加；返回新正文 */
export function appendToContent(content: string, section: string): string {
  const base = content.replace(/\s+$/, '')
  return base ? `${base}\n\n${section}\n` : `${section}\n`
}
