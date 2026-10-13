/**
 * 批量导入计划自测（纯逻辑，不碰磁盘、不碰 Zotero）：
 * 匹配优先级、分类合并与「未分类」、标签规则、幂等（重复规划不再新增）、
 * 不覆盖用户正文/标签/附件、citekey 不撞名、文件名冲突避让。
 *
 * 运行：npm run test:zotero-import
 */
import assert from 'node:assert/strict'
import type { Note } from '@/types/note'
import type { ZoteroItem } from '@/lib/zoteroSync'
import { planZoteroImport } from '@/lib/zoteroImport'
import { toMarkdown, assignFileNames, parseNoteMarkdown, planVaultWrite } from '@/lib/vaultFormat'

let passed = 0
const failures: string[] = []

function check(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    console.log(`  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}

const NOW = 1_790_000_000_000

function zItem(partial: Partial<ZoteroItem> = {}): ZoteroItem {
  return {
    zoteroKey: 'AAAA1111',
    itemType: 'journalArticle',
    title: 'Silicon photonics for quantum computing',
    doi: '10.1038/s41566-024-0001',
    year: 2024,
    venue: 'Nature Photonics',
    authors: ['Zhang, San'],
    collectionPaths: [],
    pdfCount: 0,
    availablePdfCount: 0,
    ...partial,
  }
}

function existingNote(partial: Partial<Note> = {}, lit: Partial<Note['literature']> = {}): Note {
  const base: Note = {
    id: 'n1',
    title: 'Silicon photonics for quantum computing',
    type: 'literature',
    grade: '',
    tags: ['我的标签'],
    content: '用户写的正文',
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    literature: {
      authors: [],
      venue: '',
      year: '',
      doi: '',
      citekey: 'zhang2024silicon',
      attachments: ['att-1'],
      collections: [],
      ...lit,
    },
  }
  return { ...base, ...partial }
}

const notesOf = (plan: { notes: Note[] }, id: string) => plan.notes.find((n) => n.id === id)!

console.log('A. 匹配优先级与元数据合并')

check('zoteroKey 优先于 DOI 与标题', () => {
  const note = existingNote({}, { zoteroKey: 'AAAA1111', doi: '10.1/other', collections: ['旧分类'] })
  const plan = planZoteroImport([zItem({ zoteroKey: 'AAAA1111', doi: '10.2/nope', title: '别的标题' })], [note], NOW)
  assert.equal(plan.stats.matchedByKey, 1)
  assert.equal(plan.stats.created, 0)
  const merged = notesOf(plan, 'n1').literature!
  assert.deepEqual(merged.collections, ['旧分类'])
  assert.equal(merged.zoteroKey, 'AAAA1111')
})

check('没有 key 时按 DOI（小写）匹配', () => {
  const note = existingNote({}, { doi: '10.1038/S41566-024-0001' })
  const plan = planZoteroImport([zItem({ doi: '10.1038/S41566-024-0001', title: '标题写的不一样' })], [note], NOW)
  assert.equal(plan.stats.matchedByDoi, 1)
})

check('DOI 也没有时按标题归一化匹配', () => {
  const note = existingNote({}, { doi: '' })
  const plan = planZoteroImport([zItem({ doi: '', title: 'Silicon Photonics: for Quantum Computing!' })], [note], NOW)
  assert.equal(plan.stats.matchedByTitle, 1)
})

check('同题名条目先归并为同一篇：两条 Zotero 条目都映射到同一篇笔记，不再抢注新笔记', () => {
  const note = existingNote({}, { doi: '' })
  const plan = planZoteroImport(
    [zItem({ zoteroKey: 'AAAA1111', doi: '', title: note.title }), zItem({ zoteroKey: 'BBBB2222', doi: '', title: note.title })],
    [note],
    NOW,
  )
  assert.equal(plan.stats.created, 0)
  assert.equal(plan.stats.matched, 2)
  assert.deepEqual([...notesOf(plan, 'n1').literature!.zoteroKeys!].sort(), ['AAAA1111', 'BBBB2222'])
})

check('只匹配 literature 类型：普通笔记同名不会被改', () => {
  const other: Note = { ...existingNote({ id: 'other-1' }), type: 'other', literature: undefined }
  const plan = planZoteroImport([zItem()], [other], NOW)
  assert.equal(plan.stats.matched, 0)
  assert.equal(other.type, 'other')
  assert.equal(other.literature, undefined)
  assert.equal(plan.notes.find((n) => n.id === 'other-1')!.title, other.title)
})

check('匹配时保留正文/标签/附件，只做并集', () => {
  const note = existingNote({ tags: ['我的标签'] }, { attachments: ['att-1'] })
  const plan = planZoteroImport([zItem({ collectionPaths: ['硅光/调制器'], venue: 'Nature Photonics', year: 2024 })], [note], NOW)
  const merged = notesOf(plan, 'n1')
  assert.equal(merged.content, '用户写的正文')
  assert.deepEqual(merged.literature!.attachments, ['att-1'])
  assert.deepEqual(merged.tags, ['我的标签', '方向:硅光', '期刊:Nature Photonics', '年份:2024'])
})

check('已有的非空字段不被 Zotero 覆盖，空缺字段才补上', () => {
  const note = existingNote({}, { venue: '我记的期刊名', year: '', doi: '', authors: [] })
  const plan = planZoteroImport([zItem()], [note], NOW)
  const lit = notesOf(plan, 'n1').literature!
  assert.equal(lit.venue, '我记的期刊名')
  assert.equal(lit.year, 2024)
  assert.equal(lit.doi, '10.1038/s41566-024-0001')
  assert.deepEqual(lit.authors, ['Zhang, San'])
})

console.log('\nB. 分类与「未分类」')

check('Zotero 没有分类 → collections 为空，不写占位（界面动态显示「未分类」）', () => {
  const plan = planZoteroImport([zItem()], [], NOW)
  assert.deepEqual(notesOf(plan, plan.createdIds[0]).literature!.collections, [])
})

check('有真实分类时不再保留「未分类」', () => {
  const note = existingNote({}, { collections: ['未分类'] })
  const plan = planZoteroImport([zItem({ collectionPaths: ['硅光/调制器'] })], [note], NOW)
  assert.deepEqual(notesOf(plan, 'n1').literature!.collections, ['硅光/调制器'])
})

check('无分类不写「方向:未分类」标签，历史占位会被清掉', () => {
  const plan = planZoteroImport([zItem({ collectionPaths: [] })], [], NOW)
  const created = notesOf(plan, plan.createdIds[0])
  assert.ok(!created.tags.includes('方向:未分类'))
  const kept = existingNote({ tags: ['方向:未分类', '我的标签'] })
  const merged = planZoteroImport([zItem({ collectionPaths: ['硅光'] })], [kept], NOW)
  const tags = notesOf(merged, 'n1').tags
  assert.ok(!tags.includes('方向:未分类'))
  assert.ok(tags.includes('我的标签') && tags.includes('方向:硅光'))
})

check('完整层级路径按原样保存', () => {
  const plan = planZoteroImport([zItem({ collectionPaths: ['01_论文库/硅光/调制器'] })], [], NOW)
  assert.deepEqual(notesOf(plan, plan.createdIds[0]).literature!.collections, ['01_论文库/硅光/调制器'])
})

console.log('\nB2. 去重合并后的稳定性（多 key 映射）')

check('Zotero 里的重复条目先归并再匹配：多个 key 只对应一篇笔记', () => {
  const items = [
    zItem({ zoteroKey: 'DUPA0001' }),
    zItem({ zoteroKey: 'DUPB0002' }),
  ]
  const plan = planZoteroImport(items, [], NOW)
  assert.equal(plan.stats.created, 1)
  assert.deepEqual(notesOf(plan, plan.createdIds[0]).literature!.zoteroKeys, ['DUPA0001', 'DUPB0002'])
})

check('去重后只留一个 key 的笔记，再同步按该 key 命中并补齐 zoteroKeys（不会再新建）', () => {
  // 去重脚本旧版本的行为：合并后只剩 keeper 的 zoteroKey，没有 zoteroKeys 列表
  const deduped = existingNote({ id: 'zotero-dupa0001' }, { zoteroKey: 'DUPA0001' })
  assert.equal(deduped.literature!.zoteroKeys, undefined)
  const items = [zItem({ zoteroKey: 'DUPA0001' }), zItem({ zoteroKey: 'DUPB0002' })]
  const plan = planZoteroImport(items, [deduped], NOW)
  assert.equal(plan.stats.created, 0)
  const lit = notesOf(plan, 'zotero-dupa0001').literature!
  assert.equal(lit.zoteroKey, 'DUPA0001')
  assert.deepEqual([...lit.zoteroKeys!].sort(), ['DUPA0001', 'DUPB0002'])
})

check('去重后再同步：正文/附件不动，重复执行不再产生写入', () => {
  const items = [zItem({ zoteroKey: 'DUPA0001' }), zItem({ zoteroKey: 'DUPB0002' })]
  const first = planZoteroImport(items, [], NOW)
  const second = planZoteroImport(items, first.notes, NOW + 1000)
  assert.equal(second.stats.created, 0)
  assert.equal(second.stats.updated, 0)
  assert.deepEqual(second.notes.map((n) => toMarkdown(n)), first.notes.map((n) => toMarkdown(n)))
})

check('md 往返保留 zoteroKeys，去重脚本写出的多 key 能原样读回', () => {
  const plan = planZoteroImport([zItem({ zoteroKey: 'DUPA0001' }), zItem({ zoteroKey: 'DUPB0002' })], [], NOW)
  const note = plan.notes[plan.notes.length - 1]
  const back = parseNoteMarkdown(toMarkdown(note), 'x')
  assert.equal(back.needsRewrite, false)
  assert.deepEqual(back.note.literature!.zoteroKeys, ['DUPA0001', 'DUPB0002'])
})

console.log('\nC. 新建与幂等')

check('新建笔记 id 由 Zotero key 派生、类型为 literature、落「文献/」', () => {
  const plan = planZoteroImport([zItem({ zoteroKey: 'Q4DVYK39' })], [], NOW)
  assert.equal(plan.createdIds[0], 'zotero-q4dvyk39')
  const note = notesOf(plan, 'zotero-q4dvyk39')
  assert.equal(note.type, 'literature')
  assert.equal(note.grade, '')
  assert.equal(note.content, '')
  const names = assignFileNames(plan.notes, null, [])
  assert.ok(names.get('zotero-q4dvyk39')!.startsWith('文献/'))
})

check('citekey 撞名自动加后缀，库内唯一', () => {
  const existing = existingNote({ id: 'other-lit', title: '另一篇论文' }, { citekey: 'zhang2024silicon', doi: '' })
  const plan = planZoteroImport([zItem()], [existing], NOW)
  assert.equal(plan.stats.created, 1)
  const created = notesOf(plan, plan.createdIds[0])
  assert.equal(created.literature!.citekey, 'zhang2024siliconb')
})

check('重复规划不新增重复笔记（幂等：第二次跑全是 unchanged/new-key 更新）', () => {
  const items = [zItem({ zoteroKey: 'AAAA1111' }), zItem({ zoteroKey: 'BBBB2222', title: 'Another paper', doi: '10.2/b', collectionPaths: ['硅光'] })]
  const first = planZoteroImport(items, [], NOW)
  assert.equal(first.stats.created, 2)
  const second = planZoteroImport(items, first.notes, NOW + 60_000)
  assert.equal(second.stats.created, 0)
  assert.equal(second.stats.updated, 0)
  assert.equal(second.stats.unchanged, 2)
  assert.equal(second.notes.length, first.notes.length)
  // 第三次：即使把 id 大小写改了也仍然按 key 命中
  const third = planZoteroImport(items, first.notes.map((n) => ({ ...n, id: n.id.toUpperCase() })), NOW + 120_000)
  assert.equal(third.stats.created, 0)
  assert.equal(third.stats.matchedByKey, 2)
})

check('同一条目重跑但 PDF 状态变了 → 只算更新，不新增', () => {
  const items = [zItem({ zoteroKey: 'AAAA1111', pdfCount: 1, availablePdfCount: 1 })]
  const first = planZoteroImport(items, [], NOW)
  assert.equal(first.stats.created, 1)
  const second = planZoteroImport([zItem({ zoteroKey: 'AAAA1111', pdfCount: 1, availablePdfCount: 0 })], first.notes, NOW + 1000)
  assert.equal(second.stats.created, 0)
  assert.equal(second.stats.updated, 1)
  assert.equal(notesOf(second, 'zotero-aaaa1111').literature!.zoteroAvailablePdfCount, 0)
})

check('标题重复时文件名自动加 -2/-3 后缀，不互相覆盖', () => {
  // DOI 互不相同（同题名但确认是不同的论文，不会被归并成一篇）
  const items = [
    zItem({ zoteroKey: 'AAAA1111', doi: '10.1/a' }),
    zItem({ zoteroKey: 'BBBB2222', doi: '10.1/b' }),
    zItem({ zoteroKey: 'CCCC3333', doi: '10.1/c' }),
  ]
  const plan = planZoteroImport(items, [], NOW)
  assert.equal(plan.stats.created, 3)
  const names = assignFileNames(plan.notes, null, [])
  const files = ['zotero-aaaa1111', 'zotero-bbbb2222', 'zotero-cccc3333'].map((id) => names.get(id)!)
  assert.equal(new Set(files).size, 3)
  assert.equal(files.filter((f) => /-\d\.md$/.test(f)).length, 2)
})

check('新建笔记时避开磁盘上未纳管 md 的文件名', () => {
  const plan = planZoteroImport([zItem()], [], NOW)
  const wanted = assignFileNames(plan.notes, null, [])
  const taken = wanted.get(plan.createdIds[0])!
  const names = assignFileNames(plan.notes, null, [taken])
  assert.notEqual(names.get(plan.createdIds[0]), taken)
})

console.log('\nD. 写盘计划（不删除、不丢原笔记）')

check('planVaultWrite：新建 1367 篇不产生任何删除，原笔记保持字节不变', () => {
  const originals = [existingNote({ id: 'keep-1' }, { doi: '' }), existingNote({ id: 'keep-2', title: '另一篇普通笔记', type: 'other', literature: undefined })]
  const index = originals.map((n) => ({ id: n.id, file: n.type === 'other' ? `Inbox/${n.title}.md` : `文献/${n.title}.md`, title: n.title }))
  const written = new Map(originals.map((n) => [n.id, { file: index.find((e) => e.id === n.id)!.file, text: toMarkdown(n) }]))
  const items = Array.from({ length: 50 }, (_, i) => zItem({ zoteroKey: `KEY${String(i).padStart(5, '0')}`, title: `Paper ${i}`, doi: `10.1/${i}` }))
  const plan = planZoteroImport(items, originals, NOW)
  const write = planVaultWrite(plan.notes, index, index.map((e) => e.file), written, '')
  assert.equal(write.deletes.length, 0)
  assert.equal(write.writes.length, 50)
  assert.ok(write.writes.every((w) => w.file.startsWith('文献/')))
  assert.deepEqual(originals.map((n) => toMarkdown(n)), originals.map((n) => toMarkdown(plan.notes.find((x) => x.id === n.id)!)))
})

check('md 往返后 Zotero 三字段与原对象一致（供下次运行直接命中 key）', () => {
  const plan = planZoteroImport([zItem({ zoteroKey: 'Q4DVYK39', pdfCount: 2, availablePdfCount: 1 })], [], NOW)
  const note = notesOf(plan, 'zotero-q4dvyk39')
  const back = parseNoteMarkdown(toMarkdown(note), 'x')
  assert.equal(back.needsRewrite, false)
  assert.deepEqual(back.note, note)
})

console.log(`\n批量导入计划：${passed}/${passed + failures.length} 通过`)
if (failures.length) {
  console.log(failures.map((f) => '  ✗ ' + f).join('\n'))
  process.exitCode = 1
}
