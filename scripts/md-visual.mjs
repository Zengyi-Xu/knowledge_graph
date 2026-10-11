/**
 * Markdown 渲染视觉检查（生成截图 + computedStyle 自检）。
 *
 *   node scripts/md-visual.mjs                 # 全部页面：整篇 5 主题 + 分节 3 主题 + 手机版
 *   node scripts/md-visual.mjs --filter=列表    # 只截图文件名匹配的页面
 *   node scripts/md-visual.mjs --no-shot       # 只生成 HTML 与自检报告，不截图
 *
 * 产物在 .tmp-md-visual/（已被 .gitignore 忽略）：
 *   app.css                 Tailwind 编译结果（含 preflight，视觉检查必须带上它）
 *   out/*.html              渲染页面（Shadow DOM + 真实组件）
 *   shots/*.png             截图
 *   probe.txt               自检脚本的结论
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.join(ROOT, '.tmp-md-visual')
const OUT = path.join(TMP, 'out')
const SHOTS = path.join(TMP, 'shots')
const APP_CSS = path.join(TMP, 'app.css')

const args = process.argv.slice(2)
const noShot = args.includes('--no-shot')
const filterArg = args.find((a) => a.startsWith('--filter='))
const filter = filterArg ? new RegExp(filterArg.slice('--filter='.length)) : null

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p))

function run(cmd, cmdArgs, label) {
  const res = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (res.status !== 0) {
    console.error(`✗ ${label} 失败 (exit ${res.status})`)
    if (res.stdout) console.error(res.stdout.slice(-4000))
    if (res.stderr) console.error(res.stderr.slice(-4000))
    process.exit(res.status ?? 1)
  }
  return res.stdout ?? ''
}

/* ---------------- 1. Tailwind（含 preflight，必须与实际应用一致） ---------------- */

// 直接跑 tailwind 的 CLI 入口：Windows 上 .cmd 需要 shell，spawnSync 默认不允许
const twCli = path.join(ROOT, 'node_modules', 'tailwindcss', 'lib', 'cli.js')
run(process.execPath, [twCli, '-i', 'src/index.css', '-o', APP_CSS], 'tailwind 编译')
console.log(`· Tailwind → ${path.relative(ROOT, APP_CSS)} (${fs.statSync(APP_CSS).size} B)`)

/* ---------------- 2. 打包渲染入口（把 ?inline 的 CSS 变成字符串） ---------------- */

const cssInlinePlugin = {
  name: 'css-inline',
  setup(build) {
    build.onResolve({ filter: /\?inline$/ }, (a) => {
      let p = a.path.replace(/\?inline$/, '')
      if (p.startsWith('@/')) p = path.join(ROOT, 'src', p.slice(2))
      else if (!path.isAbsolute(p)) p = path.resolve(a.resolveDir, p)
      return { path: p, namespace: 'css-inline' }
    })
    build.onLoad({ filter: /.*/, namespace: 'css-inline' }, (a) => {
      const css = a.path.endsWith(`${path.sep}index.css`) ? fs.readFileSync(APP_CSS, 'utf8') : fs.readFileSync(a.path, 'utf8')
      return { contents: `export default ${JSON.stringify(css)}`, loader: 'js' }
    })
  },
}

const bundle = path.join(TMP, 'visual.cjs')
await esbuild.build({
  entryPoints: [path.join(ROOT, 'scripts/md-visual.tsx')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  jsx: 'automatic',
  alias: { '@': path.join(ROOT, 'src') },
  plugins: [cssInlinePlugin],
  logLevel: 'warning',
})
console.log('· 渲染入口已打包')

/* ---------------- 3. 生成页面 ---------------- */

const genOut = run(process.execPath, [bundle], '生成页面')
process.stdout.write(genOut)

const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'))

/* ---------------- 4. 截图 + computedStyle 自检 ---------------- */

if (!noShot) {
  if (!CHROME) {
    console.error('✗ 找不到 Chrome/Edge，无法截图')
    process.exit(2)
  }
  fs.mkdirSync(SHOTS, { recursive: true })
  const profile = path.join(TMP, 'chrome-profile')
  const probeLines = []
  const pages = manifest.pages.filter((p) => !filter || filter.test(p.file))
  console.log(`· 截图 ${pages.length} 个页面（Chrome: ${CHROME}）`)
  for (const p of pages) {
    const url = 'file:///' + path.join(OUT, p.file).replace(/\\/g, '/')
    const shot = path.join(SHOTS, p.file.replace(/\.html$/, '.png'))
    run(
      CHROME,
      [
        '--headless=new',
        '--no-sandbox',
        '--allow-file-access-from-files',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        '--force-device-scale-factor=1',
        '--virtual-time-budget=4000',
        `--user-data-dir=${profile}`,
        `--window-size=${p.width},${p.height}`,
        `--screenshot=${shot.replace(/\\/g, '/')}`,
        url,
      ],
      `截图 ${p.file}`,
    )
    // 自检报告
    const dom = run(CHROME, [
      '--headless=new',
      '--no-sandbox',
      '--allow-file-access-from-files',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--virtual-time-budget=4000',
      `--user-data-dir=${profile}`,
      '--dump-dom',
      url,
    ], `自检 ${p.file}`)
    const m = dom.match(/<pre id="report"[^>]*>([\s\S]*?)<\/pre>/)
    const text = m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '(没有拿到报告)'
    probeLines.push(`===== ${p.file} =====\n${text}`)
    console.log(`  · ${p.file}`)
  }
  fs.writeFileSync(path.join(TMP, 'probe.txt'), probeLines.join('\n\n'))

  // 汇总失败项
  const fails = probeLines.join('\n').split('\n').filter((l) => l.startsWith('FAIL '))
  const totals = probeLines.join('\n').match(/PROBE_TOTAL=(\d+) PROBE_FAIL=(\d+)/g) ?? []
  const [t, f] = totals.reduce(
    (acc, s) => {
      const m = s.match(/PROBE_TOTAL=(\d+) PROBE_FAIL=(\d+)/)
      return [acc[0] + Number(m[1]), acc[1] + Number(m[2])]
    },
    [0, 0],
  )
  console.log(`\n· 自检：${t} 项，失败 ${f} 项`)
  if (fails.length) {
    const uniq = [...new Set(fails)]
    console.log(uniq.slice(0, 40).join('\n'))
  }
  console.log(`· 截图目录：${path.relative(ROOT, SHOTS)}`)
}
