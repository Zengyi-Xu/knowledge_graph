/**
 * vault 安全写入门禁（纯函数，不依赖浏览器 / Electron，便于单测）。
 *
 * 背景：2026-10-13 出过一次真实事故——旧客户端不认识 front matter 里的 `zoteroKeys` / `localPdf`，
 * 回写时把它不认识的字段整段抹掉（668 篇一起丢）。门禁按三层挡住这类写入：
 *
 *   1. 声明：写入方在 md 里写下 `formatVersion` / `minimumWriterVersion` / `requiredCapabilities`；
 *   2. 判定：读到超出自己能力的声明 → 只读（该篇只读，meta.json 自己的声明超限则整库只读），绝不回写；
 *   3. 兜底：任何回写都必须把「写入方不认识」的 front matter 字段原样带回，写盘计划里
 *      未纳管的 md 不写不删、索引里登记却读不到的文件直接中止。
 *
 * 缺失声明 = 基线（formatVersion 1 / 无最低写入方版本 / 无能力要求），老 vault 照常可写。
 * 接线（vaultFormat / 主进程写盘）见 docs/VAULT_WRITE_GATE.md；本模块只提供判定与过滤，不改磁盘格式。
 */
import type { Note } from '@/types/note'
import { NOTE_FORMAT } from '@/lib/vaultFormat'
import type { VaultIndexEntry, VaultWritePlan } from '@/lib/vaultFormat'

// ------------------------------------------------------------- 写入方与能力

/** 写进 md front matter 的声明字段（顺序即序列化顺序） */
export const DECLARATION_FIELDS = ['formatVersion', 'minimumWriterVersion', 'requiredCapabilities'] as const

/** 本客户端写出的磁盘格式代次；1 = 历史格式（没有声明） */
export const WRITER_FORMAT_VERSION = 2
/** 本客户端的能力修订号，与 minimumWriterVersion 比较 */
export const WRITER_VERSION = 2

/**
 * 能力名 = front matter 字段名。声明了 requiredCapabilities 的笔记，写入方必须能重新生成
 * 这些字段才有权回写；否则只读。2026-10-13 丢的就是这两个字段，所以它们是第一批能力。
 */
export const CAPABILITY_FIELDS = ['zoteroKeys', 'localPdf'] as const

/** `toMarkdown` 会重新生成的字段（小写）：不在这张表里的字段一律原样带回（未知字段保留） */
export const WRITER_FIELDS: readonly string[] = [
  'format',
  'formatversion',
  'id',
  'title',
  'type',
  'grade',
  'authors',
  'venue',
  'year',
  'doi',
  'citekey',
  'attachments',
  'collections',
  'zoterokey',
  'zoterokeys',
  'localpdf',
  'zoteropdfcount',
  'zoteroavailablepdfcount',
  'tags',
  'created',
  'updated',
  'minimumwriterversion',
  'requiredcapabilities',
]

/** 一个写入方的能力画像（测试里用它构造「旧客户端」） */
export interface WriterProfile {
  formatVersion: number
  version: number
  /** 能重新生成、因此允许覆盖的 front matter 字段名（小写） */
  fields: readonly string[]
}

export const CURRENT_WRITER: WriterProfile = {
  formatVersion: WRITER_FORMAT_VERSION,
  version: WRITER_VERSION,
  fields: WRITER_FIELDS,
}

// -------------------------------------------------------------- 声明与判定

export interface NoteDeclaration {
  formatVersion: number
  /** 0 = 没有最低写入方版本要求 */
  minimumWriterVersion: number
  requiredCapabilities: string[]
  /** 文件里是否真的写了这三个字段 */
  declared: boolean
}

/** 没有声明的文件（历史格式）按基线处理 */
export const BASELINE_DECLARATION: NoteDeclaration = {
  formatVersion: 1,
  minimumWriterVersion: 0,
  requiredCapabilities: [],
  declared: false,
}

export interface WriteGateVerdict {
  writable: boolean
  /** 只读理由（给人看：UI 横幅 / CLI 日志） */
  reasons: string[]
  /** 声明里有、本写入方没有的能力 */
  missingCapabilities: string[]
}

/** 这篇笔记实际用到了哪些「基线之外」的能力（能力名 = 字段名） */
export function requiredCapabilitiesFor(note: Note): string[] {
  const lit = note.literature
  const out: string[] = []
  if (lit?.zoteroKeys?.length) out.push('zoteroKeys')
  if (lit?.localPdf) out.push('localPdf')
  return out
}

