// FROZEN(md-parser) 全冻结：内部实现是黑箱，不要读也不要改 → 契约见 docs/FROZEN.md
/**
 * Markdown 解析器（纯函数，不依赖 React / 浏览器）—— 产出 AST，由 Markdown.tsx 渲染。
 *
 * 目标：覆盖 Typora 支持的 Markdown 语法。
 *   块级：ATX(#~######) 与 Setext(=/-) 标题、段落、无序/有序列表（嵌套、紧凑/宽松、任务列表）、
 *         围栏代码块（``` / ~~~，带 info string）、缩进代码块、引用（可嵌套、惰性续行）、
 *         GFM 表格（对齐、转义竖线、代码内的竖线）、分隔线、定义列表、脚注定义、[TOC]、
 *         $$ 数学块、YAML 前置元数据、白名单原始 HTML 块
 *   行内：***粗斜体***、**粗体**、__粗体__、*斜体*、_斜体_、~~删除线~~、==高亮==、
 *         `行内代码`、![图片](地址 "标题")、[链接](地址 "标题")、引用式链接、<自动链接>、
 *         裸 URL、[[双链]]、#标签、~下标~、^上标^、$行内数学$、:emoji:、
 *         实体（&amp; &#65;）、行尾硬换行、反斜杠转义、白名单行内 HTML
 *
 * 与本应用既有观感一致的两处有意差异（不是 CommonMark 默认行为）：
 *   1. 段落内的软换行渲染成换行。Typora 编辑器里的软换行（Shift+Enter）也是这样显示的，
 *      而且能保留既有笔记里"一行一句"的排版。CommonMark 把软换行当空格。
 *   2. `1、项目`（中文顿号）也当作有序列表标记。
 *
 * 安全：链接只允许 https/mailto/tel/相对路径/锚点；HTML 只渲染白名单标签与属性，
 *       <script>/<iframe>/on*=/javascript: 等内容会被丢弃或转义成文字。
 */

export type Align = 'left' | 'center' | 'right' | null

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'del'; c: Inline[] }
  | { t: 'mark'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; title?: string; c: Inline[] }
  | { t: 'image'; src: string; alt: string; title?: string }
  | { t: 'wikilink'; target: string; alias?: string }
  | { t: 'tag'; v: string }
  | { t: 'sub'; c: Inline[] }
  | { t: 'sup'; c: Inline[] }
  | { t: 'br' }
  | { t: 'math'; v: string }
  | { t: 'emoji'; char: string; v: string }
  | { t: 'html'; v: string }
  | { t: 'footnote-ref'; label: string; index: number; id: string }

export interface ListItem {
  checked?: boolean
  blocks: Block[]
}

export interface DefItem {
  term: Inline[]
  defs: Inline[][]
}

export interface FootnoteItem {
  label: string
  index: number
  id: string
  refId: string
  blocks: Block[]
}

export interface TocItem {
  level: number
  text: string
  id: string
}

