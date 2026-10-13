export type NoteType = 'person' | 'task' | 'skill' | 'question' | 'literature' | 'summary' | 'other'

export type Grade = 'pi' | 'postdoc' | 'phd' | 'master' | 'undergrad' | 'engineer' | 'staff' | ''

export interface Note {
  id: string
  title: string
  type: NoteType
  /** 年级/身份，仅人物类笔记使用 */
  grade: Grade
  tags: string[]
  content: string
  createdAt: number
  updatedAt: number
  /** 文献元数据，仅 type === 'literature' 时有值 */
  literature?: LiteratureMeta
}

/** 文献笔记的元数据（frontmatter 里的 authors/venue/year/doi/citekey/attachments） */
export interface LiteratureMeta {
  /** 全名，如 ["Zhang, San", "Li, Si"] */
  authors: string[]
  /** 期刊/会议名，可为空 */
  venue: string
  /** 发表年；未知为空串 */
  year: number | ''
  /** 可为空 */
  doi: string
  /** 引用键，如 zhang2024silicon；库内唯一 */
  citekey: string
  /** 附件 id 列表（见 docs/VAULT_FORMAT.md 的 attachments/ 约定） */
  attachments: string[]
  /** Zotero 分类路径（层级用 / 压平），如 ["硅光/电光调制器"] */
  collections: string[]
  /** Zotero 书目条目的稳定 8 位 key；用于从本机库定位 PDF */
  zoteroKey?: string
  /** Zotero 中登记的 PDF 数量 */
  zoteroPdfCount?: number
  /** 当前同步时实际存在于本机的 PDF 数量 */
  zoteroAvailablePdfCount?: number
}

/** 全空文献元数据：所有「手动构造 literature 对象」的代码都应从这里起步，避免漏字段 */
export function emptyLiterature(): LiteratureMeta {
  return { authors: [], venue: '', year: '', doi: '', citekey: '', attachments: [], collections: [] }
}

export const NOTE_TYPE_META: Record<NoteType, { label: string; color: string; bg: string }> = {
  person: { label: '人物', color: '#e8734a', bg: 'rgba(232,115,74,0.14)' },
  task: { label: '项目', color: '#4a90e8', bg: 'rgba(74,144,232,0.14)' },
  skill: { label: '技能', color: '#3fae7a', bg: 'rgba(63,174,122,0.14)' },
  question: { label: '学习', color: '#b06ee0', bg: 'rgba(176,110,224,0.14)' },
  literature: { label: '文献', color: '#2aa1a8', bg: 'rgba(42,161,168,0.14)' },
  summary: { label: '汇总', color: '#e8a34a', bg: 'rgba(232,163,74,0.14)' },
  other: { label: '其他', color: '#8a93a6', bg: 'rgba(138,147,166,0.14)' },
}

export const GRADE_META: Record<Exclude<Grade, ''>, string> = {
  pi: '教授/PI',
  postdoc: '博后',
  phd: '博士生',
  master: '硕士生',
  undergrad: '本科生',
  engineer: '工程师',
  staff: '行政/技术人员',
}

export const GRADE_COLORS: Record<Exclude<Grade, ''>, string> = {
  pi: '#c94f4f',
  postdoc: '#e8734a',
  phd: '#e8a34a',
  master: '#4a90e8',
  undergrad: '#3fae7a',
  engineer: '#7a6ee0',
  staff: '#8a93a6',
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36)
}

/** 从 markdown 内容中提取 [[wikilink]] */
export function extractLinks(content: string): string[] {
  const re = /\[\[([^\[\]|]+)(?:\|[^\[\]]*)?\]\]/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    out.push(m[1].trim())
  }
  return out
}
