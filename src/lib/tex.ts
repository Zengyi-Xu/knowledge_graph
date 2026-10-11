/**
 * 极简 LaTeX（数学模式）解析器：把 $...$ / $$...$$ 里的内容变成可渲染的节点树。
 *
 * 只覆盖笔记里常见的写法：上下标、\frac、\sqrt、希腊字母、常用运算符、\text{}、
 * 矩阵/环境等一律不支持 —— 遇到不认识的命令、括号不配对、& 或 \\ 时返回 null，
 * 调用方会退回显示原始源码（宁可显示源码，也不显示错乱的公式）。
 *
 * 这不是 MathJax/KaTeX 的替代品：它不做布局、不做字体度量，只是把公式排版成
 * "接近数学排版"的 HTML（分式用两层 span，根号用上划线）。
 */

export type Tex =
  | { t: 'var'; v: string }
  | { t: 'ord'; v: string }
  | { t: 'op'; v: string }
  | { t: 'group'; c: Tex[] }
  | { t: 'frac'; num: Tex[]; den: Tex[] }
  | { t: 'sqrt'; idx?: Tex[]; c: Tex[] }
  | { t: 'sup'; c: Tex[] }
  | { t: 'sub'; c: Tex[] }
  | { t: 'subsup'; sub: Tex[]; sup: Tex[] }
  | { t: 'space'; w: string }
  | { t: 'text'; v: string }
  | { t: 'accent'; mark: string; below?: boolean; c: Tex[] }

/** 希腊字母与常用符号 */
const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  cdot: '·', cdots: '⋯', ldots: '…', dots: '…', vdots: '⋮', ddots: '⋱',
  times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘',
  bullet: '•', oplus: '⊕', ominus: '⊖', otimes: '⊗', odot: '⊙',
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭',
  oint: '∮', bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', equiv: '≡',
  approx: '≈', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', asymp: '≍',
  ll: '≪', gg: '≫', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇',
  in: '∈', notin: '∉', ni: '∋', cup: '∪', cap: '∩', setminus: '∖',
  emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', nexists: '∄',
  neg: '¬', land: '∧', lor: '∨', therefore: '∴', because: '∵',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',
  uparrow: '↑', downarrow: '↓', updownarrow: '↕', hookrightarrow: '↪',
  partial: '∂', nabla: '∇', infty: '∞', angle: '∠', perp: '⊥', parallel: '∥',
  prime: '′', dagger: '†', ell: 'ℓ', hbar: 'ℏ', Re: 'ℜ', Im: 'ℑ',
  aleph: 'ℵ', wp: '℘', imath: 'ı', jmath: 'ȷ',
  quad: '\u2003', qquad: '\u2003\u2003',
}

/** 大运算符（上下标放在正上/正下方） */
const BIG_OPS = new Set(['sum', 'prod', 'coprod', 'int', 'iint', 'iiint', 'oint', 'bigcup', 'bigcap', 'bigoplus', 'bigotimes'])

/** 取文本的宏（内含内容按普通文字处理） */
const TEXT_MACROS = new Set(['text', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'operatorname', 'mbox'])

/** 间距宏 */
const SPACES: Record<string, string> = {
  ',': '0.17em', ':': '0.22em', ';': '0.28em', '!': '-0.17em',
  ' ': '0.25em', quad: '1em', qquad: '2em', thinspace: '0.17em',
}

/** 函数名（正体，前后留一点空隙） */
const FUNCS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'det', 'dim',
  'deg', 'gcd', 'hom', 'ker', 'arg', 'max', 'min', 'sup', 'inf', 'lim',
  'limsup', 'liminf', 'mod', 'bmod', 'pmod',
])

/** 重音符宏 */
const ACCENTS: Record<string, { mark: string; below?: boolean }> = {
  hat: { mark: '^' }, widehat: { mark: '^' }, check: { mark: 'ˇ' },
  breve: { mark: '˘' }, acute: { mark: '´' }, grave: { mark: '`' },
  tilde: { mark: '~' }, widetilde: { mark: '~' }, bar: { mark: '‾' },
  overline: { mark: '‾' }, vec: { mark: '→' }, dot: { mark: '·' },
  ddot: { mark: '··' }, mathring: { mark: '˚' }, underline: { mark: '_', below: true },
}