export type Block =
  | { t: 'heading'; level: number; c: Inline[]; id: string }
  | { t: 'paragraph'; c: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { t: 'code'; lang: string; info: string; v: string }
  | { t: 'math'; v: string }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'table'; align: Align[]; header: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' }
  | { t: 'deflist'; items: DefItem[] }
  | { t: 'html'; v: string }
  | { t: 'meta'; v: string }
  | { t: 'toc'; items: TocItem[] }
  | { t: 'footnotes'; items: FootnoteItem[] }

/** 解析上下文：引用式链接定义 + 已定义的脚注标签（由 parseMarkdown 预先收集）。 */
export interface ParseContext {
  refs: Map<string, { href: string; title?: string }>
  footnoteLabels: Set<string>
}

const EMPTY_CTX: ParseContext = { refs: new Map(), footnoteLabels: new Set() }

/* ------------------------------------------------------------------ 工具 */

/** 允许的链接地址：http(s)、mailto、tel、锚点、相对路径 */
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/|\.{1,2}\/)/i
/** 允许的图片地址：http(s)、data:image、锚点、相对路径 */
const SAFE_IMG = /^(?:https?:|data:image\/|#|\/|\.{1,2}\/)/i

/** 允许被反斜杠转义的字符 */
const ESCAPABLE = '\\`*_{}[]()#+-.!|~>^$="\''

function indentWidth(line: string): number {
  let w = 0
  for (const ch of line) {
    if (ch === ' ') w++
    else if (ch === '\t') w += 4
    else break
  }
  return w
}

/** 去掉最多 n 列的行首空白（tab 记 4 列） */
function stripIndent(line: string, n: number): string {
  let w = 0
  let k = 0
  while (k < line.length && w < n) {
    const ch = line[k]
    if (ch === ' ') {
      w++
      k++
    } else if (ch === '\t') {
      w += 4
      k++
    } else break
  }
  return line.slice(k)
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/* ------------------------------------------------------------------ 实体 / 表情 */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  minus: '−', times: '×', divide: '÷', frac12: '½', frac14: '¼',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  deg: '°', plusmn: '±', micro: 'µ', middot: '·', bull: '•', dagger: '†',
  sect: '§', para: '¶', permil: '‰', prime: '′', Prime: '″',
  larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔',
  lArr: '⇐', rArr: '⇒', hArr: '⇔',
  le: '≤', ge: '≥', ne: '≠', equiv: '≡', asymp: '≈', prop: '∝',
  infin: '∞', sum: '∑', prod: '∏', radic: '√', int: '∫', part: '∂',
  nabla: '∇', isin: '∈', notin: '∉', forall: '∀', exist: '∃',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω',
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε', Theta: 'Θ',
  Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}

const EMOJI: Record<string, string> = {
  smile: '😄', smiley: '😃', grin: '😁', grinning: '😀', joy: '😂', rofl: '🤣',
  wink: '😉', blush: '😊', heart_eyes: '😍', kissing_heart: '😘', smirk: '😏',
  sunglasses: '😎', thinking: '🤔', neutral_face: '😐', confused: '😕',
  cry: '😢', sob: '😭', angry: '😠', scream: '😱', sleeping: '😴',
  sweat_smile: '😅', stuck_out_tongue: '😛', zany: '🤪', nerd: '🤓',
  heart: '❤️', broken_heart: '💔', sparkling_heart: '💖', two_hearts: '💕',
  '+1': '👍', thumbsup: '👍', '-1': '👎', thumbsdown: '👎',
  ok_hand: '👌', clap: '👏', pray: '🙏', muscle: '💪', wave: '👋',
  point_right: '👉', point_left: '👈', point_up: '☝️', v: '✌️',
  fire: '🔥', rocket: '🚀', tada: '🎉', sparkles: '✨', star: '⭐', star2: '🌟',
  warning: '⚠️', bulb: '💡', eyes: '👀', '100': '💯', check: '✅',
  heavy_check_mark: '✔️', white_check_mark: '✅', x: '❌', zap: '⚡', boom: '💥',
  coffee: '☕', beer: '🍺', cake: '🍰', gift: '🎁', bell: '🔔', lock: '🔒',
  unlock: '🔓', key: '🔑', mag: '🔍', memo: '📝', pencil: '✏️', pushpin: '📌',
  books: '📚', book: '📖', link: '🔗', paperclip: '📎', file_folder: '📁',
  chart_with_upwards_trend: '📈', chart_with_downwards_trend: '📉', bar_chart: '📊',
  calendar: '📅', hourglass: '⏳', alarm_clock: '⏰', stopwatch: '⏱️',
  arrow_right: '➡️', arrow_left: '⬅️', arrow_up: '⬆️', arrow_down: '⬇️',
  question: '❓', exclamation: '❗', information_source: 'ℹ️', no_entry: '⛔',
  gear: '⚙️', wrench: '🔧', hammer: '🔨', bomb: '💣', shield: '🛡️',
  dna: '🧬', microscope: '🔬', test_tube: '🧪', satellite: '🛰️', satellite_antenna: '📡',
  computer: '💻', phone: '📱', email: '📧', globe_with_meridians: '🌐',
  earth_asia: '🌏', earth_americas: '🌎', sunny: '☀️', cloud: '☁️',
  snowflake: '❄️', ocean: '🌊', droplet: '💧', seedling: '🌱', herb: '🌿',
  four_leaf_clover: '🍀', maple_leaf: '🍁', cherry_blossom: '🌸', rose: '🌹',
  sunflower: '🌻', trophy: '🏆', medal_sports: '🏅', dart: '🎯', soccer: '⚽',
  basketball: '🏀', video_game: '🎮', art: '🎨', musical_note: '🎵',
  headphones: '🎧', microphone: '🎤', camera: '📷', movie_camera: '🎥',
  package: '📦', clipboard: '📋', scroll: '📜', bookmark: '🔖', label: '🏷️',
  white_flower: '💮', speech_balloon: '💬', thought_balloon: '💭',
  clock1: '🕐', date: '📆', triangular_flag_on_post: '🚩', flag_white: '🏳️',
  heavy_exclamation_mark: '❗', red_circle: '🔴', green_circle: '🟢',
  large_blue_circle: '🔵', white_circle: '⚪', black_circle: '⚫',
}

/** 行内 HTML 白名单（渲染成 span + 清洗后的 HTML 片段） */
const HTML_INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'big', 'br', 'cite', 'code', 'del', 'dfn', 'em',
  'i', 'img', 'ins', 'kbd', 'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
  'small', 'span', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr',
])

/** 块级 HTML 白名单 */
const HTML_BLOCK_TAGS = new Set([
  'article', 'aside', 'blockquote', 'br', 'caption', 'center', 'code', 'col',
  'colgroup', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption',
  'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'ins', 'kbd',
  'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'span',
  'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'u', 'ul', 'var', 'video', 'audio', 'source', 'picture',
])

const HTML_ALLOWED_ATTRS = new Set([
  'align', 'alt', 'class', 'colspan', 'dir', 'height', 'href', 'id', 'lang',
  'rowspan', 'src', 'start', 'style', 'title', 'type', 'width',
])

/** 清洗时允许保留的标签：行内白名单 ∪ 块级白名单 */
const HTML_SAFE_TAGS = new Set([...HTML_INLINE_TAGS, ...HTML_BLOCK_TAGS, 'a', 'abbr', 'b', 'i', 's', 'ins'])

const HTML_STYLE_PROPS = /^(?:color|background(?:-color)?|font(?:-(?:size|weight|style|family))?|text-(?:align|decoration)|line-height|letter-spacing|padding(?:-(?:top|right|bottom|left))?|margin(?:-(?:top|right|bottom|left))?|border(?:-(?:width|style|color|top|right|bottom|left))?|width|height|max-width|min-width|max-height|min-height|vertical-align|display|white-space|border-radius|opacity)$/i

