/**
 * 移动端第一阶段 · 360 / 390 / 412 / 768 / 1024 / 1440 六档宽度的响应式与能力降级验证。
 *
 *   npm run test:mobile                 # 构建 + 跑完整矩阵（约 2–4 分钟）
 *   npm run test:mobile -- --no-build   # 复用现有 dist
 *   npm run test:mobile -- --only 360,768
 *   npm run test:mobile -- --shots      # 额外产出各宽度各状态的无个人信息截图
 *
 * 做法（**不需要任何监听端口、不需要网络**）：
 *   1. 把 `dist/` 复制到 `.tmp-mobile/serve/`，并把 `notes.json` 换成合成的无个人信息夹具；
 *   2. 在复制的 `index.html` 的 `<head>` 里插一段驱动脚本（`scripts/mobile-dom-driver.js`），
 *      它比应用的 module script 先执行，负责播种 localStorage / 注入桥接桩；
 *   3. 用本机 Chrome/Edge 的 `--headless=new --dump-dom --window-size=W,H
 *      --virtual-time-budget=N file:///…/index.html` 打开：`--window-size` 就是真实视口
 *      （CSS 媒体查询按它求值），驱动把断言结果写成 `<pre id="kg-report">`，从 dump 里取回。
 *
 * 两个场景：
 *   no-bridge  纯浏览器打开（手机上的实际情形）：本机能力必须明确降级
 *   bridge     注入 Electron 风格桥接桩：本机能力必须恢复为可用，桌面布局保持不变
 *
 * 不读真实 vault、不连真实 Zotero、不请求网络；产物在 `.tmp-mobile/`（已 gitignore）。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 允许把产物与 dist 指向别处：同一个仓库可能有别的会话在跑构建 / 清理 .tmp-mobile
const TMP = path.resolve(process.env.KG_MOBILE_TMP || path.join(ROOT, '.tmp-mobile'))
const SERVE = path.join(TMP, 'serve')
const OUT = path.join(TMP, 'out')
const SHOTS = path.join(OUT, 'screenshots')

const WIDTHS = [
  { w: 360, h: 800, label: '小手机' },
  { w: 390, h: 844, label: '常见手机' },
  { w: 412, h: 915, label: '大屏手机' },
  { w: 768, h: 1024, label: '平板竖屏' },
  { w: 1024, h: 768, label: '平板横屏' },
  { w: 1440, h: 900, label: '电脑' },
]

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

// 无头 Chrome 在受限环境里必须带这几个开关，否则 GPU 进程会让浏览器直接崩掉
const BASE_FLAGS = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--in-process-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--allow-file-access-from-files',
  '--force-device-scale-factor=1',
]

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (flag) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : '')
const only = valueOf('--only')
  ? new Set(valueOf('--only').split(',').map((s) => Number(s.trim())))
  : null

// ----------------------------------------------------------------- 合成夹具（无个人信息）

const LONG_WORD = 'SupercalifragilisticexpialidociousAntidisestablishmentarianism'
const SAMPLE_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#e2e8f0"/><circle cx="400" cy="300" r="180" fill="#93c5fd"/><text x="400" y="320" font-size="56" text-anchor="middle" fill="#1e293b">sample</text></svg>',
  )

const SAMPLE_CONTENT = [
  '## 示例小节',
  '',
  '正文里的水分子写作 H<sub>2</sub>O，平方写作 x<sup>2</sup>；这是**合成测试内容**，不含任何个人信息。',
  '',
  '| 示例表头 A | 示例表头 B | 示例表头 C | 示例表头 D | 示例表头 E |',
  '| --- | --- | --- | --- | --- |',
  '| 单元格 1 | 单元格 2 | 单元格 3 | 单元格 4 | 单元格 5 |',
  '',
  '```',
  `const sample = "${LONG_WORD}" // 这一行足够长，让代码块需要局部横向滚动`,
  '```',
  '',
  `![示例图](${SAMPLE_SVG})`,
  '',
  `超长链接：https://example.com/${'segment-'.repeat(14)}end`,
  '',
  LONG_WORD,
  '',
  '- 列表项 1',
  '- 列表项 2',
  '',
  '> 引用示例',
  '',
].join('\n')

const NOW = Date.now()
const FIXTURE = [
  {
    id: 'sample-1',
    title: '示例：一个相当长的中文标题用来验证手机端两行截断不挤压右侧图标与元数据',
    type: 'task',
    grade: '',
    tags: ['方向:示例方向', '期刊:示例期刊', '材料:示例材料'],
    content: SAMPLE_CONTENT,
  },
  { id: 'sample-2', title: '示例：空笔记', type: 'other', grade: '', tags: [], content: '' },
  {
    id: 'sample-3',
    title: `示例：超长不可断词 ${LONG_WORD}`,
    type: 'person',
    grade: 'phd',
    tags: ['功能:示例功能', '材料:示例材料'],
    content: SAMPLE_CONTENT,
  },
  {
    id: 'sample-4',
    title: '示例文献：带本地 PDF 绝对路径（本机外必须降级）',
    type: 'literature',
    grade: '',
    tags: ['方向:示例方向', '年份:2024'],
    content: '这是一条示例文献，仅用于验证本地 PDF 绝对路径在不支持的环境里被明确降级。',
    literature: {
      authors: ['示例作者 A', '示例作者 B'],
      venue: '示例期刊',
      year: 2024,
      doi: '10.0000/example.0001',
      citekey: 'example2024local',
      attachments: [],
      collections: ['示例分类/子分类'],
      zoteroKey: 'EXAMP001',
      zoteroKeys: ['EXAMP001'],
      zoteroPdfCount: 1,
      zoteroAvailablePdfCount: 1,
      localPdf: 'D:\\Example\\Papers\\sample-only-fixture.pdf',
    },
  },
  {
    id: 'sample-5',
    title: '示例文献：仅有 Zotero key（本机外必须降级）',
    type: 'literature',
    grade: '',
    tags: ['方向:示例方向', '年份:2023'],
    content: '这是一条示例文献，仅用于验证本机 Zotero 数据库在非本机环境里被明确降级。',
    literature: {
      authors: ['示例作者 C'],
      venue: '示例会议',
      year: 2023,
      doi: '',
      citekey: 'example2023zotero',
      attachments: [],
      collections: ['示例分类'],
      zoteroKey: 'EXAMP002',
      zoteroKeys: ['EXAMP002'],
      zoteroPdfCount: 1,
      zoteroAvailablePdfCount: 1,
    },
  },
  {
    id: 'sample-6',
    title: '示例汇总：方向概览',
    type: 'summary',
    grade: '',
    tags: ['方向:示例方向'],
    content: '示例汇总正文，引用了 [[示例文献：带本地 PDF 绝对路径（本机外必须降级）]]。',
  },
].map((note, index) => ({ ...note, createdAt: NOW - index * 1000, updatedAt: NOW - index * 1000 }))

// ----------------------------------------------------------------- Chrome 调用

const urlToFileUrl = (file) => 'file:///' + file.replace(/\\/g, '/')

/**
 * 父页面：无头 Chrome 的窗口有最小宽度限制（实测 360 会被拉成 512），
 * 所以真正的 360 / 390 / 412 视口只能靠 iframe 提供 —— iframe 的宽度就是它内部文档的视口宽度，
 * CSS 媒体查询、100dvh、matchMedia 都按它求值。
 * 每个 job 顺序跑（一个 iframe 一个 job，跑完移除），报告由 iframe 里的驱动 push 回来。
 */
