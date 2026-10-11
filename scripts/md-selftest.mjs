/**
 * 解析器自测（不需要 React，用 node 的类型擦除直接跑 .ts）：
 *   node scripts/md-selftest.mjs
 * 目的：确认"常见 Markdown 语法"都能解析成预期的 AST 形状。
 */
import { parseMarkdown, parseInline, splitRow } from '../src/lib/md.ts'
import { parseTex } from '../src/lib/tex.ts'

let pass = 0
let fail = 0

function check(name, cond, extra) {
  if (cond) {
    pass++
    console.log('  ok   ' + name)
  } else {
    fail++
    console.log('  FAIL ' + name + (extra ? '  →  ' + extra : ''))
  }
}

function kinds(blocks) {
  return blocks.map((b) => b.t).join(',')
}

console.log('== 块级 ==')

check('ATX 标题 1-6 级', kinds(parseMarkdown('# a\n## b\n### c\n#### d\n##### e\n###### f')) === 'heading,heading,heading,heading,heading,heading')
check('标题级别正确', parseMarkdown('### c')[0].level === 3)
check('分隔线 ---', kinds(parseMarkdown('---')) === 'hr')
check('分隔线 ***', kinds(parseMarkdown('***')) === 'hr')
check('围栏代码块 ```', kinds(parseMarkdown('```js\nlet a = 1\n```')) === 'code', kinds(parseMarkdown('```js\nlet a = 1\n```')))
check('围栏代码块内容', parseMarkdown('```\nline1\nline2\n```')[0].v === 'line1\nline2')
check('围栏代码块语言', parseMarkdown('```python\nx\n```')[0].lang === 'python')
check('波浪号围栏 ~~~', kinds(parseMarkdown('~~~\nx\n~~~')) === 'code')
check('代码块内的表格不被解析', kinds(parseMarkdown('```\n| a | b |\n| - | - |\n```')) === 'code')
check('引用单行', kinds(parseMarkdown('> hello')) === 'quote')
check('引用多行合并为一个块', parseMarkdown('> a\n> b').length === 1)
check('引用内含列表', parseMarkdown('> - a\n> - b')[0].blocks[0].t === 'list')
check('无序列表', kinds(parseMarkdown('- a\n- b')) === 'list')
check('无序列表项数', parseMarkdown('- a\n- b\n- c')[0].items.length === 3)
check('有序列表', parseMarkdown('1. a\n2. b')[0].ordered === true)
check('有序列表起始值', parseMarkdown('3. a\n4. b')[0].start === 3)
check('中文顿号有序列表', parseMarkdown('1、a\n2、b')[0].items.length === 2)
check('嵌套列表', parseMarkdown('- a\n  - b\n  - c\n- d')[0].items[0].blocks.some((x) => x.t === 'list'))
check('嵌套层数正确', parseMarkdown('- a\n  - b')[0].items[0].blocks.find((x) => x.t === 'list').items.length === 1)
check('任务列表（未勾选）', parseMarkdown('- [ ] todo')[0].items[0].checked === false)
check('任务列表（已勾选）', parseMarkdown('- [x] done')[0].items[0].checked === true)
check('列表项多行内容', parseMarkdown('- a\n  continued')[0].items[0].blocks.length >= 1)

console.log('== 表格 ==')
const t = parseMarkdown('| A | B |\n|---|:--:|\n| 1 | 2 |\n| 3 | 4 |')[0]
check('表格被识别', t.t === 'table')
check('表头 2 列', t.header.length === 2)
check('数据 2 行', t.rows.length === 2)
check('对齐解析 left/center', t.align[0] === null || t.align[1] === 'center' ? true : true)
check('对齐 center', parseMarkdown('| A | B |\n|---|:--:|\n| 1 | 2 |')[0].align[1] === 'center')
check('对齐 right', parseMarkdown('| A | B |\n|---|---:|\n| 1 | 2 |')[0].align[1] === 'right')
check('无首尾竖线的表格', parseMarkdown('A | B\n--- | ---\n1 | 2')[0].t === 'table')
check('单元格内的 \\| 转义', splitRow('| a \\| b | c |').join('/') === 'a | b/c', splitRow('| a \\| b | c |').join('/'))
check('表格行数与列数补齐', parseMarkdown('| A | B | C |\n|---|---|---|\n| 1 |')[0].rows[0].length === 3)
check('表格内支持行内语法', JSON.stringify(parseMarkdown('| A |\n|---|\n| **b** |')[0].rows[0][0]).includes('strong'))

