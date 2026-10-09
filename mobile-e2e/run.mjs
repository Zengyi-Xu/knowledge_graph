/**
 * 移动端适配验证 runner。
 * 用无头 Chrome + CDP 打开 .tmp-e2e 的 Vite 实例，按测试矩阵测量布局指标并截图。
 * 只使用合成测试数据；不读取、不截图任何真实笔记。
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'out')
const SHOTS = path.join(OUT, 'screenshots')
const CDP_PORT = 9334
const BASE = 'http://127.0.0.1:5199/'

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p))
if (!CHROME) throw new Error('找不到 Chrome/Edge 可执行文件')

const DESKTOP_SIZES = new Set(['1440x900', '1024x768', '768x1024'])

function scenarios() {
  const list = []
  const add = (size, scenario, note) => {
    const [w, h] = size.split('x').map(Number)
    list.push({ size, w, h, scenario, note, mobile: w < 768 })
  }
  // App.tsx 的手机适配已落地（列表抽屉 + 图标视图标签 + 顶栏菜单 + 并列降级），
  // 所以不再需要 shell=mobile 模拟口径：下面全部是「真实布局」。
  add('360x800', 'default', '小手机 / 默认主题 / 正文')
  add('360x800', 'edit', '小手机 / 编辑标签页')
  add('360x800', 'night', '小手机 / 夜读主题')
  add('360x800', 'paper', '小手机 / 纸页主题')
  add('360x800', 'vue-light', '小手机 / Vue 浅色')
  add('360x800', 'vue-night', '小手机 / Vue 深色')
  add('360x800', 'custom', '小手机 / 自定义主题（极限宽内容）')
  add('360x800', 'empty-search', '小手机 / 无搜索结果（抽屉里的搜索框）')
  add('360x800', 'no-notes', '小手机 / 无笔记空状态')
  add('360x800', 'long-list', '小手机 / 单条笔记')
  add('360x800', 'many-tags', '小手机 / 八个标签')
  add('360x800', 'edit-links', '小手机 / 编辑态笔记链接建议')
  add('360x800', 'drawer-open', '小手机 / 抽屉展开（量列表项与分组标题触摸目标）')
  add('360x800', 'wide', '小手机 / 宽表格')
  add('360x800', 'wide-night', '小手机 / 宽表格 + 夜读')
  add('360x800', 'code', '小手机 / 长代码行 + 大图')
  add('360x800', 'code-night', '小手机 / 长代码行 + Vue 深色（对比度回归）')
  add('360x800', 'code-paper', '小手机 / 长代码行 + 纸页')
  add('360x800', 'code-custom', '小手机 / 长代码行 + 自定义主题')
  add('390x844', 'default', '常见手机 / 默认主题')
  add('412x915', 'vue-night', '常见手机 / Vue 深色')
  // 横屏、平板、电脑——必须与改动前一致
  add('844x390', 'default', '手机横屏 / 低高度')
  add('768x1024', 'default', '平板竖屏 / 断点边界（应回到桌面布局）')
  add('768x1024', 'wide', '平板竖屏 / 宽表格')
  add('1024x768', 'vue-light', '平板横屏 / Vue 浅色')
  add('1440x900', 'default', '电脑 / 桌面回归')
  add('1440x900', 'vue-night', '电脑 / 桌面 + Vue 深色')
  add('1440x900', 'code', '电脑 / 长代码行 + 大图')
  return list
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url) {
  const res = await fetch(url)
  return res.json()
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    })
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', (e) => reject(new Error('ws error ' + (e.message || ''))), { once: true })
    })
    return new CDP(ws)
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('CDP timeout: ' + method))
        }
      }, 120000)
    })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
    return r.result.value
  }
}

async function waitForServer(url, timeoutMs = 180000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { method: 'GET' })
      if (r.ok) return true
    } catch {
      /* not up yet */
    }
    await sleep(400)
  }
  throw new Error('Vite 测试实例未就绪: ' + url)
}

