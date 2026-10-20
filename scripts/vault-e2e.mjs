/**
 * 真实应用的端到端验证（Electron + CDP）：
 *   1. 启动打包后的桌面版，用 CDP 设定 vault 目录并重载
 *   2. 断点：vault 目录里生成「每篇一个 md + meta.json」
 *   3. 在界面里编辑正文 → 对应的 md 文件被改写
 *   4. 在磁盘上改 md → 应用跟随（跟随目录改动）
 *   5. 在磁盘上删 md → 应用里的笔记消失、meta.json 索引同步
 *   6. 目录里不属于本应用的 md 不被碰
 *
 * 运行：node scripts/vault-e2e.mjs
 * 产物留在 .tmp-vault-e2e/（vault 目录、Electron profile、日志）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const e2eDir = path.join(root, '.tmp-vault-e2e')
const vaultDir = path.join(e2eDir, 'vault')
const profileDir = path.join(e2eDir, 'profile')
const PORT = 9333

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail ? `\n      ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, timeout = 20000, interval = 300) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      const v = await fn()
      if (v) return v
      last = v
    } catch (error) {
      last = error
    }
    await sleep(interval)
  }
  return null
}

async function readMeta() {
  try {
    return JSON.parse(await fs.readFile(path.join(vaultDir, 'meta.json'), 'utf8'))
  } catch {
    return null
  }
}

async function readVaultFile(name) {
  try {
    return await fs.readFile(path.join(vaultDir, name), 'utf8')
  } catch {
    return null
  }
}

/** 递归收集 vault 里所有 .md 的相对路径（笔记按类型放在子文件夹里） */
async function listMarkdown(dir, prefix = '') {
  const out = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await listMarkdown(path.join(dir, entry.name), rel)))
    else if (entry.name.endsWith('.md')) out.push(rel)
  }
  return out
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(msg.error.message))
      else entry.resolve(msg.result)
    })
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true })
    })
    return new CDP(ws)
  }

  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} 超时`))
      }, 20000)
    })
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? '页面内脚本报错')
    }
    return r.result?.value
  }

  /** 页面重载后执行上下文会短暂失效，这里重试 */
  async evalRetry(expression, timeout = 15000) {
    return waitFor(async () => {
      const v = await this.eval(expression)
      return v === undefined || v === null ? null : v
    }, timeout, 350)
  }

  close() {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

function noteCount(bodyText) {
  const m = bodyText.match(/·\s*(\d+)\s*(?:篇笔记|个条目)/)
  return m ? Number(m[1]) : null
}

async function main() {
  await fs.rm(e2eDir, { recursive: true, force: true })
  await fs.mkdir(vaultDir, { recursive: true })

  const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  // DSH 自身跑在 Electron 里，环境里带着 ELECTRON_RUN_AS_NODE=1；
  // 不清掉的话子进程会退化成纯 Node，require('electron') 拿不到 app/protocol。
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    electronBin,
    ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env },
  )
  let logs = ''
  child.stdout.on('data', (d) => (logs += d.toString()))
  child.stderr.on('data', (d) => (logs += d.toString()))

  let cdp
  try {
    const wsUrl = await waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      // 只认 kg:// 页面：窗口刚创建时第一个 page 目标可能是 about:blank，
      // 对它读写 localStorage 会被拒绝（SecurityError），落上去整个用例就毁了——宁可继续等。
      const page = list.find((t) => t.type === 'page' && String(t.url).startsWith('kg://'))
      return page?.webSocketDebuggerUrl ?? null
    }, 30000, 500)

    check('桌面版启动并暴露调试目标', Boolean(wsUrl), logs.slice(-800))
    if (!wsUrl) throw new Error('无法连接 Electron 调试端口')

    cdp = await CDP.connect(wsUrl)
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')

    // 直接写 localStorage，跳过需要人工操作的原生目录选择框
    // （开发版用 kg-dev- 前缀：见 src/lib/env.ts；经典模式让后面的 textarea 驱动有效）
    await cdp.eval(`(() => {
      localStorage.setItem('kaust-knowledge-graph-vault-dir', ${JSON.stringify(vaultDir)})
      localStorage.setItem('kg-dev-vault-dir-v1', ${JSON.stringify(vaultDir)})
      localStorage.setItem('kg-vault-dir-v1', ${JSON.stringify(vaultDir)})
      localStorage.setItem('kg-dev-editor-mode-v1', 'classic')
      localStorage.setItem('kg-editor-mode-v1', 'classic')
    })()`)
    await cdp.send('Page.reload')
    await cdp.evalRetry('document.readyState === "complete" ? "ready" : null')

    const meta = await waitFor(readMeta, 25000, 400)
    check('首次进入即建立 vault：meta.json 生成', Boolean(meta?.notes), JSON.stringify(meta)?.slice(0, 200))
    if (!meta?.notes) throw new Error('vault 未建立')

    const listing = await fs.readdir(vaultDir)
    const mdFiles = await listMarkdown(vaultDir)
    check(
      `每篇笔记一个 md 文件（本次把已有笔记迁移成 ${meta.notes.length} 篇）`,
      mdFiles.length === meta.notes.length && meta.notes.length > 0,
      `meta=${meta.notes.length} md=${mdFiles.length}`,
    )
    check(
      '笔记按类型落在子文件夹里',
      meta.notes.every((e) => typeof e.file === 'string' && e.file.includes('/')),
      meta.notes.map((e) => e.file).slice(0, 4).join(', '),
    )
    const allExist = await Promise.all(meta.notes.map(async (e) => (await readVaultFile(e.file)) !== null))
    check('索引里的每个文件都真实存在', allExist.every(Boolean))
    check('不再往目录里写「全部笔记一个 JSON」的文件', !listing.includes('notes.json'), listing.join(', '))

    const first = meta.notes[0]
    const firstText = await readVaultFile(first.file)
    check(
      'md 是自包含的：frontmatter 里带 id/title/type/tags/时间',
      Boolean(
        firstText?.startsWith('---\n') &&
          firstText.includes('format: kaust-kg-note') &&
          firstText.includes(`id: ${JSON.stringify(first.id)}`) &&
          firstText.includes('title: ') &&
          firstText.includes('type: ') &&
          firstText.includes('tags: ') &&
          firstText.includes('created: ') &&
          firstText.includes('updated: '),
      ),
      firstText?.slice(0, 220),
    )

    // 用 textContent 而不是 innerText：条数徽标是 `hidden lg:inline`，窗口内容区不足 1024px
    // （小屏幕 CI runner）时 display:none，innerText 读不到它。
    const bodyText = await cdp.evalRetry('document.body.textContent')
    check('界面已显示为「笔记目录」模式', String(bodyText).includes('笔记目录：'), String(bodyText).slice(0, 160))
    const countBefore = noteCount(String(bodyText))

    // ---- 界面编辑 → 落盘 ----
    // 并列视图的经典模式默认停在「预览」页签；先切到「编辑」再驱动 textarea。
    // （所见即所得模式没有 textarea，所以这里先确保 localStorage 里的经典模式已生效。）
    if (!(await cdp.eval(`document.querySelectorAll('textarea').length > 0`))) {
      // Radix Tabs 的切换挂在 mousedown 上（不是 click）：程序化 click() 不会改变页签。
      await cdp.eval(`(() => {
        const tab = [...document.querySelectorAll('[role=tab]')].find((e) => e.textContent.trim() === '编辑')
        if (!tab) return 'no-tab'
        tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }))
        tab.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
        return 'clicked'
      })()`)
      await waitFor(async () => cdp.eval(`document.querySelectorAll('textarea').length > 0`), 5000, 200)
    }
    const marker = `端到端追加-${Date.now()}`
    const injected = await cdp.eval(`(() => {
      const ta = [...document.querySelectorAll('textarea')].sort((a, b) => b.value.length - a.value.length)[0]
      if (!ta) return 'no-textarea'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, ta.value + '\\n\\n${marker}')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    })()`)
    check('能在正文编辑框里输入', injected === 'ok', String(injected))

    const changedFiles = await waitFor(async () => {
      const changed = []
      for (const entry of meta.notes) {
        const now = await readVaultFile(entry.file)
        if (now?.includes(marker)) changed.push(entry.file)
      }
      return changed.length ? changed : null
    }, 15000, 400)
    check(
      '界面里的编辑被写进对应的 md 文件',
      Array.isArray(changedFiles) && changedFiles.length === 1,
      String(changedFiles),
    )
    // 当前默认是并列视图，界面选中的第一篇不保证等于 meta 的第一条；以实际改动文件继续验证。
    const editedFile = changedFiles?.[0] ?? first.file
    const afterEdit = await readVaultFile(editedFile)
    check('写入是增量且保留 frontmatter', Boolean(afterEdit?.includes(marker) && afterEdit.startsWith('---\n')), afterEdit?.slice(0, 160))

    // ---- 外部改动 → 应用跟随 ----
    const externalMarker = `外部改动-${Date.now()}`
    await fs.writeFile(path.join(vaultDir, editedFile), `${afterEdit}\n\n${externalMarker}`, 'utf8')
    // 注意：textarea 的 innerText 不含当前 value，所以要看 value 与渲染区（innerHTML）
    const followed = await waitFor(async () => {
      const r = await cdp.eval(`(() => {
        const ta = [...document.querySelectorAll('textarea')].sort((a, b) => b.value.length - a.value.length)[0]
        const marker = ${JSON.stringify(externalMarker)}
        return { value: Boolean(ta && ta.value.includes(marker)), dom: document.body.innerHTML.includes(marker) }
      })()`)
      return r && (r.value || r.dom) ? r : null
    }, 20000, 500)
    check('磁盘上的外部改动被应用读到（跟随目录改动）', Boolean(followed), JSON.stringify(followed))

    // ---- 外部删除 → 应用移除 + 索引同步 ----
    const lastEntry = meta.notes[meta.notes.length - 1]
    await fs.rm(path.join(vaultDir, lastEntry.file))
    const countAfter = await waitFor(async () => {
      const c = noteCount(String(await cdp.eval('document.body.textContent')))
      return c !== null && countBefore !== null && c === countBefore - 1 ? c : null
    }, 20000, 500)
    check('磁盘上删除 md 后，应用里的笔记数减一', countAfter === (countBefore ?? 0) - 1, `${countBefore} -> ${countAfter}`)
    const metaSynced = await waitFor(async () => {
      const m = await readMeta()
      return m && !m.notes.some((e) => e.file === lastEntry.file) ? m : null
    }, 20000, 400)
    check('meta.json 索引同步移除该条目', Boolean(metaSynced))
    await sleep(3000)
    check('被删的笔记不会被应用复活', (await readVaultFile(lastEntry.file)) === null)

    // ---- 未纳管文件 ----
    const foreignName = '别人的笔记.md'
    await fs.writeFile(path.join(vaultDir, foreignName), '# 别人的笔记\n\n原样保留\n', 'utf8')
    const warned = await cdp.evalRetry('document.body.innerText.includes("未纳管") ? "yes" : null', 20000)
    check('提示目录里存在未纳管的 md', warned === 'yes', String(warned))
    await sleep(2500)
    check('未纳管的 md 内容未被改动', (await readVaultFile(foreignName)) === '# 别人的笔记\n\n原样保留\n')
  } finally {
    cdp?.close()
    child.kill()
    await sleep(800)
    await fs.writeFile(path.join(e2eDir, 'electron.log'), logs, 'utf8').catch(() => {})
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n结果：${results.length - failed.length} 通过，${failed.length} 失败`)
  console.log(`vault 目录：${vaultDir}`)
  console.log(`Electron 日志：${path.join(e2eDir, 'electron.log')}`)
  if (failed.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(`\n端到端验证中断：${error.message}`)
  process.exitCode = 1
})