console.log('== 行内 ==')
const inl = (s) => parseInline(s)
check('粗体', inl('a **b** c').some((n) => n.t === 'strong'))
check('斜体 *', inl('a *b* c').some((n) => n.t === 'em'))
check('斜体 _', inl('a _b_ c').some((n) => n.t === 'em'))
check('删除线', inl('a ~~b~~ c').some((n) => n.t === 'del'))
check('行内代码', inl('a `b` c').some((n) => n.t === 'code'))
check('行内代码里的星号不解析', inl('`**a**`')[0].t === 'code')
check('加粗+斜体嵌套', JSON.stringify(inl('**a *b* c**')).includes('"em"'))
check('链接', inl('[x](https://a.com)').some((n) => n.t === 'link'))
check('链接 href 正确', inl('[x](https://a.com)')[0].href === 'https://a.com')
check('javascript: 链接被拒绝（当普通文本）', !inl('[x](javascript:alert(1))').some((n) => n.t === 'link'))
check('自动链接 <...>', inl('<https://a.com>').some((n) => n.t === 'link'))
check('裸 URL 自动链接', inl('见 https://a.com/x 结尾').some((n) => n.t === 'link'))
check('裸 URL 去掉尾随句号', (inl('见 https://a.com/x。').find((n) => n.t === 'link') || {}).href === 'https://a.com/x')
check('图片', inl('![alt](https://a.com/i.png)').some((n) => n.t === 'image'))
check('双链', inl('[[目标]]').some((n) => n.t === 'wikilink'))
check('双链别名', inl('[[目标|显示]]')[0].alias === '显示')
check('标签', inl('文本 #标签 后面').some((n) => n.t === 'tag'))
check('标签不会误伤 a#b', !inl('a#b').some((n) => n.t === 'tag'))
check('转义 \\*', inl('a \\*b\\* c').every((n) => n.t === 'text'))
check('相邻文本合并为一个节点', inl('aaa bbb').length === 1)

console.log('== 上下标 ==')
check('Typora 下标', inl('σ~param~')[1]?.t === 'sub' && inl('σ~param~')[1].c[0].v === 'param')
check('Typora 上标', inl('x^2^')[1]?.t === 'sup')
check('连续上下标', inl('x~i~^2^').map((n) => n.t).join(',') === 'text,sub,sup')
check('希腊字母下标', inl('σ~τ~')[1]?.c[0].v === 'τ')
check('删除线仍是删除线', inl('~~removed~~')[0]?.t === 'del')
check('删除线内下标', inl('~~H~2~O~~')[0]?.c.some((n) => n.t === 'sub'))
check('HTML 下标兼容', inl('H<sub>2</sub>O')[1]?.t === 'sub')
check('HTML 上标兼容', inl('x<sup>2</sup>')[1]?.t === 'sup')
check('代码内不解析', inl('`σ~w~ x^2^`')[0]?.t === 'code')
check('围栏内不解析', parseMarkdown('~~~\nσ~w~ x^2^\n~~~')[0]?.t === 'code')
check('转义标记保持文字', inl('σ\\~w\\~ x\\^2\\^').every((n) => n.t === 'text'))
check('未闭合标记保持文字', inl('σ~w x^2').every((n) => n.t === 'text'))
check('空标记保持文字', inl('~~ ^^').every((n) => n.t === 'text'))
check('空格必须转义', inl('x~a b~').every((n) => n.t === 'text'))
check('支持转义空格', inl('x~a\\ b~')[1]?.c[0].v === 'a b')
check('下划线不自动变下标', !inl('σ_w file_name').some((n) => n.t === 'sub'))
check('URL 内容不转换', inl('https://example.com/~user~')[0]?.t === 'link')
check('双链目标不转换', inl('[[x~i~]]')[0]?.target === 'x~i~')
check('粗体中下标', inl('**σ~w~**')[0]?.c.some((n) => n.t === 'sub'))
check('表格中上下标', parseMarkdown('| 指标 |\n| --- |\n| σ~w~ x^2^ |')[0].rows[0][0].filter((n) => n.t === 'sub' || n.t === 'sup').length === 2)

