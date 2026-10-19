/**
 * 文献表真实 DOM 交互测试：把 scripts/literature-view-dom.tsx 打成一个页面脚本，
 * 用无头 Chrome 打开并 --dump-dom 取回页面里的自检报告（<pre id="report">）。
 *
 *   npm run test:lit-dom            # 跑一遍（约 10–20 秒，需要本机有 Chrome 或 Edge）
 *
 * 打桩全部在页面内完成（假的 window.knowledgeGraphDesktop），不读真实 vault / 真实 Zotero 库；
 * 产物在 .tmp-lit-view-dom/（已 gitignore）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.join(ROOT, '.tmp-lit-view-dom')
const BUNDLE = path.join(TMP, 'lit-view-dom.js')
const PAGE = path.join(TMP, 'lit-view-dom.html')

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p))
if (!CHROME) {
  console.error('✗ 找不到 Chrome/Edge，无法跑真实 DOM 测试')
  process.exit(2)
}

fs.mkdirSync(TMP, { recursive: true })

await esbuild.build({
  entryPoints: [path.join(ROOT, 'scripts', 'literature-view-dom.tsx')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome110',
  jsx: 'automatic',
  alias: { '@': './src' },
  absWorkingDir: ROOT,
  outfile: BUNDLE,
  logLevel: 'warning',
})

fs.writeFileSync(
  PAGE,
  `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>文献表 DOM 交互测试</title>
<style>html, body { margin: 0; background: #fff; } pre#report { white-space: pre-wrap; }</style>
</head>
<body><div id="root"></div><script src="lit-view-dom.js"></script></body></html>
`,
)

// 每次跑用全新的 profile：避免上一轮的 localStorage / 缓存影响结果
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-lit-dom-'))
const url = 'file:///' + PAGE.replace(/\\/g, '/')

const dom = spawnSync(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--allow-file-access-from-files',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    // 这个自测点的是「桌面表格」：手机宽度会渲染卡片列表（见 LiteratureCardList），
    // 不指定窗口就会落到无头默认宽度上，tbody tr[title] 一条都找不到。
    '--window-size=1280,900',
    '--virtual-time-budget=15000',
    `--user-data-dir=${profile}`,
    '--dump-dom',
    url,
  ],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
).stdout ?? ''

const match = dom.match(/<pre id="report">([\s\S]*?)<\/pre>/)
const unescapeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')

if (!match) {
  console.error('✗ 没拿到自检报告（页面可能没跑完或报错）')
  console.error(dom.slice(0, 2000))
  process.exit(1)
}

const report = unescapeHtml(match[1])
console.log(report)

const fails = report.split('\n').filter((l) => l.startsWith('FAIL'))
const skips = report.split('\n').filter((l) => l.startsWith('SKIP'))
const total = (report.match(/PROBE_TOTAL=(\d+) PROBE_FAIL=(\d+)/) ?? [])[1]
console.log('')
console.log(`· 真实 DOM 交互：${total ?? '?'} 项，失败 ${fails.length} 项，跳过 ${skips.length} 项`)
if (skips.length) console.log('· 跳过（环境限制，不是通过）：\n' + skips.join('\n'))
console.log(`· 页面产物：${path.relative(ROOT, PAGE)}`)
process.exit(fails.length ? 1 : 0)
