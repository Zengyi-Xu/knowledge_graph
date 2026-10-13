/** Real React + local HTTP bridge + fresh headless Chromium profile; synthetic vault only. */
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import esbuild from 'esbuild'
import { createLocalServer } from './local-web.mjs'

const root = process.cwd()
const out = path.join(root, '.tmp-startup-e2e', `run-${Date.now()}`)
const vault = path.join(out, 'vault')
const profile = path.join(out, 'profile')
await fs.mkdir(vault, { recursive: true })
await esbuild.build({ stdin: { contents: "export { buildMeta, toMarkdown, relPathFor, parseNoteMarkdown } from '@/lib/vaultFormat'; export { emptyLiterature } from '@/types/note'", resolveDir: root }, bundle: true, outfile: path.join(out, 'tools.cjs'), platform: 'node', format: 'cjs', alias: { '@': path.join(root, 'src') } })
const require = createRequire(import.meta.url)
const tools = require(path.join(out, 'tools.cjs'))
const api = require('../electron/vaultFs.cjs')
const base = 1700000000000
const notes = Array.from({ length: 2000 }, (_, i) => ({
  id: `startup-${i}`, title: i < 100 ? `普通笔记 ${i}` : `Paper ${i - 100}`,
  type: i < 100 ? 'other' : 'literature', grade: '', tags: ['启动测试'],
  content: i < 100 ? `普通正文 ${i}\n\n[[Paper ${i}]]` : `Abstract ${i - 100}. `.repeat(40),
  createdAt: base + i, updatedAt: base + i,
  ...(i >= 100 ? { literature: { ...tools.emptyLiterature(), citekey: `paper${i - 100}`, collections: ['已发表文章'] } } : {}),
}))
const names = new Map(notes.map((note) => [note.id, tools.relPathFor(note)]))
for (const note of notes) {
  const file = path.join(vault, names.get(note.id))
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, tools.toMarkdown(note), 'utf8')
}
const originalMeta = tools.buildMeta(notes, names)
await fs.writeFile(path.join(vault, 'meta.json'), originalMeta, 'utf8')
let executable
for (const candidate of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
  try { await fs.access(candidate); executable = candidate; break } catch {}
}
if (!executable) throw new Error('Chromium not installed')
const local = await createLocalServer({ port: 0, vault, dist: path.join(root, 'dist') })
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const started = performance.now()
const browser = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
let ws
const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); console.log(`${ok ? '✓' : '✗'} ${name}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`); assert.ok(ok, name) }
try {
  let debugPort
  for (let attempt = 0; attempt < 80; attempt++) {
    try { debugPort = Number((await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break } catch {}
    await delay(100)
  }
  if (!debugPort) throw new Error('Chrome did not start')
  const target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((entry) => entry.type === 'page')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
  let sequence = 0
  const pending = new Map()
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    const item = pending.get(message.id)
    if (item) { pending.delete(message.id); message.error ? item.reject(message.error) : item.resolve(message.result) }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result?.value
  }
  await send('Page.enable')
  await send('Runtime.enable')
  const wait = async (expression, timeout = 15000) => {
    const end = performance.now() + timeout
    while (performance.now() < end) { if (await evaluate(`Boolean(${expression})`)) return true; await delay(50) }
    return false
  }
  const instrument = (mode) => `(() => {
    for (const prefix of ['kg-', 'kg-dev-']) {
      localStorage.setItem(prefix + 'vault-dir-v1', ${JSON.stringify(vault)});
      localStorage.setItem(prefix + 'vault-watch-v1', '0');
      localStorage.setItem(prefix + 'auto-sync-v1', '1');
      localStorage.setItem(prefix + 'sync-path-v1', ${JSON.stringify(path.join(vault, 'sync', 'notes.json'))});
      // 本测试用经典模式的 textarea 驱动真实输入；默认的所见即所得模式由 wysiwyg-e2e 覆盖
      localStorage.setItem(prefix + 'editor-mode-v1', 'classic');
    }
    const state = window.e2e = { reads: [], completedReads: [], writes: [], syncWrites: [], syncReads: 0, downloads: 0, blocked: false, failures: [], readyMs: null };
    let bridge; let release;
    state.release = () => { state.blocked = false; release?.(); };
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() { if(this.download) state.downloads++; else anchorClick.call(this); };
    addEventListener('error', e => state.failures.push(e.message));
    addEventListener('unhandledrejection', e => state.failures.push(String(e.reason)));
    Object.defineProperty(window, 'knowledgeGraphDesktop', { configurable: true, get: () => bridge, set: value => {
      bridge = value;
      const list = value.listVault.bind(value);
      let scanRequests = 0;
      value.listVault = async dir => {
        if (${JSON.stringify(mode)} === 'scan' && ++scanRequests === 1) { state.blocked = true; await new Promise(resolve => release = resolve); }
        return list(dir);
      };
      const read = value.readVaultFiles.bind(value);
      let literatureRequests = 0;
      value.readVaultFiles = async (dir, files) => {
        state.reads.push(...files);
        if (files.some(file => file.replace(/\\\\/g,'/').startsWith('文献/'))) {
          literatureRequests++;
          if (${JSON.stringify(mode)} === 'hold' && literatureRequests === 1) {
            state.blocked = true; await new Promise(resolve => release = resolve);
          }
          if (${JSON.stringify(mode)} === 'fail' && literatureRequests === 2) throw new Error('E2E simulated EACCES');
        }
        const records = await read(dir, files);
        state.completedReads.push(...files);
        return records;
      };
      const write = value.writeVault.bind(value);
      value.writeVault = (dir, plan) => { state.writes.push({ time: performance.now(), blocked: state.blocked, writes: plan.writes.length, deletes: plan.deletes, count: plan.meta ? JSON.parse(plan.meta).notes.length : null }); return write(dir, plan); };
      const readSync = value.readSyncFile.bind(value);
      value.readSyncFile = file => { state.syncReads++; return readSync(file); };
      const writeSync = value.writeSyncFile.bind(value);
      value.writeSyncFile = (file, contents) => { state.syncWrites.push({ time: performance.now(), blocked: state.blocked, count: JSON.parse(contents).length }); return writeSync(file, contents); };
    }});
    addEventListener('DOMContentLoaded', () => {
      // 编辑器两种模式都算「可交互」：经典模式是 textarea，默认的所见即所得模式是 Vditor
      const editorReady = () => document.querySelector('textarea[placeholder^="用 Markdown"]') || document.querySelector('[data-testid=wysiwyg-editor] .vditor')
      const observe = new MutationObserver(() => { if(state.readyMs === null && editorReady() && /100 (个条目|篇笔记)/.test(document.querySelector('header')?.textContent ?? '')) state.readyMs = performance.now(); });
      observe.observe(document.body, { childList: true, subtree: true });
    });
  })()`
  const injection = await send('Page.addScriptToEvaluateOnNewDocument', { source: instrument('hold') })
  await send('Page.navigate', { url: local.origin })
  const foregroundReady = await wait('window.e2e?.blocked && e2e.readyMs !== null')
  if (!foregroundReady) {
    const diagnosis = await evaluate('({e2e:window.e2e,body:document.body.innerText.slice(0,1500),textarea:!!document.querySelector("textarea"),href:location.href})')
    await fs.writeFile(path.join(out, 'diagnosis.json'), JSON.stringify(diagnosis, null, 2))
    console.log(JSON.stringify(diagnosis))
  }
  check('真实 React 首屏载入 100 普通笔记，文献等待不阻塞编辑器', foregroundReady)
  const readiness = await evaluate('({pageMs:e2e.readyMs,completedReadCount:e2e.completedReads.length,completedLiteratureReadCount:e2e.completedReads.filter(name=>name.startsWith("文献/")).length})')
  const processToInteractiveMs = Math.round(performance.now() - started)
  check('首屏可交互低于 3 秒', readiness.pageMs <= 3000, { ...readiness, processToInteractiveMs })
  // Request has entered the artificial hold; no literature bodies have been read.
  check('首屏期间没有写入目录或同步文件', await evaluate('e2e.writes.length === 0 && e2e.syncWrites.length === 0 && e2e.syncReads === 0'))
  await evaluate('document.querySelector(\'textarea[placeholder^="用 Markdown"]\').focus(); document.querySelector(\'textarea[placeholder^="用 Markdown"]\').setSelectionRange(0,0)')
  await send('Input.insertText', { text: '加载中编辑，必须保存。\n' })
  await delay(1200)
  const button = (text) => `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)})?.click()`
  for (const label of ['写入目录', '保存到同步文件', '导出备份']) await evaluate(button(label))
  await delay(300)
  const paused = await evaluate('({writes:e2e.writes.length,syncWrites:e2e.syncWrites.length,syncReads:e2e.syncReads,downloads:e2e.downloads,editor:document.querySelector(\'textarea[placeholder^="用 Markdown"]\').value})')
  check('加载中的真实输入已留在 React 状态', paused.editor.startsWith('加载中编辑，必须保存。\n'))
  check('自动/手动写盘均挂起；全库同步/导出未推送残缺工作集', paused.writes === 0 && paused.syncWrites === 0 && paused.syncReads === 0 && paused.downloads === 0, paused)
  check('挂起期间磁盘 meta 原样且已有正文未被抢先覆盖', await fs.readFile(path.join(vault, 'meta.json'), 'utf8') === originalMeta && await fs.readFile(path.join(vault, names.get(notes[0].id)), 'utf8') === tools.toMarkdown(notes[0]))
  await evaluate('e2e.release()')
  check('文献分批完全加载到 2000 篇且状态指示结束', await wait('/2000 (个条目|篇笔记)/.test(document.querySelector("header")?.textContent ?? "") && !document.body.textContent.includes("文献加载中")', 30000))
  check('完整加载后补写首屏期间的编辑并生成完整同步文件', await wait('e2e.writes.length > 0 && e2e.syncWrites.some(write=>write.count===2000)', 15000))
  await delay(500)
  const finalState = await evaluate('({writes:e2e.writes,syncWrites:e2e.syncWrites,errors:e2e.failures,readyMs:e2e.readyMs})')
  check('写盘记录无误删；所有同步快照均含完整 2000 篇', finalState.writes.every(write => write.deletes.length === 0 && (write.count === null || write.count === 2000)) && finalState.syncWrites.every(write => write.count === 2000 && !write.blocked), finalState)
  const listing = await api.listVault(vault)
  const finalIndex = JSON.parse(listing.meta)
  check('磁盘索引与正文数量均保持 2000 篇', listing.md.length === 2000 && finalIndex.notes.length === 2000)
  const disk = await api.readVaultFiles(vault, [...names.values()])
  const originalByFile = new Map(notes.map(note => [names.get(note.id), tools.toMarkdown(note)]))
  check('1900 篇文献的全部字节均未改变', disk.filter(file => file.name.startsWith('文献/')).every(file => file.text === originalByFile.get(file.name)))
  check('首屏普通笔记编辑实际落盘', tools.parseNoteMarkdown(disk.find(file => file.name === names.get(notes[0].id)).text, '').note.content.startsWith('加载中编辑，必须保存。\n'))
  await send('Page.captureScreenshot', { format: 'png' }).then(result => fs.writeFile(path.join(out, 'complete.png'), Buffer.from(result.data, 'base64')))

  // A fresh navigation starts the actual hook again; fail the second literature batch.
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
  let currentInjection = await send('Page.addScriptToEvaluateOnNewDocument', { source: instrument('fail') })
  await send('Page.reload', { ignoreCache: true })
  check('真实后台读取失败有明确提示并暂停写盘', await wait('document.body?.textContent?.includes("E2E simulated EACCES")'))
  await evaluate(button('写入目录'))
  await evaluate(button('保存到同步文件'))
  await evaluate(button('导出备份'))
  await delay(1200)
  const failedState = await evaluate('({writes:e2e.writes.length,syncWrites:e2e.syncWrites.length,syncReads:e2e.syncReads,downloads:e2e.downloads,errors:e2e.failures})')
  check('读取失败时手动保存/自动同步/导出仍未发出任何残缺数据', failedState.writes === 0 && failedState.syncWrites === 0 && failedState.syncReads === 0 && failedState.downloads === 0, failedState)
  const failureListing = await api.listVault(vault)
  check('失败场景后仍保留全部 2000 文件与索引', failureListing.md.length === 2000 && JSON.parse(failureListing.meta).notes.length === 2000)
  check('浏览器无未处理异常', finalState.errors.length === 0 && failedState.errors.length === 0)

  const navigateMode = async mode => {
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: currentInjection.identifier })
    currentInjection = await send('Page.addScriptToEvaluateOnNewDocument', { source: instrument(mode) })
    await send('Page.reload', { ignoreCache: true })
    return wait('window.e2e?.blocked && e2e.readyMs !== null')
  }
  check('扫描窗口测试在真实首屏之后暂停后台扫描', await navigateMode('scan'))
  const normalFile = path.join(vault, names.get(notes[0].id))
  const external = { ...notes[0], content: '扫描窗口的外部版本，必须进入界面。', updatedAt: base + 7000 }
  await fs.writeFile(normalFile, tools.toMarkdown(external), 'utf8')
  await evaluate('e2e.release()')
  check('首读与扫描之间外部改写普通笔记被重新读入，没有漏掉新正文', await wait('/2000 (个条目|篇笔记)/.test(document.querySelector("header")?.textContent ?? "") && document.querySelector(\'textarea[placeholder^="用 Markdown"]\')?.value === "扫描窗口的外部版本，必须进入界面。"', 30000))
  await delay(500)
  check('外部单方修改未被启动flush覆盖', await fs.readFile(normalFile, 'utf8') === tools.toMarkdown(external) && await evaluate('e2e.writes.length === 0'))

  check('并行本地/外部编辑冲突测试在扫描窗口暂停', await navigateMode('scan'))
  await evaluate('document.querySelector(\'textarea[placeholder^="用 Markdown"]\').focus(); document.querySelector(\'textarea[placeholder^="用 Markdown"]\').setSelectionRange(0,0)')
  await send('Input.insertText', { text: '冲突本地版本，不能丢失。\n' })
  await delay(100)
  const conflictDisk = { ...external, content: '并行冲突的磁盘版本，选择前不能覆盖。', updatedAt: base + 8000 }
  await fs.writeFile(normalFile, tools.toMarkdown(conflictDisk), 'utf8')
  await evaluate('e2e.release()')
  check('文献完整加载后普通笔记冲突保留本地并保持写盘gate关闭', await wait('/2000 (个条目|篇笔记)/.test(document.querySelector("header")?.textContent ?? "") && document.body?.textContent?.includes("1 篇笔记存在文件冲突")', 30000))
  await delay(1200)
  check('冲突尚未选择时本地与磁盘两份版本均保留，全库同步没有覆盖磁盘', await evaluate('document.querySelector(\'textarea[placeholder^="用 Markdown"]\').value.startsWith("冲突本地版本，不能丢失。\\n") && e2e.writes.length === 0 && e2e.syncWrites.length === 0 && e2e.syncReads === 0') && await fs.readFile(normalFile, 'utf8') === tools.toMarkdown(conflictDisk))
  await evaluate('window.confirm = () => true')
  await evaluate(button('保留本地编辑'))
  check('明确选择本地冲突版本后在React提交之后补写，不丢本地修改', await wait('e2e.writes.length > 0 && !document.body?.textContent?.includes("1 篇笔记存在文件冲突")', 15000))
  await delay(300)
  const selectedText = tools.parseNoteMarkdown(await fs.readFile(normalFile, 'utf8'), '').note.content
  check('冲突解决实际落盘的是所选本地版本，仍0误删', selectedText.startsWith('冲突本地版本，不能丢失。\n') && await evaluate('e2e.writes.every(write=>write.deletes.length===0)'))
  check('采用磁盘版本测试再次暂停扫描窗口', await navigateMode('scan'))
  await evaluate('document.querySelector(\'textarea[placeholder^="用 Markdown"]\').focus(); document.querySelector(\'textarea[placeholder^="用 Markdown"]\').setSelectionRange(0,0)')
  await send('Input.insertText', { text: '这次用户会选择磁盘版本。\n' })
  await delay(100)
  const diskChosen = { ...external, content: '用户明确选择的最新磁盘正文。', updatedAt: base + 9000 }
  await fs.writeFile(normalFile, tools.toMarkdown(diskChosen), 'utf8')
  await evaluate('e2e.release()')
  check('第二次冲突也完整加载且暂停写盘', await wait('/2000 (个条目|篇笔记)/.test(document.querySelector("header")?.textContent ?? "") && document.body?.textContent?.includes("1 篇笔记存在文件冲突")', 30000))
  await evaluate('window.confirm = () => true')
  await evaluate(button('采用磁盘版本'))
  check('明确选择磁盘版本后React与磁盘保持同一正文', await wait('!document.body?.textContent?.includes("1 篇笔记存在文件冲突") && document.querySelector(\'textarea[placeholder^="用 Markdown"]\')?.value === "用户明确选择的最新磁盘正文。"'))
  await delay(500)
  check('采用磁盘版本没有把已放弃的本地编辑写回，也无误删', await fs.readFile(normalFile, 'utf8') === tools.toMarkdown(diskChosen) && await evaluate('e2e.writes.length === 0 && e2e.failures.length === 0'))
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ checks, readiness, processToInteractiveMs, total: 2000, vault, limitation: '独立 Chromium 新 profile + 合成 2000 篇库，不是百度盘真实 2000 文献测试。' }, null, 2))
  console.log(`\n${checks.length} checks passed; evidence: ${path.join(out, 'results.json')}`)
} finally {
  await fs.writeFile(path.join(out, 'checks.json'), JSON.stringify(checks, null, 2))
  ws?.close(); browser.kill(); await local.close()
}
