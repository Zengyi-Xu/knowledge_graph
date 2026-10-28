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
await esbuild.build({ entryPoints: ['scripts/wysiwyg-fixture.tsx'], bundle: true, outfile: path.join(out, 'bundle.js'), format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': path.join(root, 'src') }, define: { __APP_ENV__: '"development"', __APP_VERSION__: '"editor-test"' }, plugins: [{ name: 'inline-css', setup(build) {
  build.onResolve({ filter: /\?url$/ }, ({ path: file }) => ({ path: file, namespace: 'asset-url' }))
  build.onLoad({ filter: /.*/, namespace: 'asset-url' }, () => ({ contents: 'export default "/unused-pdf-worker.mjs"', loader: 'js' }))
  build.onResolve({ filter: /\?inline$/ }, ({ path: file, resolveDir }) => ({ path: file.startsWith('@/') ? path.join(root, 'src', file.slice(2, -7)) : /^(vditor|katex)\//.test(file) ? path.join(root, 'node_modules', file.slice(0, -7)) : path.resolve(resolveDir, file.slice(0, -7)), namespace: 'inline-css' }))
  build.onLoad({ filter: /.*/, namespace: 'inline-css' }, async ({ path: file }) => ({ contents: `export default ${JSON.stringify(await fs.readFile((file.endsWith('index.css') && !file.includes('node_modules')) ? path.join(out, 'app.css') : file, 'utf8'))}`, loader: 'js' }))
} }] })
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="margin:0"><div id="root" style="height:100vh"></div><script>localStorage.removeItem("kg-dev-editor-mode-v1")</script><script src="/app.js"></script></body></html>'
const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0]
    if (url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(out, 'bundle.js'))) }
    else if (url === '/app.css') { res.setHeader('Content-Type', 'text/css'); res.end(await fs.readFile(path.join(out, 'app.css'))) }
    else if (url.startsWith('/vditor/')) { res.setHeader('Content-Type', url.endsWith('.css') ? 'text/css' : 'application/javascript'); res.end(await fs.readFile(path.join(root, 'public', url.slice(1)))) }
    else res.end(html)
  } catch { res.statusCode = 500; res.end() }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
