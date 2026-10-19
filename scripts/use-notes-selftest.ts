/**
 * useNotes 特征测试（重构前的安全网）。
 *
 * 用真实临时 vault（electron/vaultFs.cjs）+ 极简 React 替身（scripts/harness/react-shim.ts）
 * 在纯 Node 里驱动真实的 useNotes()，锁定对外可观测的行为：
 *   1. 首屏只读普通笔记（不读 文献/ 正文）；装载完成前一次写盘都不发生
 *   2. 装载期间的用户编辑在装载完成后落盘：写 1 篇、删除 0、文献一篇不丢
 *   3. 正文读取失败（同步盘离线）→ 中止写盘，原文件一个字都不动
 *   4. 加载期本地与外部同时改动 → 冲突计数 + 暂停写盘；resolve 后恢复
 *   5. debounce：500ms 内不写盘，连续编辑合并成一次
 *   6. 未知字段保留（meta.json 顶层键 / 笔记 front matter 未知字段）
 *   7. 未纳管 md 不读不改不删；删除数恒为 0
 *
 * 运行：npm run test:use-notes
 * 只使用 .tmp-vault-test/use-notes/ 下的测试 vault，绝不触碰真实库。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as vaultFs from '../electron/vaultFs.cjs'
import * as shim from './harness/react-shim'
import type { NotesApi } from '@/hooks/useNotes'
import { useNotes } from '@/hooks/useNotes'
import { buildMeta, relPathFor, toMarkdown } from '@/lib/vaultFormat'
import { emptyLiterature, type Note } from '@/types/note'

const root = process.cwd()
const fixtures = path.resolve(root, '.tmp-vault-test', 'use-notes')

// ---------------------------------------------------------------- 测试环境

const settings = new Map<string, string>()
const storage = {
  getItem: (key: string) => settings.get(key) ?? null,
  setItem: (key: string, value: string) => void settings.set(key, String(value)),
  removeItem: (key: string) => void settings.delete(key),
  clear: () => settings.clear(),
  key: () => null,
  length: 0,
}

const windowShim = {
  location: { search: '' },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  knowledgeGraphDesktop: undefined as unknown,
}

Object.defineProperty(globalThis, 'window', { configurable: true, value: windowShim })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function settle(rounds = 16): Promise<void> {
  for (let i = 0; i < rounds; i++) await tick()
}

async function waitFor(cond: () => boolean, label: string, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (cond()) return
    if (Date.now() > deadline) {
      const api = current?.api
      const reads = current?.reads ?? []
      throw new Error(
        `等待超时：${label}｜loading=${JSON.stringify(api?.vault.loading)} notes=${api?.notes.length} ` +
          `active=${api?.vault.active} error=${api?.vault.error} reads=${reads.length} 次，前几次=${JSON.stringify(reads.slice(0, 6))}`,
      )
    }
    await tick()
  }
}

// ------------------------------------------------------------------ 测试台

interface WriteCall {
  writes: { file: string; text: string }[]
  deletes: string[]
  meta: string | null
}

interface Harness {
  api: NotesApi
  writeCalls: WriteCall[]
  reads: string[][]
  unmount: () => void
}

interface HarnessOptions {
  dir: string
  /** 每次读 md 之前调用（同步），用于在装载过程中的精确时点做断言或制造外部改动 */
  onReadFiles?: (h: Harness, names: string[]) => void | Promise<void>
  /** 返回 Error 表示这次读取失败（同步盘离线 / EACCES） */
  failReadFiles?: (h: Harness, names: string[]) => Error | null
  onListVault?: (h: Harness, dir: string) => void | Promise<void>
}

const live: Harness[] = []
/** 当前测试台：等待超时时用来把真实状态写进失败信息 */
let current: Harness | null = null