/** 过滤 style 属性：只保留排版相关属性，丢弃 url()/expression()/javascript: */
function safeStyle(value: string): string {
  const kept: string[] = []
  for (const decl of value.split(';')) {
    const idx = decl.indexOf(':')
    if (idx < 0) continue
    const prop = decl.slice(0, idx).trim()
    const val = decl.slice(idx + 1).trim()
    if (!prop || !val) continue
    if (!HTML_STYLE_PROPS.test(prop)) continue
    if (/url\s*\(|expression\s*\(|javascript:|@import/i.test(val)) continue
    kept.push(`${prop}: ${val}`)
  }
  return kept.join('; ')
}

function safeAttrValue(name: string, value: string): string | null {
  if (name === 'href') return SAFE_URL.test(value) ? value : null
  if (name === 'src') return SAFE_IMG.test(value) ? value : null
  if (name === 'style') {
    const s = safeStyle(value)
    return s || null
  }
  if (/^(?:on|data-)/i.test(name)) return null
  return value
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** 清洗白名单 HTML：丢弃危险标签/属性，白名单外的标签转义成文字 */
function sanitizeHtml(src: string): string {
  let out = src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|svg|math|template|noscript)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|link|meta|base|form|svg|math|template|noscript)\b[^>]*>/gi, '')
  out = out.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\s*(\/?)>/g, (full, close, tag, attrs, selfClose) => {
    const name = String(tag).toLowerCase()
    if (!HTML_SAFE_TAGS.has(name)) return escapeHtmlText(full)
    if (close) return `</${name}>`
    const kept: string[] = []
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g
    let m: RegExpExecArray | null
    while ((m = attrRe.exec(attrs))) {
      const attrName = m[1].toLowerCase()
      if (!HTML_ALLOWED_ATTRS.has(attrName)) continue
      const raw = m[2]
      const value = raw[0] === '"' || raw[0] === "'" ? raw.slice(1, -1) : raw
      const safe = safeAttrValue(attrName, value)
      if (safe === null) continue
      kept.push(`${attrName}="${escapeAttr(safe)}"`)
    }
    return `<${name}${kept.length ? ' ' + kept.join(' ') : ''}${selfClose ? ' /' : ''}>`
  })
  return out
}

/* ------------------------------------------------------------------ 行内解析 */

function pushInline(out: Inline[], node: Inline) {
  const last = out[out.length - 1]
  if (node.t === 'text' && last && last.t === 'text') {
    last.v += node.v
    return
  }
  if (node.t === 'text' && node.v === '') return
  out.push(node)
}

/** 单字符 `~` / `^` 的 Typora 式上下标；双写（`~~`）留给删除线 */
function scriptSpan(src: string, delimiter: '~' | '^'): { value: string; length: number } | null {
  if (src[0] !== delimiter || src[1] === delimiter) return null
  let value = ''
  for (let i = 1; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\\' && (src[i + 1] === delimiter || src[i + 1] === ' ' || src[i + 1] === '\\')) {
      value += src[++i]
      continue
    }
    if (ch === delimiter) {
      if (!value || src[i + 1] === delimiter) return null
      return { value, length: i + 1 }
    }
    if (/\s/.test(ch)) return null
    value += ch
  }
  return null
}

/** 去掉链接标题的引号/括号包装 */
function unquoteTitle(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  if (!s) return undefined
  const first = s[0]
  if ((first === '"' && s.endsWith('"')) || (first === "'" && s.endsWith("'")) || (first === '(' && s.endsWith(')'))) {
    return s.slice(1, -1)
  }
  return s
}

function unwrapDestination(raw: string): string {
  const s = raw.trim()
  if (s.startsWith('<') && s.endsWith('>')) return s.slice(1, -1).trim()
  return s
}

/** 词内保护：下划线强调不在单词内部生效 */
function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\w\u4e00-\u9fa5]/.test(ch)
}