async function waitForCdp(timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`)
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* not up yet */
    }
    await sleep(300)
  }
  throw new Error('CDP 未就绪')
}

/** 只用我们自己启动的 Chrome：先清掉复用同一 profile / 端口的残留进程 */
function killStaleBrowsers() {
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${CDP_PORT}*' -or $_.CommandLine -like '*.tmp-e2e*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: 'ignore' },
    )
  } catch {
    /* nothing to kill */
  }
}

const READ_PROBE = `(function(){
  if (!document.documentElement.hasAttribute('data-probe')) return null;
  var el = document.getElementById('__probe_result');
  return el ? el.textContent : null;
})()`

async function waitForProbeFlag(cdp, attempts = 250) {
  for (let i = 0; i < attempts; i++) {
    let v = null
    try {
      v = await cdp.evaluate(READ_PROBE)
    } catch {
      /* page may be mid-navigation */
    }
    if (v) return v
    await sleep(200)
  }
  throw new Error('探针超时')
}

async function waitForFlag(cdp, expression, attempts = 120, gap = 200) {
  for (let i = 0; i < attempts; i++) {
    let v = null
    try {
      v = await cdp.evaluate(expression)
    } catch {
      /* page mid-navigation */
    }
    if (v) return v
    await sleep(gap)
  }
  return null
}

/** 用真实输入驱动 React：探针只给动作与坐标，按键/点击由 CDP 真的发出去 */
async function driveControls(cdp) {
  let tries = 0
  const trace = []
  for (;;) {
    tries++
    if (tries > 30) break
    let action = null
    try {
      action = await cdp.evaluate('window.__e2e ? window.__e2e.nextAction() : null')
    } catch {
      break
    }
    if (!action || action.op === 'done') break
    trace.push(action.why)
    if (action.op === 'click') {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: action.x, y: action.y, button: 'none' })
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: action.x, y: action.y, button: 'left', buttons: 1, clickCount: 1,
      })
      await sleep(30)
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: action.x, y: action.y, button: 'left', buttons: 0, clickCount: 1,
      })
    } else if (action.op === 'type') {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: action.x, y: action.y, button: 'left', buttons: 1, clickCount: 1 })
      await sleep(30)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: action.x, y: action.y, button: 'left', buttons: 0, clickCount: 1 })
      await sleep(80)
      // 全选后输入，避免残留内容
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
      await sleep(40)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
      await sleep(40)
      await cdp.send('Input.insertText', { text: action.text })
    }
    await sleep(220)
  }
  await cdp.evaluate(`(function(){ window.__e2eTries = ${tries}; return true })()`)
  return { tries, trace }
}

/**
 * 应用是否已经挂载并渲染。
 * 不再依赖顶栏的「N 篇笔记」文案——手机端该文案按设计被隐藏了。
 * 改为检查「笔记列表开关」+ 根节点里已经出现内容，两者在全部场景下都成立。
 */
const READY_EXPR = `(function(){
  if (!window.__e2eReady) return false;
  var root = document.getElementById('root');
  if (!root || !root.firstElementChild) return false;
  var toggle = Array.prototype.slice.call(document.querySelectorAll('button[title]'))
    .some(function (b) { return /笔记列表/.test(b.getAttribute('title') || '') });
  return toggle && (root.innerText || '').trim().length > 0;
})()`

async function runScenario(cdp, sc, base) {
  const url = `${base}?scenario=${encodeURIComponent(sc.scenario)}${sc.shell ? `&shell=${sc.shell}` : ''}`
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: sc.w,
    height: sc.h,
    deviceScaleFactor: 1,
    mobile: sc.mobile,
    screenWidth: sc.w,
    screenHeight: sc.h,
  })
  await cdp.send('Page.navigate', { url })

  // 1) 等 React 挂载完成——必须在驱动之前，否则 nextAction 找不到任何元素
  await waitForFlag(cdp, READY_EXPR, 250, 200)
  await sleep(400)

  // 2) 允许驱动后复检一次（切换笔记会重新挂载，元素会短暂消失）。
  //    每轮都重置探针内部的“已完成”标志，因为切换笔记会重新挂载 NoteEditor
  //    并把标签页重置回预览——第二轮必须重新点一次「编辑」。
  let drive = { tries: 0, trace: [] }
  let settled = false
  for (let round = 0; round < 4; round++) {
    await cdp.evaluate(
      '(function(){ window.__e2eState = { activeClicked: false, tabClicked: false, searchTyped: false, suggestTyped: false }; return true })()',
    )
    drive = await driveControls(cdp)
    await sleep(300)
    settled = await cdp.evaluate('window.__e2e ? window.__e2e.controlsSettled() : false')
    if (settled) break
  }

  // 3) 交互全部生效后才注入全宽外壳：它会 display:none 隐藏笔记列表，
  //    必须放在“切笔记 / 切标签页 / 输入”之后，否则列表根本点不到。
  if (sc.shell === 'mobile') {
    await cdp.evaluate('window.__e2e ? window.__e2e.setShellMobile() : false')
    await sleep(700)
  }

  // 4) 由探针在最终布局下测量并落盘
  await cdp.evaluate('window.__e2e ? (window.__e2e.finish(), true) : false')
  const raw = await waitForFlag(cdp, READ_PROBE, 60, 150)

  const shotName = sc.shell ? `${sc.size}__${sc.scenario}__shell-${sc.shell}.png` : `${sc.size}__${sc.scenario}.png`
  const shot = path.join(SHOTS, shotName)
  const shotRes = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(shot, Buffer.from(shotRes.data, 'base64'))

  let parsed
  try {
    parsed = raw ? JSON.parse(raw) : { parseError: 'no probe result' }
  } catch (e) {
    parsed = { parseError: String(e), raw: String(raw).slice(0, 500) }
  }
  return {
    id: shotName.replace(/\.png$/, ''),
    size: sc.size,
    scenario: sc.scenario,
    shellMode: sc.shell || 'original',
    mobile: sc.mobile,
    note: sc.note,
    desktopExpected: DESKTOP_SIZES.has(sc.size),
    screenshot: path.relative(path.join(__dirname, '..'), shot).replace(/\\/g, '/'),
    drive,
    outcome: parsed,
  }
}

function summarise(result) {
  const o = result.outcome || {}
  const f = o.facts || {}
  const ov = o.overflow || {}
  const tap = o.tap || {}
  const shadow = o.shadow || []
  const shadowScroll = shadow.flatMap((s) => s.scrollContainers || [])
  const shadowClipped = shadow.flatMap((s) => s.clipped || [])
  return {
    id: result.id,
    size: result.size,
    scenario: result.scenario,
    shellMode: result.shellMode,
    mobile: result.mobile,
    note: result.note,
    screenshot: result.screenshot,
    drive: result.drive || null,
    // 原样透传探针的 facts / engine，避免以后新增探针字段被这里的白名单悄悄丢掉
    facts: f,
    engine: o.engine || null,
    controlsSettled: o.controlsSettled,
    controlAttempts: o.controlAttempts,
    pageScrollsX: !!ov.pageScrollsX,
    docScrollW: ov.docScrollW,
    docClientW: ov.docClientW,
    overflowFlagged: (ov.flagged || []).length,
    overflowTop: (ov.flagged || []).slice(0, 6),
    write: f.write || null,
    writeInner: f.writeInner || null,
    table: f.table || null,
    pre: f.pre || null,
    img: f.img || null,
    sub: f.sub || null,
    sup: f.sup || null,
    editorTitle: f.editorTitle || null,
    shell: f.shell || null,
    controls: f.controls || null,
    tabState: f.tabState || null,
    textareas: f.textareas || null,
    linkSuggest: f.linkSuggest || null,
    emptySearchText: f.emptySearchText,
    hydrated: f.hydrated,
    seedError: f.seedError,
    tapScanned: tap.scanned,
    tapSmall: (tap.small || []).slice(0, 12),
    tapSmallCount: (tap.small || []).length,
    shadowScrollNonScrollable: shadowScroll.filter((s) => !s.isScrollable).slice(0, 8),
    shadowScrollContainers: shadowScroll.filter((s) => s.isScrollable).slice(0, 8),
    shadowClipped: shadowClipped.slice(0, 6),
    errors: o.errors || [],
  }
}


async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  killStaleBrowsers()
  await sleep(500)

  // 在进程内启动 Vite：避免 Windows 上 shell 子进程残留占用 5199 端口
  const vite = await createServer({
    configFile: path.join(__dirname, 'vite.harness.config.ts'),
    logLevel: 'error',
  })
  await vite.listen()
  const addr = vite.httpServer?.address()
  const port = typeof addr === 'object' && addr ? addr.port : 5199
  const base = `http://127.0.0.1:${port}/`

  const profileDir = path.join(OUT, 'chrome-profile')
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-component-update',
      '--hide-scrollbars',
      '--user-data-dir=' + profileDir,
      'about:blank',
    ],
    { stdio: 'ignore', detached: true },
  )

  const results = []
  let cdp
  try {
    await waitForServer(base)
    const page = await waitForCdp()
    cdp = await CDP.connect(page.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await cdp.send('Page.navigate', { url: base })
    await sleep(6000)

    const list = scenarios()
    for (const sc of list) {
      process.stdout.write(`[scenario] ${sc.size} / ${sc.scenario} ... `)
      const r = await runScenario(cdp, sc, base)
      results.push(summarise(r))
      console.log((r.errors || []).length ? `errors=${r.errors.length}` : 'ok')
    }
  } finally {
    try {
      if (cdp) cdp.ws.close()
    } catch {
      /* ignore */
    }
    killTree(chrome.pid)
    await vite.close()
    await sleep(800)
  }

  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
  console.log('\n写入: ' + path.join(OUT, 'results.json'))
}

function killTree(pid) {
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(-pid, 'SIGKILL')
    }
  } catch {
    /* already gone */
  }
}

main().catch((e) => {
  console.error('RUNNER FAILED:', e.stack || e)
  process.exit(1)
})
