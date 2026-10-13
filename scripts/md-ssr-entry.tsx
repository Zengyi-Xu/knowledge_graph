import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '@/components/Markdown'
import type { Note } from '@/types/note'

const note = (title: string): Note => ({
  id: 'n1',
  title,
  type: 'other',
  grade: '',
  tags: [],
  content: '',
  createdAt: 0,
  updatedAt: 0,
})

const sample = `# 一级标题

## 二级标题

### 三级标题

> 多行引用第一行
> 多行引用第二行

普通段落，含 **粗体**、*斜体*、~~删除线~~、\`行内代码\`。

- 无序项 A
  - 嵌套项 A1
  - 嵌套项 A2
- 无序项 B

1. 有序项一
2. 有序项二

- [x] 已完成任务
- [ ] 未完成任务

| 维度 | 判定 | 数值 |
|:-----|:----:|-----:|
| **幅度** | **支持** | 53 pm |
| 保持 | 支持 | 10.06 h |

\`\`\`python
x = 1  # | 不是表格 |
\`\`\`

链接：[Ren 2024](https://arxiv.org/abs/2409.12354)、裸链 https://example.com/a 与 <https://example.com/b>。

危险链接 [bad](javascript:alert(1)) 应保持纯文本。

![图](https://example.com/i.png)

转义竖线 a \\| b 应显示为 a | b。

---

[[不存在双链]]

[[结论清单：已确立 / 已推翻 / 仍未决]]

结尾 #标签 一枚。
`

const html = renderToStaticMarkup(
  React.createElement(Markdown, {
    content: sample,
    notes: [note('结论清单：已确立 / 已推翻 / 仍未决')],
    onOpenNote: () => {},
    onCreateNote: () => {},
  }),
)

let pass = 0
let fail = 0
const check = (name: string, cond: boolean, extra?: string) => {
  if (cond) {
    pass++
    console.log('  ok   ' + name)
  } else {
    fail++
    console.log('  FAIL ' + name + (extra ? '  →  ' + extra : ''))
  }
}

console.log('== 服务端渲染（真实渲染 Markdown 组件）==')
check('表格渲染为 <table>', html.includes('<table'))
check('表头 <th>', html.includes('<th'))
check('单元格 <td>', html.includes('<td'))
check('居中对齐样式', html.includes('text-align:center'))
check('右对齐样式', html.includes('text-align:right'))
check('围栏代码渲染为 <pre><code>', html.includes('<pre') && html.includes('<code'))
check('代码块内容保留', html.includes('x = 1'))
check('代码块内的 | 未被当成表格', (html.match(/<table/g) || []).length === 1)
check('多行引用合并为一个 <blockquote>', (html.match(/<blockquote/g) || []).length === 1)
check('嵌套列表生成 ul 内含 ul', /<ul[^>]*>[\s\S]*<li[^>]*>[\s\S]*<ul/.test(html))
// 任务列表现在是真实的 checkbox（Typora 结构），勾选状态由 checked 属性体现
check('任务列表 li 类名', html.includes('md-task-list-item'))
check(
  '任务列表勾选状态',
  /<input[^>]*type="checkbox"[^>]*checked/.test(html) && /<input[^>]*type="checkbox"(?![^>]*checked)/.test(html),
)
check('有序列表 <ol', html.includes('<ol'))
check('标题带 id（供 TOC 跳转）', /<h1[^>]*id="/.test(html))
check('粗体 <strong>', html.includes('<strong>'))
check('斜体 <em>', html.includes('<em>'))
check('删除线 <del>', html.includes('<del'))
check('分隔线 <hr', html.includes('<hr'))
check('Markdown 链接 → <a target=_blank', /<a[^>]*href="https:\/\/arxiv\.org\/abs\/2409\.12354"[^>]*target="_blank"/.test(html))
check('裸 URL 自动变成链接', html.includes('href="https://example.com/a"'))
check('尖括号自动链接', html.includes('href="https://example.com/b"'))
check('javascript: 链接不渲染为 <a>', !/<a[^>]*href="javascript:/.test(html) && html.includes('[bad](javascript:alert(1))'))
check('图片渲染为 <img>', html.includes('<img') && html.includes('src="https://example.com/i.png"'))
check('转义竖线渲染为普通 |', html.includes('a | b'))
check('已存在的双链渲染为按钮', /<button[^>]*title="打开笔记"/.test(html))
check('不存在的双链带 ? 提示', html.includes('?') && /title="点击创建这篇笔记"/.test(html))
check('标签渲染为 chip', html.includes('bg-accent') && html.includes('#标签'))
check('标题级别 h1/h2/h3 都存在', html.includes('<h1') && html.includes('<h2') && html.includes('<h3'))

console.log('')
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
if (fail > 0) {
  console.log('---- 渲染片段（供排查）----')
  console.log(html.slice(0, 1500))
}
process.exit(fail === 0 ? 0 : 1)