export function parseInline(src: string, ctx: ParseContext = EMPTY_CTX): Inline[] {
  const out: Inline[] = []
  let i = 0
  let buf = ''

  const flush = () => {
    if (buf) {
      pushInline(out, { t: 'text', v: buf })
      buf = ''
    }
  }
  const emit = (node: Inline) => {
    flush()
    pushInline(out, node)
  }
  const softBreak = () => {
    buf = buf.replace(/[ \t]+$/, '')
    emit({ t: 'br' })
  }

  while (i < src.length) {
    const rest = src.slice(i)
    const c0 = rest[0]
    let m: RegExpMatchArray | null

    // \ 转义与反斜杠硬换行
    if (c0 === '\\' && rest.length > 1) {
      if (rest[1] === '\n') {
        softBreak()
        i += 2
        continue
      }
      if (ESCAPABLE.includes(rest[1])) {
        buf += rest[1]
        i += 2
        continue
      }
    }

    // 换行 → 硬换行
    if (c0 === '\n') {
      softBreak()
      i++
      continue
    }

    // `行内代码` / ``支持反引号``
    if (c0 === '`') {
      const open = rest.match(/^`+/)![0]
      const close = rest.indexOf(open, open.length)
      if (close > 0) {
        let code = rest.slice(open.length, close)
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') {
          code = code.slice(1, -1)
        }
        emit({ t: 'code', v: code.replace(/\n/g, ' ') })
        i += close + open.length
        continue
      }
    }

    // ![图片](地址 "标题") / ![图片][ref]
    if (c0 === '!' && rest[1] === '[') {
      if ((m = rest.match(/^!\[([^\]]*)\]\(\s*(<[^>\n]*>|\S*?)(?:\s+("(?:[^"]*)"|'(?:[^']*)'|\((?:[^()]*)\)))?\s*\)/))) {
        const target = unwrapDestination(m[2])
        if (SAFE_IMG.test(target)) {
          emit({ t: 'image', src: target, alt: m[1], title: unquoteTitle(m[3]) })
          i += m[0].length
          continue
        }
      }
      if ((m = rest.match(/^!\[([^\]]*)\]\[([^\]]*)\]/))) {
        const label = (m[2] || m[1]).toLowerCase()
        const def = ctx.refs.get(label)
        if (def && SAFE_IMG.test(def.href)) {
          emit({ t: 'image', src: def.href, alt: m[1], title: def.title })
          i += m[0].length
          continue
        }
      }
    }

    // [[双链]] / [[双链|别名]]
    if (c0 === '[' && rest[1] === '[' && (m = rest.match(/^\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/))) {
      emit({ t: 'wikilink', target: m[1].trim(), alias: m[2]?.trim() })
      i += m[0].length
      continue
    }

    // 脚注引用 [^label]
    if (c0 === '[' && rest[1] === '^' && (m = rest.match(/^\[\^([^\]\s]+)\]/))) {
      if (ctx.footnoteLabels.has(m[1])) {
        emit({ t: 'footnote-ref', label: m[1], index: 0, id: '' })
        i += m[0].length
        continue
      }
    }

    // [文字](链接 "标题")
    if (c0 === '[' && (m = rest.match(/^\[([^\]]*)\]\(\s*(<[^>\n]*>|\S*?)(?:\s+("(?:[^"]*)"|'(?:[^']*)'|\((?:[^()]*)\)))?\s*\)/))) {
      const href = unwrapDestination(m[2])
      if (SAFE_URL.test(href)) {
        emit({ t: 'link', href, title: unquoteTitle(m[3]), c: parseInline(m[1], ctx) })
        i += m[0].length
        continue
      }
    }

    // [文字][ref] / [文字][] / [ref]
    if (c0 === '[') {
      if ((m = rest.match(/^\[([^\]]*)\]\[([^\]]*)\]/))) {
        const label = (m[2] || m[1]).toLowerCase()
        const def = ctx.refs.get(label)
        if (def && SAFE_URL.test(def.href)) {
          emit({ t: 'link', href: def.href, title: def.title, c: parseInline(m[1], ctx) })
          i += m[0].length
          continue
        }
      }
      if ((m = rest.match(/^\[([^\]\s]+)\](?!\()/))) {
        const def = ctx.refs.get(m[1].toLowerCase())
        if (def && SAFE_URL.test(def.href)) {
          emit({ t: 'link', href: def.href, title: def.title, c: parseInline(m[1], ctx) })
          i += m[0].length
          continue
        }
      }
    }

    // <自动链接> / <邮箱> / <sub> / <sup> / 白名单行内 HTML
    if (c0 === '<') {
      if ((m = rest.match(/^<((?:https?|mailto|tel):[^>\s]+)>/i))) {
        emit({ t: 'link', href: m[1], c: [{ t: 'text', v: m[1].replace(/^mailto:/i, '') }] })
        i += m[0].length
        continue
      }
      if ((m = rest.match(/^<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/))) {
        emit({ t: 'link', href: `mailto:${m[1]}`, c: [{ t: 'text', v: m[1] }] })
        i += m[0].length
        continue
      }
      if ((m = rest.match(/^<(sub|sup)>([\s\S]*?)<\/\1>/i))) {
        emit({ t: m[1].toLowerCase() as 'sub' | 'sup', c: parseInline(m[2], ctx) })
        i += m[0].length
        continue
      }
      if ((m = rest.match(/^<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/))) {
        const tag = m[1].toLowerCase()
        if (HTML_INLINE_TAGS.has(tag)) {
          const voidTag = m[3] === '/' || tag === 'br' || tag === 'wbr' || tag === 'img'
          if (voidTag) {
            emit({ t: 'html', v: sanitizeHtml(m[0]) })
            i += m[0].length
            continue
          }
          const closeIdx = rest.toLowerCase().indexOf(`</${tag}>`, m[0].length)
          if (closeIdx >= 0) {
            const inner = rest.slice(m[0].length, closeIdx)
            emit({ t: 'html', v: sanitizeHtml(m[0]) + sanitizeHtml(inner) + `</${tag}>` })
            i += closeIdx + tag.length + 3
            continue
          }
        }
      }
    }

    // ***粗斜体*** / ___粗斜体___（必须排在 ** 之前，否则 ***x*** 会被当成 ** 吃掉一个 *）
    if ((m = rest.match(/^\*\*\*(\S(?:[\s\S]*?\S)?)\*\*\*(?!\*)/)) || (m = rest.match(/^___(\S(?:[\s\S]*?\S)?)___(?!_)/))) {
      emit({ t: 'strong', c: [{ t: 'em', c: parseInline(m[1], ctx) }] })
      i += m[0].length
      continue
    }

    // **粗体** / __粗体__
    if ((m = rest.match(/^\*\*(\S(?:[\s\S]*?\S)?)\*\*(?!\*)/)) || (m = rest.match(/^__(\S(?:[\s\S]*?\S)?)__(?!_)/))) {
      emit({ t: 'strong', c: parseInline(m[1], ctx) })
      i += m[0].length
      continue
    }

    // ~~删除线~~
    if ((m = rest.match(/^~~(\S(?:[\s\S]*?\S)?)~~/))) {
      emit({ t: 'del', c: parseInline(m[1], ctx) })
      i += m[0].length
      continue
    }

    // ==高亮==
    if ((m = rest.match(/^==(\S(?:[\s\S]*?\S)?)==/))) {
      emit({ t: 'mark', c: parseInline(m[1], ctx) })
      i += m[0].length
      continue
    }

    // Typora 式单波浪线下标 / 单尖号上标（代码、链接、双波浪线优先）
    if ((c0 === '~' || c0 === '^') && (i === 0 || src[i - 1] !== c0)) {
      const span = scriptSpan(rest, c0 as '~' | '^')
      if (span) {
        emit({ t: c0 === '~' ? 'sub' : 'sup', c: [{ t: 'text', v: span.value }] })
        i += span.length
        continue
      }
    }

    // $行内数学$
    if (c0 === '$' && (m = rest.match(/^\$(?!\s)((?:\\[\s\S]|[^$\n])+?)(?<!\s)\$/))) {
      emit({ t: 'math', v: m[1] })
      i += m[0].length
      continue
    }

    // *斜体*：优先允许内部出现 **粗体**（*a **b*** 这类写法），再退回紧凑/宽松形式
    if (
      (m = rest.match(/^\*((?:[^*\n]|\*\*[^*\n]+\*\*)+)\*(?!\*)/)) ||
      (m = rest.match(/^\*(\S(?:[^*]*?\S)?)\*(?!\*)/)) ||
      (m = rest.match(/^\*(\S(?:[\s\S]*?\S)?)\*(?!\*)/))
    ) {
      emit({ t: 'em', c: parseInline(m[1], ctx) })
      i += m[0].length
      continue
    }

    // _斜体_（不在单词内部生效）
    if ((m = rest.match(/^_(\S(?:[^_]*?\S)?)_(?!_)/)) || (m = rest.match(/^_(\S(?:[\s\S]*?\S)?)_(?!_)/))) {
      const before = src[i - 1]
      const after = src[i + m[0].length]
      if (!isWordChar(before) && !isWordChar(after)) {
        emit({ t: 'em', c: parseInline(m[1], ctx) })
        i += m[0].length
        continue
      }
    }

    // :emoji:
    if (c0 === ':' && (m = rest.match(/^:([a-zA-Z0-9_+-]+):/))) {
      const char = EMOJI[m[1]] ?? EMOJI[m[1].toLowerCase()]
      if (char) {
        emit({ t: 'emoji', char, v: m[1] })
        i += m[0].length
        continue
      }
    }

    // 实体
    if (c0 === '&' && (m = rest.match(/^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/))) {
      const body = m[1]
      let decoded: string | null = null
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
        if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) decoded = String.fromCodePoint(code)
      } else {
        decoded = ENTITIES[body] ?? null
      }
      if (decoded !== null) {
        buf += decoded
        i += m[0].length
        continue
      }
    }

    // 裸 URL
    if ((m = rest.match(/^(https?:\/\/[^\s<>()[\]]+)/i))) {
      const url = m[1].replace(/[.,;:!?，。；：！？）)】」"']+$/, '')
      emit({ t: 'link', href: url, c: [{ t: 'text', v: url }] })
      i += url.length
      continue
    }

    // #标签（前面必须是行首或空白/标点，避免把 a#b 当标签）
    if (
      c0 === '#' &&
      (i === 0 || /[\s，。；：、,.;:!?()[\]{}"'\n]/.test(src[i - 1])) &&
      (m = rest.match(/^#([^\s#，。；：、,.;:!?()[\]{}"'`]+)/))
    ) {
      emit({ t: 'tag', v: m[1] })
      i += m[0].length
      continue
    }

    // 普通文本：攒到下一个可能触发语法/换行的字符
    const next = rest.search(/[\\`![<*_~^#&:$=\n]|https?:\/\//i)
    const take = next === -1 ? rest.length : next === 0 ? 1 : next
    buf += rest.slice(0, take)
    i += take
  }

  flush()
  return out
}

/* ------------------------------------------------------------------ 表格工具 */

/** 按未转义、且不在行内代码里的 | 切分一行表格，并把 \| 还原成 | */
export function splitRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let ticks = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '|'
      i++
      continue
    }
    if (ch === '`') {
      ticks++
      cur += ch
      continue
    }
    if (ch === '|' && ticks % 2 === 0) {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur)
  if (cells.length > 1 && cells[0].trim() === '') cells.shift()
  if (cells.length > 1 && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.map((c) => c.trim())
}

const TABLE_DELIM = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

function isTableDelim(line: string): boolean {
  return !!line && line.includes('-') && TABLE_DELIM.test(line)
}

function alignOf(cell: string): Align {
  const s = cell.trim()
  const l = s.startsWith(':')
  const r = s.endsWith(':')
  if (l && r) return 'center'
  if (r) return 'right'
  if (l) return 'left'
  return null
}

/* ------------------------------------------------------------------ 块级正则 */

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/
const RE_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const RE_QUOTE = /^ {0,3}>[ \t]?(.*)$/
const RE_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const RE_TASK = /^\[([ xX])\][ \t]+(.*)$/
const RE_TOC = /^ {0,3}\[TOC\][ \t]*$/i
const RE_MATH_OPEN = /^ {0,3}\$\$(.*)$/
const RE_DEF_ITEM = /^ {0,3}:[ \t]+(.*)$/
const RE_HTML_BLOCK = /^ {0,3}<(?:\/?([a-zA-Z][a-zA-Z0-9-]*)|!--)/

/* ------------------------------------------------------------------ 列表 */

interface Marker {
  indent: number
  width: number
  ordered: boolean
  start: number
  text: string
}

/**
 * 识别列表项。中文习惯：
 *   `- 项目`、`1. 项目`、`1) 项目` 需要标记后有空白；
 *   `1、项目`（顿号）可以没有空格；
 *   `1.5 倍` 不是有序列表，所以 `.` / `)` 后必须有空白或行尾。
 */
function matchItem(line: string): Marker | null {
  let m = line.match(/^([ \t]*)([-*+])(?:[ \t]+(.*)|[ \t]*)$/)
  if (m) {
    const spaces = m[3] === undefined ? 1 : m[0].length - m[1].length - 1 - m[3].length
    return {
      indent: indentWidth(m[1]),
      width: 1 + Math.min(4, Math.max(1, spaces)),
      ordered: false,
      start: 1,
      text: m[3] ?? '',
    }
  }
  m = line.match(/^([ \t]*)(\d{1,9})([.)])(?:[ \t]+(.*)|[ \t]*)$/)
  if (m) {
    const spaces = m[4] === undefined ? 1 : m[0].length - m[1].length - m[2].length - 1 - m[4].length
    return {
      indent: indentWidth(m[1]),
      width: 2 + Math.min(4, Math.max(1, spaces)),
      ordered: true,
      start: parseInt(m[2], 10) || 1,
      text: m[4] ?? '',
    }
  }
  m = line.match(/^([ \t]*)(\d{1,9})(、)[ \t]*(.*)$/)
  if (m) {
    return {
      indent: indentWidth(m[1]),
      width: m[2].length + m[3].length + 1,
      ordered: true,
      start: parseInt(m[2], 10) || 1,
      text: m[4] ?? '',
    }
  }
  return null
}

