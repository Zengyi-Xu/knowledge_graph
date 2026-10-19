/**
 * 打包体积基线 + CI 预算（不需要浏览器；自带一次 production 构建，结论只依赖 Rollup 的
 * chunk 元数据，不猜文件名）。
 *
 *   npm run budget:check            # 构建 + 断言预算，超了退出码 1（CI 用这个）
 *   npm run budget:report           # 只打印表格，不因预算失败
 *   npm run budget:baseline         # 把当前结果写成新的基线（perf/bundle-baseline.json）
 *
 * 预算（用户 2026-10-15 定的硬指标，见 docs/BUNDLE_BUDGET.md）：
 *   1. 主入口 chunk        ≤ 500KB raw
 *   2. 进入文献列表新增     ≤ 200KB raw
 *   3. GraphView chunk     ≤ 80KB raw
 *   4. PdfViewer + pdf.worker / 编辑器（Vditor）/ citation-js 只在对应场景加载：
 *      不得出现在首页、文献列表、预览、图谱的静态闭包里
 *   5. 每个场景的 JS 总量相对基线涨幅 ≤ 10%（防回归）
 *
 * 构建期额外产出：--json 可以把整份报告（含每个 chunk 的模块归属）写到文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { build } from 'vite'

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf(name)
  return at === -1 ? fallback : argv[at + 1]
}
const has = (name) => argv.includes(name)
const KB = 1024

const BASELINE_FILE = path.resolve(ROOT, flag('--baseline', 'perf/bundle-baseline.json'))
const LANES_FILE = path.resolve(ROOT, flag('--lanes', 'perf/bundle-lanes.json'))
const JSON_OUT = flag('--json', '')
const update = has('--update')
const reportOnly = has('--report')

// ------------------------------------------------------------------ 硬预算
const BUDGET = {
  entryRaw: 500 * KB,
  literatureIncrementRaw: 200 * KB,
  graphRaw: 80 * KB,
  scenarioDriftRatio: 1.1,
}

/**
 * 按需加载的东西：`roots` 命中 chunk 的模块（源码路径或 node_modules 包路径），
 * `allowed` 列出允许出现它的场景——出现在别的场景里就是加载时机回退。
 */
