/**
 * 文献引用键（citekey）生成：第一作者姓小写 + year + 标题首词小写，如 zhang2024silicon。
 * 纯函数，便于单测。
 */
import type { LiteratureMeta } from '@/types/note'

/** 从作者全名取姓："Zhang, San" -> "zhang"；无逗号时取首个词 */
function familyOf(author: string): string {
  const s = (author ?? '').trim()
  if (!s) return ''
  const head = s.includes(',') ? s.split(',')[0] : s.split(/\s+/)[0]
  return head.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
}

/** 标题首词：取第一个字母/数字开头的词并小写化 */
function titleWord(title: string): string {
  const m = (title ?? '').match(/[A-Za-z0-9]+/)
  return m ? m[0].toLowerCase() : ''
}

/**
 * 生成库内唯一的 citekey；撞名时追加 b/c/d… 后缀。
 * existing 传当前库内已占用的 citekey 集合。
 */
export function makeCitekey(lit: Pick<LiteratureMeta, 'authors' | 'year'>, title: string, existing: Set<string>): string {
  const family = lit.authors.length ? familyOf(lit.authors[0]) : ''
  const year = typeof lit.year === 'number' ? String(lit.year) : ''
  const word = titleWord(title)
  const base = `${family}${year}${word}`
  if (!base) return 'untitled'
  if (!existing.has(base)) return base
  for (const suffix of ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']) {
    const candidate = `${base}${suffix}`
    if (!existing.has(candidate)) return candidate
  }
  // 极端情况：后缀用完，退化为随机尾巴
  return `${base}${Math.random().toString(36).slice(2, 6)}`
}