/** 这一行会不会开启一个新的块（用于段落/引用的终止判断） */
function startsBlock(line: string): boolean {
  return (
    RE_HEADING.test(line) ||
    RE_FENCE.test(line) ||
    RE_HR.test(line) ||
    RE_QUOTE.test(line) ||
    RE_HTML_BLOCK.test(line) ||
    RE_TOC.test(line) ||
    RE_MATH_OPEN.test(line) ||
    matchItem(line) !== null
  )
}

/* ------------------------------------------------------------------ 预扫描：定义 */

/** 收集引用式链接定义 [label]: url "title"，并从正文里删除这些行 */
function extractRefs(lines: string[], refs: Map<string, { href: string; title?: string }>): string[] {
  const keep: string[] = []
  const RE_REF = /^ {0,3}\[([^\]]+)\]:[ \t]*(<[^>]*>|[^\s]+)(?:[ \t]+("[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*$/
  for (const line of lines) {
    const m = line.match(RE_REF)
    if (m && !m[1].startsWith('^')) {
      refs.set(m[1].toLowerCase(), { href: unwrapDestination(m[2]), title: unquoteTitle(m[3]) })
      continue
    }
    keep.push(line)
  }
  return keep
}

/** 收集脚注定义 [^label]: 内容（含缩进续行），并从正文里删除这些行 */
function extractFootnotes(
  lines: string[],
  defs: Map<string, { text: string }>,
  labels: Set<string>,
): string[] {
  const keep: string[] = []
  const RE_FN = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/
  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(RE_FN)
    if (!m) {
      keep.push(lines[i])
      i++
      continue
    }
    const body: string[] = [m[2]]
    i++
    while (i < lines.length) {
      const cur = lines[i]
      if (/^\s*$/.test(cur)) {
        if (indentWidth(lines[i + 1] ?? '') >= 2) {
          body.push('')
          i++
          continue
        }
        break
      }
      if (indentWidth(cur) >= 2) {
        body.push(stripIndent(cur, 2))
        i++
        continue
      }
      break
    }
    defs.set(m[1], { text: body.join('\n') })
    labels.add(m[1])
  }
  return keep
}

