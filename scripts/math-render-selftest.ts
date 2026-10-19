import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import katex from 'katex'
import { prepareMathMarkdown } from '@/lib/mathMarkup'

let passed = 0
function check(label: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`✓ ${label}`)
}

// 行尾归一：Windows 上 core.autocrlf 会把夹具签出成 CRLF，断言按 LF 写。
const fixture = fs.readFileSync(path.resolve('scripts/fixtures/latex-regression.md'), 'utf8').replace(/\r\n/g, '\n')
const prepared = prepareMathMarkdown(fixture)

check('截图原文中的行内与块级公式全部被专业引擎接管', () => {
  assert.ok(prepared.expressions.length >= 10)
  assert.ok(prepared.expressions.some((item) => item.tex.includes('P_c=\\frac')))
  assert.ok(prepared.expressions.some((item) => item.tex.includes('B_{\\mathrm{det}}')))
})

check('矩阵、分段函数、积分与求和进入 KaTeX', () => {
  assert.ok(prepared.expressions.some((item) => item.tex.includes('bmatrix')))
  assert.ok(prepared.expressions.some((item) => item.tex.includes('cases')))
  assert.ok(prepared.expressions.some((item) => item.tex.includes('\\int_')))
  assert.ok(prepared.expressions.some((item) => item.tex.includes('\\sum_')))
})

check('MathType 常见 align 环境归一成 KaTeX aligned', () => {
  const aligned = prepared.expressions.find((item) => item.tex.includes('S(f)'))
  assert.ok(aligned)
  assert.match(aligned.tex, /\\begin\{aligned\}/u)
  assert.doesNotMatch(aligned.tex, /\\begin\{align\}/u)
})

check('代码围栏和行内代码保持源码', () => {
  assert.match(prepared.markdown, /`\$x_1\$`/u)
  assert.match(prepared.markdown, /```tex\n\\frac\{这里是代码\}\{不能渲染\}\n```/u)
})

check('货币金额不误判为公式', () => {
  assert.match(prepared.markdown, /价格 \$20 不应被当成公式/u)
})

check('未闭合数学块不吞掉后文', () => {
  const broken = prepareMathMarkdown('前文\n$$\nx+1\n后文')
  assert.equal(broken.expressions.length, 0)
  assert.match(broken.markdown, /\$\$\nx\+1\n后文/u)
})

check('复杂公式均能生成 HTML + MathML，且没有 KaTeX 错误', () => {
  for (const expression of prepared.expressions) {
    const html = katex.renderToString(expression.tex, {
      displayMode: expression.display,
      output: 'htmlAndMathml',
      throwOnError: false,
      strict: 'ignore',
      trust: false,
    })
    assert.match(html, /class="katex"/u, expression.tex)
    assert.match(html, /<math/u, expression.tex)
    assert.doesNotMatch(html, /katex-error/u, expression.tex)
  }
})

console.log(`\n公式渲染：${passed} 项通过，0 失败；${prepared.expressions.length} 个公式已验证。`)