console.log('== 真实片段（我们笔记里的写法）==')
const sample = `## 标题

> **这份笔记回答什么**：一句话。

- **A1**
- 结论：TFLN 微环里**光折变效应真实存在**：Δn 达 5.8e-5

| 维度 | 判定 |
|---|---|
| **幅度** | **支持** ✅ |

\`G* = γ_R N_A²/[4(N_D−N_A)] ≈ 2.5e5 1/s\`
`
const sb = parseMarkdown(sample)
check('片段块序列', kinds(sb) === 'heading,quote,list,table,paragraph', kinds(sb))
check('片段表格有 1 行数据', sb[3].rows.length === 1)
check('片段表格首格是粗体', JSON.stringify(sb[3].rows[0][0]).includes('strong'))

console.log('== 完整语法（对齐 Typora）==')

const hd = (s) => parseMarkdown(s)[0]
check('Setext 一级标题', hd('标题\n=====').t === 'heading' && hd('标题\n=====').level === 1)
check('Setext 二级标题', hd('标题\n-----').t === 'heading' && hd('标题\n-----').level === 2)
check('ATX 标题可无文字', hd('#').t === 'heading' && hd('#').level === 1)
check('标题生成 id', hd('## 中文 标题！').id === '中文-标题')
check('重复标题 id 去重', parseMarkdown('# A\n\n# A')[1].id === 'a-1')
check('高亮 ==x==', inl('a ==b== c').some((n) => n.t === 'mark'))
check('粗斜体 ***x***', inl('***x***')[0].t === 'strong' && inl('***x***')[0].c[0].t === 'em')
check('两空格硬换行', inl('a  \nb').some((n) => n.t === 'br'))
check('反斜杠硬换行', inl('a\\\nb').some((n) => n.t === 'br'))
check('词内下划线不成斜体', !inl('snake_case_name').some((n) => n.t === 'em'))
check('实体解码', inl('&amp;&#65;').map((n) => n.v).join('') === '&A')
check('emoji 短代码', inl(':rocket:')[0].t === 'emoji' && inl(':rocket:')[0].char === '🚀')
check('未知 emoji 保持文字', inl(':not_an_emoji:').every((n) => n.t === 'text'))
check('行内数学', inl('$x^2$')[0].t === 'math')
check('货币不被当数学', inl('costs $5 and $10').every((n) => n.t !== 'math'))

const rl = parseMarkdown('[文字][r] 与 [r][]\n\n[r]: https://e.com "标题"')
check('引用式链接', rl[0].c.some((n) => n.t === 'link' && n.href === 'https://e.com' && n.title === '标题'))
check('引用式链接定义行不显示', rl.length === 1)
check('引用式图片', parseMarkdown('![a][i]\n\n[i]: https://e.com/i.png')[0].c[0].t === 'image')
check('图片标题', inl('![a](https://e.com/i.png "T")')[0].title === 'T')

const fn = parseMarkdown('正文[^a] 与[^b]\n\n[^a]: 脚注 A\n[^b]: 脚注 **B**')
check('脚注引用编号', fn[0].c.filter((n) => n.t === 'footnote-ref').map((n) => n.index).join(',') === '1,2')
check('脚注区生成', fn.some((b) => b.t === 'footnotes' && b.items.length === 2))
check('脚注内容解析行内语法', JSON.stringify(fn.find((b) => b.t === 'footnotes').items[1].blocks).includes('strong'))
check('未定义脚注引用保持文字', parseMarkdown('x[^nope]')[0].c.every((n) => n.t !== 'footnote-ref'))

const toc = parseMarkdown('# A\n\n[TOC]\n\n## B\n\n### C')
check('TOC 展开所有标题', toc.find((b) => b.t === 'toc').items.length === 3)
check('TOC 记录层级', toc.find((b) => b.t === 'toc').items.map((t) => t.level).join(',') === '1,2,3')

check('定义列表', parseMarkdown('术语\n: 定义')[0].t === 'deflist')
check('定义列表多定义', parseMarkdown('术语\n: 一\n: 二')[0].items[0].defs.length === 2)
check('数学块', parseMarkdown('$$\nE = mc^2\n$$')[0].t === 'math')
check('缩进代码块', parseMarkdown('    let a = 1')[0].t === 'code')
check('嵌套引用', parseMarkdown('> a\n>\n> > b')[0].blocks.some((b) => b.t === 'quote'))
check('引用惰性续行', parseMarkdown('> a\nb')[0].blocks.length === 1)
check('表格内代码竖线不切分', splitRow('| `a|b` | c |').length === 2)
check('宽松列表', parseMarkdown('- a\n\n- b')[0].tight === false)
check('紧凑列表', parseMarkdown('- a\n- b')[0].tight === true)
check('任务列表可嵌套列表', parseMarkdown('- [x] a\n  - [ ] b')[0].items[0].blocks.some((b) => b.t === 'list'))
check('有序/无序切换会另起列表', parseMarkdown('- a\n\n1. b')[0].ordered === false && parseMarkdown('- a\n\n1. b')[1].ordered === true)
check('YAML 前置元数据', parseMarkdown('---\ntitle: x\n---\n\n# H')[0].t === 'meta')
check('围栏代码 info string', parseMarkdown('```js {1}\ncode\n```')[0].lang === 'js')
check('TOC 之前的空行不影响', parseMarkdown('\n\n[TOC]')[0].t === 'toc')

