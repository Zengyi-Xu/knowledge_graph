/**
 * NoteEditor 真实 DOM 交互自测（无头 Chrome + esbuild 打包，报告写进 <pre id="report">）。
 *
 * 覆盖两个回归：
 * 1. 「+ 新建主题…」：Radix Select 关闭时默认把焦点还给触发器，会立刻触发新主题输入框的
 *    blur 把它关掉（输入框一闪即没）—— 修复靠 SelectContent 的 onCloseAutoFocus 拦截。
 * 2. 经典模式插图：粘贴剪贴板图片 → 落盘 attachments/img-<uid>.png（不再是 base64 内嵌），
 *    正文写入 `![图片](./attachments/img-….png)`；渲染层 resolveNoteImages 把它换成 blob URL。
 * 3. flow 布局只有正文区滚动：滚动容器在编辑区内部（data-body-scroll），
 *    头部（主题/标签行）与编辑工具行都固定，不再叠 sticky（叠 sticky 会出现两行交换位置、
 *    中间透出滚动内容的缝隙）。
 *
 * 依赖全部打桩（window.knowledgeGraphDesktop 是假的），不碰真实 vault。
 * 由 scripts/note-editor-dom-test.mjs 驱动。
 */
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { NoteEditor } from '@/components/NoteEditor'
import { saveNoteImage, resolveNoteImages } from '@/lib/noteImages'
import type { Note } from '@/types/note'