function harnessHtml(jobs, mode) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>kg-harness</title>
  <style>
    html, body { margin: 0; padding: 0; background: #ffffff; }
    #stage { display: block; }
    iframe { border: 0; display: block; background: #ffffff; }
  </style>
</head>
<body>
  <div id="stage"></div>
  <pre id="kg-report" hidden></pre>
  <script>
    window.__KG_FIXTURE__ = ${JSON.stringify(FIXTURE)};
    window.__KG_JOBS__ = ${JSON.stringify(jobs)};
    window.__KG_MODE__ = ${JSON.stringify(mode)};
    window.__KG_REPORTS__ = [];
    window.__KG_MESSAGES__ = [];
    window.addEventListener('error', function (event) { window.__KG_MESSAGES__.push('parent onerror: ' + event.message); });
    window.__kgWriteReport = function () {
      document.getElementById('kg-report').textContent = encodeURIComponent(JSON.stringify({
        reports: window.__KG_REPORTS__,
        messages: window.__KG_MESSAGES__,
        jobs: window.__KG_JOBS__.length,
      }));
    };
    (async function () {
      const stage = document.getElementById('stage');
      for (const job of window.__KG_JOBS__) {
        const frame = document.createElement('iframe');
        frame.width = String(job.w);
        frame.height = String(job.h);
        frame.setAttribute('data-job', job.w + '-' + job.scenario);
        frame.src = './index.html?drive=1&width=' + job.w + '&scenario=' + job.scenario + '&view=' + job.view +
          '&mode=' + job.mode + (job.hold ? '&hold=1' : '');
        stage.appendChild(frame);
        await new Promise(function (resolve) {
          const startedAt = Date.now();
          const poll = setInterval(function () {
            const arrived = window.__KG_REPORTS__.some(function (entry) {
              return entry.width === job.w && entry.scenario === job.scenario &&
                entry.editorMode === job.mode && entry.finished === true;
            });
            if (arrived || Date.now() - startedAt > 60000) {
              clearInterval(poll);
              resolve();
            }
          }, 200);
        });
        if (window.__KG_MODE__ !== 'shot') frame.remove();
      }
      window.__kgWriteReport();
      document.title = 'kg-harness-done';
    })();
  </script>
</body>
</html>
`
}

/**
 * 跑一次无头浏览器。
 * 注意：本机 Chrome 的 `--dump-dom` **不会**写进管道（stdout 为 pipe 时输出 0 字节），
 * 也不认 Node 直接继承的文件描述符 —— 只有由系统启动器重定向到文件才行（已实测）。
 * 所以这里通过 PowerShell 的 Start-Process 启动，再把输出文件读回来。
 */
function runChrome(chrome, { width, height, url, extraArgs, timeoutMs = 90000 }) {
  const outFile = path.join(TMP, 'chrome-stdout.txt')
  const errFile = path.join(TMP, 'chrome-stderr.txt')
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`
  const args = [...BASE_FLAGS, `--window-size=${width},${height}`, ...extraArgs, url]
  const script = [
    `$p = Start-Process -FilePath ${quote(chrome)} -ArgumentList @(${args.map(quote).join(',')}) -PassThru ` +
      `-RedirectStandardOutput ${quote(outFile)} -RedirectStandardError ${quote(errFile)} -WindowStyle Hidden -Wait`,
    'exit $p.ExitCode',
  ].join('; ')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  const read = (file) => {
    try {
      return fs.readFileSync(file, 'utf8')
    } catch {
      return ''
    }
  }
  return { stdout: read(outFile), stderr: read(errFile) || result.stderr || '', status: result.status, signal: result.signal }
}

const REPORT_RE = /<pre id="kg-report"[^>]*>([\s\S]*?)<\/pre>/

function extractReport(stdout) {
  const match = stdout.match(REPORT_RE)
  if (!match || !match[1].trim()) return null
  try {
    return JSON.parse(decodeURIComponent(match[1]))
  } catch (error) {
    return { checks: [{ name: '报告解析失败', ok: false, detail: String(error.message) }] }
  }
}

// ----------------------------------------------------------------- 主流程

function prepare(jobs, mode) {
  const dist = path.resolve(process.env.KG_MOBILE_DIST || path.join(ROOT, 'dist'))
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('✗ 找不到 dist/index.html：先运行 npm run build（或不要加 --no-build）')
    process.exit(1)
  }
  fs.rmSync(SERVE, { recursive: true, force: true })
  fs.mkdirSync(SERVE, { recursive: true })
  fs.cpSync(dist, SERVE, { recursive: true })
  // 夹具：覆盖掉可能的 notes.json / 假数据目录，确保浏览器只看到合成内容
  fs.writeFileSync(path.join(SERVE, 'notes.json'), JSON.stringify(FIXTURE, null, 2), 'utf8')
  fs.copyFileSync(path.join(ROOT, 'scripts', 'mobile-dom-driver.js'), path.join(SERVE, 'mobile-dom-driver.js'))

  const indexHtml = fs.readFileSync(path.join(SERVE, 'index.html'), 'utf8')
  const head = indexHtml.indexOf('<head>')
  if (head < 0) {
    console.error('✗ dist/index.html 里没有 <head>，无法插入驱动脚本')
    process.exit(1)
  }
  const inject =
    '<head>\n' +
    '    <script src="./mobile-dom-driver.js"></script>'
  fs.writeFileSync(path.join(SERVE, 'index.html'), indexHtml.slice(0, head) + inject + indexHtml.slice(head + '<head>'.length), 'utf8')
  const harness = writeHarness(jobs, mode, 'main')
  return { serve: SERVE, index: path.join(SERVE, 'index.html'), harness }
}