/**
 * 声明字段对应的 front matter 行（交给 toMarkdown 拼进 front matter）。
 * 策略 B：只有带能力数据的笔记才写声明 —— 普通笔记保持逐字节不变，升级本身不触发任何重写。
 */
export function declarationLines(note: Note): string[] {
  const requiredCapabilities = requiredCapabilitiesFor(note)
  if (!requiredCapabilities.length) return []
  return [
    `formatVersion: ${WRITER_FORMAT_VERSION}`,
    // 带能力数据的笔记要求写入方至少是本代次（老客户端不认识这些字段的语义）
    `minimumWriterVersion: ${WRITER_VERSION}`,
    `requiredCapabilities: ${JSON.stringify(requiredCapabilities)}`,
  ]
}

/**
 * 磁盘上的声明能不能被这个写入方安全回写。
 * 认不出来的版本号（乱码 / 0 / 负数）按「更高的版本」处理 —— 宁可只读，也不要覆盖未知格式。
 */
export function checkWriteGate(decl: NoteDeclaration, writer: WriterProfile = CURRENT_WRITER): WriteGateVerdict {
  const reasons: string[] = []
  if (decl.formatVersion > writer.formatVersion) {
    reasons.push(`磁盘格式 formatVersion ${describeVersion(decl.formatVersion)} 高于本客户端支持的 ${writer.formatVersion}`)
  }
  if (decl.minimumWriterVersion > writer.version) {
    reasons.push(`要求写入方版本 ≥ ${describeVersion(decl.minimumWriterVersion)}，本客户端是 ${writer.version}`)
  }
  const known = new Set(writer.fields.map((f) => f.toLowerCase()))
  const missingCapabilities = decl.requiredCapabilities.filter((c) => !known.has(c.toLowerCase()))
  if (missingCapabilities.length) reasons.push(`缺少字段能力：${missingCapabilities.join('、')}`)
  return { writable: reasons.length === 0, reasons, missingCapabilities }
}

function describeVersion(value: number): string {
  return Number.isFinite(value) ? String(value) : '无法解析'
}

export interface VaultGateDecision {
  /** 整库只读：meta.json 自己的声明超出本客户端能力（连索引都不敢重建） */
  vaultReadOnly: boolean
  vaultReasons: string[]
  /** 逐篇只读的文件（gateKey 形式） */
  readOnlyFiles: Set<string>
  /** 逐篇只读的文件与理由（给人看） */
  blocked: { file: string; reasons: string[] }[]
}

/** 相对路径比较键：与 vaultFormat 的 pathKey 同规则（Windows 不区分大小写） */
export function gateKey(file: string): string {
  return (file ?? '').replace(/\\/g, '/').toLowerCase()
}

/**
 * 打开 vault 时的整体判定。
 * - meta.json 声明超限 → 整库只读（索引都不敢重建）；
 * - 某篇 md 声明超限 → 只有那一篇只读，其余照常可写（md 是自包含的，互不牵连）。
 */
export function decideVaultGate(
  files: { file: string; text: string }[],
  metaText: string | null,
  writer: WriterProfile = CURRENT_WRITER,
): VaultGateDecision {
  const metaVerdict = checkWriteGate(readMetaDeclaration(metaText), writer)
  const readOnlyFiles = new Set<string>()
  const blocked: { file: string; reasons: string[] }[] = []
  for (const f of files) {
    const verdict = checkWriteGate(readDeclaration(f.text), writer)
    if (verdict.writable) continue
    readOnlyFiles.add(gateKey(f.file))
    blocked.push({ file: f.file, reasons: verdict.reasons })
  }
  return {
    vaultReadOnly: !metaVerdict.writable,
    vaultReasons: metaVerdict.reasons,
    readOnlyFiles,
    blocked,
  }
}

// ------------------------------------------------------------ front matter 扫描

export interface FrontMatterField {
  key: string
  lower: string
  /** 字段行 `key: value` 里的 value 原文；块状列表（`tags:` 换行）为空串 */
  value: string
  /** 这个字段的全部原始行：上面的注释/空行 + 字段行 + 下面的续行与列表项 */
  lines: string[]
}

const FM_BLOCK_RE = /^---\n([\s\S]*?)\n---[ \t]*\n?/
const FM_FIELD_RE = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/

function normaliseNewlines(text: string): string {
  return (text ?? '').replace(/\r\n/g, '\n')
}

/**
 * 拆 front matter：字段块按「注释/空行跟到下一个字段、续行跟到上一个字段」归属，
 * 认不出的行也留在字段块里 —— 回写时原样带走，不丢东西。
 */
