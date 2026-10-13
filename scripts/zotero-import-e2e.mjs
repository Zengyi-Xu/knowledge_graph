/**
 * 批量同步脚本端到端测试：造一个合成 Zotero 库 + 合成笔记库，真的跑
 * .tmp-zotero/zotero-vault-sync.cjs（dry-run → apply → 再 apply），验证：
 * 只导入真正书目、写入 文献/ 分区、未纳管文件与原笔记不被改动、备份完整、
 * 删除数为 0、重复执行幂等。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const bundle = path.resolve('.tmp-zotero/zotero-vault-sync.cjs')
assert.ok(fs.existsSync(bundle), '先运行 npm run zotero:build')

let checks = 0
function check(name, ok, detail = '') {
  assert.ok(ok, detail ? `${name} — ${detail}` : name)
  checks++
  console.log('✓ ' + name)
}

const base = path.resolve('.tmp-zotero-e2e')
await fsp.rm(base, { recursive: true, force: true })
await fsp.mkdir(base, { recursive: true })
const root = await fsp.mkdtemp(path.join(base, 'run-'))
const vault = path.join(root, 'vault')
const zoteroDir = path.join(root, 'zotero')
await fsp.mkdir(path.join(vault, '学习'), { recursive: true })
await fsp.mkdir(path.join(vault, 'Inbox'), { recursive: true })
await fsp.mkdir(path.join(vault, '文献'), { recursive: true })
await fsp.mkdir(path.join(zoteroDir, 'storage', 'PDFKEY01'), { recursive: true })
const dbPath = path.join(zoteroDir, 'zotero.sqlite')
await fsp.writeFile(path.join(zoteroDir, 'storage', 'PDFKEY01', '论文.pdf'), '%PDF-1.4 stored')

// ---- 合成 Zotero 库：2 篇真正书目（1 篇有分类+PDF，1 篇未分类）+ 附件/批注/笔记 ----
const db = new Database(dbPath)
db.exec(`
  CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
  CREATE TABLE items (itemID INTEGER PRIMARY KEY, key TEXT, itemTypeID INTEGER);
  CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);
  CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT, parentCollectionID INTEGER);
  CREATE TABLE collectionItems (collectionID INTEGER, itemID INTEGER);
  CREATE TABLE itemData (itemID INTEGER, fieldID INTEGER, valueID INTEGER);
  CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value TEXT);
  CREATE TABLE itemAttachments (itemID INTEGER, parentItemID INTEGER, contentType TEXT, path TEXT, linkMode INTEGER);
  CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, lastName TEXT, firstName TEXT);
  CREATE TABLE itemCreators (itemID INTEGER, creatorID INTEGER, orderIndex INTEGER);
`)
;['journalArticle', 'attachment', 'annotation', 'note'].forEach((name, i) => db.prepare('INSERT INTO itemTypes VALUES (?, ?)').run(i + 1, name))
db.prepare('INSERT INTO items VALUES (1, ?, 1)').run('KLASSIFY') // 有分类 + 有 PDF
db.prepare('INSERT INTO items VALUES (2, ?, 1)').run('LOOSEZZZ') // 未分类、无 PDF
db.prepare('INSERT INTO items VALUES (3, ?, 2)').run('ATTACH99') // 附件（有题名也不该进书目）
db.prepare('INSERT INTO items VALUES (4, ?, 3)').run('ANNOT999') // 批注
db.prepare('INSERT INTO items VALUES (5, ?, 4)').run('NOTES000') // 笔记
db.prepare('INSERT INTO items VALUES (6, ?, 2)').run('PDFKEY01')
db.prepare('INSERT INTO collections VALUES (1, ?, NULL)').run('硅光')
db.prepare('INSERT INTO collections VALUES (2, ?, 1)').run('调制器')
db.prepare('INSERT INTO collectionItems VALUES (2, 1)').run()
db.prepare('INSERT INTO itemAttachments VALUES (6, 1, ?, ?, 1)').run('application/pdf', 'storage:论文.pdf')
const values = [
  [1, 1, 'A classified paper on modulators'], [1, 6, '2024-03-00 2024-03'], [1, 59, '10.1/classified'], [1, 38, 'Nature Photonics'],
  [2, 1, 'An unclassified paper'], [2, 6, '2021'], [2, 38, 'Optics Express'],
  [3, 1, '附件题名'], [4, 1, '批注'], [5, 1, '笔记'],
]
values.forEach(([itemID, fieldID, value], i) => {
  db.prepare('INSERT INTO itemDataValues VALUES (?, ?)').run(i + 1, value)
  db.prepare('INSERT INTO itemData VALUES (?, ?, ?)').run(itemID, fieldID, i + 1)
})
db.prepare('INSERT INTO creators VALUES (1, ?, ?)').run('Zhang', 'San')
db.prepare('INSERT INTO itemCreators VALUES (1, 1, 0)').run()
db.close()

// ---- 合成笔记库：1 篇待匹配的文献笔记（DOI 命中）+ 1 篇普通笔记 + 1 个未纳管 md ----
const existingLit = `---
format: kaust-kg-note
id: "lit-existing"
title: "A classified paper on modulators"
type: literature
authors: []
venue: ""
year: ""
doi: "10.1/classified"
citekey: "zhang2024classified"
attachments: ["att-keep"]
collections: []
tags: ["我的标签"]
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
---

用户自己写的正文，不能丢
`
const plainNote = `---
format: kaust-kg-note
id: "plain-1"
title: "普通笔记"
type: other
tags: []
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
---

正文
`
await fsp.writeFile(path.join(vault, '文献', 'A classified paper on modulators.md'), existingLit)
await fsp.writeFile(path.join(vault, 'Inbox', '普通笔记.md'), plainNote)
await fsp.writeFile(path.join(vault, '学习', '未纳管.md'), '未纳管的文件，脚本不能动它\n')
const meta = JSON.stringify({
  format: 'kaust-kg-vault',
  version: 1,
  notes: [
    { id: 'lit-existing', file: '文献/A classified paper on modulators.md', title: 'A classified paper on modulators' },
    { id: 'plain-1', file: 'Inbox/普通笔记.md', title: '普通笔记' },
  ],
}, null, 2) + '\n'
await fsp.writeFile(path.join(vault, 'meta.json'), meta)

const runScript = (...extra) => {
  const out = execFileSync('node', [bundle, '--vault', vault, '--db', dbPath, ...extra], { encoding: 'utf8' })
  console.log(out.split('\n').filter((l) => l.trim()).slice(0, 6).map((l) => '    ' + l).join('\n'))
  return out
}

try {
  // ---- 1) dry-run：不能改动笔记库 ----
  runScript()
  const mdAfterDry = fs.readdirSync(path.join(vault, '文献')).sort()
  check('dry-run 不新建任何 md', mdAfterDry.length === 1 && mdAfterDry[0] === 'A classified paper on modulators.md', mdAfterDry.join(','))
  check('dry-run 不改 meta.json', await fsp.readFile(path.join(vault, 'meta.json'), 'utf8') === meta)
  const previewDirs = (await fsp.readdir(path.join(vault, '.backups'))).filter((d) => d.startsWith('zotero-preview-'))
  check('dry-run 留下预览报告', previewDirs.length === 1 && fs.existsSync(path.join(vault, '.backups', previewDirs[0], 'report.json')))
  const preview = JSON.parse(await fsp.readFile(path.join(vault, '.backups', previewDirs[0], 'report.json'), 'utf8'))
  check('dry-run 报告只统计真正书目（附件/批注/笔记不算）', preview.counts.zoteroItems === 2, String(preview.counts.zoteroItems))
  check('dry-run 报告：1 篇匹配（DOI）、1 篇新建、0 删除', preview.counts.matchedByDoi === 1 && preview.counts.created === 1 && preview.counts.deletes === 0)

  // ---- 2) apply：写盘 + 备份 ----
  const applyOut = runScript('--apply')
  const files = fs.readdirSync(path.join(vault, '文献')).sort()
  check('新建文献落到 文献/ 分区', files.length === 2 && files.includes('An unclassified paper.md'), files.join(','))
  const newText = await fsp.readFile(path.join(vault, '文献', 'An unclassified paper.md'), 'utf8')
  check('新笔记带「未分类」与 Zotero key 字段', newText.includes('collections: ["未分类"]') && newText.includes('zoteroKey: "LOOSEZZZ"'))
  check('新笔记落「方向:未分类」标签', newText.includes('方向:未分类'))
  check('新笔记的 PDF 状态是 0（本机没有文件）', newText.includes('zoteroAvailablePdfCount: 0'))
  const matched = await fsp.readFile(path.join(vault, '文献', 'A classified paper on modulators.md'), 'utf8')
  check('匹配到的笔记：正文原样保留', matched.includes('用户自己写的正文，不能丢'))
  check('匹配到的笔记：分类写入且不再有「未分类」', matched.includes('collections: ["硅光/调制器"]'))
  check('匹配到的笔记：key/PDF 状态更新', matched.includes('zoteroKey: "KLASSIFY"') && matched.includes('zoteroPdfCount: 1') && matched.includes('zoteroAvailablePdfCount: 1'))
  check('匹配到的笔记：附件与已有标签保留', matched.includes('"att-keep"') && matched.includes('我的标签'))
  check('匹配到的笔记：补上「方向:硅光」「期刊:Nature Photonics」标签', matched.includes('方向:硅光') && matched.includes('期刊:Nature Photonics'))
  const metaAfter = JSON.parse(await fsp.readFile(path.join(vault, 'meta.json'), 'utf8'))
  check('meta.json 三条笔记齐全且路径带分区', metaAfter.notes.length === 3 && metaAfter.notes.every((n) => n.file.includes('/')))
  const litIds = metaAfter.notes.map((n) => n.id)
  check('新文献的 id 稳定为 zotero-<key>', litIds.includes('zotero-loosezzz') && litIds.includes('lit-existing'))
  check('普通笔记与未纳管 md 未被改动', fs.readFileSync(path.join(vault, 'Inbox', '普通笔记.md'), 'utf8') === plainNote && fs.readFileSync(path.join(vault, '学习', '未纳管.md'), 'utf8') === '未纳管的文件，脚本不能动它\n')
  check('apply 输出声明 0 删除', applyOut.includes('删除 0 个'))
  const backupDirs = (await fsp.readdir(path.join(vault, '.backups'))).filter((d) => d.startsWith('zotero-import-'))
  check('apply 建立带时间戳的备份目录', backupDirs.length === 1)
  const backup = path.join(vault, '.backups', backupDirs[0])
  check('备份里含原始 meta.json 与全部原 md', fs.readFileSync(path.join(backup, 'meta.json'), 'utf8') === meta &&
    fs.readFileSync(path.join(backup, '文献', 'A classified paper on modulators.md'), 'utf8') === existingLit &&
    fs.existsSync(path.join(backup, '学习', '未纳管.md')))
  check('备份里带 report.json', fs.existsSync(path.join(backup, 'report.json')))

  // ---- 3) 再 apply 一次：幂等，不应再产生任何写入 ----
  const againOut = runScript('--apply')
  const filesAgain = fs.readdirSync(path.join(vault, '文献')).sort()
  check('重复执行不新增文件', filesAgain.length === 2)
  check('重复执行：新建 0、更新 0、写盘 0、删除 0', againOut.includes('新建：0') && againOut.includes('更新：0') && againOut.includes('写盘：0 个 md') && againOut.includes('删除：0'))
  const dirsAfter = (await fsp.readdir(path.join(vault, '.backups'))).filter((d) => d.startsWith('zotero-import-'))
  check('重复 apply 仍各自备份（不影响幂等判定）', dirsAfter.length === 2)

  // ---- 4) 参数与边界 ----
  let missingDb = ''
  try {
    execFileSync('node', [bundle, '--vault', vault], { encoding: 'utf8', stdio: 'pipe' })
  } catch (error) {
    missingDb = String(error.stdout) + String(error.stderr)
  }
  check('缺 --db 时明确报错', missingDb.includes('缺少 --db'))
  let badVault = ''
  try {
    execFileSync('node', [bundle, '--vault', path.join(root, '不存在'), '--db', dbPath], { encoding: 'utf8', stdio: 'pipe' })
  } catch (error) {
    badVault = String(error.stdout) + String(error.stderr)
  }
  check('笔记库不存在时拒绝执行', badVault.includes('笔记库不存在'))

  console.log(`\n批量同步端到端：${checks}/${checks} 通过`)
} finally {
  await fsp.rm(base, { recursive: true, force: true })
}