/* ------------------------------------------------------------------ 块级解析 */

function isFenceClose(line: string, fence: string): boolean {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)
  return !!m && m[1][0] === fence[0] && m[1].length >= fence.length
}

export function parseMarkdown(src: string, ctx: ParseContext = EMPTY_CTX): Block[] {
  const rawLines = src.replace(/\r\n?/g, '\n').split('\n')

  // ---- 前置元数据（只在文档最开头） ----
  let lines = rawLines
  let meta: Block | null = null
  if (rawLines[0]?.trim() === '---') {
    const end = rawLines.findIndex((l, idx) => idx > 0 && (l.trim() === '---' || l.trim() === '...'))
    if (end > 0) {
      meta = { t: 'meta', v: rawLines.slice(1, end).join('\n') }
      lines = rawLines.slice(end + 1)
    }
  }

  // ---- 预扫描：脚注定义 / 引用式链接定义 ----
  const footnoteDefs = new Map<string, { text: string }>()
  lines = extractFootnotes(lines, footnoteDefs, ctx.footnoteLabels)
  lines = extractRefs(lines, ctx.refs)

  const blocks = parseBlocks(lines, ctx)
  return finalize(meta ? [meta, ...blocks] : blocks, footnoteDefs)
}

function parseBlocks(lines: string[], ctx: ParseContext): Block[] {
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (/^\s*$/.test(line)) {
      i++
      continue
    }

    // [TOC]
    if (RE_TOC.test(line)) {
      blocks.push({ t: 'toc', items: [] })
      i++
      continue
    }

    // 围栏代码块
    let m = line.match(RE_FENCE)
    if (m) {
      const fence = m[1]
      const info = (m[2] ?? '').trim()
      const lang = info.split(/[\s{]/)[0]
      const body: string[] = []
      i++
      while (i < lines.length && !isFenceClose(lines[i], fence)) {
        body.push(lines[i])
        i++
      }
      i++
      blocks.push({ t: 'code', lang, info, v: body.join('\n') })
      continue
    }

    // $$ 数学块
    m = line.match(RE_MATH_OPEN)
    if (m) {
      const body: string[] = []
      const same = m[1].includes('$$')
      const first = same ? m[1].replace(/\$\$.*$/, '') : m[1]
      if (first.trim()) body.push(first)
      i++
      while (!same && i < lines.length && !/\$\$[ \t]*$/.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      if (!same && i < lines.length) {
        const tail = lines[i].replace(/\$\$[ \t]*$/, '')
        if (tail.trim()) body.push(tail)
        i++
      }
      blocks.push({ t: 'math', v: body.join('\n').trim() })
      continue
    }

    // 分隔线
    if (RE_HR.test(line)) {
      blocks.push({ t: 'hr' })
      i++
      continue
    }

    // ATX 标题
    m = line.match(RE_HEADING)
    if (m) {
      blocks.push({ t: 'heading', level: m[1].length, c: parseInline((m[2] ?? '').trim(), ctx), id: '' })
      i++
      continue
    }

    // 引用（含惰性续行）
    if (RE_QUOTE.test(line)) {
      const inner: string[] = []
      while (i < lines.length) {
        const q = lines[i].match(RE_QUOTE)
        if (q) {
          inner.push(q[1])
          i++
          continue
        }
        if (/^\s*$/.test(lines[i])) {
          if (RE_QUOTE.test(lines[i + 1] ?? '')) {
            inner.push('')
            i++
            continue
          }
          break
        }
        if (!startsBlock(lines[i])) {
          inner.push(lines[i])
          i++
          continue
        }
        break
      }
      blocks.push({ t: 'quote', blocks: parseBlocks(inner, ctx) })
      continue
    }

    // 表格：本行含 | 且下一行是分隔行
    if (line.includes('|') && isTableDelim(lines[i + 1] ?? '')) {
      const header = splitRow(line).map((c) => parseInline(c, ctx))
      const align = splitRow(lines[i + 1]).map(alignOf)
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && !/^\s*$/.test(lines[i]) && lines[i].includes('|') && !startsBlock(lines[i])) {
        const cells = splitRow(lines[i])
        while (cells.length < header.length) cells.push('')
        rows.push(cells.slice(0, header.length).map((c) => parseInline(c, ctx)))
        i++
      }
      blocks.push({ t: 'table', align, header, rows })
      continue
    }

    // 定义列表
    if (!startsBlock(line) && RE_DEF_ITEM.test(lines[i + 1] ?? '')) {
      const items: DefItem[] = []
      while (i < lines.length && !/^\s*$/.test(lines[i]) && RE_DEF_ITEM.test(lines[i + 1] ?? '')) {
        const term = parseInline(lines[i].trim(), ctx)
        i++
        const defs: Inline[][] = []
        while (i < lines.length && RE_DEF_ITEM.test(lines[i])) {
          const d: string[] = [lines[i].match(RE_DEF_ITEM)![1]]
          i++
          while (i < lines.length && indentWidth(lines[i]) >= 2 && !RE_DEF_ITEM.test(lines[i]) && !/^\s*$/.test(lines[i])) {
            d.push(stripIndent(lines[i], 2))
            i++
          }
          defs.push(parseInline(d.join('\n'), ctx))
        }
        items.push({ term, defs })
        while (i < lines.length && /^\s*$/.test(lines[i]) && RE_DEF_ITEM.test(lines[i + 1] ?? '')) i++
      }
      blocks.push({ t: 'deflist', items })
      continue
    }

    // 列表
    const mk = matchItem(line)
    if (mk) {
      const res = parseList(lines, i, ctx)
      blocks.push(res.block)
      i = res.next
      continue
    }

    // 块级 HTML
    m = line.match(RE_HTML_BLOCK)
    if (m) {
      const tag = (m[1] ?? '').toLowerCase()
      const body: string[] = []
      if (line.includes('<!--')) {
        while (i < lines.length && !body.some((l) => l.includes('-->'))) {
          body.push(lines[i])
          i++
        }
      } else if (tag && HTML_BLOCK_TAGS.has(tag)) {
        while (i < lines.length && !/^\s*$/.test(lines[i])) {
          body.push(lines[i])
          const done = new RegExp(`</${tag}>`, 'i').test(lines[i]) || /\/>[ \t]*$/.test(lines[i])
          i++
          if (done) break
        }
      }
      if (body.length) {
        blocks.push({ t: 'html', v: sanitizeHtml(body.join('\n')) })
        continue
      }
      m = null
    }

    // 缩进代码块
    if (/^(?: {4}|\t)/.test(line)) {
      const body: string[] = []
      while (i < lines.length && (/^(?: {4}|\t)/.test(lines[i]) || /^\s*$/.test(lines[i]))) {
        body.push(/^(?: {4}|\t)/.test(lines[i]) ? lines[i].replace(/^(?: {4}|\t)/, '') : '')
        i++
      }
      while (body.length && body[body.length - 1] === '') body.pop()
      blocks.push({ t: 'code', lang: '', info: '', v: body.join('\n') })
      continue
    }

    // 段落（含 Setext 标题）
    const para: string[] = [line]
    let setext: 1 | 2 | null = null
    i++
    while (i < lines.length) {
      const cur = lines[i]
      if (/^\s*$/.test(cur)) break
      // Setext 下划线要在 startsBlock 之前判断：`---` 同时是分隔线
      const underline = cur.match(RE_SETEXT)
      if (underline) {
        setext = underline[1][0] === '=' ? 1 : 2
        i++
        break
      }
      if (startsBlock(cur)) break
      if (cur.includes('|') && isTableDelim(lines[i + 1] ?? '')) break
      para.push(cur)
      i++
    }
    if (setext) {
      blocks.push({ t: 'heading', level: setext, c: parseInline(para.join(' '), ctx), id: '' })
      continue
    }
    blocks.push({ t: 'paragraph', c: parseInline(para.join('\n'), ctx) })
  }

  return blocks
}