const LAZY_UNITS = [
  {
    label: 'PdfViewer + pdf.worker',
    roots: [/src\/components\/(PdfViewer|PdfReadingWorkspace|LiteratureAttachments)\.tsx$/, /node_modules\/pdfjs-dist\//],
    extraAssets: [/^assets\/pdf\.worker\.min-.*\.mjs$/],
    allowed: ['pdf'],
  },
  {
    label: '编辑器 Vditor',
    roots: [/src\/components\/WysiwygEditor\.tsx$/, /node_modules\/vditor\//],
    allowed: ['edit'],
  },
  {
    label: 'citation-js + CSL 样式',
    roots: [/node_modules\/@citation-js\//, /node_modules\/citeproc\//, /node_modules\/wikibase-sdk\//, /src\/lib\/csl\//],
    allowed: ['citation'],
  },
]

// ------------------------------------------------------------------ 跑一次构建拿元数据
const chunks = new Map() // fileName -> 元数据
const assets = new Map() // fileName -> { raw, gzip, kind }
let indexHtml = ''

await build({
  configFile: path.resolve(ROOT, 'vite.config.ts'),
  logLevel: 'warn',
  build: { write: true },
  plugins: [
    {
      name: 'kg:bundle-budget',
      generateBundle(_options, bundle) {
        for (const [file, item] of Object.entries(bundle)) {
          const size = item.type === 'chunk' ? Buffer.byteLength(item.code) : Buffer.byteLength(String(item.source))
          assets.set(file, { raw: size, gzip: gzipSize(item), kind: item.type === 'chunk' ? 'js' : 'asset' })
          if (item.type !== 'chunk') continue
          chunks.set(file, {
            isEntry: Boolean(item.isEntry),
            isDynamicEntry: Boolean(item.isDynamicEntry),
            imports: item.imports,
            dynamicImports: item.dynamicImports,
            css: item.viteMetadata?.importedCss ? [...item.viteMetadata.importedCss] : [],
            modules: Object.keys(item.modules).map((id) => id.replace(/\\/g, '/')),
            code: item.code,
          })
        }
      },
      closeBundle() {
        const html = path.join(ROOT, 'dist', 'index.html')
        if (fs.existsSync(html)) indexHtml = fs.readFileSync(html, 'utf8')
      },
    },
  ],
})

function gzipSize(item) {
  const source = item.type === 'chunk' ? Buffer.from(item.code) : Buffer.from(String(item.source))
  return zlib.gzipSync(source).length
}
const sizeOf = (file) => assets.get(file)?.raw ?? 0
const gzipOf = (file) => assets.get(file)?.gzip ?? 0

// ------------------------------------------------------------------ chunk 图
const moduleToChunk = new Map()
for (const [file, info] of chunks) for (const id of info.modules) moduleToChunk.set(id, file)

/** 静态闭包：自己 + 递归的静态 import（动态 import 不算——那正是「按需」的边界） */
function closure(roots) {
  const seen = new Set()
  const queue = [...roots]
  while (queue.length) {
    const file = queue.pop()
    if (!file || seen.has(file)) continue
    seen.add(file)
    for (const dep of chunks.get(file)?.imports ?? []) queue.push(dep)
  }
  return seen
}

function chunksMatching(patterns) {
  const out = new Set()
  for (const [file, info] of chunks) {
    if (info.modules.some((id) => patterns.some((re) => re.test(id)))) out.add(file)
  }
  return out
}

const entryChunk = [...chunks].find(([, info]) => info.isEntry)?.[0]
if (!entryChunk) throw new Error('没有找到入口 chunk，构建输出异常')

/** 场景 = 一组 chunk 文件的静态闭包（JS + CSS 分开统计） */
function scenario(name, roots) {
  const files = closure(roots)
  const js = [...files].filter((f) => chunks.has(f))
  const css = new Set()
  for (const file of js) for (const sheet of chunks.get(file).css) css.add(sheet)
  return {
    name,
    files: [...files].sort(),
    chunks: js.sort((a, b) => sizeOf(b) - sizeOf(a)),
    js: js.reduce((sum, f) => sum + sizeOf(f), 0),
    gzip: js.reduce((sum, f) => sum + gzipOf(f), 0),
    css: [...css].reduce((sum, f) => sum + sizeOf(f), 0),
    cssGzip: [...css].reduce((sum, f) => sum + gzipOf(f), 0),
  }
}

const literatureChunks = chunksMatching([/src\/components\/LiteratureView\.tsx$/])
const previewChunks = chunksMatching([/src\/components\/NoteEditor\.tsx$/, /src\/components\/PreviewContent\.tsx$/])
const graphChunks = chunksMatching([/src\/components\/GraphView\.tsx$/])
const editChunks = chunksMatching([/src\/components\/WysiwygEditor\.tsx$/])
const pdfChunks = chunksMatching([/src\/components\/PdfViewer\.tsx$/])
const citationChunks = chunksMatching(LAZY_UNITS[2].roots)

const SCENARIOS = [
  scenario('home', [entryChunk]),
  scenario('literature', [entryChunk, ...literatureChunks]),
  scenario('preview', [entryChunk, ...previewChunks]),
  scenario('edit', [entryChunk, ...previewChunks, ...editChunks]),
  scenario('graph', [entryChunk, ...graphChunks]),
  scenario('pdf', [entryChunk, ...previewChunks, ...pdfChunks]),
  scenario('citation', [entryChunk, ...previewChunks, ...literatureChunks, ...citationChunks]),
]
const scen = Object.fromEntries(SCENARIOS.map((s) => [s.name, s]))

/** 每个「按需单元」落在哪些场景里（用来判加载时机） */
const unitLanes = LAZY_UNITS.map((unit) => {
  const files = [...chunksMatching(unit.roots)]
  const lanes = SCENARIOS.filter((s) => files.some((f) => s.files.includes(f))).map((s) => s.name)
  return { ...unit, files, lanes }
})

const literatureIncrement = scen.literature.js - scen.home.js
const graphChunkBytes = [...graphChunks].reduce((sum, f) => sum + sizeOf(f), 0)

// ------------------------------------------------------------------ 预算判定
const violations = []
const budget = (ok, label, detail) => {
  if (!ok) violations.push(`${label} ${detail}`)
  console.log(`  ${ok ? '✓' : '✗'} ${label} ${detail}`)
}

const kbText = (bytes) => `${(bytes / KB).toFixed(1)}KB`
console.log('\n=== 预算 ===')
budget(
  sizeOf(entryChunk) <= BUDGET.entryRaw,
  '主入口 chunk ≤ 500KB raw',
  `${kbText(sizeOf(entryChunk))}（gzip ${kbText(gzipOf(entryChunk))}）`,
)
budget(
  literatureIncrement <= BUDGET.literatureIncrementRaw,
  '进文献列表新增 ≤ 200KB raw',
  `${kbText(literatureIncrement)}（${literatureChunks.size} 个 chunk）`,
)
budget(graphChunkBytes <= BUDGET.graphRaw, 'GraphView ≤ 80KB raw', kbText(graphChunkBytes))
const preloaded = [...indexHtml.matchAll(/rel="modulepreload"[^>]*href="\.\/([^"]+)"/g)].map((m) => m[1])
const preloadedLazy = preloaded.filter((file) => LAZY_UNITS.some((unit) => chunksMatching(unit.roots).has(file)))
budget(
  preloadedLazy.length === 0,
  'index.html 不预载懒加载 chunk',
  preloadedLazy.length ? `被预载：${preloadedLazy.join(', ')}` : `（预载 ${preloaded.length} 个：${preloaded.join(', ') || '无'}）`,
)

for (const unit of unitLanes) {
  const wrong = unit.lanes.filter((lane) => !unit.allowed.includes(lane))
  const shouldBeIn = unit.allowed.filter((lane) => !unit.lanes.includes(lane))
  budget(
    unit.files.length > 0 && wrong.length === 0,
    `${unit.label} 只在 ${unit.allowed.join('/')} 加载`,
    unit.files.length === 0
      ? '没找到对应 chunk（模块名变了？）'
      : `当前出现在：${unit.lanes.join(', ') || '（哪里都没有）'}${wrong.length ? ` ← 不应出现在 ${wrong.join(', ')}` : ''}${shouldBeIn.length ? `（未出现在 ${shouldBeIn.join(', ')}：可能被静态拉平了）` : ''}`,
  )
  if (unit.extraAssets) {
    for (const re of unit.extraAssets) {
      const files = [...assets.keys()].filter((f) => re.test(f))
      for (const file of files) {
        const referenced = [...chunks].filter(([, info]) => info.code.includes(path.basename(file))).map(([f]) => f)
        const ok = referenced.length > 0 && referenced.every((f) => unit.files.includes(f))
        budget(ok, `${path.basename(file)} 只被 ${unit.label} 引用`, `引用方：${referenced.map((f) => path.basename(f)).join(', ') || '（无人引用）'}`)
      }
    }
  }
}

// ------------------------------------------------------------------ 表格输出
console.log('\n=== 场景（静态闭包；JS raw / JS gzip / CSS raw） ===')
for (const s of SCENARIOS) {
  console.log(
    `  ${s.name.padEnd(11)} ${kbText(s.js).padStart(10)} ${kbText(s.gzip).padStart(10)} ${kbText(s.css).padStart(9)}   ${s.chunks.length} chunks`,
  )
}
console.log('\n=== 最大的资产 ===')
for (const [file, info] of [...assets].sort((a, b) => b[1].raw - a[1].raw).slice(0, 12)) {
  console.log(`  ${kbText(info.raw).padStart(10)} gzip ${kbText(info.gzip).padStart(9)}  ${file}`)
}

// ------------------------------------------------------------------ 基线对比
const current = {
  generatedAt: new Date().toISOString(),
  git: gitInfo(),
  vite: viteVersion(),
  budgets: { entryRaw: BUDGET.entryRaw, literatureIncrementRaw: BUDGET.literatureIncrementRaw, graphRaw: BUDGET.graphRaw },
  assets: [...assets]
    .map(([file, info]) => ({ file, raw: info.raw, gzip: info.gzip, kind: info.kind }))
    .sort((a, b) => b.raw - a.raw),
  chunks: SCENARIOS.map((s) => ({ scenario: s.name, js: s.js, gzip: s.gzip, css: s.css, files: s.chunks })),
}

if (update) {
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true })
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2) + '\n', 'utf8')
  console.log(`\n基线已更新：${path.relative(ROOT, BASELINE_FILE)}`)
} else if (fs.existsSync(BASELINE_FILE)) {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  console.log(`\n=== 相对基线（${path.relative(ROOT, BASELINE_FILE)}，${baseline.generatedAt.slice(0, 16).replace('T', ' ')}） ===`)
  for (const s of SCENARIOS) {
    const before = baseline.chunks?.find((entry) => entry.scenario === s.name)
    if (!before) continue
    const limit = Math.round(before.js * BUDGET.scenarioDriftRatio)
    const delta = s.js - before.js
    const ok = s.js <= limit
    if (!ok) violations.push(`场景 ${s.name} 体积回归：${kbText(before.js)} → ${kbText(s.js)}（上限 ${kbText(limit)}）`)
    console.log(`  ${ok ? '✓' : '✗'} ${s.name.padEnd(11)} ${kbText(before.js).padStart(10)} → ${kbText(s.js).padStart(10)}  (${delta >= 0 ? '+' : '-'}${kbText(Math.abs(delta))})`)
  }
} else {
  console.log(`\n（还没有基线：跑 npm run budget:baseline 生成 ${path.relative(ROOT, BASELINE_FILE)}）`)
}