function createHarness(options: HarnessOptions): Harness {
  const h = {
    writeCalls: [] as WriteCall[],
    reads: [] as string[][],
    api: null as unknown as NotesApi,
    unmount: () => {},
  }
  const bridge = {
    isElectron: true,
    defaultVaultDir: options.dir,
    listVault: async (dir: string) => {
      await options.onListVault?.(h, dir)
      return vaultFs.listVault(dir)
    },
    readVaultFiles: async (dir: string, names: string[]) => {
      h.reads.push([...names])
      await options.onReadFiles?.(h, names)
      const failure = options.failReadFiles?.(h, names)
      if (failure) throw failure
      return vaultFs.readVaultFiles(dir, names)
    },
    writeVault: async (dir: string, payload: { writes?: WriteCall['writes']; deletes?: string[]; meta?: string | null }) => {
      h.writeCalls.push({ writes: payload.writes ?? [], deletes: payload.deletes ?? [], meta: payload.meta ?? null })
      return vaultFs.writeVault(dir, payload)
    },
  }
  windowShim.knowledgeGraphDesktop = bridge
  const mounted = shim.mount(() => {
    h.api = useNotes()
  })
  h.unmount = mounted.unmount
  live.push(h)
  current = h
  return h
}

// ------------------------------------------------------------------ 夹具

const base = 1_700_000_000_000

function mk(title: string, extra: Partial<Note> = {}): Note {
  const createdAt = extra.createdAt ?? base
  return {
    id: extra.id ?? `id-${title}`,
    title,
    type: extra.type ?? 'person',
    grade: extra.grade ?? '',
    tags: extra.tags ?? ['测试'],
    content: extra.content ?? `正文 ${title}`,
    createdAt,
    updatedAt: extra.updatedAt ?? createdAt,
    ...(extra.literature ? { literature: extra.literature } : {}),
  }
}

function lit(title: string, id: string): Note {
  return mk(title, { id, type: 'literature', grade: '', literature: emptyLiterature() })
}

async function makeVault(
  name: string,
  notes: Note[],
  extras: { metaExtra?: Record<string, unknown>; files?: Record<string, string> } = {},
): Promise<{ dir: string; names: Map<string, string> }> {
  const dir = path.join(fixtures, name)
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  const names = new Map(notes.map((n) => [n.id, relPathFor(n)]))
  for (const note of notes) {
    const rel = names.get(note.id)!
    const abs = path.join(dir, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, extras.files?.[rel] ?? toMarkdown(note), 'utf8')
  }
  const meta = { ...(JSON.parse(buildMeta(notes, names)) as Record<string, unknown>), ...(extras.metaExtra ?? {}) }
  await fs.writeFile(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  return { dir, names }
}

const readText = async (dir: string, rel: string) => fs.readFile(path.join(dir, rel.replace(/\//g, path.sep)), 'utf8')
const readMetaJson = async (dir: string) => JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))

// ------------------------------------------------------------------ 运行器

let passed = 0
const failures: string[] = []

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  settings.clear()
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`${name}: ${message}`)
    console.log(`  ✗ ${name}\n      ${message}`)
  } finally {
    while (live.length) live.pop()!.unmount()
    await settle(2)
  }
}