function scanFields(lines: string[]): { fields: FrontMatterField[]; tail: string[] } {
  const fields: FrontMatterField[] = []
  let pending: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    const m = trimmed && !trimmed.startsWith('#') ? line.match(FM_FIELD_RE) : null
    if (m) {
      fields.push({ key: m[1], lower: m[1].toLowerCase(), value: m[2], lines: [...pending, line] })
      pending = []
      continue
    }
    if (!trimmed || trimmed.startsWith('#')) {
      pending.push(line)
      continue
    }
    if (fields.length) fields[fields.length - 1].lines.push(line)
    else pending.push(line)
  }
  return { fields, tail: pending }
}

/** 拆出 front matter 与正文；没有 front matter 时 fields 为 null */
export function splitFrontMatter(text: string): { fields: FrontMatterField[] | null; rest: string } {
  const src = normaliseNewlines(text)
  const m = src.match(FM_BLOCK_RE)
  if (!m) return { fields: null, rest: src }
  const { fields, tail } = scanFields(m[1].split('\n'))
  // 结尾找不到归属的注释/空行也保住（伪字段，key 为空，永远算「不认识」）
  if (tail.length) fields.push({ key: '', lower: '', value: '', lines: tail })
  return { fields, rest: src.slice(m[0].length) }
}

/** 字段名（小写）→ 原始值；重复字段以第一个为准 */
export function frontMatterFields(text: string): Map<string, string> {
  const out = new Map<string, string>()
  const { fields } = splitFrontMatter(text)
  for (const f of fields ?? []) if (f.lower && !out.has(f.lower)) out.set(f.lower, f.value)
  return out
}

function stripQuotes(raw: string): string {
  const s = (raw ?? '').trim()
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

/** 版本号：缺失/空 → 基线；解析不出来 → 无穷大（保守只读） */
function parseVersion(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const s = stripQuotes(raw)
  if (!s) return fallback
  if (!/^\d+$/.test(s)) return Number.POSITIVE_INFINITY
  const n = Number(s)
  return n >= 1 ? n : Number.POSITIVE_INFINITY
}

function parseCapabilities(raw: string | undefined): string[] {
  if (raw === undefined) return []
  const s = stripQuotes(raw)
  if (!s || s === '[]') return []
  const item = (x: string) => stripQuotes(x).trim()
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s)
      if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean)
    } catch {
      /* 退回手工拆逗号 */
    }
    return s.replace(/^\[|\]$/g, '').split(',').map(item).filter(Boolean)
  }
  return s.split(',').map(item).filter(Boolean)
}

/**
 * 读一篇 md 的声明。
 * 同一个字段出现多次时取「最严」的那份（版本号取最大、能力取并集）：重复的声明不能让门禁放松。
 */
export function readDeclaration(text: string): NoteDeclaration {
  const fields = splitFrontMatter(text).fields ?? []
  let formatVersion = BASELINE_DECLARATION.formatVersion
  let minimumWriterVersion = BASELINE_DECLARATION.minimumWriterVersion
  const requiredCapabilities: string[] = []
  let declared = false
  for (const f of fields) {
    if (f.lower === 'formatversion') {
      declared = true
      formatVersion = Math.max(formatVersion, parseVersion(f.value, BASELINE_DECLARATION.formatVersion))
    } else if (f.lower === 'minimumwriterversion') {
      declared = true
      minimumWriterVersion = Math.max(minimumWriterVersion, parseVersion(f.value, BASELINE_DECLARATION.minimumWriterVersion))
    } else if (f.lower === 'requiredcapabilities') {
      declared = true
      for (const c of parseCapabilities(f.value)) if (!requiredCapabilities.includes(c)) requiredCapabilities.push(c)
    }
  }
  return { formatVersion, minimumWriterVersion, requiredCapabilities, declared }
}

/** 读 meta.json 顶层声明（可选镜像；meta 丢了也只是退回基线，不影响 md 的权威地位） */
export function readMetaDeclaration(metaText: string | null): NoteDeclaration {
  if (!metaText) return BASELINE_DECLARATION
  let raw: Record<string, unknown>
  try {
    const parsed = JSON.parse(metaText) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return BASELINE_DECLARATION
    raw = parsed as Record<string, unknown>
  } catch {
    return BASELINE_DECLARATION
  }
  const number = (value: unknown, fallback: number): number => {
    if (value === undefined || value === null || value === '') return fallback
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value
    return Number.POSITIVE_INFINITY
  }
  const caps = raw.requiredCapabilities
  const requiredCapabilities = Array.isArray(caps)
    ? caps.map((x) => String(x).trim()).filter(Boolean)
    : caps === undefined || caps === null || caps === ''
      ? []
      : [String(caps).trim()]
  return {
    formatVersion: number(raw.formatVersion, BASELINE_DECLARATION.formatVersion),
    minimumWriterVersion: number(raw.minimumWriterVersion, BASELINE_DECLARATION.minimumWriterVersion),
    requiredCapabilities,
    declared: 'formatVersion' in raw || 'minimumWriterVersion' in raw || 'requiredCapabilities' in raw,
  }
}

