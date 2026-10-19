/**
 * 侧栏（NoteList）自测：只列非文献笔记，文献一概不进侧栏（条目与分类树都不画）。
 *
 * 用内存 fixture SSR 渲染真实组件：不读真实 vault、不碰网络。
 * 跑法：npm run test:note-list（esbuild 打包 + node，无浏览器）
 */
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { NoteList } from '@/components/NoteList'
import type { Note } from '@/types/note'

/** 折叠状态从 localStorage 读（按环境加 kg- / kg-dev- 前缀），给个空实现避免依赖运行环境 */
function installStorage(): void {
  const store = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  }
}

const lit = (id: string, title: string, collections: string[]): Note => ({
  id,
  title,
  type: 'literature',
  grade: '',
  tags: [],
  content: '',
  createdAt: 0,
  updatedAt: 0,
  literature: { authors: [], venue: '', year: '', doi: '', citekey: '', attachments: [], collections },
})

const notes: Note[] = [
  { id: 'p1', title: '人物笔记甲', type: 'person', grade: 'phd', tags: ['标签X'], content: '', createdAt: 0, updatedAt: 0 },
  { id: 'k1', title: '技能笔记甲', type: 'skill', grade: '', tags: [], content: '', createdAt: 0, updatedAt: 0 },
  lit('l1', '论文标题甲', ['01_论文库/Laser/Coherent/激光与相干']),
  lit('l2', '论文标题乙', ['01_论文库/Laser']),
  lit('l3', '未分类论文丙', []),
]

function render(): { html: string; text: string } {
  installStorage()
  const html = renderToStaticMarkup(
    <NoteList notes={notes} activeId={null} onSelect={() => {}} onCreate={() => {}} />,
  )
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') }
}

const checks: [string, () => void][] = []
const check = (name: string, fn: () => void) => checks.push([name, fn])

check('侧栏没有「文献」分组', () => {
  const { text } = render()
  assert.ok(!text.includes('文献'), text)
})

check('侧栏没有文献分类树（一级、二级都不画）', () => {
  const { text } = render()
  assert.ok(!text.includes('01_论文库'), text)
  assert.ok(!text.includes('Laser'), text)
  assert.ok(!text.includes('未分类'), text)
})

check('文献条目一概不渲染（已分类、未分类都一样）', () => {
  const { text } = render()
  assert.ok(!text.includes('论文标题甲'), text)
  assert.ok(!text.includes('论文标题乙'), text)
  assert.ok(!text.includes('未分类论文丙'), text)
})

check('非文献笔记照旧渲染（分组头 + 条目 + 标签）', () => {
  const { text } = render()
  assert.ok(text.includes('人物 (1)'), text)
  assert.ok(text.includes('技能 (1)'), text)
  assert.ok(text.includes('人物笔记甲'), text)
  assert.ok(text.includes('技能笔记甲'), text)
  assert.ok(text.includes('#标签X'), text)
})

check('不再有「含文献条目」开关（文献不进侧栏，无需开关）', () => {
  const { html } = render()
  assert.ok(!html.includes('含文献条目'), html)
})

let passed = 0
for (const [name, fn] of checks) {
  try {
    fn()
    passed++
    console.log(`✓ ${name}`)
  } catch (error) {
    console.log(`✗ ${name}`)
    console.log(`    ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
console.log(`\n侧栏自测：通过 ${passed} 项，失败 ${checks.length - passed} 项`)
