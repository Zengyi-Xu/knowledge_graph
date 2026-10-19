/**
 * 六个场景的「真实加载」验证：生产构建 + 本机网页桥（scripts/local-web.mjs）+ headless Chromium，
 * 按真实 UI 操作记录每次落到 /assets/ 的请求，和打包静态预测（perf/bundle-lanes.json）对照。
 *
 *   npm run budget:report      # 先跑一次，生成 perf/bundle-lanes.json（构建期预测）
 *   npm run test:bundle-scenarios
 *
 * 断言（与 docs/BUNDLE_BUDGET.md 的加速预算一致）：
 *   1. 每个场景实际加载的 chunk 必须落在该场景的静态预测里（多出来的就是加载时机回退）
 *   2. PdfViewer / pdf.worker / 编辑器（Vditor）/ citation-js 不得出现在不该出现的场景
 *   3. 每个场景打印实测字节（浏览器 performance resource 计时 + CDP 请求表）
 *
 * 编辑器两种模式都测：经典模式下的「预览页签」不该拉起 Vditor；所见即所得模式下打开笔记正文就是编辑，
 * Vditor 随正文一起加载（这是设计，不是回退）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import esbuild from 'esbuild'
import { createLocalServer } from './local-web.mjs'

const root = process.cwd()
const dist = path.join(root, 'dist')
const lanesFile = path.join(root, 'perf/bundle-lanes.json')
const out = path.join(root, '.tmp-bundle-scenarios', `run-${Date.now()}`)
const vault = path.join(out, 'vault')
const profile = path.join(out, 'profile')

if (!(await exists(path.join(dist, 'index.html')))) throw new Error('先构建：npm run build（或 npm run budget:report）')
if (!(await exists(lanesFile))) throw new Error('缺 perf/bundle-lanes.json：先跑 npm run budget:report')
const lanes = JSON.parse(await fs.readFile(lanesFile, 'utf8'))
// 字节数来自构建产物清单（perf/bundle-baseline.json）；浏览器这边只回答「哪些 chunk 真的加载了」
const assetSizes = new Map(
  (JSON.parse(await fs.readFile(path.join(root, 'perf/bundle-baseline.json'), 'utf8')).assets ?? []).map((entry) => [entry.file, entry]),
)
const basename = (url) => decodeURIComponent(new URL(url, 'http://x').pathname.replace(/^\//, ''))
/** 只把 JS chunk 算进「加载了哪些 chunk」；CSS 单独统计字节 */
const assetOf = (url) => {
  const file = basename(url)
  return file.startsWith('assets/') && /\.(js|mjs)$/.test(file) ? file : null
}

// ---------------------------------------------------------------- 合成 vault（只含测试数据）
await fs.mkdir(vault, { recursive: true })
const tmpTools = path.join(out, 'tools.cjs')
await esbuild.build({
  stdin: {
    contents:
      "export { buildMeta, toMarkdown, relPathFor } from '@/lib/vaultFormat'; export { emptyLiterature } from '@/types/note'",
    resolveDir: root,
  },
  bundle: true,
  outfile: tmpTools,
  platform: 'node',
  format: 'cjs',
  alias: { '@': path.join(root, 'src') },
  logLevel: 'error',
})
const tools = createRequire(import.meta.url)(tmpTools)

const pdfPath = path.join(vault, '文献', '附件', 'example-paper.pdf')
await fs.mkdir(path.dirname(pdfPath), { recursive: true })
await fs.writeFile(pdfPath, minimalPdf())

