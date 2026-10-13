/**
 * Markdown 渲染视觉检查：把 fixtures 里的 Markdown 用真实组件 + 真实 CSS 渲染成静态页面。
 *
 * 由 scripts/md-visual.mjs 打包后执行（esbuild 会把 `?inline` 的 CSS 换成编译后的内容）。
 * 产物（默认 .tmp-md-visual/out/）：
 *   all-<theme>.html        整篇文档
 *   section-NN-<slug>-<theme>.html  按 `## ` 切分的小节（便于逐段核对细节）
 *   manifest.json           页面清单（含截图尺寸）
 *
 * 每个页面里还会注入一段自检脚本，把关键元素的 computedStyle 结果写进 #report，
 * 这样 `chrome --dump-dom` 就能拿到"列表符号是否真的画出来"这类结论。
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '@/components/Markdown'
import { previewCss } from '@/lib/previewTheme'
import type { PreviewTheme } from '@/lib/previewTheme'
import baseStyles from '@/index.css?inline'
import type { Note } from '@/types/note'

const OUT_DIR = process.env.MD_VISUAL_OUT ?? path.resolve('.tmp-md-visual/out')
const fixturePath = process.argv[2] ?? path.resolve('scripts/fixtures/typora-kitchen-sink.md')
const content = fs.readFileSync(fixturePath, 'utf8')

const LINK_TITLES = ['量子点激光模式控制 Optica 2026', 'Yating Wan', '科研策略：器件为本']
const notes: Note[] = LINK_TITLES.map((title, i) => ({
  id: `n${i}`,
  title,
  type: 'other',
  grade: '',
  tags: [],
  content: '',
  createdAt: 0,
  updatedAt: 0,
}))

function renderMarkdown(md: string): string {
  return renderToStaticMarkup(
    <Markdown content={md} notes={notes} onOpenNote={() => {}} onCreateNote={() => {}} />,
  )
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

const PAGE_BG: Record<PreviewTheme, string> = {
  default: '#ffffff',
  paper: '#fcfaf5',
  night: '#202827',
  'vue-light': '#ffffff',
  'vue-night': '#1d1d1d',
  custom: '#ffffff',
}

/** 页面内自检：把关键元素的 computedStyle 写回 light DOM 的 #report，供 --dump-dom 读取 */
const PROBE_SCRIPT = `
function runProbe() {
  const root = document.getElementById('host').shadowRoot;
  const out = [];
  // ok: true=通过 false=不通过 null=该页没有这种元素（不计入失败）
  const report = (label, ok, detail) => out.push({ label, ok, detail: detail || '' });
  const q = (sel) => root.querySelector(sel);
  const cs = (el) => getComputedStyle(el);
  const px = (v) => parseFloat(v) || 0;
  const need = (el, label, fn) => {
    if (!el) return report(label, null, '本页没有该元素');
    report(label, fn(el), '');
  };
  const ul = q('#write ul');
  const ol = q('#write ol');
  const h1 = q('#write h1');
  const h2 = q('#write h2');
  const h3 = q('#write h3');
  const p = q('#write p');
  const th = q('#write table th');
  const td = q('#write table td');
  const tr = q('#write table tr');
  const pre = q('#write pre');
  const bq = q('#write blockquote');
  const task = q('#write li.md-task-list-item input[type=checkbox]');
  const hr = q('#write hr');

  need(ul, 'ul 列表符号', (el) => { const v = cs(el).listStyleType; window.__d = v; return v !== 'none' })
  need(ol, 'ol 列表符号', (el) => cs(el).listStyleType !== 'none')
  need(ul, '列表符号在行外', (el) => cs(el).listStylePosition === 'outside')
  if (!h1 || !p) report('h1 字号大于正文', null, '本页缺少 h1 或段落');
  else report('h1 字号大于正文', px(cs(h1).fontSize) > px(cs(p).fontSize), '');
  if (!h1 || !h2 || !h3) report('标题层级递减', null, '本页缺少 h1/h2/h3');
  else report('标题层级递减', px(cs(h1).fontSize) > px(cs(h2).fontSize) && px(cs(h2).fontSize) > px(cs(h3).fontSize), '');
  need(h1, 'h1 加粗', (el) => px(cs(el).fontWeight) >= 600)
  need(th, '表格有边框', () => {
    const widths = [th, td, tr].filter(Boolean).map((el) => Math.max(px(cs(el).borderTopWidth), px(cs(el).borderLeftWidth)));
    return Math.max(...widths, 0) > 0;
  })
  need(pre, '代码块有底色', (el) => cs(el).backgroundColor !== 'rgba(0, 0, 0, 0)')
  need(pre, '代码块等宽字体', (el) => /mono|Menlo|Consolas|Courier/i.test(cs(el.querySelector('code') || el).fontFamily))
  need(bq, '引用有左边框', (el) => px(cs(el).borderLeftWidth) > 0)
  need(task, '任务列表有复选框', (el) => el.disabled === true)
  need(hr, '分隔线可见', (el) => px(cs(el).height) > 0 || px(cs(el).borderTopWidth) > 0)
  need(q('#write sup'), '上标是 sup', () => true)
  need(q('#write mark'), '高亮是 mark', () => true)
  need(q('#write section.md-footnotes'), '脚注区渲染', () => true)
  need(q('#write nav.md-toc a'), '目录渲染', () => true)
  need(q('#write dl.md-deflist dt'), '定义列表渲染', () => true)
  need(q('#write .mathjax-block'), '数学块渲染', () => true)
  need(q('#write figure.md-image img'), '图片以 figure 渲染', () => true)
  need(q('#write .md-html-block'), 'html 块渲染', () => true)
  need(q('#write li.md-task-list-item'), '任务列表 li 类名', () => true)

  // 横向溢出：正文不应该把页面撑宽（pre 与表格容器是刻意局部滚动的）
  {
    const vw = window.innerWidth;
    const bad = [];
    for (const el of root.querySelectorAll('#write *')) {
      if (el.closest('pre') === el || el.tagName === 'PRE') continue;
      if (el.closest('.md-table')) continue;
      if (el.tagName === 'CODE' || el.tagName === 'A') continue;
      const r = el.getBoundingClientRect();
      if (r.width > vw + 2 || r.right > vw + 2) {
        bad.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + '@' + Math.round(r.width));
      }
    }
    report('正文不横向溢出', document.documentElement.scrollWidth <= vw + 2 && bad.length === 0,
      'scrollWidth=' + document.documentElement.scrollWidth + '/vw=' + vw + (bad.length ? ' 撑宽元素: ' + [...new Set(bad)].slice(0, 6).join(', ') : ''));
  }

  const applied = out.filter((r) => r.ok !== null);
  const failed = applied.filter((r) => !r.ok);
  const detail = (r) => {
    if (r.label === 'ul 列表符号' && ul) return 'list-style-type=' + cs(ul).listStyleType;
    if (r.label === 'ol 列表符号' && ol) return 'list-style-type=' + cs(ol).listStyleType;
    if (r.label === '列表符号在行外' && ul) return 'list-style-position=' + cs(ul).listStylePosition;
    if (r.label === 'h1 字号大于正文') return (h1 ? cs(h1).fontSize : '?') + ' vs ' + (p ? cs(p).fontSize : '?');
    if (r.label === '标题层级递减') return [h1, h2, h3].map((e) => (e ? cs(e).fontSize : '?')).join(' > ');
    if (r.label === 'h1 加粗' && h1) return 'font-weight=' + cs(h1).fontWeight;
    if (r.label === '表格有边框' && th) return 'th/td/tr 边框=' + [th, td, tr].filter(Boolean).map((el) => cs(el).borderTopWidth).join('/');
    if (r.label === '代码块有底色' && pre) return cs(pre).backgroundColor;
    if (r.label === '代码块等宽字体' && pre) return cs(pre.querySelector('code') || pre).fontFamily.slice(0, 40);
    if (r.label === '引用有左边框' && bq) return cs(bq).borderLeftWidth;
    if (r.label === '分隔线可见' && hr) return 'height=' + cs(hr).height;
    return '';
  };
  document.getElementById('report').textContent =
    'PROBE_TOTAL=' + applied.length + ' PROBE_FAIL=' + failed.length + '\\n' +
    out.map((r) => (r.ok === null ? 'n/a  ' : r.ok ? 'ok   ' : 'FAIL ') + r.label +
      (r.detail || detail(r) ? '  [' + (r.detail || detail(r)) + ']' : '')).join('\\n');
}
runProbe();
`

