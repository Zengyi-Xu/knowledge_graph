import katex from 'katex'
import katexStyles from 'katex/dist/katex.min.css?inline'
import { MATH_PLACEHOLDER_RE, type MathExpression } from './mathMarkup'

const APP_STYLES = `
.kg-math-inline {
  display: inline-block;
  max-width: 100%;
  vertical-align: -0.12em;
}
.kg-math-display {
  display: block;
  max-width: 100%;
  margin: 1em 0;
  padding: 0.2em 0;
  overflow-x: auto;
  overflow-y: hidden;
  text-align: center;
  -webkit-overflow-scrolling: touch;
}
.kg-math-inline .katex { font-size: 1.04em; }
.kg-math-display .katex-display { margin: 0; }
.kg-math-display[data-math-error="true"],
.kg-math-inline[data-math-error="true"] {
  color: #b42318;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (max-width: 640px) {
  .kg-math-display { text-align: left; }
  .kg-math-display .katex { font-size: 0.96em; }
}
`

export function installKatexStyles(root: ShadowRoot): void {
  if (root.querySelector('style[data-kg-katex]')) return
  const style = document.createElement('style')
  style.dataset.kgKatex = ''
  style.textContent = `${katexStyles}\n${APP_STYLES}`
  root.appendChild(style)
}

export function installKatexDocumentStyles(): void {
  if (document.head.querySelector('style[data-kg-katex]')) return
  const style = document.createElement('style')
  style.dataset.kgKatex = ''
  style.textContent = `${katexStyles}\n${APP_STYLES}`
  document.head.appendChild(style)
}

function renderExpression(expression: MathExpression): { html: string; error: boolean } {
  try {
    const html = katex.renderToString(expression.tex, {
      displayMode: expression.display,
      output: 'htmlAndMathml',
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      macros: {
        '\\bm': '\\boldsymbol',
        '\\R': '\\mathbb{R}',
        '\\N': '\\mathbb{N}',
        '\\Z': '\\mathbb{Z}',
      },
    })
    return { html, error: html.includes('katex-error') }
  } catch {
    return { html: '', error: true }
  }
}

/**
 * Vditor 会先把公式解析成「隐藏源码 + 可见预览」两份 DOM，但它自带的
 * CDN 渲染器在离线/本机部署里可能加载失败。这里仅替换可见预览，隐藏源码
 * 保持原样，因此 Markdown 序列化、撤销和再次编辑仍全部交给 Vditor。
 */
export function hydrateVditorMath(root: HTMLElement): void {
  installKatexDocumentStyles()
  const blocks = root.querySelectorAll<HTMLElement>(
    '.vditor-wysiwyg__block[data-type="math-block"], .vditor-wysiwyg__block[data-type="math-inline"]',
  )

  for (const block of blocks) {
    const type = block.dataset.type
    const source = block.querySelector<HTMLElement>(
      type === 'math-block'
        ? ':scope > pre > code[data-type="math-block"]'
        : ':scope > code[data-type="math-inline"]',
    )
    const preview = block.querySelector<HTMLElement>(
      ':scope > .vditor-wysiwyg__preview > .language-math',
    )
    const tex = (source?.textContent ?? '').replace(/^\u200b+|\u200b+$/g, '')
    if (!preview || !tex) continue
    // 已经处理过同一份源码就跳过：失败回退只写纯文本（没有 .katex），若不认错误标记，
    // 写 textContent 会再次触发 MutationObserver → 装饰 → 再写，形成无限循环。
    if (
      preview.dataset.kgTex === tex
      && (preview.querySelector('.katex') || preview.dataset.mathError === 'true')
    ) continue

    const expression: MathExpression = {
      tex,
      source: tex,
      display: type === 'math-block',
    }
    const rendered = renderExpression(expression)
    preview.dataset.kgTex = tex
    preview.dataset.mathError = String(rendered.error)
    preview.classList.toggle('kg-math-display', expression.display)
    preview.classList.toggle('kg-math-inline', !expression.display)
    if (rendered.error) {
      preview.textContent = tex
      preview.title = '公式语法无法解析；已保留原始 LaTeX'
    } else {
      preview.removeAttribute('title')
      preview.innerHTML = rendered.html
    }
  }
}

export function hydrateMath(root: HTMLElement, expressions: MathExpression[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    if (
      text.nodeValue?.includes('KGMATHPLACEHOLDER')
      && !text.parentElement?.closest('code, pre, textarea, style, script')
    ) targets.push(text)
  }

  for (const text of targets) {
    const value = text.nodeValue ?? ''
    const fragment = document.createDocumentFragment()
    let cursor = 0
    MATH_PLACEHOLDER_RE.lastIndex = 0
    for (let match = MATH_PLACEHOLDER_RE.exec(value); match; match = MATH_PLACEHOLDER_RE.exec(value)) {
      if (match.index > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, match.index)))
      const expression = expressions[Number(match[1])]
      if (!expression) {
        fragment.appendChild(document.createTextNode(match[0]))
      } else {
        const span = document.createElement('span')
        span.className = expression.display ? 'kg-math-display mathjax-block' : 'kg-math-inline'
        span.dataset.tex = expression.tex
        span.setAttribute('role', 'math')
        const rendered = renderExpression(expression)
        span.dataset.mathError = String(rendered.error)
        if (rendered.error) {
          span.textContent = expression.source
          span.title = '公式语法无法解析；已保留原始 LaTeX'
        } else {
          span.innerHTML = rendered.html
        }
        fragment.appendChild(span)
      }
      cursor = match.index + match[0].length
    }
    if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)))
    text.parentNode?.replaceChild(fragment, text)
  }
}