/** 括号类宏 */
const DELIMS: Record<string, string> = {
  lbrace: '{', rbrace: '}', langle: '⟨', rangle: '⟩', lvert: '|', rvert: '|',
  vert: '|', Vert: '‖', lVert: '‖', rVert: '‖', lceil: '⌈', rceil: '⌉',
  lfloor: '⌊', rfloor: '⌋', ldotp: '.', lgroup: '(', rgroup: ')', langle2: '⟨',
}

const STYLE_MACROS = new Set([
  'displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits',
  'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr',
])

interface P {
  s: string
  i: number
}

/** 读一个宏名（\ 后面的字母序列） */
function readMacro(p: P): string {
  const m = p.s.slice(p.i).match(/^[a-zA-Z]+/)
  if (m) {
    p.i += m[0].length
    return m[0]
  }
  // \\, \\; 这类单字符宏
  const ch = p.s[p.i]
  p.i++
  return ch ?? ''
}

/** 读一个参数：{...} 或单个原子 */
function parseArg(p: P): Tex[] | null {
  skipSpaces(p)
  if (p.s[p.i] === '{') return parseGroup(p)
  const node = parseAtom(p, true)
  return node ? node : null
}

function parseGroup(p: P): Tex[] | null {
  if (p.s[p.i] !== '{') return null
  p.i++
  const out: Tex[] = []
  while (p.i < p.s.length && p.s[p.i] !== '}') {
    const node = parseAtom(p, false)
    if (!node) return null
    out.push(...node)
  }
  if (p.s[p.i] !== '}') return null
  p.i++
  return out
}

function skipSpaces(p: P) {
  while (p.s[p.i] === ' ') p.i++
}

const UNSUPPORTED_TEX = /\\begin|\\end|\\hline|&|\$\$/

