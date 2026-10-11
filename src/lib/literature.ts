/**
 * 文献相关纯函数：CSL-JSON 转换、DOI/arXiv/BibTeX/RIS 元数据导入、引文格式化。
 * 网络请求只出现在本模块（CrossRef / arXiv / DataCite 三个域名），其余离线可用。
 */
import Cite from 'citation-js'
import type { LiteratureMeta, Note } from '@/types/note'
import { APA_CSL_XML, GB_CSL_XML, ZH_CN_LOCALE_XML } from './csl/styles'

export type CslItem = Record<string, unknown>

/** 引文样式 id：gb = 国标 GB/T 7714-2015 顺序编码制；apa = APA 7th */
export const CITATION_STYLES = {
  gb: { id: 'gb', label: 'GB/T 7714' },
  apa: { id: 'apa', label: 'APA' },
} as const
export type CitationStyleId = keyof typeof CITATION_STYLES

/** 导入结果：title 单独给出，其余是文献元数据（均可缺省/为空） */
export interface ImportedLit {
  title: string
  authors: string[]
  venue: string
  year: number | ''
  doi: string
}

// ------------------------------------------------------------ CSL 样式注册

interface CslConfig {
  styles: { add: (name: string, xml: string) => void }
  locales: { add: (name: string, xml: string) => void }
}

let stylesReady = false

/** 把内嵌的两个样式与 zh-CN locale 注册进 citation-js（幂等） */
function ensureStyles(): void {
  if (stylesReady) return
  const config = (Cite as unknown as { plugins: { config: { get: (ref: string) => CslConfig } } }).plugins.config.get(
    '@csl',
  )
  config.styles.add('gb', GB_CSL_XML)
  config.styles.add('apa', APA_CSL_XML)
  config.locales.add('zh-CN', ZH_CN_LOCALE_XML)
  stylesReady = true
}

// ------------------------------------------------------------ CSL 转换

/** 作者全名 → CSL creator；已带逗号按逗号切，否则整个作为 family */
function parseAuthor(name: string): { family: string; given: string } {
  const s = name.trim()
  if (!s) return { family: '', given: '' }
  if (s.includes(',')) {
    const [family, ...rest] = s.split(',')
    return { family: family.trim(), given: rest.join(',').trim() }
  }
  return { family: s, given: '' }
}

/** Note（文献类型）→ CSL-JSON；id 用 citekey */
export function litToCSL(note: Note): CslItem {
  const lit = note.literature
  const out: CslItem = {
    id: lit?.citekey || note.id,
    type: 'article-journal',
    title: note.title,
    author: (lit?.authors ?? []).map(parseAuthor),
  }
  if (typeof lit?.year === 'number') out.issued = { 'date-parts': [[lit.year]] }
  if (lit?.venue) out['container-title'] = lit.venue
  if (lit?.doi) out.DOI = lit.doi
  return out
}

// ------------------------------------------------------------ 引文格式化

function langOf(styleId: CitationStyleId): string {
  return styleId === 'gb' ? 'zh-CN' : 'en-US'
}

/** 多条 CSL-JSON 按样式排成完整文献表（文本，条目间换行） */
export function formatBibliography(items: CslItem[], styleId: CitationStyleId): string {
  if (!items.length) return ''
  ensureStyles()
  const cite = new Cite(items) as unknown as {
    format: (fmt: string, opts: Record<string, unknown>) => string
  }
  return cite
    .format('bibliography', { format: 'text', template: styleId, lang: langOf(styleId) })
    .trim()
}

/** 单条引文（就是只有一条的文献表） */
export function formatCitation(csl: CslItem, styleId: CitationStyleId): string {
  return formatBibliography([csl], styleId)
}

/** 自拼 BibTeX（比 citation-js 输出键名可控） */
export function buildBibtex(meta: {
  title: string
  authors: string[]
  venue: string
  year: number | ''
  doi: string
  citekey: string
}): string {
  const fields = [
    `  title = {${meta.title}}`,
    meta.authors.length ? `  author = {${meta.authors.join(' and ')}}` : null,
    meta.year !== '' ? `  year = {${meta.year}}` : null,
    meta.venue ? `  journal = {${meta.venue}}` : null,
    meta.doi ? `  doi = {${meta.doi}}` : null,
  ].filter((x): x is string => Boolean(x))
  return `@article{${meta.citekey || 'untitled'},\n${fields.join(',\n')}\n}`
}

// ------------------------------------------------------------ 元数据导入

/** 去掉 DOI 常见的 https://doi.org/ 前缀 */
function cleanDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
}

function pickTitle(arr: unknown): string {
  return Array.isArray(arr) && typeof arr[0] === 'string' ? arr[0] : ''
}

function yearOf(raw: unknown): number | '' {
  const parts = (raw as { 'date-parts'?: unknown[][] } | null)?.['date-parts']
  const y = Array.isArray(parts) && Array.isArray(parts[0]) ? Number(parts[0][0]) : NaN
  return Number.isFinite(y) ? y : ''
}

