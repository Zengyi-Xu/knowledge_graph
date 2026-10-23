/**
 * 笔记关系：反向链接 / 大纲 / 搜索片段。纯函数，不碰 React、不读写存储。
 *
 * 反链只看 `[[标题]]`（与 noteStore.noteEdges 同一套解析口径：大小写不敏感、支持
 * `[[标题|别名]]` 与 `[[标题#小节]]`），所以图谱里的边和这里列出的反链一一对应。
 */
import type { Note } from '@/types/note'

export interface OutlineEntry {
  level: number
  text: string
  /** 标题行在正文里的字符偏移（经典模式的 textarea 用它定位） */
  index: number
}

export interface Backlink {
  note: Note
  /** 命中处前后的一小段文字，方便判断「它为什么引用我」 */
  snippet: string
}

/** 逐行跳过 ``` / ~~~ 围栏内的内容（围栏里的 # 和 [[ ]] 都不是真标题/真链接） */
function eachLineOutsideFence(content: string, visit: (line: string, offset: number, lineNo: number) => void): void {
  let fence: string | null = null
  let offset = 0
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trimStart()
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null
    } else {
      const open = /^(`{3,}|~{3,})/.exec(trimmed)
      if (open) fence = open[1]
      else visit(line, offset, i)
    }
    offset += line.length + 1
  }
}

/** 标题大纲：`#` 到 `######`，跳过围栏代码 */
export function outlineOf(content: string): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  eachLineOutsideFence(content, (line, offset) => {
    const match = /^(#{1,6})\s+(.*)$/.exec(line)
    if (!match) return
    const text = match[2].replace(/\s+#+\s*$/, '').trim()
    if (!text) return
    entries.push({ level: match[1].length, text, index: offset })
  })
  return entries
}

/** 正文里的双链目标（去别名、去 #小节，保持原拼写） */
export function linksIn(content: string): { title: string; index: number }[] {
  const links: { title: string; index: number }[] = []
  eachLineOutsideFence(content, (line, offset) => {
    const re = /\[\[([^\[\]]+)\]\]/g
    let match: RegExpExecArray | null
    while ((match = re.exec(line)) !== null) {
      const title = match[1].split('|')[0].split('#')[0].trim()
      if (title) links.push({ title, index: offset + match.index })
    }
  })
  return links
}

/** 紧凑片段：压掉换行和多余空白，过长时前后加省略号 */
function snippetAround(content: string, index: number, titleLength: number): string {
  const radius = 36
  const start = Math.max(0, index - radius)
  const end = Math.min(content.length, index + titleLength + radius)
  const text = content
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .replace(/^[>\-*+\s]+/, '')
    .trim()
  return `${start > 0 ? '…' : ''}${text}${end < content.length ? '…' : ''}`
}

/** 谁引用了这篇笔记（不含自己），每条带一段命中上下文 */
export function backlinksOf(notes: Note[], target: Pick<Note, 'id' | 'title'>): Backlink[] {
  const title = target.title.trim().toLowerCase()
  if (!title) return []
  const result: Backlink[] = []
  for (const note of notes) {
    if (note.id === target.id) continue
    if (!note.content.includes('[[')) continue
    const hit = linksIn(note.content).find((link) => link.title.toLowerCase() === title)
    if (!hit) continue
    result.push({ note, snippet: snippetAround(note.content, hit.index, hit.title.length) })
  }
  return result.sort((a, b) => b.note.updatedAt - a.note.updatedAt)
}

/** 本文里指向不存在笔记的双链（去重、按出现顺序） */
export function brokenLinksOf(note: Pick<Note, 'content'>, notes: Pick<Note, 'title'>[]): string[] {
  const known = new Set(notes.map((n) => n.title.trim().toLowerCase()))
  const seen = new Set<string>()
  const broken: string[] = []
  for (const link of linksIn(note.content)) {
    const key = link.title.toLowerCase()
    if (known.has(key) || seen.has(key)) continue
    seen.add(key)
    broken.push(link.title)
  }
  return broken
}

/** 搜索结果的一行上下文：命中词前后各 30 字，命中段单独返回给界面加粗 */
export function searchSnippet(
  content: string,
  query: string,
): { before: string; match: string; after: string } | null {
  const q = query.trim()
  if (!q) return null
  const index = content.toLowerCase().indexOf(q.toLowerCase())
  if (index < 0) return null
  const before = content.slice(Math.max(0, index - 30), index).replace(/\s+/g, ' ')
  const after = content.slice(index + q.length, index + q.length + 30).replace(/\s+/g, ' ')
  return {
    before: `${index > 30 ? '…' : ''}${before}`,
    match: content.slice(index, index + q.length),
    after: `${after}${index + q.length + 30 < content.length ? '…' : ''}`,
  }
}

/** 从任意节点往上找到真正在滚的容器（阴影 DOM 里要跨过 ShadowRoot.host） */
function nearestScrollable(start: Element): HTMLElement | null {
  let node: Node | null = start
  while (node) {
    if (node instanceof ShadowRoot) {
      node = node.host
      continue
    }
    if (node instanceof HTMLElement) {
      const overflow = getComputedStyle(node).overflowY
      if (/(auto|scroll)/.test(overflow) && node.scrollHeight > node.clientHeight + 4) return node
      // 用 parentNode 而不是 parentElement：Shadow DOM 里的根元素直接挂在 ShadowRoot 下，
      // parentElement 会返回 null，一路往上就断了（预览面板的大纲跳转因此静默不滚）
      node = node.parentNode
      continue
    }
    node = node.parentNode
  }
  return null
}

/**
 * 把元素滚到视野里，并在顶部留出 `offset`（吸顶的 Vditor 工具栏约 48px）。
 * 返回 false = 没找到元素（界面可以退回按文本查找或提示）。
 */
export function scrollElementIntoView(target: Element | null | undefined, offset = 56): boolean {
  if (!target) return false
  const rect = target.getBoundingClientRect()
  const scroller = nearestScrollable(target)
  if (!scroller) {
    window.scrollBy({ top: rect.top - offset, behavior: 'smooth' })
    return true
  }
  const box = scroller.getBoundingClientRect()
  scroller.scrollTo({ top: scroller.scrollTop + (rect.top - box.top) - offset, behavior: 'smooth' })
  return true
}
