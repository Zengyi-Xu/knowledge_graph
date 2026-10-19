# 阅读面板的 Markdown 渲染器

日期：2026-10-11

## 症状与根因

阅读面板（笔记右侧的渲染结果）此前**看不到有序/无序列表的符号**，标题层级也很弱。

根因不是解析器，而是样式：应用全局引入了 Tailwind 的 preflight，它会把
`ul/ol { list-style: none }`、`h1~h6 { font-size: inherit; font-weight: inherit }`、
`blockquote/dl/p/pre { margin: 0 }` 全部重置。阅读面板虽然在 Shadow DOM 里，
但 Tailwind 的基础层同样插在 Shadow 根内，于是列表符号、标题大小、表格边框都被清掉，
渲染层原先只写了 `list-style-position: inside`，没有恢复 `list-style-type`。

## 这次做了什么

1. **样式分层**：新增 `src/markdown-base.css`，把语义排版（列表符号、标题层级、
   引用、表格、代码、脚注、目录、数学）补回来，只作用于 `#write`。
   加载顺序固定为：Tailwind（含 preflight）→ Markdown 基础排版 → 阅读主题 → 自定义 CSS。
2. **样式拼装抽成模块**：`src/lib/previewTheme.ts` 负责生成 Shadow DOM 的全部 CSS
   （`PreviewContent.tsx` 只负责挂载）。这样视觉检查脚本可以复用同一份样式。
3. **渲染层换成语义 DOM**：`src/components/Markdown.tsx` 不再用 Tailwind 工具类堆正文，
   改为产出 Typora 兼容结构（`.md-fences`、`.md-meta-block`、`.md-task-list-item`、
   `.md-footnote`、`.md-toc`、`.mathjax-block`），让 `src/themes` 里的 Typora 主题能直接命中。
4. **解析器重写**：`src/lib/md.ts` 从"常见语法子集"扩到 Typora 覆盖的范围（见下表），
   并按 CommonMark 的思路处理列表项缩进、松紧列表、引用惰性续行、引用式链接、脚注定义。
5. **数学**：阅读面板在冻结解析器之前由 `src/lib/mathMarkup.ts` 抽取公式，再按需加载 KaTeX 0.19 渲染；
   输出同时包含视觉 HTML 与无障碍 MathML。支持行内 `$…$` / `\(…\)`、块级 `$$…$$` / `\[…\]`、
   矩阵、分段函数、多行对齐、求和积分、字体与重音等常用 LaTeX / MathType 导出语法。代码围栏、行内代码、
   货币金额不会被误判；无公式的页面不下载 KaTeX。所见即所得编辑器同样走内置 KaTeX：Vditor 自带的公式渲染器
   要从 CDN 取脚本，离线会失败，`WysiwygEditor` 在每次 DOM 重排后由 `hydrateVditorMath` 接管可见层
   （隐藏源码保持原样，序列化/撤销仍归 Vditor）。旧的 `src/lib/tex.ts` 子集仍作为冻结解析器契约保留，
   但阅读面板中的公式正常情况下不会再走它的源码降级路径。

## 支持的语法

| 类别 | 支持内容 |
|---|---|
| 标题 | ATX `#`~`######`（可空标题、可闭合 `#`）、Setext（`===` / `---`）、自动生成 `id`（供目录跳转） |
| 段落与换行 | 段落、行尾两空格硬换行、反斜杠硬换行、段内软换行 |
| 强调 | `**粗**`、`__粗__`、`*斜*`、`_斜_`（词内下划线不生效）、`***粗斜***`、`~~删除线~~`、`==高亮==` |
| 上下标 | Typora 简写 `H~2~O`、`x^2^`（支持 `\ ` 转义空格）与 `<sub>` / `<sup>` |
| 代码 | `` `行内代码` ``（可用多个反引号包裹）、``` / ~~~ 围栏（info string）、缩进代码块 |
| 列表 | 无序（`-` `*` `+`）、有序（`1.` `1)` `1、`）、起始序号、嵌套、紧凑/宽松、任务列表（含嵌套） |
| 引用 | 单层/多层嵌套、引用内列表与代码块、惰性续行 |
| 表格 | GFM 表格、三种对齐、缺列自动补齐、`\|` 转义、行内代码里的 `|` 不切分 |
| 链接与图片 | 行内链接/图片（带标题）、引用式 `[文字][ref]`、`[ref][]`、`[ref]`、`<自动链接>`、裸 URL、相对路径 |
| 其他块 | 分隔线、定义列表、脚注（引用 + 定义 + 回跳）、`[TOC]`、`$$ 数学块 $$`、YAML 前置元数据 |
| 其他行内 | `[[双链]]`、`[[双链\|别名]]`、`#标签`、`:emoji:`、HTML 实体、反斜杠转义、白名单行内 HTML |
| 文字 | 中文、emoji（原生字符）、实体（`&amp;`、`&#65;`） |