// -------------------------------------------------------------- 未知字段保留

/**
 * 重写这篇 md 时必须原样带回去的字段名（磁盘上有、但写入方不认识、因此无权覆盖）。
 * 2026-10-13 丢的 zoteroKeys / localPdf 对旧客户端来说就是两个「不认识」的字段。
 */
export function unknownKeys(diskText: string, writer: WriterProfile = CURRENT_WRITER): string[] {
  const { fields } = splitFrontMatter(diskText)
  const known = new Set(writer.fields.map((f) => f.toLowerCase()))
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of fields ?? []) {
    if (known.has(f.lower) || seen.has(f.lower)) continue
    seen.add(f.lower)
    out.push(f.key || '(注释)')
  }
  return out
}

/**
 * 把磁盘原文里「写入方不认识」的 front matter 字段合并进新文本：
 * - 新文本重新生成的字段以新值为准（字段被真正删除时不会复活）；
 * - 不认识的字段连同它上面的注释、下面的列表项一起原样搬回来；
 * - 没有要抢救的字段时逐字节返回新文本（老笔记的序列化结果保持不变）。
 */
export function mergeFrontMatter(diskText: string, nextText: string, writer: WriterProfile = CURRENT_WRITER): string {
  const next = splitFrontMatter(nextText)
  if (!next.fields) return nextText // 新文本没有 front matter，无从合并
  const disk = splitFrontMatter(diskText)
  if (!disk.fields) return nextText // 磁盘上没有 front matter（未纳管 / 新文件）
  const known = new Set(writer.fields.map((f) => f.toLowerCase()))
  const nextKeys = new Set(next.fields.map((f) => f.lower))
  const seen = new Set<string>()
  const keep: FrontMatterField[] = []
  for (const f of disk.fields) {
    if (known.has(f.lower) || nextKeys.has(f.lower) || seen.has(f.lower)) continue
    seen.add(f.lower)
    keep.push(f)
  }
  if (!keep.length) return nextText
  const lines = [...next.fields.flatMap((f) => f.lines), ...keep.flatMap((f) => f.lines)]
  return `---\n${lines.join('\n')}\n---\n${next.rest}`
}

// ---------------------------------------------------------------- 计划门禁

export interface GatePlanInput {
  plan: VaultWritePlan
  /** meta.json 的索引（判断「纳管/未纳管」的唯一依据） */
  index: VaultIndexEntry[]
  /** 磁盘上实际存在的 md（相对路径，来自列目录） */
  diskFiles: string[]
  /** 写盘前读到的磁盘原文，键为相对路径；读不到的文件不要放进这张表 */
  diskText: Map<string, string>
  writer?: WriterProfile
  /** 允许删除（默认 false：门禁一律不做删除，删除数恒为 0） */
  allowDeletes?: boolean
  /** 放行「索引里登记、磁盘上却读不到」的文件（默认 false = 直接中止） */
  allowMissing?: boolean
}

export interface GatePlanResult {
  plan: VaultWritePlan
  /** 只读、被跳过的文件与理由 */
  readOnly: { file: string; reasons: string[] }[]
  /** 被门禁丢弃的删除 */
  skippedDeletes: { file: string; reason: string }[]
  /** 索引里登记、磁盘上读不到的条目（allowMissing=false 时会先抛错，不会返回） */
  missing: string[]
  /** 新文本里补回的未知字段（便于日志与界面提示） */
  preserved: { file: string; keys: string[] }[]
}

/** 磁盘上的文本是不是本应用的笔记（认 format 标记；读不到就当「不是」） */
function isOurNote(text: string | undefined): boolean {
  if (text === undefined) return false
  return stripQuotes(frontMatterFields(text).get('format') ?? '') === NOTE_FORMAT
}

/**
 * 把门禁套在写盘计划上（纯函数，不改磁盘）：
 * - 去掉对未纳管 / 只读 / 索引外文件的写入与删除；
 * - 每个写回文本都先合并磁盘上的未知字段；
 * - 删除默认一律不做，`allowDeletes` 也要过「在索引里 + 不是只读」两道；
 * - 索引里登记却读不到正文的条目直接中止（同步盘离线时绝不静默丢索引）。
 */