const base = 1700000000000
const notes = [
  {
    id: 'lit-1',
    title: 'Example paper on silicon photonics',
    type: 'literature',
    grade: '',
    tags: ['方向:硅光'],
    content: '# Example paper\n\n摘要正文。\n\n## 摘录\n\n引文 [[普通笔记 1]]',
    createdAt: base,
    updatedAt: base,
    literature: {
      ...tools.emptyLiterature(),
      authors: ['Zhang, San'],
      venue: 'Nature Photonics',
      year: 2024,
      doi: '10.1038/s41566-024-xxxx',
      citekey: 'zhang2024example',
      collections: ['已发表文章'],
      localPdf: pdfPath,
    },
  },
  {
    id: 'note-1',
    title: '普通笔记 1',
    type: 'other',
    grade: '',
    tags: ['启动测试'],
    content: '普通正文。\n\n[[Example paper on silicon photonics]]\n',
    createdAt: base + 1,
    updatedAt: base + 1,
  },
]
const names = new Map(notes.map((note) => [note.id, tools.relPathFor(note)]))
for (const note of notes) {
  const file = path.join(vault, names.get(note.id))
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, tools.toMarkdown(note), 'utf8')
}
await fs.writeFile(path.join(vault, 'meta.json'), tools.buildMeta(notes, names), 'utf8')

// ---------------------------------------------------------------- 服务 + 浏览器
const local = await createLocalServer({ port: 0, vault, dist })
const executable = await findChromium()
const browser = spawn(
  executable,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' },
)