if (JSON_OUT) {
  const file = path.resolve(ROOT, JSON_OUT)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n', 'utf8')
  console.log(`报告已写入 ${path.relative(ROOT, file)}`)
}

// 场景 → chunk 的静态预测写盘：浏览器实测（scripts/bundle-scenarios.mjs）拿它当对照
fs.mkdirSync(path.dirname(LANES_FILE), { recursive: true })
fs.writeFileSync(
  LANES_FILE,
  JSON.stringify(
    {
      generatedAt: current.generatedAt,
      entry: entryChunk,
      workerAssets: [...assets.keys()].filter((file) => /pdf\.worker/.test(file)),
      scenarios: Object.fromEntries(SCENARIOS.map((s) => [s.name, s.chunks])),
      units: Object.fromEntries(unitLanes.map((unit) => [unit.label, { files: unit.files, allowed: unit.allowed }])),
    },
    null,
    2,
  ) + '\n',
  'utf8',
)
console.log(`场景预测已写入 ${path.relative(ROOT, LANES_FILE)}`)

if (violations.length && !reportOnly && !update) {
  console.log(`\n预算未通过（${violations.length} 项）：`)
  for (const line of violations) console.log(`  - ${line}`)
  process.exit(1)
}
console.log(`\n预算检查${violations.length ? `（${violations.length} 项未通过，--report 模式不失败）` : '通过'}`)

function gitInfo() {
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0
    return { head, dirty }
  } catch {
    return { head: '', dirty: true }
  }
}

function viteVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/vite/package.json'), 'utf8')).version
  } catch {
    return ''
  }
}
