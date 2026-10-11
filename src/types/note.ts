export type NoteType = 'person' | 'task' | 'skill' | 'question' | 'other'

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
}

export const NOTE_TYPE_META: Record<NoteType, { label: string; color: string; bg: string }> = {
  person: { label: '人物', color: '#e8734a', bg: 'rgba(232,115,74,0.14)' },
  task: { label: '项目', color: '#4a90e8', bg: 'rgba(74,144,232,0.14)' },
  skill: { label: '技能', color: '#3fae7a', bg: 'rgba(63,174,122,0.14)' },
  question: { label: '学习', color: '#b06ee0', bg: 'rgba(176,110,224,0.14)' },
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
