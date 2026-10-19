export interface MathExpression {
  tex: string
  display: boolean
  source: string
}

export interface PreparedMathMarkdown {
  markdown: string
  expressions: MathExpression[]
}

const PLACEHOLDER_PREFIX = 'KGMATHPLACEHOLDER'
const PLACEHOLDER_SUFFIX = 'END'
export const MATH_PLACEHOLDER_RE = /KGMATHPLACEHOLDER(\d+)END/g

const ENVIRONMENTS = new Set([
  'equation', 'equation*', 'align', 'align*', 'aligned', 'alignedat',
  'gather', 'gather*', 'gathered', 'multline', 'multline*', 'flalign', 'flalign*',
  'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'smallmatrix',
  'array', 'cases', 'split',
])

function placeholder(index: number): string {
  return `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) slashes += 1
  return slashes % 2 === 1
}

function findUnescaped(text: string, needle: string, from: number): number {
  let index = text.indexOf(needle, from)
  while (index >= 0 && isEscaped(text, index)) index = text.indexOf(needle, index + needle.length)
  return index
}

function looksLikeDollarMath(tex: string): boolean {
  const value = tex.trim()
  if (!value || /^\d+(?:[.,]\d+)?$/.test(value)) return false
  // 避免把 “$5 and $6” 一类货币文本吞成公式；真正的多词文本应写在 \text{} 中。
  if (/\s/.test(value) && /^[\dA-Za-z\s.,]+$/.test(value) && /[A-Za-z]{2,}/.test(value)) return false
  return true
}

function normalizeImportedTex(tex: string): string {
  let value = tex.trim()
  // MathType / Word 常导出这些顶层环境；KaTeX 在数学模式内对应使用 *ed 版本。
  value = value
    .replace(/^\\begin\{equation\*?\}([\s\S]*)\\end\{equation\*?\}$/u, '$1')
    .replace(/\\begin\{align\*?\}/gu, '\\begin{aligned}')
    .replace(/\\end\{align\*?\}/gu, '\\end{aligned}')
    .replace(/\\begin\{gather\*?\}/gu, '\\begin{gathered}')
    .replace(/\\end\{gather\*?\}/gu, '\\end{gathered}')
    .replace(/\\(?:label|ref|eqref)\{[^{}]*\}/gu, '')
    .replace(/\\nonumber\b/gu, '')
  return value.trim()
}

/**
 * 在 Markdown 进入冻结解析器前先抽走数学源码，避免有限子集解析器把复杂公式降级成源码。
 * 代码围栏和行内代码保持逐字不变；公式稍后由 KaTeX 在 Shadow DOM 内接管。
 */
export function prepareMathMarkdown(source: string): PreparedMathMarkdown {
  const expressions: MathExpression[] = []
  const add = (tex: string, display: boolean, original: string) => {
    const index = expressions.length
    expressions.push({ tex: normalizeImportedTex(tex), display, source: original })
    return placeholder(index)
  }

  const processMathText = (text: string): string => {
    let output = ''
    let cursor = 0

    while (cursor < text.length) {
      let handled = false

      if (text.startsWith('$$', cursor) && !isEscaped(text, cursor)) {
        const end = findUnescaped(text, '$$', cursor + 2)
        if (end >= 0) {
          const original = text.slice(cursor, end + 2)
          output += add(text.slice(cursor + 2, end), true, original)
          cursor = end + 2
          handled = true
        }
      } else if (text.startsWith('\\[', cursor) && !isEscaped(text, cursor)) {
        const end = findUnescaped(text, '\\]', cursor + 2)
        if (end >= 0) {
          const original = text.slice(cursor, end + 2)
          output += add(text.slice(cursor + 2, end), true, original)
          cursor = end + 2
          handled = true
        }
      } else if (text.startsWith('\\(', cursor) && !isEscaped(text, cursor)) {
        const end = findUnescaped(text, '\\)', cursor + 2)
        if (end >= 0) {
          const original = text.slice(cursor, end + 2)
          output += add(text.slice(cursor + 2, end), false, original)
          cursor = end + 2
          handled = true
        }
      } else if (text.startsWith('\\begin{', cursor) && !isEscaped(text, cursor)) {
        const open = /^\\begin\{([^{}]+)\}/u.exec(text.slice(cursor))
        const environment = open?.[1]
        if (open && environment && ENVIRONMENTS.has(environment)) {
          const close = `\\end{${environment}}`
          const end = text.indexOf(close, cursor + open[0].length)
          if (end >= 0) {
            const original = text.slice(cursor, end + close.length)
            output += add(original, true, original)
            cursor = end + close.length
            handled = true
          }
        }
      } else if (text[cursor] === '$' && !isEscaped(text, cursor)) {
        const end = findUnescaped(text, '$', cursor + 1)
        if (end >= 0) {
          const tex = text.slice(cursor + 1, end)
          if (looksLikeDollarMath(tex)) {
            const original = text.slice(cursor, end + 1)
            output += add(tex, false, original)
            cursor = end + 1
            handled = true
          }
        }
      }

      if (!handled) {
        output += text[cursor]
        cursor += 1
      }
    }
    return output
  }

  const processInlineCode = (line: string): string => {
    let output = ''
    let cursor = 0
    const code = /(`+)([\s\S]*?)\1/gu
    for (let match = code.exec(line); match; match = code.exec(line)) {
      output += processMathText(line.slice(cursor, match.index))
      output += match[0]
      cursor = match.index + match[0].length
    }
    output += processMathText(line.slice(cursor))
    return output
  }

  const lines = source.match(/[^\n]*(?:\n|$)/gu) ?? []
  let output = ''
  let fence: { char: string; length: number } | null = null
  let mathBlock: {
    close: string
    lines: string[]
    opening: string
    includeBoundaries: boolean
  } | null = null

  for (const withNewline of lines) {
    if (!withNewline) continue
    const newline = withNewline.endsWith('\n') ? '\n' : ''
    const line = newline ? withNewline.slice(0, -1) : withNewline
    const trimmed = line.trim()

    if (mathBlock) {
      const closesHere = mathBlock.includeBoundaries ? line.includes(mathBlock.close) : trimmed === mathBlock.close
      if (closesHere) {
        const texLines = mathBlock.includeBoundaries ? [...mathBlock.lines, line] : mathBlock.lines
        const original = (
          mathBlock.includeBoundaries
            ? [...mathBlock.lines, line]
            : [mathBlock.opening, ...mathBlock.lines, line]
        ).join('\n')
        output += `${add(texLines.join('\n'), true, original)}${newline}`
        mathBlock = null
      } else {
        mathBlock.lines.push(line)
      }
      continue
    }

    const fenceMark = /^(?: {0,3})(`{3,}|~{3,})/u.exec(line)?.[1]
    if (fence) {
      output += withNewline
      if (fenceMark && fenceMark[0] === fence.char && fenceMark.length >= fence.length) fence = null
      continue
    }
    if (fenceMark) {
      fence = { char: fenceMark[0], length: fenceMark.length }
      output += withNewline
      continue
    }

    if (trimmed === '$$' || trimmed === '\\[') {
      mathBlock = {
        close: trimmed === '$$' ? '$$' : '\\]',
        lines: [],
        opening: line,
        includeBoundaries: false,
      }
      continue
    }

    const environmentOpen = /\\begin\{([^{}]+)\}/u.exec(line)
    const environment = environmentOpen?.[1]
    if (environmentOpen && environment && ENVIRONMENTS.has(environment)) {
      const close = `\\end{${environment}}`
      if (!line.slice((environmentOpen.index ?? 0) + environmentOpen[0].length).includes(close)) {
        mathBlock = { close, lines: [line], opening: line, includeBoundaries: true }
        continue
      }
    }

    const processed = processInlineCode(line)
    const bare = processed.trim()
    const looksLikeBareDisplay = (
      expressions.length === 0 || !bare.includes(PLACEHOLDER_PREFIX)
    ) && !/[\u3400-\u9fff]/u.test(bare)
      && /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|iint|oint|lim|log|ln|mathrm|mathbf|operatorname|left|right)\b/u.test(bare)
      && (/[=_^]/u.test(bare) || /\\(?:frac|sum|prod|int|begin)\b/u.test(bare))
      && !/^\s*(?:#{1,6}|>|[-+*]\s|\d+[.)]\s)/u.test(processed)

    output += looksLikeBareDisplay ? `${add(bare, true, line)}${newline}` : `${processed}${newline}`
  }

  // 未闭合的块不能吞掉后文，按原文退回。
  if (mathBlock) output += [mathBlock.opening, ...mathBlock.lines.slice(mathBlock.includeBoundaries ? 1 : 0)].join('\n')

  return { markdown: output, expressions }
}

