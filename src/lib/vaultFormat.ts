/**
 * vault 本地存储格式（纯函数，不依赖浏览器/Electron API，便于单测）：
 *
 *   <vault>/
 *     <笔记标题>.md     每篇笔记一个自包含 md：YAML frontmatter 存全部元数据 + 正文
 *     meta.json         索引：id -> 文件名（仅用于改名追踪、未纳管检测与顺序）
 *
 * md 是唯一事实来源；meta.json 只是索引，丢了也能靠 md 里的 frontmatter 完整还原。
 */
import type { Grade, LiteratureMeta, Note, NoteType } from '@/types/note'
import { GRADE_META, NOTE_TYPE_META, uid } from '@/types/note'

/** meta.json 的格式标记与版本 */
export const VAULT_FORMAT = 'kaust-kg-vault'
export const VAULT_VERSION = 1
/** 单篇 md frontmatter 里的格式标记 */
export const NOTE_FORMAT = 'kaust-kg-note'
export const META_FILE = 'meta.json'
export const MD_EXT = '.md'

/** 文件名（不含扩展名）的最大长度：NTFS 上限 255 字节，中文 3 字节/字，取 60 字留足余量 */
const MAX_BASE_LEN = 60

export interface VaultIndexEntry {
  id: string
  file: string
  title: string
}

export interface VaultIndex {
  format: string
  version: number
  notes: VaultIndexEntry[]
}

/** 账本里记录的「磁盘现状」：某篇笔记当前对应哪个文件、内容是什么 */
export interface WrittenNote {
  file: string
  text: string
}

export interface VaultWritePlan {
  writes: { id: string; file: string; text: string }[]
  deletes: string[]
  index: VaultIndexEntry[]
  meta: string
  /** meta 内容与上次一致，无需写盘（避免无意义地刷新 mtime） */
  metaSkipped: boolean
  names: Map<string, string>
}

const RESERVED_BASE = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
])

