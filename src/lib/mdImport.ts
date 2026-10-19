/**
 * 导入外部 .md 时读取 frontmatter（纯函数）。
 *
 * 这里只做「够用」的 YAML：标量字段 + tags 的行内列表 / 块状列表。
 * 关键是剥掉 YAML 的引号 —— 直接 trim 会得到 `"标题"`（引号当作正文的一部分），
 * 落盘后再被序列化一次就变成 `title: "\"标题\""`，界面上标题和每个标签都多一层引号。
 */
import { NOTE_TYPE_META, GRADE_META } from '@/types/note'
import type { Grade, NoteType } from '@/types/note'

/** 去掉 YAML 标量外层成对的引号，并还原引号内的转义 */
function unquoteYaml(raw: string): string {
  const s = raw.trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'")
  }
  return s
}

/** 按逗号切分行内列表，引号里的逗号不算分隔符 */
function splitInlineList(inner: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (quote) {
      cur += ch
      if (ch === '\\' && quote === '"' && i + 1 < inner.length) {
        cur += inner[++i]
      } else if (ch === quote) {
        if (quote === "'" && inner[i + 1] === "'") {
          cur += inner[++i]
        } else {
          quote = null
        }
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) out.push(cur)
  return out.map(unquoteYaml).filter(Boolean)
}

/** 读一个顶层标量字段（已剥引号）；不存在或为空返回 undefined */
function readScalar(fm: string, key: string): string | undefined {
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))
  const value = m ? unquoteYaml(m[1]) : ''
  return value || undefined
}

/** tags 支持 `tags: ["a", "b"]` / `tags: a`，也支持 Obsidian 的 `tags:\n  - a` 块状列表 */
function readTags(fm: string): string[] {
  const inline = fm.match(/^tags:[ \t]*(.*)$/m)
  if (inline && inline[1].trim()) {
    const raw = inline[1].trim()
    const inner = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw
    return splitInlineList(inner)
  }
  const lines = fm.split('\n')
  const start = lines.findIndex((line) => /^tags:[ \t]*$/.test(line))
  if (start < 0) return []
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue
    const item = line.match(/^[ \t]*-[ \t]*(.*)$/)
    if (!item) break
    const value = unquoteYaml(item[1])
    if (value) out.push(value)
  }
  return out
}

/** 解析要导入的 md：frontmatter 读 type / grade / tags / title，正文去掉 frontmatter */
export function parseMdImport(fileName: string, text: string) {
  // BOM 与 CRLF 会让 `^---\n` 直接匹配不上（整段被当成正文，标题退回文件名）
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  const fm = fmMatch?.[1] ?? ''
  let type: NoteType = 'other'
  let grade: Grade = ''
  let tags: string[] = []
  let content = normalized
  if (fmMatch) {
    content = normalized.slice(fmMatch[0].length)
    const t = readScalar(fm, 'type')
    if (t && t in NOTE_TYPE_META) type = t as NoteType
    const g = readScalar(fm, 'grade')
    if (g && g in GRADE_META) grade = g as Grade
    tags = readTags(fm)
  }
  const title = readScalar(fm, 'title') ?? fileName.replace(/\.(md|markdown)$/i, '')
  return { title, type, grade, tags, content: content.trim() }
}
