import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.join(ROOT, '.tmp-math-visual')
const SOURCE = path.join(TMP, 'source')
const OUT = path.join(TMP, 'out')
const SHOT = path.join(TMP, 'latex-render.png')
const REPORT = path.join(TMP, 'report.json')
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate))

fs.mkdirSync(SOURCE, { recursive: true })
fs.writeFileSync(path.join(SOURCE, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><title>LaTeX visual check</title></head><body><div id="root"></div><script type="module" src="/scripts/math-visual-app.tsx"></script></body></html>')

await build({
  root: ROOT,
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir: OUT,
    emptyOutDir: true,
    rollupOptions: { input: path.join(SOURCE, 'index.html') },
  },
})

if (!CHROME) throw new Error('找不到 Chrome / Edge，无法执行公式视觉验收')

const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' }
const server = http.createServer((request, response) => {
  const relative = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname).replace(/^\/+/, '') || 'index.html'
  const file = path.resolve(OUT, relative)
  if (!file.startsWith(path.resolve(OUT)) || !fs.existsSync(file)) {
    response.writeHead(404).end('not found')
    return
  }
  response.setHeader('Content-Type', contentTypes[path.extname(file)] ?? 'application/octet-stream')
  response.end(fs.readFileSync(file))
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const port = typeof address === 'object' && address ? address.port : 0
const url = `http://127.0.0.1:${port}/.tmp-math-visual/source/index.html`
const profile = path.join(TMP, 'chrome-profile')

function runChrome(args) {
  return new Promise((resolve) => {
    const child = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

try {
  const common = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--force-device-scale-factor=1', '--virtual-time-budget=8000',
    `--user-data-dir=${profile}`,
  ]
  const screenshot = await runChrome([...common, '--window-size=1380,1500', `--screenshot=${SHOT}`, url])
  if (screenshot.status !== 0 || !fs.existsSync(SHOT)) throw new Error(`截图失败：${screenshot.stderr || screenshot.stdout}`)

  const dom = await runChrome([...common, '--dump-dom', url])
  if (dom.status !== 0) throw new Error(`DOM 验收失败：${dom.stderr || dom.stdout}`)
  fs.writeFileSync(path.join(TMP, 'dom.html'), dom.stdout)
  const match = dom.stdout.match(/<pre[^>]*id="report"[^>]*>([\s\S]*?)<\/pre>/u)
  if (!match) throw new Error(`没有取得视觉验收报告（DOM ${dom.stdout.length} 字节）`)
  const decoded = match[1].replace(/&quot;/gu, '"').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&')
  const report = JSON.parse(decoded)
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  console.log(`截图：${path.relative(ROOT, SHOT)}`)
  if (report.failed) process.exitCode = 1
} finally {
  await new Promise((resolve) => server.close(resolve))
}