/** 额外写一个父页面（截图用的单 job 版本复用同一个服务目录） */
function writeHarness(jobs, mode, name) {
  const file = path.join(SERVE, `harness-${name}.html`)
  fs.writeFileSync(file, harnessHtml(jobs, mode), 'utf8')
  return file
}

function main() {
  const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p))
  if (!chrome) {
    console.error('✗ 找不到 Chrome / Edge，无法做真实浏览器验证')
    process.exit(2)
  }
  fs.mkdirSync(SHOTS, { recursive: true })

  if (!has('--no-build')) {
    console.log('· 构建 dist（npm run build）…')
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, shell: true, encoding: 'utf8', timeout: 300000 })
    if (build.status !== 0) {
      console.error((build.stdout || '').slice(-2000), (build.stderr || '').slice(-2000))
      console.error(`✗ 构建失败（退出码 ${build.status}）`)
      process.exit(1)
    }
    console.log('  ✓ 构建通过')
  }

  const widths = only ? WIDTHS.filter((entry) => only.has(entry.w)) : WIDTHS
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-mobile-profile-'))
  const profileArgs = [`--user-data-dir=${profile}`]
  const jobs = []
  for (const { w, h } of widths) {
    for (const scenario of ['no-bridge', 'bridge']) jobs.push({ w, h, scenario, view: 'all', mode: 'classic' })
  }
  // 当前代码的默认编辑器是「所见即所得」：在 360 与 1440 各补一档，确认它也不会撑宽页面
  if (!only || only.has(360)) jobs.push({ w: 360, h: 800, scenario: 'no-bridge', view: 'all', mode: 'wysiwyg' })
  if (!only || only.has(1440)) jobs.push({ w: 1440, h: 900, scenario: 'bridge', view: 'all', mode: 'wysiwyg' })
  prepare(jobs, 'assert')
  console.log(`· 合成夹具 ${FIXTURE.length} 条（无个人信息），视口由 iframe 提供`)
  console.log(`· 浏览器 ${chrome}`)
  console.log(`· 任务 ${jobs.length} 个：${widths.map((w) => w.w).join(' / ')} × no-bridge/bridge\n`)

  const allChecks = []
  const notes = []
  for (const job of jobs) {
    const tag = `${job.w}x${job.h}__${job.scenario}${job.mode === 'wysiwyg' ? '__wysiwyg' : ''}`
    // 每个任务单独一次浏览器启动：只放一个 iframe，虚拟时间预算各算各的，最稳定
    const harness = writeHarness([job], 'assert', `job-${job.w}-${job.scenario}-${job.mode}`)
    const result = runChrome(chrome, {
      width: Math.max(job.w, 520),
      height: Math.max(job.h, 520),
      url: urlToFileUrl(harness),
      extraArgs: [...profileArgs, '--virtual-time-budget=180000', '--dump-dom'],
    })
    const parsed = extractReport(result.stdout || '')
    const report = parsed ? (parsed.reports || [])[0] : null
    if (!report) {
      allChecks.push({
        ok: false,
        name: `${tag} 未取得报告`,
        detail: `stdout=${(result.stdout || '').length}B stderr 尾部=${(result.stderr || '').split('\n').filter((l) => l.includes('ERROR')).slice(0, 2).join(' | ')}`,
      })
      continue
    }
    const failed = report.checks.filter((entry) => !entry.ok)
    process.stdout.write(`· ${tag} ${failed.length === 0 ? '✓' : `✗ ${failed.length}`}${report.stage === 'done' ? '' : `（只跑到 ${report.stage}）`}\n`)
    for (const entry of report.checks) {
      allChecks.push({ ok: entry.ok, name: `${tag} ${entry.name}`, detail: entry.detail })
    }
    if (report.consoleErrors && report.consoleErrors.length > 0) {
      allChecks.push({ ok: false, name: `${tag} 控制台无错误`, detail: report.consoleErrors.join(' | ') })
    } else {
      allChecks.push({ ok: true, name: `${tag} 控制台无错误`, detail: '' })
    }
    for (const artifact of report.knownArtifacts || []) {
      notes.push({ width: job.w, scenario: job.scenario, artifact: artifact.error.slice(0, 120), why: artifact.why })
    }
    notes.push({
      width: job.w,
      scenario: job.scenario,
      mode: job.mode,
      stage: report.stage,
      badge: (report.notes || []).find((entry) => entry.label === 'badge')?.value || '',
      bodyText: (report.notes || []).find((entry) => entry.label === 'bodyText')?.value || '',
    })
  }

  // ---- 截图（可选；每个宽度补几张代表性状态，全部为合成内容） ----
  if (argv.some((a) => a === '--shots' || a.startsWith('--shots='))) {
    // `--shots=capability` 只补拍某几个状态（改了一处 UI 时不用整轮重拍）
    const onlyStates = (argv.find((a) => a.startsWith('--shots=')) || '').replace('--shots=', '').split(',').map((s) => s.trim()).filter(Boolean)
    const states = onlyStates.length ? onlyStates : ['default', 'detail', 'preview', 'literature', 'capability']
    for (const { w, h } of widths) {
      for (const state of states) {
        const file = path.join(SHOTS, `${w}x${h}__no-bridge__${state}.png`)
        // 能力面板那一步跑完会把对话框关掉：截图要的是「打开着」的样子，所以按住不关
        const job = { w, h, scenario: 'no-bridge', view: state, mode: 'classic', hold: state === 'capability' }
        const shot = writeHarness([job], 'shot', `${w}-${state}`)
        runChrome(chrome, {
          width: w,
          height: h,
          url: urlToFileUrl(shot),
          extraArgs: [...profileArgs, '--virtual-time-budget=120000', `--screenshot=${file}`],
        })
      }
    }
    console.log(`\n· 截图已写入 ${SHOTS}`)
  }

  const failed = allChecks.filter((c) => !c.ok)
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ checks: allChecks, notes, widths: widths.map((w) => w.w), chrome }, null, 2), 'utf8')

  console.log('\n================ 响应式 / 能力降级验证 ================')
  for (const item of allChecks) {
    if (item.ok) console.log(`✓ ${item.name}`)
    else console.log(`✗ ${item.name}\n    ${item.detail}`)
  }
  console.log(`\n宽度：${widths.map((w) => w.w).join(' / ')}（横屏高度见截图文件名）`)
  console.log(`共 ${allChecks.length} 项断言，失败 ${failed.length} 项`)
  console.log(`明细：${path.join(OUT, 'results.json')}`)
  if (argv.some((a) => a === '--shots' || a.startsWith('--shots='))) console.log(`截图：${SHOTS}`)
  process.exitCode = failed.length === 0 ? 0 : 1
}

main()