const ILLEGAL_CHARS = /[\\/:*?"<>|]/g

/** 控制字符逐个过滤：正则字符组写法会触发 eslint 的 no-control-regex */
function stripControlChars(input: string): string {
  let out = ''
  for (const ch of input) {
    out += (ch.codePointAt(0) ?? 0) < 0x20 ? '_' : ch
  }
  return out
}

function clean(raw: string, maxLen: number): string {
  let s = stripControlChars(raw ?? '').replace(ILLEGAL_CHARS, '_')
  s = s.replace(/\s+/g, ' ').trim()
  // 前导点会变成隐藏文件，`..` 之类也要挡掉
  s = s.replace(/^\.+/, '_')
  const chars = [...s]
  if (chars.length > maxLen) s = chars.slice(0, maxLen).join('')
  // Windows 不允许文件名以点或空格结尾
  s = s.replace(/[. ]+$/, '').trim()
  // 全是点/下划线（如标题就是 "..."）→ 交给调用方用兜底名
  return /^_*$/.test(s) ? '' : s
}

/** 标题 -> 安全的文件名主干（不含 .md） */
export function sanitizeBaseName(title: string): string {
  let s = clean(title, MAX_BASE_LEN)
  if (!s) s = '未命名笔记'
  if (RESERVED_BASE.has(s.toUpperCase())) s = `_${s}`
  return s
}

/** 冲突时的备用名：A -> A-2 / A-3 …（截断时给后缀留出空间） */
function withSuffix(base: string, n: number): string {
  const suffix = `-${n}`
  const head = clean(base, MAX_BASE_LEN - suffix.length) || '未命名笔记'
  return `${head}${suffix}`
}

export function fileNameFor(title: string): string {
  return sanitizeBaseName(title) + MD_EXT
}

/**
 * 每个笔记类型对应的子文件夹。
 * 技能 / 项目 / 学习 三类平行并列；人物归到「人物」目录；其他落到收件箱。
 */
export const TYPE_FOLDERS: Record<NoteType, string> = {
  person: '人物',
  task: '项目',
  skill: '技能',
  question: '学习',
  literature: '文献',
  summary: '汇总',
  other: 'Inbox',
}

/**
 * 旧版文件夹名 → 现名。只用于「判断文件是否已经在正确位置」，
 * 这样老 vault 里的文件不会被大搬家；新建笔记一律落到新目录。
 */
const LEGACY_FOLDERS: Record<string, string> = {
  KAUST团队: '人物',
}

/** 两个文件夹是否是同一类（含旧命名） */
function sameFolder(a: string, b: string): boolean {
  if (a === b) return true
  return LEGACY_FOLDERS[a] === b || LEGACY_FOLDERS[b] === a
}

/** 文件夹名的最大长度（中文 3 字节/字，留足余量） */
const MAX_FOLDER_LEN = 40

/** 把一个候选文件夹名洗成安全名字；空串表示放在 vault 根目录 */
export function sanitizeFolder(raw: string): string {
  return clean(raw ?? '', MAX_FOLDER_LEN)
}

/** 类型 -> 目标文件夹（可能为空串 = vault 根） */
export function folderFor(note: Note): string {
  return sanitizeFolder(TYPE_FOLDERS[note.type] ?? TYPE_FOLDERS.other)
}

/** 笔记 -> vault 内的相对路径（用 / 分隔） */
export function relPathFor(note: Note): string {
  const folder = folderFor(note)
  const file = sanitizeBaseName(note.title) + MD_EXT
  return folder ? `${folder}/${file}` : file
}

/** 相对路径的目录部分（'' 表示根目录） */
export function dirOf(relPath: string): string {
  const norm = (relPath ?? '').replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return i >= 0 ? norm.slice(0, i) : ''
}

/** 相对路径的文件名主干（去掉目录与扩展名） */
export function baseNameOf(relPath: string): string {
  const norm = (relPath ?? '').replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return baseOf(i >= 0 ? norm.slice(i + 1) : norm)
}

export function isMarkdownName(name: string): boolean {
  return /\.md$/i.test(name)
}

export function baseOf(file: string): string {
  return file.replace(/\.md$/i, '')
}

/** 正文里可能出现的孤立 CR，统一成 \n，避免 frontmatter 之外的换行风格漂移 */
function normaliseNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

// ---------------------------------------------------------------- md 序列化

export function toMarkdown(note: Note): string {
  const fm: string[] = [
    `format: ${NOTE_FORMAT}`,
    `id: ${JSON.stringify(note.id)}`,
    `title: ${JSON.stringify(note.title)}`,
    `type: ${note.type}`,
  ]
  if (note.grade) fm.push(`grade: ${note.grade}`)
  // 文献元数据：空数组/空串也写出来，字段稳定存在，解析端简单
  if (note.type === 'literature' && note.literature) {
    const lit = note.literature
    fm.push(`authors: ${JSON.stringify(lit.authors ?? [])}`)
    fm.push(`venue: ${JSON.stringify(lit.venue ?? '')}`)
    fm.push(`year: ${typeof lit.year === 'number' ? lit.year : '""'}`)
    fm.push(`doi: ${JSON.stringify(lit.doi ?? '')}`)
    fm.push(`citekey: ${JSON.stringify(lit.citekey ?? '')}`)
    fm.push(`attachments: ${JSON.stringify(lit.attachments ?? [])}`)
    fm.push(`collections: ${JSON.stringify(lit.collections ?? [])}`)
  }
  fm.push(`tags: ${JSON.stringify(note.tags ?? [])}`)
  fm.push(`created: ${new Date(note.createdAt).toISOString()}`)
  fm.push(`updated: ${new Date(note.updatedAt).toISOString()}`)
  return `---\n${fm.join('\n')}\n---\n\n${normaliseNewlines(note.content ?? '')}`
}

function stripQuotes(raw: string): string {
  const s = raw.trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      const parsed = JSON.parse(s)
      if (typeof parsed === 'string') return parsed
    } catch {
      /* 不是合法 JSON 就退回手工去引号 */
    }
    return s.slice(1, -1)
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1)
  return s
}

function parseTagValue(raw: string): string[] {
  const s = raw.trim()
  if (!s) return []
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s)
      if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean)
    } catch {
      /* 退回逗号分隔 */
    }
    return s
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((x) => stripQuotes(x))
      .filter(Boolean)
  }
  return s.split(',').map((x) => stripQuotes(x)).filter(Boolean)
}

/** 极简 frontmatter 解析：兼容本应用写法，也兼容 Obsidian 的 `tags:` 块状列表 */
function parseFrontmatter(fm: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  const lines = fm.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const rest = m[2]
    if (key === 'tags' && !rest.trim()) {
      const items: string[] = []
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(stripQuotes(lines[i + 1].replace(/^\s*-\s+/, '')))
        i++
      }
      out[key] = items.filter(Boolean)
      continue
    }
    out[key] = rest
  }
  return out
}