/** 解析一个原子（可能带上下标），返回节点数组；失败返回 null */
function parseAtom(p: P, single: boolean): Tex[] | null {
  skipSpaces(p)
  if (p.i >= p.s.length) return null
  const ch = p.s[p.i]
  let base: Tex[] | null = null
  let isFunc = false

  if (ch === '{') {
    base = parseGroup(p)
    if (!base) return null
    base = [{ t: 'group', c: base }]
  } else if (ch === '\\') {
    p.i++
    const name = readMacro(p)
    if (name in SPACES) {
      base = [{ t: 'space', w: SPACES[name] }]
    } else if (name in DELIMS) {
      base = [{ t: 'ord', v: DELIMS[name] }]
    } else if (name in SYMBOLS) {
      base = BIG_OPS.has(name) ? [{ t: 'op', v: SYMBOLS[name] }] : [{ t: 'ord', v: SYMBOLS[name] }]
    } else if (FUNCS.has(name)) {
      isFunc = true
      base = [{ t: 'ord', v: name === 'bmod' || name === 'pmod' ? 'mod' : name }]
    } else if (name in ACCENTS) {
      const arg = parseArg(p)
      if (!arg) return null
      base = [{ t: 'accent', mark: ACCENTS[name].mark, below: ACCENTS[name].below, c: arg }]
    } else if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const num = parseArg(p)
      if (!num) return null
      const den = parseArg(p)
      if (!den) return null
      base = [{ t: 'frac', num, den }]
    } else if (name === 'sqrt') {
      let idx: Tex[] | undefined
      if (p.s[p.i] === '[') {
        const close = p.s.indexOf(']', p.i)
        if (close < 0) return null
        const inner: P = { s: p.s.slice(p.i + 1, close), i: 0 }
        const parsed = parseBody(inner)
        if (!parsed || inner.i !== inner.s.length) return null
        idx = parsed
        p.i = close + 1
      }
      const body = parseArg(p)
      if (!body) return null
      base = [{ t: 'sqrt', idx, c: body }]
    } else if (TEXT_MACROS.has(name)) {
      skipSpaces(p)
      if (p.s[p.i] !== '{') return null
      const close = p.s.indexOf('}', p.i)
      if (close < 0) return null
      const raw = p.s.slice(p.i + 1, close)
      // \text{} 里允许转义空格与 \{ \}
      const text = raw.replace(/\\([{} \\])/g, '$1')
      p.i = close + 1
      base = [{ t: TEXT_MACROS.has(name) && name !== 'text' ? 'ord' : 'text', v: text }]
    } else if (STYLE_MACROS.has(name)) {
      if (name === 'left' || name === 'right' || name.startsWith('big')) {
        skipSpaces(p)
        const d = p.s[p.i]
        if (d === '\\') {
          p.i++
          const dn = readMacro(p)
          base = [{ t: 'ord', v: dn in DELIMS ? DELIMS[dn] : '.' }]
        } else if (d && d !== '\n') {
          p.i++
          if (d === '.') return [] // \left. / \right. 空定界符
          base = [{ t: 'ord', v: d }]
        } else return null
      } else {
        base = []
      }
    } else if (name === '\\') {
      return null // 换行（矩阵/多行公式）不支持
    } else {
      return null // 不认识的宏
    }
  } else if (ch === '$' || ch === '&' || ch === '~' || ch === '\n') {
    return null
  } else if (/[0-9.]/.test(ch)) {
    const m = p.s.slice(p.i).match(/^[0-9]+(?:\.[0-9]+)?/)
    p.i += m![0].length
    base = [{ t: 'ord', v: m![0] }]
  } else if (/[a-zA-Z]/.test(ch)) {
    p.i++
    base = [{ t: 'var', v: ch }]
  } else if (ch === ')' || ch === ']' || ch === '}' || ch === '^' || ch === '_') {
    return null
  } else {
    p.i++
    base = [{ t: 'ord', v: ch }]
  }

  if (!base) return null

  // 上下标
  let sup: Tex[] | undefined
  let sub: Tex[] | undefined
  for (let guard = 0; guard < 4; guard++) {
    const c = p.s[p.i]
    if (c === '^' && !sup) {
      p.i++
      const arg = parseArg(p)
      if (!arg) return null
      sup = arg
      continue
    }
    if (c === '_' && !sub) {
      p.i++
      const arg = parseArg(p)
      if (!arg) return null
      sub = arg
      continue
    }
    break
  }
  // 上下标追加在基底之后（不能替换基底，否则 σ_w 会丢掉 σ）
  if (sup && sub) base = [...base, { t: 'subsup', sub, sup }]
  else if (sup) base = [...base, { t: 'sup', c: sup }]
  else if (sub) base = [...base, { t: 'sub', c: sub }]
  else if (isFunc) base = [...base, { t: 'space', w: '0.17em' }]

  if (single) return base
  return base
}

function parseBody(p: P): Tex[] | null {
  const out: Tex[] = []
  while (p.i < p.s.length) {
    if (p.s[p.i] === '}') return null
    const node = parseAtom(p, false)
    if (!node) return null
    out.push(...node)
  }
  return out
}

/** 解析数学源码；不支持的内容返回 null（调用方退化成显示源码） */
export function parseTex(src: string): Tex[] | null {
  if (!src.trim()) return null
  if (UNSUPPORTED_TEX.test(src)) return null
  const p: P = { s: src.replace(/\s+/g, ' '), i: 0 }
  const body = parseBody(p)
  if (!body || p.i !== p.s.length) return null
  return body
}

/** 判断公式里是否有分式/根号等"块状"结构（决定单行还是分行排版） */
export function texIsTall(nodes: Tex[]): boolean {
  return nodes.some((n) => {
    if (n.t === 'frac' || n.t === 'sqrt') return true
    if (n.t === 'group') return texIsTall(n.c)
    if (n.t === 'accent') return texIsTall(n.c)
    if (n.t === 'sup' || n.t === 'sub') return texIsTall(n.c)
    if (n.t === 'subsup') return texIsTall(n.sub) || texIsTall(n.sup)
    return false
  })
}