let total = 0
let failed = 0
const lines: string[] = []
const check = (name: string, ok: boolean, extra = '') => {
  total++
  if (!ok) failed++
  lines.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- 打桩 ----------

const writes: { rel: string; size: number }[] = []
// 1x1 PNG
const PNG_BYTES = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

;(window as unknown as Record<string, unknown>).knowledgeGraphDesktop = {
  isElectron: true,
  isLocalWeb: false,
  writeAttachment: async (_dir: string, rel: string, data: Uint8Array) => {
    writes.push({ rel, size: data.length })
    return { error: null }
  },
  readAttachment: async (_dir: string, rel: string) => (rel.startsWith('attachments/img-') ? PNG_BYTES : null),
}

localStorage.setItem('kg-vault-dir-v1', 'D:/fake/vault')
localStorage.setItem('kg-editor-mode-v1', 'classic')

// ---------- fixture ----------

function note(id: string, title: string, tags: string[]): Note {
  return { id, title, type: 'skill', grade: '', tags, content: '# 正文\n', createdAt: 1, updatedAt: 1 }
}

const patches: Array<Record<string, unknown>> = []

function Host() {
  const [n, setN] = useState<Note>(note('n1', 'SOP 笔记', []))
  return (
    <NoteEditor
      note={n}
      allNotes={[n, note('n2', '别的笔记', ['主题:工艺'])]}
      onChange={(p) => { patches.push(p); setN((prev) => ({ ...prev, ...p })) }}
      onDelete={() => {}}
      onOpenNote={() => {}}
      onCreateNote={() => {}}
      splitView
      flow
    />
  )
}

createRoot(document.getElementById('root')!).render(<Host />)

// ---------- 探针 ----------

async function run() {
  await sleep(600) // 等懒加载的编辑器链落地

  // 1. 主题下拉：选已有主题
  const trigger = document.querySelector('[title="主题（落盘为 主题:标签）"]') as HTMLElement | null
  check('主题下拉触发器渲染', Boolean(trigger))
  trigger?.click()
  await sleep(300)
  const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === '工艺')
  check('主题下拉列出已有主题', Boolean(opt))
  ;(opt as HTMLElement | undefined)?.click()
  await sleep(300)
  check('选已有主题产生 tags patch', patches.some((p) => JSON.stringify(p.tags) === JSON.stringify(['主题:工艺'])), JSON.stringify(patches))

  // 2. 新建主题：输入框必须真的出现并能回车提交
  ;(document.querySelector('[title="主题（落盘为 主题:标签）"]') as HTMLElement | null)?.click()
  await sleep(300)
  const newItem = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('新建主题'))
  ;(newItem as HTMLElement | undefined)?.click()
  await sleep(300)
  const input = document.querySelector<HTMLInputElement>('input[aria-label="新建主题"]')
  check('「+ 新建主题…」后输入框出现且不闪退', Boolean(input))
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, '设备SOP')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await sleep(300)
  }
  check('新建主题产生 tags patch', patches.some((p) => JSON.stringify(p.tags) === JSON.stringify(['主题:设备SOP'])), JSON.stringify(patches))

  // 3. 插图落盘：短文件名 + ./attachments/ 前缀
  const path = await saveNoteImage(new Blob([PNG_BYTES], { type: 'image/png' }))
  check('插图写进 attachments/img-*.png', /^attachments\/img-[a-z0-9]+\.png$/.test(writes[0]?.rel ?? ''), JSON.stringify(writes))
  check('正文路径是短相对路径', /^\.\/attachments\/img-[a-z0-9]+\.png$/.test(path), path)

  // 4. 渲染层把相对路径换成 blob URL
  const img = document.createElement('img')
  img.setAttribute('src', path)
  document.body.appendChild(img)
  resolveNoteImages(document.body)
  await sleep(300)
  check('resolveNoteImages 换成 blob URL', img.src.startsWith('blob:'), img.src.slice(0, 40))
  img.remove()

  // 5. 经典模式粘贴图片：走落盘而不是 base64
  const before = writes.length
  const ta = document.querySelector('textarea')
  check('经典模式编辑区存在', Boolean(ta))
  if (ta) {
    const dt = new DataTransfer()
    dt.items.add(new File([PNG_BYTES], 'shot.png', { type: 'image/png' }))
    const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })
    ta.dispatchEvent(evt)
    await sleep(500)
    check('粘贴图片触发一次附件写入', writes.length === before + 1, JSON.stringify(writes))
    const patch = patches[patches.length - 1]
    const content = String(patch?.content ?? '')
    check('正文写入短路径图片语法', /!\[图片\]\(\.\/attachments\/img-[a-z0-9]+\.png\)/.test(content), content.slice(-120))
    check('正文不含 base64 内嵌', !content.includes('data:image'))
  }
  // 6. flow 布局下只有正文区滚动：滚动容器在编辑区内部（data-body-scroll + overflow-y-auto）
  const scrollBoxes = [...document.querySelectorAll<HTMLElement>('[data-body-scroll]')]
  check(
    'flow 下正文区有自己的滚动容器',
    scrollBoxes.length > 0 && scrollBoxes.every((el) => el.className.includes('overflow-y-auto')),
    `${scrollBoxes.length} 个`,
  )
  // 7. 头部（主题/标签行）与编辑工具行都不再吸顶：它们本就不在滚动容器里，
  //    叠 sticky 反而会出现两行交换位置、中间透出滚动内容的缝隙
  const stickyRow = trigger?.closest('.sticky')
  check('主题/标签行不再吸顶（头部整体固定）', !stickyRow, stickyRow?.className.slice(0, 60) ?? '')
  const modeTrigger = document.querySelector('[aria-label="编辑模式"]')
  const stickyToolbar = modeTrigger?.closest('.sticky')
  check('编辑工具行不再吸顶（随头部固定）', !stickyToolbar, stickyToolbar?.className.slice(0, 60) ?? '')
}

run()
  .catch((e) => { failed++; lines.push('FAIL 运行异常 — ' + (e instanceof Error ? e.message : String(e))) })
  .finally(() => {
    const pre = document.createElement('pre')
    pre.id = 'report'
    pre.textContent = lines.join('\n') + `\nPROBE_TOTAL=${total} PROBE_FAIL=${failed}`
    document.body.appendChild(pre)
  })
