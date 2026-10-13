/** Real Chromium + React editor checks. No real vault/profile is opened or modified. */
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import esbuild from 'esbuild'

const root = process.cwd()
const out = path.join(root, '.tmp-vault-test', 'wysiwyg-e2e')
await fs.mkdir(out, { recursive: true })
// Check paths separately so a missing Chrome falls back to Edge.
let executable
for (const file of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
  try { await fs.access(file); executable = file; break } catch { /* try next */ }
}
if (!executable) throw new Error('Chromium is unavailable')
const tw = spawn(process.execPath, ['node_modules/tailwindcss/lib/cli.js', '-i', 'src/index.css', '-o', path.join(out, 'app.css')], { cwd: root, windowsHide: true, stdio: 'ignore' })
await new Promise((resolve, reject) => tw.on('exit', (code) => code === 0 ? resolve() : reject(new Error('Tailwind build failed'))))
await esbuild.build({ entryPoints: ['scripts/wysiwyg-fixture.tsx'], bundle: true, outfile: path.join(out, 'app.js'), format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': path.join(root, 'src') }, define: { __APP_ENV__: '"development"', __APP_VERSION__: '"editor-test"' }, plugins: [{ name: 'inline-css', setup(build) {
  build.onResolve({ filter: /\?url$/ }, ({ path: file }) => ({ path: file, namespace: 'asset-url' }))
  build.onLoad({ filter: /.*/, namespace: 'asset-url' }, () => ({ contents: 'export default "/unused-pdf-worker.mjs"', loader: 'js' }))
  build.onResolve({ filter: /\?inline$/ }, ({ path: file, resolveDir }) => ({ path: file.startsWith('@/') ? path.join(root, 'src', file.slice(2, -7)) : file.startsWith('vditor/') ? path.join(root, 'node_modules', file.slice(0, -7)) : path.resolve(resolveDir, file.slice(0, -7)), namespace: 'inline-css' }))
  build.onLoad({ filter: /.*/, namespace: 'inline-css' }, async ({ path: file }) => ({ contents: `export default ${JSON.stringify(await fs.readFile((file.endsWith('index.css') && !file.includes('node_modules')) ? path.join(out, 'app.css') : file, 'utf8'))}`, loader: 'js' }))
} }] })
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="margin:0"><div id="root" style="height:100vh"></div><script>localStorage.removeItem("kg-dev-editor-mode-v1")</script><script src="/app.js"></script></body></html>'
const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0]
    if (url === '/app.js' || url === '/app.css') { res.setHeader('Content-Type', url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(await fs.readFile(path.join(out, url.slice(1)))) }
    else if (url.startsWith('/vditor/')) { res.setHeader('Content-Type', url.endsWith('.css') ? 'text/css' : 'application/javascript'); res.end(await fs.readFile(path.join(root, 'public', url.slice(1)))) }
    else res.end(html)
  } catch { res.statusCode = 500; res.end() }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