const checks = []
let keepArtifacts = true
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail === undefined ? '' : '：' + detail}`)
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

try {
  const debugPort = await waitForPort(profile)
  const target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((entry) => entry.type === 'page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
  let sequence = 0
  const pending = new Map()
  const requested = new Set()
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Network.requestWillBeSent') {
      const asset = assetOf(message.params.request.url)
      if (asset) requested.add(asset)
      return
    }
    const item = pending.get(message.id)
    if (item) {
      pending.delete(message.id)
      message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result?.value
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  // 每个场景都按「冷加载」量：否则第二次导航命中内存缓存，后面的场景全是 0 字节
  await send('Network.setCacheDisabled', { cacheDisabled: true })

  const waitFor = async (expression, timeout = 20000) => {
    const end = performance.now() + timeout
    while (performance.now() < end) {
      if (await evaluate(`Boolean(${expression})`)) return true
      await delay(60)
    }
    return false
  }
  /**
   * 真鼠标点击：Radix 的 Tabs 触发靠 mousedown 激活，`element.click()` 不生效，
   * 所以走 CDP 的 Input.dispatchMouseEvent（事件和真人点击一样是 trusted）。
   */
  const clickPoint = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  const clickByExpression = async (findExpression) => {
    const point = await evaluate(
      `(() => { const el = ${findExpression}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })()`,
    )
    if (!point) return false
    await clickPoint(point.x, point.y)
    return true
  }
  const tabByLabel = (label) => `[...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === ${JSON.stringify(label)})`
  /** 点到目标为止：懒加载视图切换会让按钮位置变动，一次点击可能落空 */
  const clickUntil = async (findExpression, signalExpression, timeout = 15000) => {
    const end = performance.now() + timeout
    while (performance.now() < end) {
      await clickByExpression(findExpression)
      if (await waitFor(signalExpression, 2500)) return true
    }
    return false
  }
  /** Markdown 预览挂在 Shadow DOM 里（PreviewContent.tsx），只能这样确认「读到正文了」 */
  const previewHost = `[...document.querySelectorAll('div')].some((d) => d.shadowRoot && d.shadowRoot.querySelector('[class^=md-], .md-body, .md-fences'))`
  const editorReady = `document.querySelector('.vditor, [data-testid=wysiwyg-editor]')`
  const pdfOpen = `document.querySelector('canvas')`

  const bootstrapSource = (editorMode) => `(() => {
    for (const prefix of ['kg-', 'kg-dev-']) {
      localStorage.setItem(prefix + 'vault-dir-v1', ${JSON.stringify(vault)});
      localStorage.setItem(prefix + 'vault-watch-v1', '0');
      localStorage.setItem(prefix + 'auto-sync-v1', '0');
      localStorage.setItem(prefix + 'editor-mode-v1', ${JSON.stringify(editorMode)});
    }
  })()`
  const shellReady = `document.querySelector('header') && /个条目/.test(document.body.innerText)`

  const SCENARIOS = [
    {
      key: 'home',
      label: '首页（默认并列视图：图谱 + 笔记预览）',
      mode: 'classic',
      drive: async () => {
        await waitFor(shellReady)
        await delay(2000)
        return true
      },
      allow: ['home', 'preview', 'graph'],
      forbid: ['PdfViewer + pdf.worker', '编辑器 Vditor', 'citation-js + CSL 样式'],
    },
    {
      key: 'literature',
      label: '文献列表',
      mode: 'classic',
      drive: async () => (await waitFor(shellReady)) && (await clickUntil(tabByLabel('文献'), `document.querySelector('table')`)),
      allow: ['home', 'preview', 'graph', 'literature'],
      forbid: ['PdfViewer + pdf.worker', '编辑器 Vditor', 'citation-js + CSL 样式'],
    },
    {
      key: 'preview',
      label: '预览（阅读态：笔记区停在预览页签）',
      mode: 'classic',
      drive: async () => (await waitFor(shellReady)) && (await clickUntil(tabByLabel('预览'), previewHost)),
      allow: ['home', 'preview', 'graph'],
      forbid: ['PdfViewer + pdf.worker', '编辑器 Vditor', 'citation-js + CSL 样式'],
    },
    {
      key: 'edit',
      label: '编辑（所见即所得：Vditor 随正文加载）',
      mode: 'wysiwyg',
      drive: async () =>
        (await waitFor(shellReady)) && (await clickUntil(tabByLabel('笔记'), editorReady, 25000)),
      allow: ['home', 'preview', 'graph', 'edit'],
      forbid: ['PdfViewer + pdf.worker', 'citation-js + CSL 样式'],
      require: ['编辑器 Vditor'],
    },
    {
      key: 'graph',
      label: '图谱',
      mode: 'classic',
      drive: async () => {
        await waitFor(shellReady)
        await clickUntil(tabByLabel('图谱'), `document.querySelector('svg')`)
        await delay(600)
        return true
      },
      allow: ['home', 'preview', 'graph'],
      forbid: ['PdfViewer + pdf.worker', '编辑器 Vditor', 'citation-js + CSL 样式'],
    },
    {
      key: 'pdf',
      label: 'PDF（文献表 → PDF 徽标 → 全屏阅读）',
      mode: 'classic',
      drive: async () => {
        if (!(await waitFor(shellReady))) return false
        if (!(await clickUntil(tabByLabel('文献'), `document.querySelector('table')`))) return false
        if (!(await clickUntil(`document.querySelector('button[title="在软件内全屏阅读 PDF"]')`, pdfOpen, 30000))) return false
        await delay(1200)
        return true
      },
      allow: ['home', 'preview', 'graph', 'literature', 'pdf'],
      forbid: ['编辑器 Vditor', 'citation-js + CSL 样式'],
      require: ['PdfViewer + pdf.worker'],
    },
  ]

  const results = []
  for (const scenario of SCENARIOS) {
    requested.clear()
    const injection = await send('Page.addScriptToEvaluateOnNewDocument', { source: bootstrapSource(scenario.mode) })
    await send('Page.navigate', { url: local.origin })
    await delay(400)
    const driven = await scenario.drive()
    const loaded = [...requested].sort()
    const workers = loaded.filter((file) => /\.mjs$/.test(file))
    const bytes = loaded.reduce((sum, file) => sum + (assetSizes.get(file)?.raw ?? 0), 0)
    const gzip = loaded.reduce((sum, file) => sum + (assetSizes.get(file)?.gzip ?? 0), 0)
    // 「首页」用的默认并列视图本身就同时渲染图谱与笔记预览，所以每个场景允许的集合是
    // 它自己 + 启动即渲染的那几块（declared in `allow`），而不是只允许它自己。
    const allowed = new Set((scenario.allow ?? [scenario.key]).flatMap((key) => lanes.scenarios[key] ?? []))
    if ((scenario.allow ?? []).includes('pdf')) for (const file of lanes.workerAssets ?? []) allowed.add(file)
    const unexpected = loaded.filter((file) => !allowed.has(file))
    const missing = [...(lanes.scenarios[scenario.key] ?? [])].filter((file) => !loaded.includes(file))
    const unitHit = {}
    for (const [label, unit] of Object.entries(lanes.units)) unitHit[label] = unit.files.filter((file) => loaded.includes(file))

    console.log(`\n[${scenario.key}] ${scenario.label}`)
    check(`${scenario.key}：UI 操作完成`, driven)
    if (!driven) {
      const diagnosis = await evaluate(
        `({ tabs: [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()), table: Boolean(document.querySelector('table')), pdfButton: Boolean(document.querySelector('button[title="在软件内全屏阅读 PDF"]')), text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400) })`,
      )
      console.log(`      ↳ 诊断：${JSON.stringify(diagnosis)}`)
    }
    check(
      `${scenario.key}：没有多加载预测之外的 chunk`,
      unexpected.length === 0,
      unexpected.length ? `多加载 ${unexpected.join(', ')}` : `${loaded.length} 个 chunk（允许集合：${(scenario.allow ?? [scenario.key]).join('+')}）`,
    )
    if (missing.length) console.log(`      （预测里有、实测没触发：${missing.join(', ')}；通常是该场景这一步没渲染到）`)
    for (const label of scenario.forbid ?? []) check(`${scenario.key}：不该加载「${label}」`, unitHit[label].length === 0, unitHit[label].join(', ') || '未加载')
    for (const label of scenario.require ?? []) check(`${scenario.key}：必须加载「${label}」`, unitHit[label].length > 0, unitHit[label].join(', ') || '没加载')
    results.push({ scenario: scenario.key, label: scenario.label, bytes, gzip, chunks: loaded, workers })
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
  }

  console.log('\n=== 实测（JS chunk raw / gzip；体积取构建产物清单，加载集合取浏览器真实请求） ===')
  for (const row of results) {
    const worker = row.workers.length ? `（含 worker ${row.workers.join(', ')}）` : ''
    console.log(
      `  ${row.scenario.padEnd(11)} ${(row.bytes / 1024).toFixed(1).padStart(9)}KB gzip ${(row.gzip / 1024).toFixed(1).padStart(8)}KB  ${row.chunks.length} chunks ${worker}`,
    )
  }

  const measuredFile = path.join(root, 'perf/bundle-scenarios.json')
  await fs.writeFile(
    measuredFile,
    JSON.stringify({ generatedAt: new Date().toISOString(), origin: local.origin, results }, null, 2) + '\n',
    'utf8',
  )
  console.log(`\n实测结果已写入 ${path.relative(root, measuredFile)}`)

  const failed = checks.filter((entry) => !entry.ok)
  console.log(`\n结果：${checks.length - failed.length} 通过，${failed.length} 失败`)
  if (failed.length) process.exitCode = 1
  keepArtifacts = failed.length > 0 // 失败时留着现场（合成 vault + 诊断）给人看
} finally {
  const exited = new Promise((resolve) => browser.once('exit', resolve))
  browser.kill()
  await Promise.race([exited, delay(5000)])
  await local.close?.()
  // 全绿就清掉临时目录（Chromium profile 上百 MB）；Chrome 刚退出时文件可能还被占着，靠重试兜
  if (!keepArtifacts) await fs.rm(out, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 }).catch(() => {})
}

/** 一页最小可用 PDF（xref 偏移按真实字节数算，pdf.js 才肯渲染） */
function minimalPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const stream = 'BT /F1 14 Tf 20 100 Td (Hello PDF) Tj ET'
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  let pdf = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function findChromium() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ]
  for (const candidate of candidates) if (await exists(candidate)) return candidate
  throw new Error('没有找到 Chromium（Chrome/Edge），无法做真实加载验证')
}

async function waitForPort(profileDir) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const text = await fs.readFile(path.join(profileDir, 'DevToolsActivePort'), 'utf8')
      const port = Number(text.split('\n')[0])
      if (port) return port
    } catch {
      /* 还没起来 */
    }
    await delay(100)
  }
  throw new Error('Chrome 没起来')
}

