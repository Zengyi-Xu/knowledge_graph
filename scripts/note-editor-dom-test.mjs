/**
 * NoteEditor 真实 DOM 交互测试驱动：把 scripts/note-editor-dom.tsx 打成页面脚本，
 * 用无头 Chrome 打开并 --dump-dom 取回 <pre id="report"> 里的自检报告。
 *
 *   npm run test:note-editor-dom      # 约 10 秒，需要本机有 Chrome 或 Edge
 *
 * 产物在 .tmp-lit-view-dom/（与文献表 DOM 测试共用目录，已 gitignore）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.join(ROOT, '.tmp-lit-view-dom')
const BUNDLE = path.join(TMP, 'note-editor-dom.js')
const PAGE = path.join(TMP, 'note-editor-dom.html')

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p))
if (!CHROME) {
  console.error('✗ 找不到 Chrome/Edge，无法跑真实 DOM 测试')
  process.exit(2)
}

fs.mkdirSync(TMP, { recursive: true })

// 把 ?inline 的 CSS 变成字符串（同 scripts/md-visual.mjs 的写法）
const cssInlinePlugin = {
  name: 'css-inline',
  setup(build) {
    build.onResolve({ filter: /\?inline$/ }, (a) => {
      let p = a.path.replace(/\?inline$/, '')
      if (p.startsWith('@/')) p = path.join(ROOT, 'src', p.slice(2))
      else if (!path.isAbsolute(p)) {
        const rel = path.resolve(a.resolveDir, p)
        p = fs.existsSync(rel) ? rel : path.join(ROOT, 'node_modules', p)
      }
      return { path: p, namespace: 'css-inline' }
    })
    build.onLoad({ filter: /.*/, namespace: 'css-inline' }, (a) => {
      const css = fs.readFileSync(a.path, 'utf8')
      return { contents: `export default ${JSON.stringify(css)}`, loader: 'js' }
    })
    // pdfjs 的 ?url 导入：打包期变成文件路径字符串即可
    build.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path.replace(/\?url$/, ''), namespace: 'asset-url' }))
    build.onLoad({ filter: /.*/, namespace: 'asset-url' }, (a) => ({ contents: `export default ${JSON.stringify(a.path)}`, loader: 'js' }))
  },
}

await esbuild.build({
  entryPoints: [path.join(ROOT, 'scripts', 'note-editor-dom.tsx')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome110',
  jsx: 'automatic',
  alias: { '@': './src' },
  absWorkingDir: ROOT,
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  plugins: [cssInlinePlugin],
  outfile: BUNDLE,
  logLevel: 'warning',
})

fs.writeFileSync(
  PAGE,
  `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>NoteEditor DOM 交互测试</title>
<style>html, body { margin: 0; background: #fff; } pre#report { white-space: pre-wrap; }</style>
</head>
<body><div id="root"></div><script src="note-editor-dom.js"></script></body></html>
`,
)

// 每次跑用全新的 profile：避免上一轮的 localStorage / 缓存影响结果
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-note-editor-dom-'))
const dom = spawnSync(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--allow-file-access-from-files',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    '--virtual-time-budget=15000',
    `--user-data-dir=${profile}`,
    '--dump-dom',
    'file:///' + PAGE.replace(/\\/g, '/'),
  ],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
).stdout ?? ''

const match = dom.match(/<pre id="report">([\s\S]*?)<\/pre>/)
const unescapeHtml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')

if (!match) {
  console.error('✗ 没拿到自检报告（页面可能没跑完或报错）')
  console.error(dom.slice(0, 2000))
  process.exit(1)
}

const report = unescapeHtml(match[1])
console.log(report)

const fails = report.split('\n').filter((l) => l.startsWith('FAIL'))
const total = (report.match(/PROBE_TOTAL=(\d+) PROBE_FAIL=(\d+)/) ?? [])[1]
console.log('')
console.log(`· NoteEditor 真实 DOM 交互：${total ?? '?'} 项，失败 ${fails.length} 项`)
console.log(`· 页面产物：${path.relative(ROOT, PAGE)}`)
process.exit(fails.length ? 1 : 0)
