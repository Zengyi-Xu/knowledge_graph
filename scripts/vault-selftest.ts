/**
 * vault 存储自测：纯函数（md 往返 / 文件名分配 / 写盘计划）+ 真实磁盘往返（electron/vaultFs.cjs）。
 *
 * 运行：npm run test:vault
 * （先由 esbuild 把 TS 打成一个 CJS 文件，再用 node 跑；见 package.json 里的脚本）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Note } from '@/types/note'
import {
  META_FILE,
  assignFileNames,
  baseNameOf,
  buildMeta,
  parseMeta,
  parseNoteMarkdown,
  planVaultWrite,
  sanitizeBaseName,
  toMarkdown,
  type VaultIndexEntry,
  type WrittenNote,
} from '@/lib/vaultFormat'
// 真实的主进程实现（.cjs，esbuild 会一并打进产物）
import * as vaultFs from '../electron/vaultFs.cjs'
import * as attachmentFs from '../electron/attachmentFs.cjs'

let passed = 0
const failures: string[] = []

function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++
      console.log(`  ✓ ${name}`)
    })
    .catch((error) => {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
      console.log(`  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
    })
}

function mk(title: string, extra: Partial<Note> = {}): Note {
  const base = 1_700_000_000_000
  const createdAt = extra.createdAt ?? base
  return {
    id: extra.id ?? `id-${title}`,
    title,
    type: extra.type ?? 'person',
    grade: extra.grade ?? 'phd',
    tags: extra.tags ?? ['功能:测试', '材料:GaN'],
    content: extra.content ?? '正文',
    createdAt,
    updatedAt: extra.updatedAt ?? createdAt + 1000,
    ...(extra.literature ? { literature: extra.literature } : {}),
  }
}

function planFor(
  notes: Note[],
  index: VaultIndexEntry[] | null,
  disk: string[],
  written: Map<string, WrittenNote> = new Map(),
  lastMeta = '',
) {
  return planVaultWrite(notes, index, disk, written, lastMeta)
}

async function main() {
  console.log('A. 文件名净化')
  await check('非法字符被替换，路径分隔符不会残留', () => {
    const s = sanitizeBaseName('a/b\\c:d*e?f"g<h>i|j')
    assert.equal(s, 'a_b_c_d_e_f_g_h_i_j')
    assert.ok(!/[\\/:*?"<>|]/.test(s))
  })
  await check('空标题有兜底名', () => {
    assert.equal(sanitizeBaseName('   '), '未命名笔记')
    assert.equal(sanitizeBaseName('...'), '未命名笔记')
  })
  await check('去掉结尾的点与空格（Windows 不允许）', () => {
    assert.equal(sanitizeBaseName('笔记... '), '笔记')
  })
  await check('Windows 保留名被加前缀', () => {
    assert.equal(sanitizeBaseName('CON'), '_CON')
    assert.equal(sanitizeBaseName('com1'), '_com1')
  })
  await check('超长标题被截断到 60 字以内', () => {
    const s = sanitizeBaseName('中'.repeat(200))
    assert.ok([...s].length <= 60, `实际 ${[...s].length}`)
  })
  await check('前导点被替换，不会生成隐藏文件', () => {
    assert.ok(!sanitizeBaseName('.hidden').startsWith('.'))
  })

  console.log('\nB. 文件名分配（冲突 / 改名 / 避让未纳管文件）')
  await check('同标题三篇：第一个拿到干净名字，其余加后缀', () => {
    const notes = [
      mk('张三', { id: 'a', createdAt: 3 }),
      mk('张三', { id: 'b', createdAt: 1 }),
      mk('张三', { id: 'c', createdAt: 2 }),
    ]
    const names = assignFileNames(notes, null, [])
    assert.equal(names.get('b'), '人物/张三.md')
    assert.equal(names.get('c'), '人物/张三-2.md')
    assert.equal(names.get('a'), '人物/张三-3.md')
  })
  await check('避让目录里未纳管的同名 md', () => {
    const notes = [mk('李四', { id: 'x' })]
    const names = assignFileNames(notes, null, ['人物/李四.md'])
    assert.equal(names.get('x'), '人物/李四-2.md')
  })
  await check('标题未变时保留现名（尊重用户手动改名）', () => {
    const notes = [mk('王五', { id: 'w' })]
    const index: VaultIndexEntry[] = [{ id: 'w', file: '人物/我自己改的名字.md', title: '王五' }]
    const names = assignFileNames(notes, index, ['人物/我自己改的名字.md'])
    assert.equal(names.get('w'), '人物/我自己改的名字.md')
  })
  await check('标题变了就改文件名', () => {
    const notes = [mk('王五（新）', { id: 'w' })]
    const index: VaultIndexEntry[] = [{ id: 'w', file: '人物/王五.md', title: '王五' }]
    const names = assignFileNames(notes, index, ['人物/王五.md'])
    assert.equal(names.get('w'), '人物/王五（新）.md')
  })
  await check('老 vault 的旧人物目录不会被迫搬家', () => {
    // 旧版人物笔记放在 「KAUST团队/」；标题没变时应保留原文件，
    // 只有新建/改名的笔记才会落到新的「人物/」目录。
    const notes = [mk('赵六', { id: 'z' })]
    const index: VaultIndexEntry[] = [{ id: 'z', file: 'KAUST团队/赵六.md', title: '赵六' }]
    const names = assignFileNames(notes, index, ['KAUST团队/赵六.md'])
    assert.equal(names.get('z'), 'KAUST团队/赵六.md')
  })
  await check('改类型 = 换文件夹（文件跟着类型走）', () => {
    const notes = [mk('乙', { id: 'n2', type: 'task', grade: '' })]
    const index: VaultIndexEntry[] = [{ id: 'n2', file: '技能/乙.md', title: '乙' }]
    const names = assignFileNames(notes, index, ['技能/乙.md'])
    assert.equal(names.get('n2'), '项目/乙.md')
  })
  await check('两篇互换标题不会撞名', () => {
    const notes = [mk('B', { id: 'n1', createdAt: 1 }), mk('A', { id: 'n2', createdAt: 2 })]
    const index: VaultIndexEntry[] = [
      { id: 'n1', file: '人物/A.md', title: 'A' },
      { id: 'n2', file: '人物/B.md', title: 'B' },
    ]
    const names = assignFileNames(notes, index, ['人物/A.md', '人物/B.md'])
    assert.equal(new Set([...names.values()]).size, 2)
  })

  console.log('\nC. md 往返（frontmatter + 正文）')
  const tricky = mk('带"引号"与:冒号/: 的标题', {
    id: 'tricky-1',
    type: 'task',
    grade: '',
    tags: ['功能:测试', '含,逗号', '含"引号"'],
    content: '第一段\n\n---\n\n正文里有分隔线\n\n```\ncode\n```\n\n结尾没有换行',
    createdAt: 1_700_000_000_123,
    updatedAt: 1_700_000_999_999,
  })
  await check('复杂标题/标签/正文往返一致', () => {
    const text = toMarkdown(tricky)
    const back = parseNoteMarkdown(text, '兜底名')
    assert.equal(back.needsRewrite, false)
    assert.deepEqual(back.note, tricky)
  })
  await check('正文为空时也能往返', () => {
    const n = mk('空笔记', { content: '' })
    assert.deepEqual(parseNoteMarkdown(toMarkdown(n), 'x').note, n)
  })
  await check('时间戳精确到毫秒', () => {
    const n = mk('时间', { createdAt: 1_699_999_999_001, updatedAt: 1_700_000_000_999 })
    const back = parseNoteMarkdown(toMarkdown(n), 'x').note
    assert.equal(back.createdAt, n.createdAt)
    assert.equal(back.updatedAt, n.updatedAt)
  })
  await check('没有 frontmatter 的外来 md：用文件名作标题并标记待规范化', () => {
    const back = parseNoteMarkdown('# 手写的笔记\n\n正文', '手写的笔记')
    assert.equal(back.needsRewrite, true)
    assert.equal(back.note.title, '手写的笔记')
    assert.equal(back.note.type, 'other')
    assert.equal(back.note.content, '# 手写的笔记\n\n正文')
  })
  await check('兼容 Obsidian 的块状标签列表', () => {
    const text = ['---', 'title: "笔记"', 'tags:', '  - alpha', '  - beta', '---', '', 'body'].join('\n')
    const back = parseNoteMarkdown(text, 'x')
    assert.deepEqual(back.note.tags, ['alpha', 'beta'])
  })
  await check('缺 id / 时间的 md 会被标记待规范化', () => {
    const text = ['---', 'title: "手改的"', 'type: skill', '---', '', 'body'].join('\n')
    const back = parseNoteMarkdown(text, 'x')
    assert.equal(back.needsRewrite, true)
    assert.ok(back.note.id.length > 0)
    assert.equal(back.note.type, 'skill')
  })

  console.log('\nD. 写盘计划（增量）')
  const list = [mk('甲', { id: 'n1', createdAt: 1 }), mk('乙', { id: 'n2', createdAt: 2 })]
  const metaOf = (notes: Note[], index: VaultIndexEntry[] | null, disk: string[]) => {
    const names = assignFileNames(notes, index, disk)
    return buildMeta(notes, names)
  }
  await check('首次写盘：全部写、meta 生成、无删除', () => {
    const plan = planFor(list, null, [])
    assert.equal(plan.writes.length, 2)
    assert.equal(plan.deletes.length, 0)
    assert.equal(plan.metaSkipped, false)
    assert.equal(parseMeta(plan.meta)?.notes.length, 2)
  })
  await check('无改动：不写任何文件，meta 跳过', () => {
    const index: VaultIndexEntry[] = [
      { id: 'n1', file: '人物/甲.md', title: '甲' },
      { id: 'n2', file: '人物/乙.md', title: '乙' },
    ]
    const written = new Map<string, WrittenNote>([
      ['n1', { file: '人物/甲.md', text: toMarkdown(list[0]) }],
      ['n2', { file: '人物/乙.md', text: toMarkdown(list[1]) }],
    ])
    const meta = metaOf(list, index, ['人物/甲.md', '人物/乙.md'])
    const plan = planFor(list, index, ['人物/甲.md', '人物/乙.md'], written, meta)
    assert.equal(plan.writes.length, 0)
    assert.equal(plan.deletes.length, 0)
    assert.equal(plan.metaSkipped, true)
  })
  await check('只改一篇：只写那一篇', () => {
    const index: VaultIndexEntry[] = [
      { id: 'n1', file: '人物/甲.md', title: '甲' },
      { id: 'n2', file: '人物/乙.md', title: '乙' },
    ]
    const edited = [{ ...list[0], content: '改了' }, list[1]]
    const written = new Map<string, WrittenNote>([
      ['n1', { file: '人物/甲.md', text: toMarkdown(list[0]) }],
      ['n2', { file: '人物/乙.md', text: toMarkdown(list[1]) }],
    ])
    const plan = planFor(
      edited,
      index,
      ['人物/甲.md', '人物/乙.md'],
      written,
      metaOf(list, index, ['人物/甲.md', '人物/乙.md']),
    )
    assert.deepEqual(plan.writes.map((w) => w.file), ['人物/甲.md'])
  })
  await check('删一篇：只删对应文件', () => {
    const index: VaultIndexEntry[] = [
      { id: 'n1', file: '人物/甲.md', title: '甲' },
      { id: 'n2', file: '人物/乙.md', title: '乙' },
    ]
    const written = new Map<string, WrittenNote>([
      ['n1', { file: '人物/甲.md', text: toMarkdown(list[0]) }],
    ])
    const plan = planFor([list[0]], index, ['人物/甲.md', '人物/乙.md'], written, '')
    assert.deepEqual(plan.deletes, ['人物/乙.md'])
  })
  await check('目录里未纳管的 md 永远不会被删', () => {
    const index: VaultIndexEntry[] = [{ id: 'n1', file: '人物/甲.md', title: '甲' }]
    const plan = planFor([], index, ['人物/甲.md', '别人的笔记.md'], new Map(), '')
    assert.deepEqual(plan.deletes, ['人物/甲.md'])
  })
  await check('改标题：写新文件 + 删旧文件', () => {
    const index: VaultIndexEntry[] = [{ id: 'n1', file: '人物/甲.md', title: '甲' }]
    const renamed = [mk('甲（改）', { id: 'n1' })]
    const written = new Map<string, WrittenNote>([
      ['n1', { file: '人物/甲.md', text: toMarkdown(list[0]) }],
    ])
    const plan = planFor(renamed, index, ['人物/甲.md'], written, '')
    assert.deepEqual(plan.writes.map((w) => w.file), ['人物/甲（改）.md'])
    assert.deepEqual(plan.deletes, ['人物/甲.md'])
  })

  console.log('\nD2. 文献类型（literature）')
  const litNote = mk('Silicon photonics', {
    id: 'lit-1',
    type: 'literature',
    grade: '',
    tags: ['方向:硅光'],
    content: '文献笔记正文',
    literature: {
      authors: ['Zhang, San', 'Li, Si'],
      venue: 'Nature Photonics',
      year: 2024,
      doi: '10.1038/s41566-024-xxxx',
      citekey: 'zhang2024silicon',
      attachments: ['abc123'],
    },
  })
  await check('文献六字段 md 往返全部还原', () => {
    const back = parseNoteMarkdown(toMarkdown(litNote), 'x')
    assert.equal(back.needsRewrite, false)
    assert.deepEqual(back.note, litNote)
  })
  await check('文献空值字段也稳定写出并还原', () => {
    const empty: Note = {
      ...litNote,
      id: 'lit-2',
      literature: { authors: [], venue: '', year: '', doi: '', citekey: '', attachments: [] },
    }
    const text = toMarkdown(empty)
    assert.ok(text.includes('authors: []'))
    assert.ok(text.includes('venue: ""'))
    assert.ok(text.includes('year: ""'))
    assert.deepEqual(parseNoteMarkdown(text, 'x').note, empty)
  })
  await check('旧格式 md（无文献字段）解析后 literature 为 undefined', () => {
    const old = mk('老笔记', { id: 'old-1', type: 'other', grade: '' })
    const back = parseNoteMarkdown(toMarkdown(old), 'x')
    assert.equal(back.note.literature, undefined)
  })
  await check('非 literature 类型即使带文献字段也不挂 literature', () => {
    const text = toMarkdown(litNote).replace('type: literature', 'type: other')
    const back = parseNoteMarkdown(text, 'x')
    assert.equal(back.note.type, 'other')
    assert.equal(back.note.literature, undefined)
  })
  await check('literature 笔记落「文献/」文件夹', () => {
    const names = assignFileNames([litNote], null, [])
    assert.equal(names.get('lit-1'), '文献/Silicon photonics.md')
  })
  await check('citekey 生成与撞名追加 b/c/d', async () => {
    const { makeCitekey } = await import('@/lib/citekey')
    const lit = { authors: ['Zhang, San'], year: 2024 as number | '' }
    assert.equal(makeCitekey(lit, 'Silicon photonics for quantum', new Set()), 'zhang2024silicon')
    // 无逗号作者：整个首词作为姓
    assert.equal(makeCitekey({ authors: ['Zhang San'], year: 2024 }, 'Silicon', new Set()), 'zhang2024silicon')
    assert.equal(makeCitekey(lit, 'Silicon', new Set(['zhang2024silicon'])), 'zhang2024siliconb')
    assert.equal(makeCitekey(lit, 'Silicon', new Set(['zhang2024silicon', 'zhang2024siliconb'])), 'zhang2024siliconc')
  })

  console.log('\nE. 真实磁盘往返（electron/vaultFs.cjs）')
  const dir = path.resolve(process.cwd(), '.tmp-vault-test', 'data')
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })

  const notes = [
    mk('甲 人物', { id: 'p1', createdAt: 1, content: '关联 [[乙 项目]]' }),
    mk('乙 项目', { id: 'p2', createdAt: 2, type: 'task', grade: '', tags: ['项目'] }),
    mk('带/斜杠:和*星号的 标题', { id: 'p3', createdAt: 3, type: 'skill', content: 'x' }),
  ]

  await check('写入 vault（全量）', async () => {
    const plan = planFor(notes, null, [])
    const result = (await vaultFs.writeVault(dir, {
      writes: plan.writes.map((w) => ({ file: w.file, text: w.text })),
      deletes: plan.deletes,
      meta: plan.meta,
    })) as { written: number }
    assert.equal(result.written, 3)
    const listing = await vaultFs.listVault(dir)
    assert.equal(listing.exists, true)
    assert.equal(listing.md.length, 3)
    assert.ok(listing.meta && listing.meta.includes('kaust-kg-vault'))
  })

  await check('读回来解析后与内存完全一致', async () => {
    const listing = await vaultFs.listVault(dir)
    const index = parseMeta(listing.meta)
    assert.ok(index)
    const texts = await vaultFs.readVaultFiles(dir, index.notes.map((e) => e.file))
    const back = texts.map((t: { name: string; text: string | null }) =>
      parseNoteMarkdown(t.text as string, baseNameOf(t.name)).note,
    )
    const order = new Map(notes.map((n) => [n.id, n]))
    for (const n of back) assert.deepEqual(n, order.get(n.id))
  })

  await check('增量：只改一篇时只有那一篇的 mtime 变化', async () => {
    const listing1 = await vaultFs.listVault(dir)
    const index = parseMeta(listing1.meta) as { notes: VaultIndexEntry[] }
    const written = new Map<string, WrittenNote>()
    for (const e of index.notes) {
      const t = await vaultFs.readVaultFiles(dir, [e.file])
      written.set(e.id, { file: e.file, text: t[0].text as string })
    }
    const edited = notes.map((n) => (n.id === 'p2' ? { ...n, content: '改过的正文', updatedAt: n.updatedAt + 5 } : n))
    const plan = planFor(edited, index.notes, listing1.md.map((f: { name: string }) => f.name), written, listing1.meta as string)
    assert.equal(plan.writes.length, 1)
    await vaultFs.writeVault(dir, {
      writes: plan.writes.map((w) => ({ file: w.file, text: w.text })),
      deletes: plan.deletes,
      meta: plan.metaSkipped ? null : plan.meta,
    })
    const listing2 = await vaultFs.listVault(dir)
    const changed = listing2.md.filter((f: { name: string; mtimeMs: number }) => {
      const before = listing1.md.find((x: { name: string }) => x.name === f.name)
      return before && before.mtimeMs !== f.mtimeMs
    })
    assert.deepEqual(changed.map((f: { name: string }) => f.name), ['项目/乙 项目.md'])
  })

  await check('外部改动 / 外部删除 / 外部新增都能被观察到', async () => {
    // 外部（模拟 Obsidian）改一篇
    const current = await vaultFs.listVault(dir)
    const target = current.md.find((f: { name: string }) => f.name === '人物/甲 人物.md')
    assert.ok(target)
    const text = (await vaultFs.readVaultFiles(dir, ['人物/甲 人物.md']))[0].text as string
    await fs.writeFile(
      path.join(dir, '人物', '甲 人物.md'),
      text.replace('title: "甲 人物"', 'title: "甲 人物（外部改）"'),
      'utf8',
    )
    // 外部删一篇
    await fs.rm(path.join(dir, '技能', '带_斜杠_和_星号的 标题.md'))
    // 外部新增一个不属于本应用的 md
    await fs.writeFile(path.join(dir, '别人的笔记.md'), '# 别人的\n', 'utf8')

    const listing = await vaultFs.listVault(dir)
    const index = parseMeta(listing.meta) as { notes: VaultIndexEntry[] }
    const owned = new Set(index.notes.map((e) => e.file))
    const byName = new Map(listing.md.map((f: { name: string; mtimeMs: number }) => [f.name, f]))
    const changed = listing.md.filter((f: { name: string; mtimeMs: number }) => {
      const before = current.md.find((x: { name: string; mtimeMs: number }) => x.name === f.name)
      return !before || before.mtimeMs !== f.mtimeMs || before.size !== f.size
    })
    assert.ok(
      changed.some((f: { name: string }) => f.name === '人物/甲 人物.md'),
      '改动的文件未被识别',
    )
    assert.ok(!byName.has('技能/带_斜杠_和_星号的 标题.md'), '被删除的文件仍存在')
    assert.equal(listing.md.filter((f: { name: string }) => !owned.has(f.name)).length, 1, '未纳管文件计数不对')
    const edited = parseNoteMarkdown(
      (await vaultFs.readVaultFiles(dir, ['人物/甲 人物.md']))[0].text as string,
      '甲 人物',
    ).note
    assert.equal(edited.title, '甲 人物（外部改）')
  })

  await check('写完不留临时文件、meta 可单独跳过', async () => {
    const leftovers: string[] = []
    const walk = async (rel: string) => {
      const entries = await fs.readdir(rel ? path.join(dir, rel) : dir, { withFileTypes: true })
      for (const e of entries) {
        const child = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) await walk(child)
        else if (e.name.startsWith('.kg-tmp-')) leftovers.push(child)
      }
    }
    await walk('')
    assert.deepEqual(leftovers, [])
    const before = (await vaultFs.listVault(dir)).meta as string
    await vaultFs.writeVault(dir, { writes: [], deletes: [], meta: null })
    assert.equal((await vaultFs.listVault(dir)).meta, before)
  })

  await check('拒绝越界文件名（写入与删除都不能逃出 vault 目录）', async () => {
    await assert.rejects(() => vaultFs.writeVault(dir, { writes: [{ file: '../evil.md', text: 'x' }], deletes: [], meta: null }))
    await assert.rejects(() => vaultFs.writeVault(dir, { writes: [], deletes: ['..\\evil.md'], meta: null }))
    await assert.rejects(() => vaultFs.readVaultFiles(dir, ['../evil.md']))
  })

  await check('目录不存在时 listVault 返回 exists:false（交给上层回退）', async () => {
    const listing = await vaultFs.listVault(path.join(dir, '不存在的子目录'))
    assert.equal(listing.exists, false)
    assert.equal(listing.meta, null)
    assert.deepEqual(listing.md, [])
  })

  await check('meta.json 文件名固定，且不会被当成笔记', async () => {
    const listing = await vaultFs.listVault(dir)
    assert.ok(listing.md.every((f: { name: string }) => f.name !== META_FILE))
  })

  await fs.rm(path.resolve(process.cwd(), '.tmp-vault-test'), { recursive: true, force: true })

  console.log('\nF. 附件（attachments/ 一层文件名白名单）')
  const attDir = path.resolve(process.cwd(), '.tmp-vault-test', 'att')
  await fs.rm(attDir, { recursive: true, force: true })
  await fs.mkdir(attDir, { recursive: true })

  await check('附件路径越界全部被拒（../ 、二层目录、绝对路径）', async () => {
    const bad = ['attachments/../../x.pdf', 'attachments/a/b.pdf', '/abs/path.pdf', 'C:\\evil.pdf', 'attachments/../secret.pdf', 'notes/x.md']
    for (const rel of bad) {
      await assert.rejects(() => attachmentFs.write(attDir, rel, Buffer.from('x')), null, `write 应拒绝 ${rel}`)
      await assert.rejects(() => attachmentFs.read(attDir, rel), null, `read 应拒绝 ${rel}`)
      await assert.rejects(() => attachmentFs.remove(attDir, rel), null, `remove 应拒绝 ${rel}`)
    }
  })
  await check('原子写后读回一致；list 可见', async () => {
    const payload = Buffer.from('%PDF-1.4 fake')
    await attachmentFs.write(attDir, 'attachments/abc.pdf', payload)
    const back = await attachmentFs.read(attDir, 'attachments/abc.pdf')
    assert.deepEqual(back, payload)
    const files = await attachmentFs.list(attDir)
    assert.ok(files.some((f) => f.name === 'attachments/abc.pdf' && f.size === payload.length))
  })
  await check('annotations JSON 可写读；目录不存在时 list 返回空', async () => {
    await attachmentFs.write(attDir, 'attachments/abc.annotations.json', Buffer.from('{"format":"kaust-kg-pdf-annotations"}'))
    const text = (await attachmentFs.read(attDir, 'attachments/abc.annotations.json'))?.toString('utf8')
    assert.ok(text?.includes('kaust-kg-pdf-annotations'))
    assert.deepEqual(await attachmentFs.list(path.join(attDir, '不存在')), [])
  })
  await check('删除附件：PDF 与标注级联删除，且不留临时文件', async () => {
    await attachmentFs.remove(attDir, 'attachments/abc.pdf')
    await attachmentFs.remove(attDir, 'attachments/abc.annotations.json')
    assert.equal(await attachmentFs.read(attDir, 'attachments/abc.pdf'), null)
    const leftovers: string[] = []
    const walk = async (rel: string) => {
      const entries = await fs.readdir(rel ? path.join(attDir, rel) : attDir, { withFileTypes: true })
      for (const e of entries) {
        const child = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) await walk(child)
        else if (e.name.startsWith('.kg-tmp-')) leftovers.push(child)
      }
    }
    await walk('')
    assert.deepEqual(leftovers, [])
    assert.deepEqual(await attachmentFs.list(attDir), [])
  })
  await fs.rm(attDir, { recursive: true, force: true })

  console.log('\nG. 标注锚定（pdfAnchor 纯函数）')
  const { buildAnchor, locateAnchor } = await import('@/lib/pdfAnchor')
  const pageText = '物理学是一门研究物质与能量的学科。量子计算利用叠加与纠缠特性。硅光集成是热点。'
  const start = pageText.indexOf('量子计算')
  const end = start + '量子计算'.length
  const anchor = buildAnchor(pageText, start, end)
  await check('buildAnchor 取 exact 与前后文（各 ≤40 字）', () => {
    assert.equal(anchor.exact, '量子计算')
    assert.equal(anchor.prefix, '物理学是一门研究物质与能量的学科。')
    assert.equal(anchor.suffix, '利用叠加与纠缠特性。硅光集成是热点。')
  })
  await check('exact 命中', () => {
    const m = locateAnchor(pageText, anchor)
    assert.deepEqual(m, { status: 'exact', index: start, length: 4 })
  })
  await check('原文被改写后 prefix+suffix 模糊找回', () => {
    // “量子计算”被插字改成“量子科技计算”：exact 不再命中，但前后文仍在
    const changed = pageText.replace('量子计算', '量子科技计算')
    const direct = locateAnchor(changed, anchor)
    assert.equal(direct.status, 'fuzzy')
    assert.equal(direct.index, anchor.prefix.length)
    assert.equal(direct.length, 6) // 前缀尾到后缀头 = “量子科技计算”
  })
  await check('找不到时标记 missing，不丢数据', () => {
    const m = locateAnchor('完全不相干的一页文字内容。', anchor)
    assert.deepEqual(m, { status: 'missing', index: -1, length: 0 })
  })

  console.log(`\n结果：${passed} 通过，${failures.length} 失败`)
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