export function gateWritePlan(input: GatePlanInput): GatePlanResult {
  const writer = input.writer ?? CURRENT_WRITER
  const diskText = new Map<string, string>()
  for (const [file, text] of input.diskText) if (!diskText.has(gateKey(file))) diskText.set(gateKey(file), text)
  const diskFiles = new Set(input.diskFiles.map(gateKey))
  const owned = new Set(input.index.map((e) => gateKey(e.file)))
  const plannedWrites = new Set(input.plan.writes.map((w) => gateKey(w.file)))
  const plannedDeletes = new Set(input.plan.deletes.map(gateKey))

  const missing: string[] = []
  for (const e of input.index) {
    const key = gateKey(e.file)
    if (plannedWrites.has(key)) continue // 计划里要（重新）写它
    if (plannedDeletes.has(key)) continue // 计划里要删它
    if (diskFiles.has(key) && diskText.has(key)) continue
    missing.push(e.file)
  }
  if (missing.length && !input.allowMissing) {
    throw new Error(
      `索引里登记的 md 在磁盘上读不到，为避免丢索引已中止写入：${missing.join('、')}；` +
        '请确认笔记库完整（同步盘已在本机）后重试，确实已永久删除再显式放行。',
    )
  }

  const readOnly: GatePlanResult['readOnly'] = []
  const preserved: GatePlanResult['preserved'] = []
  const blockedIds = new Set<string>()
  const writes: VaultWritePlan['writes'] = []
  const byId = new Map(input.index.map((e) => [e.id, e]))
  for (const w of input.plan.writes) {
    const key = gateKey(w.file)
    const disk = diskText.get(key)
    // 未纳管 md：盘上已有这个路径、索引里却没有登记过。除非它本来就是本应用的文件
    // （上一次写盘中断在写 meta 之前），否则一律不碰。
    if (!owned.has(key) && (disk !== undefined || diskFiles.has(key)) && !isOurNote(disk)) {
      readOnly.push({ file: w.file, reasons: ['同名文件不是本应用纳管的笔记，未纳管 md 一律不碰'] })
      blockedIds.add(w.id)
      continue
    }
    // 改名的笔记：声明在「当前文件」里，回写目标是新路径 —— 两边都要查，否则改个名就绕过门禁
    const source = byId.get(w.id)
    const sourceKey = source ? gateKey(source.file) : key
    const guardTexts = sourceKey === key ? [disk] : [disk, diskText.get(sourceKey)]
    let blocked: string[] | null = null
    for (const guardText of guardTexts) {
      if (guardText === undefined) continue
      const verdict = checkWriteGate(readDeclaration(guardText), writer)
      if (!verdict.writable) {
        blocked = verdict.reasons
        break
      }
    }
    if (blocked) {
      readOnly.push({ file: w.file, reasons: blocked })
      blockedIds.add(w.id)
      continue
    }
    const text = disk === undefined ? w.text : mergeFrontMatter(disk, w.text, writer)
    const keys = disk === undefined ? [] : unknownKeys(disk, writer)
    if (keys.length) preserved.push({ file: w.file, keys })
    writes.push({ ...w, text })
  }

  // 只读笔记的原文件不能因为「改名」被删掉
  const keepFiles = new Set<string>()
  for (const e of input.index) if (blockedIds.has(e.id)) keepFiles.add(gateKey(e.file))

  const skippedDeletes: GatePlanResult['skippedDeletes'] = []
  const deletes: string[] = []
  for (const file of input.plan.deletes) {
    const key = gateKey(file)
    if (!owned.has(key)) {
      skippedDeletes.push({ file, reason: '未纳管 md 一律不碰' })
      continue
    }
    if (!input.allowDeletes) {
      skippedDeletes.push({ file, reason: '门禁不做删除（写入方未显式放行）' })
      continue
    }
    if (keepFiles.has(key)) {
      skippedDeletes.push({ file, reason: '对应的笔记只读，保留原文件' })
      continue
    }
    const disk = diskText.get(key)
    if (disk === undefined && diskFiles.has(key)) {
      // 读不到正文就无法确认它是不是未来格式的笔记，宁可留个孤儿文件
      skippedDeletes.push({ file, reason: '读不到正文，无法确认可以删除' })
      continue
    }
    if (disk !== undefined && !checkWriteGate(readDeclaration(disk), writer).writable) {
      skippedDeletes.push({ file, reason: '文件声明的格式高于本客户端' })
      continue
    }
    deletes.push(file)
  }

  return {
    plan: { ...input.plan, writes, deletes },
    readOnly,
    skippedDeletes,
    missing,
    preserved,
  }
}