/** 解析一个列表（从 lines[start] 开始），返回块与下一个待处理下标 */
function parseList(lines: string[], start: number, ctx: ParseContext): { block: Block; next: number } {
  const first = matchItem(lines[start])!
  const baseIndent = first.indent
  const ordered = first.ordered
  const listStart = first.start
  const items: ListItem[] = []
  let loose = false
  let i = start

  while (i < lines.length) {
    const mk = matchItem(lines[i])
    if (!mk || mk.indent !== baseIndent || mk.ordered !== ordered) break

    const contentIndent = mk.indent + mk.width
    const content: string[] = mk.text ? [mk.text] : []
    i++

    while (i < lines.length) {
      const cur = lines[i]
      if (/^\s*$/.test(cur)) {
        const nxt = lines[i + 1] ?? ''
        const nm = matchItem(nxt)
        const deeper = indentWidth(nxt) >= contentIndent || !!(nm && nm.indent > baseIndent)
        if (nxt !== '' && deeper) {
          content.push('')
          i++
          loose = true
          continue
        }
        break
      }
      const nm = matchItem(cur)
      if (nm && nm.indent <= baseIndent) break
      if (indentWidth(cur) > baseIndent) {
        content.push(stripIndent(cur, contentIndent))
        i++
        continue
      }
      // 与标记同缩进的续行：惰性段落续行（遇到新的块则结束该项）
      if (content.length > 0 && !startsBlock(cur)) {
        content.push(cur)
        i++
        continue
      }
      break
    }

    let checked: boolean | undefined
    const task = content[0]?.match(RE_TASK)
    if (task) {
      checked = task[1].toLowerCase() === 'x'
      content[0] = task[2]
    }
    items.push({ checked, blocks: parseBlocks(content, ctx) })

    // 项之间可以有空行；若后面还有同级项，说明是宽松列表
    let j = i
    while (j < lines.length && /^\s*$/.test(lines[j])) j++
    const nm = j < lines.length ? matchItem(lines[j]) : null
    if (nm && nm.indent === baseIndent && nm.ordered === ordered) {
      if (j > i) loose = true
      i = j
      continue
    }
    break
  }

  return { block: { t: 'list', ordered, start: listStart, tight: !loose, items }, next: i }
}