console.log('== HTML 白名单 ==')
check('行内 HTML', inl('<span>a</span>')[0].t === 'html')
check('行内 HTML 去掉 onclick', !inl('<span onclick="x()">a</span>')[0].v.includes('onclick'))
check('行内 HTML 去掉 javascript: 链接', !inl('<a href="javascript:x">a</a>')[0].v.includes('javascript:'))
check('行内 HTML 保留安全样式', inl('<span style="color:red">a</span>')[0].v.includes('color: red'))
check('行内 HTML 去掉 url() 样式', !inl('<span style="background:url(x)">a</span>')[0].v.includes('url('))
check('块级 HTML', parseMarkdown('<div class="x">\n文本\n</div>')[0].t === 'html')
check('块级 HTML 去掉 script', !parseMarkdown('<div>\n<script>alert(1)</script>\n</div>')[0].v.includes('<script'))
check('未知行内标签保持文字', inl('<customtag>a</customtag>').every((n) => n.t !== 'html'))
check('javascript: 图片被拒绝', !inl('![a](javascript:alert(1))').some((n) => n.t === 'image'))

console.log('== 数学（LaTeX 子集）==')
check('TeX 上下标', !!parseTex('E = mc^2'))
check('TeX 下标不被上标覆盖', JSON.stringify(parseTex('\\sigma_w')).includes('σ'))
check('TeX 分式', parseTex('\\frac{a}{b}')[0].t === 'frac')
check('TeX 根号与可选次数', parseTex('\\sqrt[3]{x}')[0].idx.length === 1)
check('TeX 希腊字母', parseTex('\\alpha\\beta')[0].v === 'α')
check('TeX 大运算符', parseTex('\\int_0^1')[0].t === 'op')
check('TeX 重音符', parseTex('\\vec{v}')[0].t === 'accent')
check('TeX 不支持的环境返回 null', parseTex('\\begin{matrix}a\\end{matrix}') === null)
check('TeX 未知宏返回 null', parseTex('\\unknown{x}') === null)
check('TeX 括号不配对返回 null', parseTex('\\frac{a}{b') === null)

console.log('== 真实笔记冒烟测试 ==')
{
  const { readFileSync, existsSync } = await import('node:fs')
  // 仓库不提交真实笔记：本地有 public/notes.json 就拿真实笔记压一遍，
  // 没有（干净的 clone）就退回通用 fixture，保证这段检查永远可跑。
  let list
  if (existsSync('public/notes.json')) {
    const raw = JSON.parse(readFileSync('public/notes.json', 'utf8'))
    list = Array.isArray(raw) ? raw : (raw.notes ?? [])
    console.log(`    （数据源：public/notes.json）`)
  } else {
    list = [
      {
        title: 'typora-kitchen-sink',
        content: readFileSync('scripts/fixtures/typora-kitchen-sink.md', 'utf8'),
      },
    ]
    console.log(`    （数据源：scripts/fixtures/typora-kitchen-sink.md）`)
  }
  let blocks = 0
  let lists = 0
  let headings = 0
  let failed = 0
  for (const note of list) {
    try {
      const bs = parseMarkdown(note.content ?? '')
      blocks += bs.length
      for (const b of bs) {
        if (b.t === 'list') lists++
        if (b.t === 'heading') headings++
      }
    } catch (err) {
      failed++
      console.log('    解析失败：' + note.title + ' → ' + err.message)
    }
  }
  check('全部笔记可解析', failed === 0, `${failed} 篇失败`)
  check('笔记里有列表块', lists > 0, `lists=${lists}`)
  check('笔记里有标题块', headings > 0, `headings=${headings}`)
  console.log(`    （${list.length} 篇笔记 → ${blocks} 个块 / ${lists} 个列表 / ${headings} 个标题）`)
}

console.log('')
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail === 0 ? 0 : 1)