安全边界：链接只允许 `https` / `mailto` / `tel` / 锚点 / 相对路径；HTML 只保留白名单标签，
`on*` 属性、`javascript:`、`<script>`、`<iframe>` 等会被丢弃或转义成文字，
`style` 只保留排版相关属性。

## 与 Typora / CommonMark 的差异（有意为之）

- **软换行渲染成换行**：CommonMark 把段落内的单换行当空格，本应用保留为换行，
  一是贴近 Typora 编辑器里 Shift+Enter 的显示，二是能保住既有笔记"一行一句"的排版。
- **`1、项目`**（中文顿号）也当作有序列表标记。
- **公式输入仍使用标准分隔符**：行内写 `$…$` 或 `\(…\)`，独立公式写 `$$…$$` 或 `\[…\]`。
  MathType / Word 导出的 `equation`、`align`、`gather` 等环境会在渲染时安全归一化，不改写磁盘正文；
  单独一整行、含明显运算结构的裸 LaTeX 也会兼容识别。
- **不支持**：mermaid/流程图等图表围栏（按普通代码块显示）、完整 LaTeX 文档级命令（导言区、宏包加载）、
  HTML 标签的属性白名单之外的内容（如 `<video controls>` 的 controls 会被去掉）、
  多行链接标题定义。
- 极端嵌套的强调分隔符（例如 `**a**b**c**`）按简化规则处理，可能和 CommonMark 的
  "分割符栈"结果不同；笔记里常见的写法都能正确渲染。

## 怎么验证

```bash
npm run test:md          # 解析器 / 渲染结构单测（136 项，含 41 篇真实笔记冒烟测试）
npm run test:md-render   # 真实 React 组件服务端渲染的断言（列表、表格、上下标、任务列表等）
npm run test:math        # 公式抽取、代码/货币防误判、KaTeX HTML+MathML 输出
npm run visual:md        # 视觉检查：生成页面 + 无头 Chrome 截图 + computedStyle 自检
npm run visual:math      # 真实 PreviewContent + Shadow DOM + KaTeX，桌面/390px 窄栏截图与溢出自检
```

`npm run visual:md` 的产物在 `.tmp-md-visual/`（已被 .gitignore 忽略）：

- `out/`：用**真实组件 + 真实 CSS**（Tailwind 编译结果 + 阅读主题）生成的页面，
  包含整篇 5 个主题、按 `## ` 切分的 14 个小节 × 3 个主题、以及手机宽度（iframe 包一层，
  因为 Windows 上 Chrome 窗口有最小宽度）的版本。
- `shots/`：每个页面的截图。
- `probe.txt`：页面内脚本读到的 computedStyle 结论，例如
  `ul 列表符号 [list-style-type=disc]`、`h1 字号大于正文 [28.5px vs 15px]`、
  `正文不横向溢出 [scrollWidth=414/vw=414]`。任何一项变成 `FAIL` 就说明样式被重置或溢出。

用例内容在 `scripts/fixtures/typora-kitchen-sink.md`，改这个文件就能扩检查范围。

## 相关文件

| 文件 | 作用 |
|---|---|
| `src/lib/md.ts` | Markdown → AST（纯函数，无 React / DOM 依赖） |
| `src/lib/tex.ts` | LaTeX 子集 → 排版节点（不支持时返回 null） |
| `src/components/Markdown.tsx` | AST → React（语义 DOM + Typora 兼容类名） |
| `src/markdown-base.css` | 阅读面板的 Markdown 基础排版 |
| `src/lib/previewTheme.ts` | Shadow DOM 的 CSS 拼装（基础排版 + 主题 + 手机覆盖） |
| `src/components/PreviewContent.tsx` | 挂载 Shadow DOM，注入 Tailwind 与上面的 CSS |
| `src/lib/mathMarkup.ts` | 在冻结 Markdown 解析器外抽取公式、保护代码与货币文本 |
| `src/lib/katexRuntime.ts` | 按需加载 KaTeX、注入 Shadow DOM 样式并输出 HTML + MathML |