function parseTime(raw: string | string[] | undefined, fallback: number): number {
  if (typeof raw !== 'string') return fallback
  const s = stripQuotes(raw)
  if (!s) return fallback
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    return n > 1e11 ? n : n * 1000
  }
  const t = Date.parse(s)
  return Number.isNaN(t) ? fallback : t
}

export interface ParsedNoteFile {
  note: Note
  /** frontmatter 缺字段（无 id / 无时间 / 非本应用格式），需要回写规范化后的 md */
  needsRewrite: boolean
}

/** 解析一篇 md；fallbackBase 为文件名主干，用作缺失 title 时的兜底 */
export function parseNoteMarkdown(text: string, fallbackBase: string): ParsedNoteFile {
  const now = Date.now()
  const src = normaliseNewlines(text)
  const m = src.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
  if (!m) {
    return {
      note: {
        id: uid(),
        title: fallbackBase || '未命名笔记',
        type: 'other',
        grade: '',
        tags: [],
        content: src,
        createdAt: now,
        updatedAt: now,
      },
      needsRewrite: true,
    }
  }

  const fm = parseFrontmatter(m[1])
  let body = src.slice(m[0].length)
  // 序列化时固定写入一个空行作分隔；这里只吃掉那一个换行，正文原样保留
  if (body.startsWith('\n')) body = body.slice(1)

  const str = (k: string): string => {
    const v = fm[k]
    return typeof v === 'string' ? stripQuotes(v) : ''
  }

  const id = str('id')
  const title = str('title') || fallbackBase || '未命名笔记'
  const rawType = str('type')
  const type = (rawType && rawType in NOTE_TYPE_META ? rawType : 'other') as NoteType
  const rawGrade = str('grade')
  const grade = (rawGrade && rawGrade in GRADE_META ? rawGrade : '') as Grade
  const tags = Array.isArray(fm.tags)
    ? fm.tags.map((t) => String(t).trim()).filter(Boolean)
    : parseTagValue(typeof fm.tags === 'string' ? fm.tags : '')
  const created = parseTime(fm.created, now)
  const updated = parseTime(fm.updated, created)

  // 文献元数据：只有 literature 类型才挂载（非 literature 的 md 即使带这些字段也忽略），
  // 缺字段时用空值补齐完整对象
  let literature: LiteratureMeta | undefined
  if (type === 'literature') {
    const rawYear = str('year')
    const yearNum = /^\d+$/.test(rawYear) ? Number(rawYear) : NaN
    literature = {
      authors: parseTagValue(typeof fm.authors === 'string' ? fm.authors : ''),
      venue: str('venue'),
      year: Number.isFinite(yearNum) ? yearNum : '',
      doi: str('doi'),
      citekey: str('citekey'),
      attachments: parseTagValue(typeof fm.attachments === 'string' ? fm.attachments : ''),
      collections: parseTagValue(typeof fm.collections === 'string' ? fm.collections : ''),
    }
  }

  const needsRewrite =
    !id ||
    !str('title') ||
    fm.created === undefined ||
    fm.updated === undefined ||
    str('format') !== NOTE_FORMAT

  return {
    note: {
      id: id || uid(),
      title,
      type,
      grade,
      tags,
      content: body,
      createdAt: created,
      updatedAt: updated,
      ...(literature ? { literature } : {}),
    },
    needsRewrite,
  }
}

// ------------------------------------------------------------- meta 索引

export function parseMeta(text: string): VaultIndex | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    if (!raw || typeof raw !== 'object') return null
    if (raw.format !== VAULT_FORMAT) return null
    const arr = Array.isArray(raw.notes) ? (raw.notes as unknown[]) : []
    const notes: VaultIndexEntry[] = []
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue
      const e = item as Record<string, unknown>
      if (typeof e.id !== 'string' || !e.id || typeof e.file !== 'string' || !e.file) continue
      notes.push({ id: e.id, file: e.file, title: typeof e.title === 'string' ? e.title : '' })
    }
    return {
      format: VAULT_FORMAT,
      version: typeof raw.version === 'number' ? raw.version : VAULT_VERSION,
      notes,
    }
  } catch {
    return null
  }
}

export function buildMeta(notes: Note[], names: Map<string, string>): string {
  const index: VaultIndex = {
    format: VAULT_FORMAT,
    version: VAULT_VERSION,
    notes: notes.map((n) => ({
      id: n.id,
      file: names.get(n.id) ?? relPathFor(n),
      title: n.title,
    })),
  }
  return JSON.stringify(index, null, 2) + '\n'
}

