/**
 * 启动性能实测：造一个约 2000 篇（1900 文献 + 100 普通笔记）的 vault，
 * 复刻 Electron 启动加载流程并分段计时，再对比「文献懒加载」首屏耗时。
 * 纯 Node、断网可跑。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import * as vaultFs from '../electron/vaultFs.cjs'
import { LITERATURE_BATCH_SIZE, readVaultBatch, splitVaultEntries } from '@/lib/vaultLoad'
import {
  buildMeta,
  parseMeta,
  parseNoteMarkdown,
  relPathFor,
  toMarkdown,
} from '@/lib/vaultFormat'
import type { Note } from '@/types/note'
import { emptyLiterature, uid } from '@/types/note'

const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n)

async function main() {
  const root = path.join(os.tmpdir(), `kg-perf-${Date.now()}`)
  await fs.mkdir(root, { recursive: true })
  const N_LIT = 1900
  const N_NOTE = 100
  const notes: Note[] = []
  const now = Date.now()

  const types: Note['type'][] = ['person', 'task', 'skill', 'question', 'summary', 'other']
  for (let i = 0; i < N_NOTE; i++) {
    notes.push({
      id: uid(),
      title: `普通笔记 ${i}`,
      type: types[i % types.length],
      grade: i % 6 === 0 ? 'phd' : '',
      tags: ['测试'],
      content: `正文内容，可能引用文献。\n\n相关：[[Paper ${i * 5}]]\n`.repeat(3),
      createdAt: now + i,
      updatedAt: now + i,
    })
  }
  for (let i = 0; i < N_LIT; i++) {
    const inMain = i < 1700
    notes.push({
      id: uid(),
      title: `Paper ${i}`,
      type: 'literature',
      grade: '',
      tags: ['论文'],
      content: `Abstract for paper ${i}. `.repeat(40),
      createdAt: now + 1000 + i,
      updatedAt: now + 1000 + i,
      literature: {
        ...emptyLiterature(),
        citekey: `paper${i}`,
        year: 2020 + (i % 6),
        collections: inMain ? ['已发表文章'] : ['其他方向'],
        authors: [`Author, A${i}`],
        venue: 'Journal',
      },
    })
  }

  const names = new Map(notes.map((n) => [n.id, relPathFor(n)]))
  for (const n of notes) {
    const abs = path.join(root, names.get(n.id)!)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, toMarkdown(n), 'utf8')
  }
  await fs.writeFile(path.join(root, 'meta.json'), buildMeta(notes, names), 'utf8')
  console.log(`vault: ${root}（${notes.length} 篇，其中文献 ${N_LIT}）`)

  // ---------------- 当前实现：首屏前全量加载 ----------------
  console.log('\n[当前实现] 启动到首屏（全部在界面出现前完成）')
  const listed: { name: string }[] = []
  let metaText: string | null = null
  const tList = nowMs()
  const walk = async (relDir: string) => {
    const cur = relDir ? path.join(root, relDir) : root
    let entries
    try {
      entries = await fs.readdir(cur, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const rel = relDir ? `${relDir}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') await walk(rel)
        continue
      }
      if (!e.isFile()) continue
      if (!relDir && e.name === 'meta.json') {
        metaText = await fs.readFile(path.join(root, e.name), 'utf8')
        continue
      }
      if (!/\.md$/i.test(e.name)) continue
      await fs.stat(path.join(root, rel)) // listVault 对每个 md 逐个 stat
      listed.push({ name: rel })
    }
  }
  await walk('')
  listed.sort((a, b) => a.name.localeCompare(b.name))
  console.log(`  listVault 递归+逐文件 stat：${nowMs() - tList} ms（${listed.length} md）`)

  const index = parseMeta(metaText!)!
  const diskNames = new Set(listed.map((x) => x.name))
  const wanted = index.notes.filter((e) => diskNames.has(e.file)).map((e) => e.file)

  const tRead = nowMs()
  const texts = new Map<string, string>()
  for (const name of wanted) texts.set(name, await fs.readFile(path.join(root, name), 'utf8')) // 串行读
  console.log(`  readVaultFiles 串行读 ${wanted.length} 个：${nowMs() - tRead} ms`)

  const tParse = nowMs()
  let loaded = 0
  for (const e of index.notes) {
    const text = texts.get(e.file)
    if (text == null) continue
    parseNoteMarkdown(text, path.basename(e.file, '.md'))
    loaded++
  }
  console.log(`  parseNoteMarkdown 串行解析 ${loaded} 个：${nowMs() - tParse} ms`)

  // ---------------- 懒加载：首屏跳过 文献/ 目录 ----------------
  console.log('\n[懒加载] 首屏（meta 索引 + 仅普通笔记，文献延后）')
  const t0 = nowMs()
  const meta2 = parseMeta(await fs.readFile(path.join(root, 'meta.json'), 'utf8'))!
  const normalEntries = meta2.notes.filter((e) => !e.file.startsWith('文献/'))
  const ntexts = new Map<string, string>()
  for (const e of normalEntries) ntexts.set(e.file, await fs.readFile(path.join(root, e.file), 'utf8'))
  for (const e of normalEntries) {
    const t = ntexts.get(e.file)
    if (t != null) parseNoteMarkdown(t, path.basename(e.file, '.md'))
  }
  console.log(`  首屏关键路径（meta + 读/解析 ${normalEntries.length} 普通笔记）：${nowMs() - t0} ms`)

  const tLit = nowMs()
  const litEntries = meta2.notes.filter((e) => e.file.startsWith('文献/'))
  const CONC = 32
  let cursor = 0
  let litLoaded = 0
  const worker = async () => {
    for (;;) {
      const i = cursor++
      if (i >= litEntries.length) return
      const e = litEntries[i]
      const t = await fs.readFile(path.join(root, e.file), 'utf8')
      parseNoteMarkdown(t, path.basename(e.file, '.md'))
      litLoaded++
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker))
  console.log(`  首屏后并发加载文献 ${litLoaded}（并发 ${CONC}）：${nowMs() - tLit} ms`)

  // ---------------- 产品实现回归：直接调用共享加载器与生产 vaultFs ----------------
  console.log('\n[产品改造] 实际调用生产读盘/解析代码（不是模拟方案）')
  const requested: string[] = []
  const read = async (files: string[]) => {
    requested.push(...files)
    const records = await vaultFs.readVaultFiles(root, files)
    return new Map<string, string>(records.filter((record: { text: string | null }) => record.text !== null)
      .map((record: { name: string; text: string }) => [record.name, record.text]))
  }
  const start = nowMs()
  const actualIndex = parseMeta((await read(['meta.json'])).get('meta.json')!)!
  const split = splitVaultEntries(actualIndex.notes)
  const seen = new Set<string>()
  const actual = await readVaultBatch(split.foreground, read, seen)
  const foregroundMs = nowMs() - start
  assert.equal(actual.notes.length, N_NOTE)
  assert.equal(requested.filter((name) => name.startsWith('文献/')).length, 0)
  console.log(`  首屏读取：meta.json + ${actual.notes.length} 普通笔记，0 文献，${foregroundMs} ms`)
  const backgroundStart = nowMs()
  const listing = await vaultFs.listVault(root)
  const scanMs = nowMs() - backgroundStart
  for (let offset = 0; offset < split.literature.length; offset += LITERATURE_BATCH_SIZE) {
    const batch = await readVaultBatch(split.literature.slice(offset, offset + LITERATURE_BATCH_SIZE), read, seen)
    actual.notes.push(...batch.notes)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const backgroundMs = nowMs() - backgroundStart
  assert.equal(actual.notes.length, N_NOTE + N_LIT)
  assert.equal(listing.md.length, N_NOTE + N_LIT)
  const report = {
    measuredAt: new Date().toISOString(), kind: 'synthetic-production-code',
    normalCount: N_NOTE, literatureCount: N_LIT, foregroundReadCount: N_NOTE + 1,
    foregroundLiteratureReadCount: 0, foregroundMs, backgroundScanMs: scanMs, backgroundMs,
    loadedCount: actual.notes.length, concurrency: CONC, batchSize: LITERATURE_BATCH_SIZE,
    limitation: '文件 I/O + 解析耗时，未包含 Electron/浏览器进程启动及 React 渲染；不是实际百度盘 2000 篇冷启动 SLA 证明。',
  }
  await fs.mkdir('.tmp-vault-test', { recursive: true })
  await fs.writeFile('.tmp-vault-test/startup-perf.json', JSON.stringify(report, null, 2), 'utf8')
  console.log(`  首屏后扫描 ${listing.md.length} 文件：${scanMs} ms；分批加载 ${N_LIT} 文献 + 扫描：${backgroundMs} ms`)
  console.log('  完整性断言通过：所有 2000 篇均已载入；结果 .tmp-vault-test/startup-perf.json')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