const browser = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9335', `--user-data-dir=${path.join(out, 'profile')}`, url], { windowsHide: true, stdio: 'ignore' })
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let ws
let closeBrowser
const results = []
const check = (name, value) => { results.push({ name, ok: !!value }); console.log(`${value ? '✓' : '✗'} ${name}`) }
try {
  let target
  for (let i = 0; i < 60; i++) { try { target = (await (await fetch('http://127.0.0.1:9335/json')).json()).find((t) => t.type === 'page'); if (target) break } catch {} await delay(100) }
  if (!target) throw new Error('Chromium did not expose CDP')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', ({ data }) => { const msg = JSON.parse(data); const item = pending.get(msg.id); if (item) { pending.delete(msg.id); msg.error ? item.reject(msg.error) : item.resolve(msg.result) } })
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)) }, 15000).unref() })
  closeBrowser = () => send('Browser.close')
  const evaluate = async (expression) => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description); return result.result?.value }
  const act = async (expression) => { const value = await evaluate(expression); await delay(100); return value }
  const ed = 'document.querySelector("[data-testid=wysiwyg-editor] .vditor")'
  const content = `${ed}?.querySelector('.vditor-wysiwyg')`
  const wait = async (expression) => { for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${expression})`)) return true; await delay(100) } return false }
  await wait('!!window.fixture')
  check('默认所见即所得模式', await wait(`${ed} && ${content}`))
  check('Vditor 就绪并完成首渲染', await wait(`${content}?.querySelector('h1')`))
  check('载入内容逐字保真', await evaluate('fixture.note.content === fixture.sample'))
  check('标题/粗斜删除线/任务列表/引用/表格/代码/分割线/链接图片渲染', await evaluate(`(() => { const c=${content}; return ['h1','strong','em','s','input[type=checkbox]','blockquote','table','pre code','hr','a','img'].every(q=>c.querySelector(q)) })()`))
  check('双链按字面文本保留', await evaluate(`${content}.textContent.includes('[[已有笔记]]')`))
  check('双链渲染为样式化标记', await wait(`${content}.querySelectorAll('.kg-wiki').length >= 2`))
  check('双链括号隐藏（与经典一致）', await evaluate(`(() => {
    const w = ${content}.querySelector('.kg-wiki')
    const bracket = w?.querySelector('.kg-wiki-bracket')
    return w?.dataset.title === '已有笔记' && w?.dataset.found === 'true' &&
      getComputedStyle(bracket).fontSize === '0px' && w.textContent.startsWith('[[')
  })()`))
  check('不存在的双链显示问号且配色区分', await evaluate(`(() => {
    const miss = [...${content}.querySelectorAll('.kg-wiki')].find(w => w.dataset.found === 'false')
    const hit = [...${content}.querySelectorAll('.kg-wiki')].find(w => w.dataset.found === 'true')
    if (!miss || !hit) return false
    const color = (el) => getComputedStyle(el).color
    return miss.querySelector('.kg-wiki-missing')?.textContent === '?' &&
      !hit.querySelector('.kg-wiki-missing') && color(miss) !== color(hit)
  })()`))
  await act(`${content}.querySelector('.kg-wiki').click()`)
  check('双链点击跳转已有笔记', await evaluate(`fixture.events.includes('open:existing')`))
  await act(`${content}.querySelectorAll('.kg-wiki')[1].click()`)
  check('双链点击可创建不存在笔记', await evaluate(`fixture.events.includes('create:尚未存在')`))
  await act(`${content}.querySelector('.vditor-reset').click()`)
  await send('Input.insertText', { text: '末尾新增' })
  check('即打即改（输入直达正文存储）', await wait(`fixture.note.content.includes('末尾新增')`))
  await delay(1000)
  await act(`${content}.querySelector('.vditor-reset').click()`)
  await send('Input.insertText', { text: '二次编辑' })
  check('连续输入累积可撤销', await wait(`fixture.note.content.includes('二次编辑')`))
  await delay(1000)
  await act('document.querySelector(".vditor-toolbar__item button[data-type=undo]")?.click()')
  check('撤销回到上一编辑状态', await wait(`!fixture.note.content.includes('二次编辑')`))
  check('所见即所得为默认（未写过设置）', await evaluate('localStorage.getItem("kg-dev-editor-mode-v1") === null'))
  await act('fixture.setContent("外部同步更新")')
  check('外部写入同步进编辑器', await wait(`${content}?.textContent.includes('外部同步更新')`))
  await act('[...document.querySelectorAll(".vditor-toolbar__item button")].find(e=>e.innerHTML.includes("M5.5 2.5"))?.click()')
  check('双链工具栏插入模板', await wait(`fixture.note.content.includes('[[笔记标题]]')`))
  await act('fixture.remount()')
  check('组件重载后仍是所见即所得且内容不重写', await wait(`${content}?.textContent.includes('外部同步更新')`))
  // 标签自动补全：候选、沿用已有拼写、大小写归一
  const tagInput = 'document.querySelector("[aria-label=添加标签]")'
  const tagList = 'document.querySelector("[role=listbox][aria-label=已有标签]")'
  await act(`${tagInput}.focus()`)
  await send('Input.insertText', { text: '激光' })
  check('标签输入出现已有标签候选', await wait(`${tagList}?.textContent.includes('量子点激光器')`))
  await act(`[...${tagList}.querySelectorAll('[role=option]')].find(o => o.textContent.includes('量子点激光器'))?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  check('点击候选添加已有标签并清空输入', await evaluate(`fixture.note.tags.includes('量子点激光器') && ${tagInput}.value === ''`))
  await act(`${tagInput}.focus()`)
  await send('Input.insertText', { text: 'laser' })
  check('候选匹配忽略大小写', await wait(`${tagList}?.textContent.includes('Laser')`))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  check('回车采用已有拼写（不新增 laser 小写变体）', await wait(`fixture.note.tags.includes('Laser') && !fixture.note.tags.includes('laser')`))
  await act('document.querySelector("[aria-label=编辑模式]").click()')
  await act('[...document.querySelectorAll("[role=option]")].find(e=>e.textContent==="经典模式").click()')
  check('可切换经典模式并持久化', await evaluate('localStorage.getItem("kg-dev-editor-mode-v1") === "classic" && !document.querySelector("[data-testid=wysiwyg-editor]")'))
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await delay(200)
  check('390px 手机布局无横向溢出', await evaluate('document.documentElement.scrollWidth <= 390'))
  await fs.writeFile(path.join(out, 'mobile.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
  if (results.some((r) => !r.ok)) throw new Error('WYSIWYG browser checks failed')
  console.log(`\n${results.length} browser checks passed; screenshot: ${path.join(out, 'mobile.png')}`)
} finally { await closeBrowser?.().catch(() => {}); ws?.close(); browser.kill(); server.close() }