// ------------------------------------------------------------ 文件名分配

/**
 * 给每篇笔记分配文件名。
 * - 标题未变（与本应用上次记录的标题一致）→ 保留磁盘上的现名，尊重用户手动改名
 * - 标题变了 → 改为新标题对应的名字
 * - 重名、以及与目录里「未纳管」的 md 冲突 → 加 -2 / -3 后缀
 * - 只使用/删除 meta.json 索引里登记的文件，目录里其他 md 一律不碰
 */
export function assignFileNames(
  notes: Note[],
  index: VaultIndexEntry[] | null,
  diskMdNames: string[],
): Map<string, string> {
  const byId = new Map((index ?? []).map((e) => [e.id, e]))
  // 用 createdAt 排序，保证「谁拿到不带后缀的名字」与笔记数组顺序无关
  const order = [...notes].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))

  const wanted = new Map<string, string>()
  for (const n of order) {
    const cur = byId.get(n.id)
    const desiredBase = sanitizeBaseName(n.title)
    const folder = folderFor(n)
    // 标题没变、且已经在目标文件夹里（含旧写法，如「KAUST团队」≈「人物」）
    // → 保留现名（尊重手动改名，也不给老 vault 搬家）；否则按类型归位
    if (cur && sanitizeBaseName(cur.title || '') === desiredBase && sameFolder(dirOf(cur.file), folder)) {
      wanted.set(n.id, cur.file)
    } else {
      wanted.set(n.id, folder ? `${folder}/${desiredBase}${MD_EXT}` : `${desiredBase}${MD_EXT}`)
    }
  }

  // 索引里登记、但主人已改名/已删除的文件名 → 可以给别人用
  const wantedFiles = new Set(wanted.values())
  const freed = new Set<string>()
  for (const e of index ?? []) if (!wantedFiles.has(e.file)) freed.add(e.file)

  const disk = new Set(diskMdNames)
  const claimed = new Set<string>()
  const out = new Map<string, string>()

  for (const n of order) {
    const cur = byId.get(n.id)
    const desired = wanted.get(n.id) ?? relPathFor(n)
    const folder = dirOf(desired)
    const base = baseNameOf(desired)
    let candidate = desired
    for (let i = 2; i <= 500; i++) {
      const takenByOther = claimed.has(candidate)
      // 磁盘上已有该名字，但它既不是本篇的现名、也没被释放 → 属于未纳管文件，必须避让
      const wouldClobber = disk.has(candidate) && !freed.has(candidate) && candidate !== cur?.file
      if (!takenByOther && !wouldClobber) break
      const name = withSuffix(base, i) + MD_EXT
      candidate = folder ? `${folder}/${name}` : name
    }
    claimed.add(candidate)
    out.set(n.id, candidate)
  }
  return out
}

// -------------------------------------------------------------- 写盘计划

/**
 * 比对内存状态与磁盘账本，算出这次要写哪些 md、删哪些、meta 是否要更新。
 * deletes 只会包含 meta.json 索引里登记过的文件。
 */
export function planVaultWrite(
  notes: Note[],
  index: VaultIndexEntry[] | null,
  diskMdNames: string[],
  written: Map<string, WrittenNote>,
  lastMeta: string,
): VaultWritePlan {
  const names = assignFileNames(notes, index, diskMdNames)

  const writes: VaultWritePlan['writes'] = []
  for (const n of notes) {
    const file = names.get(n.id) ?? relPathFor(n)
    const text = toMarkdown(n)
    const prev = written.get(n.id)
    if (!prev || prev.file !== file || prev.text !== text) writes.push({ id: n.id, file, text })
  }

  const liveIds = new Set(notes.map((n) => n.id))
  const writtenFiles = new Set(writes.map((w) => w.file))
  const deletes = new Set<string>()
  for (const e of index ?? []) {
    if (!liveIds.has(e.id)) deletes.add(e.file)
    else if (names.get(e.id) !== e.file) deletes.add(e.file)
  }
  // 改名互换等场景：新名字已经写过了，就不能再删
  for (const f of [...deletes]) if (writtenFiles.has(f)) deletes.delete(f)

  const meta = buildMeta(notes, names)
  const index2: VaultIndexEntry[] = notes.map((n) => ({
    id: n.id,
    file: names.get(n.id) ?? relPathFor(n),
    title: n.title,
  }))

  return {
    writes,
    deletes: [...deletes],
    index: index2,
    meta,
    metaSkipped: meta === lastMeta,
    names,
  }
}