const profile = await fs.mkdtemp(path.join(out, 'profile-'))
const browser = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9335', `--user-data-dir=${profile}`, url], { windowsHide: true, stdio: 'ignore' })
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
  // 本脚本只服务 public/vditor/（没有 dist/js/katex/*），Vditor 自带的 CDN 渲染器在这里必然失败，
  // 公式仍能渲染就证明走的是应用内置的 katexRuntime，而不是联网/外部脚本。
  check('块公式与行内公式均由内置 KaTeX 渲染', await wait(`${content}.querySelectorAll('.katex').length >= 3`))
  check('数字起始的行内公式可识别', await evaluate(`[...${content}.querySelectorAll('[data-type="math-inline"] code')].some(e => e.textContent.includes('10\\\\log'))`))
  check('公式可见层不再显示 LaTeX 源码', await evaluate(`(() => {
    const previews = [...${content}.querySelectorAll('.vditor-wysiwyg__preview .language-math')]
    return previews.length >= 3 && previews.every(e => e.querySelector('.katex') &&
      [...e.childNodes].every(n => n.nodeType !== Node.TEXT_NODE || !n.textContent.trim()))
  })()`))
  check('公式隐藏源码保持原样供编辑与序列化', await evaluate(`${content}.querySelector('code[data-type="math-block"]')?.textContent.includes('\\\\mathrm{TBP}')`))
  // 新输入的公式也要走内置渲染（首屏已有的公式只覆盖「初次加载」这条路径）。
  await act(`${content}.querySelector('.vditor-reset').click()`)
  for (let i = 0; i < 2; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  }
  await send('Input.insertText', { text: '新输入 $\\alpha+\\beta$ 结束' })
  check('输入行内公式后即时渲染', await wait(`(() => {
    const blocks = [...${content}.querySelectorAll('.vditor-wysiwyg__block[data-type="math-inline"]')]
    const block = blocks.find((item) => item.querySelector('code[data-type="math-inline"]')?.textContent.includes('\\\\alpha+\\\\beta'))
    return Boolean(block?.querySelector('.vditor-wysiwyg__preview .language-math .katex'))
  })()`))
  const storedFormula = await wait(`fixture.note.content.includes('$\\\\alpha+\\\\beta$')`)
  if (!storedFormula) console.log('  存储末尾:', await evaluate(`JSON.stringify(fixture.note.content.slice(-200))`))
  check('输入的公式源码进入正文存储', storedFormula)
  check('标题/粗斜删除线/任务列表/引用/表格/代码/分割线/链接图片渲染', await evaluate(`(() => { const c=${content}; return ['h1','strong','em','s','input[type=checkbox]','blockquote','table','pre code','hr','a','img'].every(q=>c.querySelector(q)) })()`))
  // Tailwind preflight 会把 ol 的 list-style 清成 none（Vditor 只补回了 ul），有序列表因此没有序号
  check('有序列表显示数字序号', await wait(`(() => { const ol = ${content}.querySelector('ol'); return Boolean(ol) && getComputedStyle(ol).listStyleType === 'decimal' })()`))
  check('有序列表左侧留出序号空间', await evaluate(`(() => { const ol = ${content}.querySelector('ol'); return ol ? parseFloat(getComputedStyle(ol).paddingLeft) >= 20 : false })()`))
  check('双链按字面文本保留', await evaluate(`${content}.textContent.includes('[[已有笔记]]')`))
  check('双链渲染为样式化标记', await wait(`${content}.querySelectorAll('.kg-wiki').length >= 2`))
  check('双链括号隐藏（与经典一致）', await evaluate(`(() => {
    const w = ${content}.querySelector('.kg-wiki')
    const bracket = w?.querySelector('.kg-wiki-bracket')
    return w?.dataset.title === '已有笔记' && w?.dataset.found === 'true' &&
      getComputedStyle(bracket).fontSize === '0px' && w.textContent.startsWith('[[')
  })()`))
  const wikiVisual = await evaluate(`(() => {
    const miss = [...${content}.querySelectorAll('.kg-wiki')].find(w => w.dataset.found === 'false')
    const hit = [...${content}.querySelectorAll('.kg-wiki')].find(w => w.dataset.found === 'true')
    if (!miss || !hit) return { ok: false, reason: 'missing link decoration' }
    const color = (el) => getComputedStyle(el).color
    return {
      ok: miss.querySelector('.kg-wiki-missing')?.textContent === '?' &&
        !hit.querySelector('.kg-wiki-missing') && color(miss) !== color(hit),
      missText: miss.textContent, hitText: hit.textContent,
      missColor: color(miss), hitColor: color(hit),
    }
  })()`)
  check('不存在的双链显示问号且配色区分', wikiVisual?.ok)
  if (!wikiVisual?.ok) console.log('  双链诊断:', JSON.stringify(wikiVisual))
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
  await act('fixture.remount()')
  check('组件重载后仍是所见即所得且内容不重写', await wait(`${content}?.textContent.includes('外部同步更新')`))
  // 双链工具栏：只插一对空括号、光标居中；以前插的是 [[笔记标题]] 占位芯片，点一下就按占位标题新建了笔记
  // 用空笔记测：新建笔记后第一件事就是点双链，最容易踩到「占位芯片被点开」
  await act('fixture.setContent("")')
  await delay(300)
  await act(`(() => {
    const root = ${content}.querySelector('.vditor-reset')
    root.focus()
    const p = root.querySelector('p') ?? root
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    const node = walker.nextNode() ?? p
    const range = document.createRange()
    range.setStart(node, node.nodeType === Node.TEXT_NODE ? node.nodeValue.length : 0)
    range.collapse(true)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    return true
  })()`)
  const eventsBeforeWiki = await evaluate('fixture.events.length')
  await act('[...document.querySelectorAll(".vditor-toolbar__item button")].find(e=>e.innerHTML.includes("M5.5 2.5"))?.click()')
  await wait(`fixture.note.content.includes('[[]]')`)
  const wikiPair = await evaluate(`(() => {
    const sel = window.getSelection()
    const root = ${content}.querySelector('.vditor-reset')
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null
    let before = ''
    let after = ''
    if (root && range) {
      const pre = document.createRange()
      pre.setStart(root, 0)
      pre.setEnd(range.startContainer, range.startOffset)
      before = pre.toString()
      const post = document.createRange()
      post.setStart(range.endContainer, range.endOffset)
      post.setEnd(root, root.childNodes.length)
      after = post.toString()
    }
    return {
      content: fixture.note.content,
      before,
      after,
      activeInEditor: Boolean(document.activeElement?.closest?.('.vditor-wysiwyg')),
    }
  })()`)
  check('双链工具栏只插入一对空括号', wikiPair.content.includes('[[]]') && !wikiPair.content.includes('笔记标题'))
  if (!wikiPair.content.includes('[[]]')) console.log('  双链插入诊断:', JSON.stringify(wikiPair))
  if (!(wikiPair.before.endsWith('[[') && wikiPair.after.startsWith(']]'))) console.log('  双链光标诊断:', JSON.stringify(wikiPair))
  check('插入后光标停在两个中括号中间', wikiPair.before.endsWith('[[') && wikiPair.after.startsWith(']]'))
  check('插入双链不新建笔记', (await evaluate('fixture.events.length')) === eventsBeforeWiki)
  await send('Input.insertText', { text: '已有' })
  check('括号内输入触发标题补全', await wait(`document.querySelector('[aria-label=匹配笔记]')?.textContent.includes('已有笔记')`))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  const pickedOk = await wait(`fixture.note.content.includes('[[已有笔记]]') && !fixture.note.content.includes(']]]]')`)
  if (!pickedOk) console.log('  选中候选后的内容:', JSON.stringify(await evaluate('fixture.note.content')))
  check('选中候选后只留一对括号', pickedOk)
  // 标题快捷键：Alt+1…6（浏览器把 Ctrl+1…8 留给切标签页，不能占用）
  await act('fixture.setContent("ALT 标题测试")')
  await wait(`${content}?.textContent.includes('ALT 标题测试')`)
  await act(`(() => {
    const root = ${content}.querySelector('.vditor-reset')
    root.focus()
    const p = root.querySelector('p') ?? root
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    const node = walker.nextNode() ?? p
    const range = document.createRange()
    range.setStart(node, 2)
    range.collapse(true)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    return true
  })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50, modifiers: 1 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50, modifiers: 1 })
  const headingOk = await wait(`(() => { const h = ${content}.querySelector('h2'); return Boolean(h?.textContent.includes('ALT 标题测试')) && fixture.note.content.includes('## ALT 标题测试') })()`)
  if (!headingOk) console.log('  标题快捷键诊断:', JSON.stringify(await evaluate(`(() => ({
    content: fixture.note.content,
    active: document.activeElement?.className ?? '',
    sel: window.getSelection()?.toString(),
    tags: [...${content}.querySelectorAll('.vditor-reset *')].slice(0, 6).map((e) => e.tagName),
  }))()`)))
  check('Alt+2 把当前段落设为二级标题', headingOk)
  // 选中文字浮出排版条（Word 迷你工具栏）：只在桌面宽度出现（<768px 交给手机端原生选择菜单）
  await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false })
  await delay(200)
  await act('fixture.setContent("需要加粗的文字")')
  await wait(`${content}?.textContent.includes('需要加粗的文字')`)
  await delay(300)
  await act(`(() => {
    const root = ${content}.querySelector('.vditor-reset')
    root.focus()
    const p = [...${content}.querySelectorAll('.vditor-reset p')].find((el) => el.textContent.includes('需要加粗的文字')) ?? root.querySelector('p')
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    const text = walker.nextNode()
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, text.nodeValue.length)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    return true
  })()`)
  const bubbleShown = await wait(`document.querySelector('[data-testid=wysiwyg-bubble]')`)
  if (!bubbleShown) console.log('  浮动条诊断:', JSON.stringify(await evaluate(`(() => {
    const host = document.querySelector('[data-testid=wysiwyg-editor] .kg-vditor')
    const sel = window.getSelection()
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null
    const rects = range ? [...range.getClientRects()].map((r) => ({ w: r.width, h: r.height, t: r.top })) : []
    return {
      vw: window.innerWidth,
      collapsed: sel?.isCollapsed,
      rangeCount: sel?.rangeCount ?? 0,
      text: sel?.toString(),
      inHost: range ? Boolean(host?.contains(range.commonAncestorContainer)) : false,
      rects,
      active: document.activeElement?.className ?? '',
    }
  })()`)))
  check('选中文字后浮出排版条', bubbleShown)
  const bubblePos = await evaluate(`(() => {
    const bar = document.querySelector('[data-testid=wysiwyg-bubble]')
    if (!bar) return null
    const box = bar.getBoundingClientRect()
    const cs = getComputedStyle(bar)
    return { width: box.width, top: box.top, left: box.left, vw: window.innerWidth, visible: cs.display !== 'none' }
  })()`)
  check('排版条完整落在视口内', Boolean(bubblePos?.visible) && bubblePos.width > 200 && bubblePos.top >= 0 && bubblePos.left >= 0 && bubblePos.left + bubblePos.width <= bubblePos.vw)
  if (!(Boolean(bubblePos?.visible) && bubblePos.width > 200 && bubblePos.top >= 0 && bubblePos.left >= 0 && bubblePos.left + bubblePos.width <= bubblePos.vw)) console.log('  排版条位置诊断:', JSON.stringify(bubblePos))
  await act(`document.querySelector('[data-testid=wysiwyg-bubble] button[aria-label="加粗"]')?.click()`)
  const boldOk = await wait(`fixture.note.content.includes('**需要加粗的文字**')`)
  if (!boldOk) console.log('  加粗诊断:', JSON.stringify(await evaluate(`({ content: fixture.note.content, sel: window.getSelection()?.toString(), html: ${content}.innerHTML.slice(0, 200) })`)))
  check('排版条上的加粗按钮生效', boldOk)
  await send('Emulation.clearDeviceMetricsOverride')
  await delay(200)
  // 流式滚动：工具栏吸在正文滚动容器顶端（flow 下滚动发生在编辑区内部的 data-body-scroll）
  const longText = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 段：用于验证流式滚动时工具栏是否留在原位。`).join('\n\n')
  await act('fixture.setFlow(true)')
  await act(`fixture.setContent(${JSON.stringify(longText)})`)
  await wait(`${content}?.textContent.includes('第 60 段')`)
  await delay(200)
  const sticky = await evaluate(`(() => {
    const scroll = document.querySelector('[data-body-scroll]')
    const toolbar = document.querySelector('[data-testid=wysiwyg-editor] .vditor-toolbar')
    if (!scroll || !toolbar) return { failed: 'missing flow containers' }
    const topEdge = scroll.getBoundingClientRect().top
    scroll.scrollTop = 500
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      position: getComputedStyle(toolbar).position,
      moved: scroll.scrollTop,
      topEdge,
      toolbarTop: toolbar.getBoundingClientRect().top,
    }))))
  })()`)
  if (sticky.failed) console.log('  吸顶诊断:', JSON.stringify(sticky))
  check('流式滚动时工具栏吸顶', sticky.position === 'sticky' && sticky.moved > 100 && Math.abs(sticky.toolbarTop - sticky.topEdge) <= 1)
  await act('fixture.setFlow(false)')
  await delay(200)
  // 语法错误不能进入「渲染 → 写回纯文本 → MutationObserver 再次触发渲染」的循环。
  await act(String.raw`fixture.setContent('坏公式 $\\frac{1}{$')`)
  const errorPreview = `[...${content}.querySelectorAll('.vditor-wysiwyg__block[data-type="math-inline"]')].find((item) => item.querySelector('code[data-type="math-inline"]')?.textContent.includes('frac{1}{'))?.querySelector('.vditor-wysiwyg__preview .language-math')`
  const errorPreviewReady = await wait(`(() => { const p=${errorPreview}; return p?.dataset.mathError === 'true' && p.textContent.includes('frac{1}{') })()`)
  if (!errorPreviewReady) console.log('  错误公式 DOM:', await evaluate(`JSON.stringify([...${content}.querySelectorAll('.vditor-wysiwyg__block[data-type^="math-"]')].map((b) => ({ type: b.dataset.type, src: b.querySelector('code')?.textContent, preview: b.querySelector('.vditor-wysiwyg__preview')?.innerHTML.slice(0, 160) })))`))
  check('无法解析的公式保留源码并标记错误', errorPreviewReady)
  await delay(300)
  const errorMutations = await evaluate(`new Promise((resolve) => {
    const target = ${content}
    let count = 0
    const observer = new MutationObserver((records) => { count += records.length })
    observer.observe(target, { childList: true, subtree: true, characterData: true })
    setTimeout(() => { observer.disconnect(); resolve(count) }, 600)
  })`)
  if (errorMutations >= 40) console.log('  错误回退期间的 DOM 变更次数:', errorMutations)
  check('错误回退不会反复重写 DOM', errorMutations < 40)
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
} finally { await closeBrowser?.().catch(() => {}); ws?.close(); browser.kill(); server.close(); await fs.rm(profile, { recursive: true, force: true }).catch(() => {}) }