/* ------------------------------------------------------------------ 后处理 */

function inlineText(nodes: Inline[]): string {
  let out = ''
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
      case 'code':
      case 'math':
        out += n.v
        break
      case 'emoji':
        out += n.char
        break
      case 'html':
        out += n.v.replace(/<[^>]*>/g, '')
        break
      case 'footnote-ref':
        out += n.label
        break
      case 'br':
        out += ' '
        break
      case 'tag':
        out += '#' + n.v
        break
      case 'wikilink':
        out += n.alias ?? n.target
        break
      case 'image':
        out += n.alt
        break
      default:
        if ('c' in n) out += inlineText(n.c)
    }
  }
  return out
}

function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base || 'section'
}

function walkBlocks(blocks: Block[], visit: (b: Block) => void): void {
  for (const b of blocks) {
    visit(b)
    if (b.t === 'quote') walkBlocks(b.blocks, visit)
    else if (b.t === 'list') for (const it of b.items) walkBlocks(it.blocks, visit)
    else if (b.t === 'footnotes') for (const it of b.items) walkBlocks(it.blocks, visit)
  }
}

function walkInlines(blocks: Block[], visit: (n: Inline) => void): void {
  const inl = (nodes: Inline[]) => {
    for (const n of nodes) {
      visit(n)
      if (n.t === 'strong' || n.t === 'em' || n.t === 'del' || n.t === 'mark' || n.t === 'sub' || n.t === 'sup') inl(n.c)
    }
  }
  const rec = (bs: Block[]) => {
    for (const b of bs) {
      switch (b.t) {
        case 'heading':
        case 'paragraph':
          inl(b.c)
          break
        case 'list':
          for (const it of b.items) rec(it.blocks)
          break
        case 'quote':
          rec(b.blocks)
          break
        case 'table':
          b.header.forEach(inl)
          b.rows.forEach((r) => r.forEach(inl))
          break
        case 'deflist':
          for (const it of b.items) {
            inl(it.term)
            it.defs.forEach(inl)
          }
          break
        case 'footnotes':
          for (const it of b.items) rec(it.blocks)
          break
        default:
          break
      }
    }
  }
  rec(blocks)
}

function finalize(blocks: Block[], footnoteDefs: Map<string, { text: string }>): Block[] {
  // 标题 id + [TOC] 目录
  const toc: TocItem[] = []
  const used = new Map<string, number>()
  walkBlocks(blocks, (b) => {
    if (b.t !== 'heading') return
    const text = inlineText(b.c)
    const base = slugify(text)
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    b.id = seen === 0 ? base : `${base}-${seen}`
    toc.push({ level: b.level, text, id: b.id })
  })
  walkBlocks(blocks, (b) => {
    if (b.t === 'toc') b.items = toc
  })

  // 脚注编号（按引用出现顺序）
  const order: string[] = []
  walkInlines(blocks, (n) => {
    if (n.t === 'footnote-ref' && !order.includes(n.label)) order.push(n.label)
  })
  if (order.length) {
    const indexOf = new Map(order.map((label, idx) => [label, idx + 1]))
    walkInlines(blocks, (n) => {
      if (n.t !== 'footnote-ref') return
      const idx = indexOf.get(n.label) ?? 0
      n.index = idx
      n.id = `fnref-${idx}`
    })
    const items: FootnoteItem[] = []
    for (const label of order) {
      const def = footnoteDefs.get(label)
      if (!def) continue
      const idx = indexOf.get(label)!
      items.push({
        label,
        index: idx,
        id: `fn-${idx}`,
        refId: `fnref-${idx}`,
        blocks: parseBlocks(def.text.split('\n'), EMPTY_CTX),
      })
    }
    if (items.length) blocks.push({ t: 'footnotes', items })
  }
  return blocks
}