async function main() {
  await fs.rm(fixtures, { recursive: true, force: true })

  console.log('A. 首屏与装载门禁')
  await test('首屏只读 meta + 普通笔记，不读文献正文；装载完成前一次写盘都没有', async () => {
    const notes = [
      mk('普通一', { id: 'fg-1' }),
      mk('普通二', { id: 'fg-2', type: 'task', grade: '' }),
      ...Array.from({ length: 70 }, (_, i) => lit(`论文 ${i}`, `lit-${i}`)),
    ]
    const { dir } = await makeVault('gate', notes)

    let literatureReads = 0
    const h = createHarness({
      dir,
      onReadFiles: (self, names) => {
        if (names.some((n) => n.startsWith('文献/'))) {
          literatureReads++
          assert.equal(self.writeCalls.length, 0, '装载文献期间不得写盘')
        }
      },
    })

    // mount 是同步的：首屏此刻只应发出一次 meta.json 读取
    assert.equal(h.reads.length, 1, `首屏不应在 meta 之前读别的文件：${JSON.stringify(h.reads)}`)
    assert.deepEqual(h.reads[0], ['meta.json'])

    await waitFor(() => h.reads.length >= 2, '首屏普通笔记读取')
    // 第二次读取 = 普通笔记；第一批里绝不能出现文献
    assert.ok(
      h.reads[1].length > 0 && h.reads[1].every((n) => !n.startsWith('文献/')),
      `首屏读到了文献：${JSON.stringify(h.reads[1])}`,
    )

    await waitFor(() => h.api.vault.loading === null && h.api.hydrated, '装载完成')
    assert.ok(literatureReads > 0, '文献必须在首屏之后另行分批读取')
    assert.equal(h.api.notes.length, 72)
    assert.equal(h.api.vault.active, true)
    assert.equal(h.api.vault.conflicts, 0)
    assert.equal(h.api.vault.error, null)
    assert.equal(h.writeCalls.length, 0, '纯加载不应产生任何写盘')
  })

  await test('装载期间的本地编辑在装载完成后落盘：写 1 篇、删除 0、文献不丢', async () => {
    const notes = [mk('普通一', { id: 'fg-1' }), lit('论文 A', 'lit-a'), lit('论文 B', 'lit-b')]
    const { dir } = await makeVault('edit-during-load', notes)
    const h = createHarness({
      dir,
      // 把文献正文的读取拖慢，让「装载仍在进行中」成为一个确定的时点
      onReadFiles: async (_self, names) => {
        if (names.some((n) => n.startsWith('文献/'))) await sleep(1200)
      },
    })

    await waitFor(() => h.api.vault.loading !== null && h.api.notes.length === 1, '首屏普通笔记已就绪')
    assert.equal(h.writeCalls.length, 0, '装载中不得写盘')
    h.api.updateNote('fg-1', { content: '装载期间编辑' })
    await sleep(700)
    assert.notEqual(h.api.vault.loading, null, '此刻装载必须仍在进行中')
    assert.equal(h.writeCalls.length, 0, '门禁关闭时即使过了 debounce 也不得写盘')

    await waitFor(() => h.api.vault.loading === null && h.api.hydrated, '装载完成')
    await waitFor(() => h.writeCalls.some((call) => call.writes.length > 0), '装载完成后把编辑写盘')
    await settle()

    const call = h.writeCalls[h.writeCalls.length - 1]
    assert.deepEqual(call.deletes, [])
    assert.deepEqual(call.writes.map((w) => w.file), ['人物/普通一.md'])
    assert.ok((await readText(dir, '人物/普通一.md')).includes('装载期间编辑'))
    const listing = await vaultFs.listVault(dir)
    assert.equal(listing.md.length, 3, '文献一篇都不能少')
    assert.equal((await readMetaJson(dir)).notes.length, 3)
  })

  console.log('\nB. 写盘节奏与失败处置')
  await test('debounce：编辑后 300ms 内不写，500ms 后只写一次；连续编辑合并', async () => {
    const notes = [mk('普通一', { id: 'fg-1' })]
    const { dir } = await makeVault('debounce', notes)
    const h = createHarness({ dir })
    await waitFor(() => h.api.hydrated && h.api.vault.active, '装载完成')
    await settle(4)
    assert.equal(h.writeCalls.length, 0)

    h.api.updateNote('fg-1', { content: '第一次改动' })
    await sleep(300)
    assert.equal(h.writeCalls.length, 0, '300ms 时不该写盘（debounce 未到）')
    h.api.updateNote('fg-1', { content: '第二次改动' })
    await sleep(300)
    assert.equal(h.writeCalls.length, 0, '300ms 时不该写盘（编辑把 debounce 又推后了）')
    await sleep(350)
    assert.equal(h.writeCalls.length, 1, 'debounce 到点后只写一次')
    const call = h.writeCalls[0]
    assert.deepEqual(call.deletes, [])
    assert.deepEqual(call.writes.map((w) => w.file), ['人物/普通一.md'])
    assert.ok((await readText(dir, '人物/普通一.md')).includes('第二次改动'))
  })

  await test('正文读取失败（离线）→ 中止写盘：手动 flush / 自动保存都写不进去', async () => {
    const notes = [mk('普通一', { id: 'fg-1' }), lit('论文 A', 'lit-a'), lit('论文 B', 'lit-b')]
    const { dir } = await makeVault('offline', notes)
    const offline = () => Object.assign(new Error('EACCES: 同步盘离线'), { code: 'EACCES' })
    const h = createHarness({
      dir,
      failReadFiles: (_self, names) => (names.some((n) => n.startsWith('文献/')) ? offline() : null),
    })

    await waitFor(() => h.api.vault.error !== null, '装载失败应报错')
    assert.match(h.api.vault.error!, /文献加载失败/)
    assert.equal(h.api.vault.conflicts, 0)

    await h.api.flushVault()
    assert.equal(h.writeCalls.length, 0, '装载失败后手动 flush 也必须被拦住')
    h.api.updateNote('fg-1', { content: '离线期间的编辑' })
    await sleep(900)
    assert.equal(h.writeCalls.length, 0, '装载失败后自动保存也必须被拦住')

    const listing = await vaultFs.listVault(dir)
    assert.equal(listing.md.length, 3, '原文件一篇都不能少')
    assert.ok(!(await readText(dir, '人物/普通一.md')).includes('离线期间的编辑'))
  })

  await test('加载期本地与外部同时改动 → 冲突暂停写盘，resolve(disk) 后恢复', async () => {
    const notes = [mk('普通一', { id: 'fg-1', content: '原始正文' }), lit('论文 A', 'lit-a')]
    const { dir } = await makeVault('conflict', notes)
    const external = toMarkdown({ ...notes[0], content: '磁盘外部改动' })

    let injected = false
    const h = createHarness({
      dir,
      onListVault: async (self) => {
        if (injected) return
        injected = true
        // 首屏扫描与重读正文之间：磁盘被外部改写，同时用户在本地编辑
        await fs.writeFile(path.join(dir, '人物', '普通一.md'), external, 'utf8')
        self.api.updateNote('fg-1', { content: '本地编辑' })
      },
    })

    await waitFor(() => h.api.vault.conflicts === 1, '应进入冲突状态')
    assert.match(h.api.vault.error ?? '', /冲突/)
    assert.equal(h.api.notes.find((n) => n.id === 'fg-1')!.content, '本地编辑', '冲突时保留本地')

    await h.api.flushVault()
    assert.equal(h.writeCalls.length, 0, '冲突期间手动 flush 也必须被拦住')
    h.api.updateNote('fg-1', { content: '冲突期间的编辑' })
    await sleep(900)
    assert.equal(h.writeCalls.length, 0, '冲突期间不得写盘')

    h.api.resolveVaultConflicts('disk')
    assert.equal(h.api.vault.conflicts, 0)
    assert.equal(h.api.vault.loading, null)
    assert.equal(h.api.vault.error, null)
    assert.equal(h.api.notes.find((n) => n.id === 'fg-1')!.content, '磁盘外部改动')

    h.api.updateNote('fg-1', { content: '冲突解决后的编辑' })
    await waitFor(() => h.writeCalls.length > 0, '冲突解决后恢复写盘')
    await settle()
    assert.deepEqual(h.writeCalls[h.writeCalls.length - 1].deletes, [])
    assert.ok((await readText(dir, '人物/普通一.md')).includes('冲突解决后的编辑'))
  })

  console.log('\nC. 未知字段与未纳管文件')
  await test('未知字段保留：meta.json 顶层键与笔记 front matter 都不被覆盖', async () => {
    const note = mk('普通一', { id: 'fg-1', content: '正文' })
    const withUnknown = toMarkdown(note).replace('tags:', 'mood: 高兴\ncustom-field: 保留我\ntags:')
    const { dir } = await makeVault('unknown-fields', [note], {
      files: { '人物/普通一.md': withUnknown },
      metaExtra: { 'x-app': 'other-tool' },
    })
    const h = createHarness({ dir })
    await waitFor(() => h.api.hydrated && h.api.vault.active, '装载完成')
    await settle(4)

    h.api.updateNote('fg-1', { content: '改过的正文' })
    // 等「带新正文的那次写盘」——加载时可能先有一次把未知字段归一化的写盘
    const editedWrites = () => h.writeCalls.filter((call) => call.writes.some((w) => w.text.includes('改过的正文')))
    await waitFor(() => editedWrites().length > 0, '正文应写盘')
    await settle()

    const written = editedWrites().at(-1)!
    assert.deepEqual(written.deletes, [])
    const text = await readText(dir, '人物/普通一.md')
    assert.ok(text.includes('改过的正文'), '正文应更新')
    assert.ok(text.includes('mood: 高兴'), '未知 front matter 字段必须原样带回')
    assert.ok(text.includes('custom-field: 保留我'))

    // 新增一篇让 meta.json 必须重写：未知顶层键仍要保留
    h.api.createNote({ title: '新增的', content: '新' })
    await waitFor(() => h.writeCalls.some((call) => call.meta !== null), 'meta 应重写')
    await settle()
    const metaText = await fs.readFile(path.join(dir, 'meta.json'), 'utf8')
    assert.ok(metaText.includes('"x-app": "other-tool"'), '未知顶层键必须原样带回')
    assert.equal((JSON.parse(metaText) as { notes: unknown[] }).notes.length, 2)
  })

  await test('未纳管 md 不读不改不删；删除纳管笔记时只删它自己的文件', async () => {
    const notes = [mk('普通一', { id: 'fg-1' })]
    const { dir } = await makeVault('unmanaged', notes)
    const stranger = path.join(dir, '别人的笔记.md')
    await fs.writeFile(stranger, '# 别人的\n\n不要动我\n', 'utf8')

    const h = createHarness({ dir })
    await waitFor(() => h.api.vault.unmanaged === 1, '未纳管计数')
    assert.equal(h.api.notes.length, 1, '未纳管 md 不能被当成笔记读进来')
    assert.ok(!h.reads.flat().includes('别人的笔记.md'), '未纳管 md 不该被读')

    h.api.updateNote('fg-1', { content: '改一下' })
    await waitFor(() => h.writeCalls.length > 0, '应写盘')
    await settle()
    assert.equal(h.writeCalls[h.writeCalls.length - 1].deletes.length, 0, '正常写盘删除数为 0')
    assert.equal(await fs.readFile(stranger, 'utf8'), '# 别人的\n\n不要动我\n', '未纳管 md 内容不得被改')

    h.api.deleteNote('fg-1')
    await waitFor(() => h.writeCalls.some((call) => call.deletes.length > 0), '删除应落盘')
    await settle()
    assert.deepEqual(h.writeCalls[h.writeCalls.length - 1].deletes, ['人物/普通一.md'])
    assert.equal(await fs.readFile(stranger, 'utf8'), '# 别人的\n\n不要动我\n')
    assert.ok((await vaultFs.listVault(dir)).md.some((f: { name: string }) => f.name === '别人的笔记.md'))
  })

  await test('索引里登记但磁盘读不到的文件：不写文件、不删文件（删除数 0）', async () => {
    const notes = [mk('在的', { id: 'ok-1' }), mk('丢的', { id: 'missing-1', type: 'task', grade: '' })]
    const { dir, names } = await makeVault('missing-file', notes)
    await fs.rm(path.join(dir, names.get('missing-1')!.replace(/\//g, path.sep)))

    const h = createHarness({ dir })
    await waitFor(() => h.api.hydrated && h.api.vault.active, '装载完成')
    await waitFor(() => h.writeCalls.length > 0 || h.api.notes.length === 1, '装载')
    await settle(6)

    assert.equal(h.api.notes.length, 1, '读不到的笔记不会被假装成空笔记')
    for (const call of h.writeCalls) {
      assert.equal(call.writes.length, 0, '没有变化就不该写 md')
      assert.equal(call.deletes.length, 0, '删除数必须为 0')
    }
    assert.equal(await fs.readFile(path.join(dir, '人物', '在的.md'), 'utf8').then(() => true), true)
  })

  console.log('\nD. 双链、图谱边与批量数据操作')
  await test('标题索引 / wikilink / 图谱边；mergeByTitle 更新与新增', async () => {
    const notes = [
      mk('甲', { id: 'n-a', content: '链接到 [[乙]] 与 [[不存在]]' }),
      mk('乙', { id: 'n-b', type: 'task', grade: '', content: '回链 [[甲]]' }),
      mk('Alpha', { id: 'n-c', type: 'skill', grade: '' }),
    ]
    const { dir } = await makeVault('links', notes)
    const h = createHarness({ dir })
    // hydrated 只表示数据源已定，装载门禁要等文献（这里没有）全部载入后才开
    await waitFor(() => h.api.hydrated && h.api.vault.active && h.api.vault.loading === null, '装载完成')
    await settle(4)

    assert.equal(h.api.notes.length, 3)
    assert.equal(h.api.resolveLink('乙')?.id, 'n-b')
    assert.equal(h.api.resolveLink('alpha')?.id, 'n-c', '标题匹配不区分大小写')
    assert.equal(h.api.resolveLink('不存在'), undefined)
    // 边无向且去重：甲↔乙 只出现一次
    assert.deepEqual(h.api.edges, [{ source: 'n-a', target: 'n-b' }])

    const merged = h.api.mergeByTitle([{ ...mk('乙', { id: 'ignored' }), content: '乙的新正文' }, mk('丙', { id: 'n-d', type: 'skill', grade: '' })])
    assert.deepEqual(merged, { added: 1, updated: 1 })
    assert.equal(h.api.notes.length, 4)
    assert.equal(h.api.notes.find((n) => n.id === 'n-b')!.content, '乙的新正文', '同标题按 id 复用原笔记')
    await waitFor(
      () => h.writeCalls.some((call) => call.writes.some((w) => w.text.includes('乙的新正文'))),
      '合并结果写盘',
    )
    await settle()
  })

  await test('装载完成前禁止整体替换 / 合并全库', async () => {
    const notes = [mk('甲', { id: 'n-a' }), lit('论文 A', 'lit-a')]
    const { dir } = await makeVault('load-guard', notes)
    const h = createHarness({
      dir,
      onReadFiles: async (_self, names) => {
        if (names.some((n) => n.startsWith('文献/'))) await sleep(900)
      },
    })
    await waitFor(() => h.api.vault.loading !== null && h.api.vault.active, '装载中')
    assert.throws(() => h.api.replaceAll([]), /尚未完整加载/)
    assert.throws(() => h.api.mergeByTitle([]), /尚未完整加载/)

    await waitFor(() => h.api.hydrated && h.api.vault.loading === null, '装载完成')
    assert.equal(h.api.replaceAll([mk('新的', { id: 'n-new' })]), 1)
    assert.equal(h.api.notes.length, 1)
    assert.equal(h.api.notes[0].id, 'n-new')
  })

  console.log(`\n结果：${passed} 通过，${failures.length} 失败`)
  if (failures.length) {
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exitCode = 1
  }
  await fs.rm(fixtures, { recursive: true, force: true }).catch(() => {})
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
