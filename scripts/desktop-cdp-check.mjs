/** 通过 CDP 驱动桌面端（kg://desktop）：打开文献笔记，检查附件行与 PDF 能力 */
import fs from 'node:fs/promises'
import path from 'node:path'

const out = path.join(process.cwd(), '.tmp-vault-test', 'desktop-cdp')
await fs.mkdir(out, { recursive: true })
const target = (await (await fetch('http://127.0.0.1:9223/json')).json()).find((t) => t.type === 'page')
if (!target) throw new Error('桌面端调试端口未就绪')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
ws.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data)
  const p = pending.get(m.id)
  if (p) { pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result) }
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
  setTimeout(() => { if (pending.delete(id)) reject(new Error(method + ' timeout')) }, 20000).unref()
})
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description)
  return r.result?.value
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const click = async (selector) => {
  const rect = JSON.parse(await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`))
  if (rect === 'null') return false
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  return true
}

// 等就绪：顶栏出现条目数
for (let i = 0; i < 120; i++) {
  const t = await evaluate(`document.body.textContent.includes('个条目')`)
  if (t) break
  await delay(500)
}
console.log('条目:', await evaluate(`[...document.querySelectorAll('span')].find(e => e.textContent.includes('个条目'))?.textContent`))
console.log('目录:', await evaluate(`[...document.querySelectorAll('span')].find(e => e.textContent.includes('笔记目录'))?.textContent?.slice(0, 60)`))
// 打开文献视图
const opened = await evaluate(`(() => {
  const tab = [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === '文献')
  if (!tab) return 'no-tab'
  const r = tab.getBoundingClientRect()
  tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }))
  tab.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  tab.click()
  return 'clicked'
})()`)
console.log('文献标签:', opened)
await delay(2500)
console.log('表格:', await evaluate(`JSON.stringify({ cols: [...document.querySelectorAll('th')].map(t => t.textContent.trim()), rows: document.querySelectorAll('tbody tr').length, pdfBadges: [...document.querySelectorAll('tbody tr')].slice(0, 12).map(r => r.lastElementChild?.previousElementSibling?.previousElementSibling?.textContent?.trim() ?? '?') })`))
await fs.writeFile(path.join(out, 'lit-view.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
console.log('shot: desktop-cdp/lit-view.png')
// 打开第一篇文献笔记，检查附件行文案（判断 attachmentsSupported 是否已为 true）
await click('tbody tr')
await delay(2500)
console.log('附件行:', await evaluate(`(() => {
  const bar = [...document.querySelectorAll('div')].find(d => /附件|添加 PDF/.test(d.textContent) && d.children.length <= 6 && d.textContent.length < 60)
  return bar ? bar.textContent.trim().slice(0, 60) : '未找到附件行'
})()`))
console.log('文献信息行:', await evaluate(`(() => { const t = document.body.textContent; return JSON.stringify({ hasOpenLit: t.includes('打开文献'), hasLocalPdf: t.includes('本地 PDF'), hasAuthors: t.includes('作者一行一个') }) })()`))
await fs.writeFile(path.join(out, 'lit-note.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
console.log('shot: desktop-cdp/lit-note.png')
ws.close()