function pageHtml(theme: PreviewTheme, markup: string, title: string): string {
  const css = previewCss(theme, '')
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>html, body { margin: 0; padding: 0; background: ${PAGE_BG[theme]}; }
#host { display: block; min-height: 100vh; }</style>
</head>
<body>
<div id="host"></div>
<pre id="report" style="display:none"></pre>
<script>
const dec = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const baseCss = dec(${JSON.stringify(b64(baseStyles))});
const themeCss = dec(${JSON.stringify(b64(css))});
const body = dec(${JSON.stringify(b64(markup))});
const root = document.getElementById('host').attachShadow({ mode: 'open' });
root.innerHTML = '<style>' + baseCss + '</style><style>' + themeCss + '</style><div id="write">' + body + '</div>';
${PROBE_SCRIPT}
</script>
</body>
</html>
`
}

/** 按 `## ` 二级标题切分：0 号是文档开头（前置元数据 + 标题层级） */
function splitSections(src: string): { slug: string; md: string }[] {
  const lines = src.split('\n')
  const out: { slug: string; md: string }[] = []
  let cur: string[] = []
  let title = 'preamble'
  const push = () => {
    const md = cur.join('\n').trim()
    if (md) out.push({ slug: slugify(title), md })
  }
  for (const line of lines) {
    const m = line.match(/^##\s+(.*)$/)
    if (m) {
      push()
      cur = []
      title = m[1]
      continue
    }
    cur.push(line)
  }
  push()
  return out
}

function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
  return base || 'section'
}

fs.mkdirSync(OUT_DIR, { recursive: true })

const manifest: {
  pages: { file: string; theme: PreviewTheme; width: number; height: number; kind: string }[]
} = { pages: [] }

const THEMES: PreviewTheme[] = ['default', 'paper', 'night', 'vue-light', 'vue-night']
const SECTION_THEMES: PreviewTheme[] = ['default', 'vue-light', 'vue-night']

// 整篇
for (const theme of THEMES) {
  const file = `all-${theme}.html`
  fs.writeFileSync(path.join(OUT_DIR, file), pageHtml(theme, renderMarkdown(content), `all ${theme}`))
  manifest.pages.push({ file, theme, width: 1280, height: 5200, kind: 'all' })
}
/*
 * 手机宽度：Windows 上 Chrome 的窗口有最小宽度（约 500px），直接 --window-size=414
 * 会得到 526px 的布局视口。改用 iframe 包一层：iframe 拥有自己的视口，
 * 媒体查询会按 414px 生效。
 */
const MOBILE_W = 414
const MOBILE_H = 6400
fs.writeFileSync(
  path.join(OUT_DIR, 'all-default-mobile.html'),
  pageHtml('default', renderMarkdown(content), 'all default mobile'),
)

/** 手机宽度用 iframe 包一层（iframe 自己的视口才会让媒体查询按手机宽度生效） */
function framePage(innerFile: string, w: number, h: number): string {
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>mobile frame</title>
<style>html, body { margin: 0; background: #fff; }</style></head>
<body>
<iframe src="${innerFile}" style="display:block;width:${w}px;height:${h}px;border:0"></iframe>
<pre id="report" style="display:none"></pre>
<script>
// 把 iframe 里的自检结果搬到外层，方便 --dump-dom 读取（需要 --allow-file-access-from-files）
const frame = document.querySelector('iframe')
frame.addEventListener('load', () => {
  try {
    document.getElementById('report').textContent = frame.contentDocument.getElementById('report').textContent
  } catch (err) {
    document.getElementById('report').textContent = 'PROBE_ERROR ' + err.message
  }
})
</script>
</body></html>`
}

fs.writeFileSync(path.join(OUT_DIR, 'all-default-mobile-frame.html'), framePage('all-default-mobile.html', MOBILE_W, MOBILE_H))
manifest.pages.push({
  file: 'all-default-mobile-frame.html',
  theme: 'default',
  width: MOBILE_W + 20,
  height: MOBILE_H + 20,
  kind: 'all-mobile',
})

// 分节
const sections = splitSections(content)
sections.forEach((sec, idx) => {
  const markup = renderMarkdown(sec.md)
  for (const theme of SECTION_THEMES) {
    const file = `section-${String(idx).padStart(2, '0')}-${sec.slug}-${theme}.html`
    fs.writeFileSync(path.join(OUT_DIR, file), pageHtml(theme, markup, `${sec.slug} ${theme}`))
    manifest.pages.push({ file, theme, width: 1280, height: 1500, kind: 'section' })
  }
  // 手机宽度的小节页（只看默认主题，避免页面数量爆炸）
  const mobileInner = `section-${String(idx).padStart(2, '0')}-${sec.slug}-mobile.html`
  const mobileFrame = `section-${String(idx).padStart(2, '0')}-${sec.slug}-mobile-frame.html`
  fs.writeFileSync(path.join(OUT_DIR, mobileInner), pageHtml('default', markup, `${sec.slug} mobile`))
  fs.writeFileSync(path.join(OUT_DIR, mobileFrame), framePage(mobileInner, MOBILE_W, 1200))
  manifest.pages.push({ file: mobileFrame, theme: 'default', width: MOBILE_W + 20, height: 1220, kind: 'section-mobile' })
})

fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({ sections: sections.map((s) => s.slug), ...manifest }, null, 2))
console.log(`生成 ${manifest.pages.length} 个页面 → ${OUT_DIR}`)