/** CrossRef message → ImportedLit */
function fromCrossRef(m: Record<string, unknown>, doi: string): ImportedLit {
  const authors = Array.isArray(m.author)
    ? (m.author as Record<string, unknown>[]).map((a) =>
        [a.family, a.given].filter((x): x is string => typeof x === 'string' && x.trim() !== '').join(', '),
      )
    : []
  return {
    title: pickTitle(m.title),
    authors,
    venue: pickTitle(m['container-title']),
    year: yearOf(m.issued ?? m.published),
    doi,
  }
}

/** DataCite attributes → ImportedLit */
function fromDataCite(a: Record<string, unknown>, doi: string): ImportedLit {
  const titles = a.titles as { title?: string }[] | undefined
  const creators = a.creators as { name?: string; familyName?: string; givenName?: string }[] | undefined
  return {
    title: titles?.[0]?.title ?? '',
    authors: (creators ?? []).map((c) => c.name ?? [c.familyName, c.givenName].filter(Boolean).join(', ')),
    venue: (a.publisher as string) ?? '',
    year: yearOf(a.publicationYear !== undefined ? { 'date-parts': [[a.publicationYear as string | number]] } : null),
    doi,
  }
}

/** 按 DOI 导入：先 CrossRef，失败回退 DataCite；网络错误抛中文错误信息 */
export async function importFromDoi(doi: string): Promise<ImportedLit> {
  const clean = cleanDoi(doi)
  if (!clean) throw new Error('DOI 不能为空')
  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(clean)}`)
    if (res.ok) {
      const json = (await res.json()) as { message?: Record<string, unknown> }
      const lit = json.message ? fromCrossRef(json.message, clean) : null
      if (lit && lit.title) return lit
    }
  } catch {
    /* 回退 DataCite */
  }
  try {
    const res = await fetch(`https://api.datacite.org/dois/${encodeURIComponent(clean)}`)
    if (res.ok) {
      const json = (await res.json()) as { data?: { attributes?: Record<string, unknown> } }
      const lit = json.data?.attributes ? fromDataCite(json.data.attributes, clean) : null
      if (lit && lit.title) return lit
    }
  } catch {
    /* 最终走统一的抛错 */
  }
  throw new Error(`无法获取 DOI「${clean}」的文献信息（请检查网络或 DOI 是否正确）`)
}

/**
 * 按 arXiv id 导入（如 2401.12345 或 hep-th/9901001）。
 * 用轻量正则解析 Atom XML——避免依赖 DOMParser，Node 单测里也能跑。
 */
export async function importFromArxiv(id: string): Promise<ImportedLit> {
  const clean = id.trim().replace(/^https?:\/\/arxiv\.org\/(abs\/)?/i, '').replace(/\.pdf$/i, '')
  if (!clean) throw new Error('arXiv 编号不能为空')
  let xml: string
  try {
    const res = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(clean)}`)
    if (!res.ok) throw new Error(String(res.status))
    xml = await res.text()
  } catch {
    throw new Error(`无法获取 arXiv「${clean}」的文献信息（请检查网络或编号是否正确）`)
  }
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1]
  if (!entry) throw new Error(`arXiv「${clean}」不存在或没有返回条目`)
  const pick = (tag: string) => entry.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? ''
  const authors = [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>\s*<\/author>/g)].map((m) => m[1].trim())
  const published = pick('published')
  const year = /^\d{4}/.test(published) ? Number(published.slice(0, 4)) : ''
  return {
    title: pick('title').replace(/\s+/g, ' '),
    authors,
    venue: `arXiv:${clean}`,
    year,
    doi: '',
  }
}

// ------------------------------------------------------------ BibTeX / RIS

/** CSL-JSON → ImportedLit（citation-js 解析结果统一走这里） */
function fromCslItem(item: Record<string, unknown>): ImportedLit {
  const authors = Array.isArray(item.author)
    ? (item.author as Record<string, unknown>[]).map((a) =>
        [a.family, a.given].filter((x): x is string => typeof x === 'string' && x.trim() !== '').join(', '),
      )
    : []
  return {
    title: typeof item.title === 'string' ? item.title : '',
    authors,
    venue: typeof item['container-title'] === 'string' ? item['container-title'] : '',
    year: yearOf(item.issued),
    doi: typeof item.DOI === 'string' ? item.DOI : '',
  }
}

/** 解析 BibTeX/RIS 文本里的全部条目（citation-js 自动识别格式） */
export function parseCitationText(text: string): ImportedLit[] {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return []
  const cite = new Cite(trimmed)
  return (cite.data as Record<string, unknown>[]).map(fromCslItem).filter((l) => l.title)
}

/** 导入 BibTeX：取第一条 */
export function importFromBibtex(text: string): ImportedLit {
  const all = parseCitationText(text)
  if (!all.length) throw new Error('没有从 BibTeX 中解析到文献条目')
  return all[0]
}

/** 导入 RIS：取第一条 */
export function importFromRis(text: string): ImportedLit {
  const all = parseCitationText(text)
  if (!all.length) throw new Error('没有从 RIS 中解析到文献条目')
  return all[0]
}

/** ImportedLit → 新建文献笔记用的元数据（citekey 由调用方生成） */
export function toLiteratureMeta(
  imported: ImportedLit,
  citekey: string,
): LiteratureMeta {
  return {
    authors: imported.authors,
    venue: imported.venue,
    year: imported.year,
    doi: imported.doi,
    citekey,
    attachments: [],
  }
}
