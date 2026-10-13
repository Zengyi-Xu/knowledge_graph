/**
 * zoteroFs 单测：用 better-sqlite3 造一个「形状与 Zotero 相同」的只读库，
 * 验证排除附件/批注/笔记、字符串 key、storage: 路径解析、可用 PDF 计数与错误信息。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { readZotero, resolveZoteroPdf, resolveAttachmentPath } = require('../electron/zoteroFs.cjs')

let checks = 0
function check(name, ok, detail = '') {
  assert.ok(ok, detail ? `${name} — ${detail}` : name)
  checks++
  console.log('✓ ' + name)
}

const base = path.resolve('.tmp-zotero-test')
await fsp.rm(base, { recursive: true, force: true })
await fsp.mkdir(base, { recursive: true })
const dir = await fsp.mkdtemp(path.join(base, 'run-'))
const dbPath = path.join(dir, 'zotero.sqlite')
const storage = path.join(dir, 'storage')
const linkedPdf = path.join(dir, 'linked', '外部论文.pdf')
await fsp.mkdir(storage, { recursive: true })
await fsp.mkdir(path.dirname(linkedPdf), { recursive: true })
await fsp.writeFile(linkedPdf, '%PDF-1.4 linked')

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
const types = ['journalArticle', 'conferencePaper', 'webpage', 'attachment', 'annotation', 'note']
types.forEach((name, i) => db.prepare('INSERT INTO itemTypes VALUES (?, ?)').run(i + 1, name))
db.prepare('INSERT INTO items VALUES (1, ?, 1)').run('AAAA1111') // journalArticle，2 个 PDF（1 个在、1 个缺失）
db.prepare('INSERT INTO items VALUES (2, ?, 2)').run('BBBB2222') // conferencePaper，绝对路径 PDF
db.prepare('INSERT INTO items VALUES (3, ?, 3)').run('CCCC3333') // webpage
db.prepare('INSERT INTO items VALUES (10, ?, 4)').run('DDDD4444') // attachment（有题名也要排除）
db.prepare('INSERT INTO items VALUES (11, ?, 5)').run('EEEE5555') // annotation
db.prepare('INSERT INTO items VALUES (12, ?, 6)').run('FFFF6666') // note
db.prepare('INSERT INTO items VALUES (13, ?, 1)').run('GGGG7777') // 已删除
db.prepare('INSERT INTO items VALUES (14, ?, 1)').run('HHHH8888') // 没有题名 → 排除
for (const [id, key, filename] of [[20, 'STORED01', '论文.pdf'], [21, 'STORED02', '缺失.pdf']]) {
  db.prepare('INSERT INTO items VALUES (?, ?, 4)').run(id, key)
  if (id === 20) await fsp.mkdir(path.join(storage, key), { recursive: true })
  if (id === 20) await fsp.writeFile(path.join(storage, key, filename), '%PDF-1.4 stored')
}
db.prepare('INSERT INTO itemAttachments VALUES (20, 1, ?, ?, 1)').run('application/pdf', 'storage:论文.pdf')
db.prepare('INSERT INTO itemAttachments VALUES (21, 1, ?, ?, 0)').run('application/pdf', 'storage:缺失.pdf')
db.prepare('INSERT INTO itemAttachments VALUES (30, 2, ?, ?, 2)').run('application/pdf', linkedPdf)
db.prepare('INSERT INTO itemAttachments VALUES (10, NULL, ?, ?, 0)').run('application/pdf', 'storage:论文.pdf')
db.prepare('INSERT INTO items VALUES (30, ?, 4)').run('LINKED03')
db.prepare('INSERT INTO collections VALUES (1, ?, NULL)').run('光通信')
db.prepare('INSERT INTO collections VALUES (2, ?, 1)').run('调制器')
db.prepare('INSERT INTO collectionItems VALUES (2, 1)').run()
db.prepare('INSERT INTO collectionItems VALUES (1, 2)').run()
const values = [
  [1, 1, 'A sub 1/2 Regularization'], [1, 6, '2024-05-00 2024-05'], [1, 59, '10.1109/TSP.2014.2309076'], [1, 38, 'Nature Photonics'], [1, 8, '短标题'],
  [2, 1, 'Conference paper on FSO'], [2, 6, '2019'], [2, 57, 'OFC 2019'],
  [3, 1, 'A webpage'], [3, 6, '2018-01-01'], [3, 113, '某网站'],
  [10, 1, '附件也有题名'], [11, 1, '批注'], [12, 1, '笔记'],
  [13, 1, '已删除条目'], [14, 6, '2020'],
]
values.forEach(([itemID, fieldID, value], i) => {
  db.prepare('INSERT INTO itemDataValues VALUES (?, ?)').run(i + 1, value)
  db.prepare('INSERT INTO itemData VALUES (?, ?, ?)').run(itemID, fieldID, i + 1)
})
db.prepare('INSERT INTO deletedItems VALUES (13)').run()
db.prepare('INSERT INTO creators VALUES (1, ?, ?)').run('Zhang', 'San')
db.prepare('INSERT INTO creators VALUES (2, ?, ?)').run('Li', '')
db.prepare('INSERT INTO itemCreators VALUES (1, 1, 0)').run()
db.prepare('INSERT INTO itemCreators VALUES (1, 2, 1)').run()
db.close()

const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const before = hash(dbPath)

try {
  const { collections, items } = readZotero(dbPath)
  check('附件 / 批注 / 笔记 / 已删除条目都不进入书目', items.length === 3 && items.every((i) => ['journalArticle', 'conferencePaper', 'webpage'].includes(i.itemType)), items.map((i) => `${i.zoteroKey}:${i.itemType}:${i.title}`).join(' | '))
  check('无题名条目被排除', !items.some((i) => i.zoteroKey === 'HHHH8888'))
  check('collections 是层级路径', collections.includes('光通信/调制器'))
  const paper = items.find((i) => i.zoteroKey === 'AAAA1111')
  check('zoteroKey 是 8 位字符串', typeof paper.zoteroKey === 'string' && /^[A-Z0-9]{8}$/.test(paper.zoteroKey))
  check('DOI 取 fieldID 59（不是 shortTitle）', paper.doi === '10.1109/tsp.2014.2309076')
  check('venue 取 publicationTitle', paper.venue === 'Nature Photonics')
  check('conferencePaper 的 venue 取 proceedingsTitle', items.find((i) => i.zoteroKey === 'BBBB2222').venue === 'OFC 2019')
  check('webpage 的 venue 取 websiteTitle', items.find((i) => i.zoteroKey === 'CCCC3333').venue === '某网站')
  check('year 从 date 提取', paper.year === 2024)
  check('作者按 orderIndex 拼接姓名、缺名的只留姓', paper.authors.length === 2 && paper.authors[0] === 'Zhang, San' && paper.authors[1] === 'Li')
  check('collectionPaths 带层级', paper.collectionPaths.includes('光通信/调制器'))
  check('pdfCount 统计全部 PDF 记录', paper.pdfCount === 2)
  check('availablePdfCount 只算实际存在的文件', paper.availablePdfCount === 1)
  check('绝对路径的 linked PDF 计入 available', items.find((i) => i.zoteroKey === 'BBBB2222').availablePdfCount === 1)
  check('读完后数据库字节不变（只读）', hash(dbPath) === before)

  const resolved = resolveZoteroPdf(dbPath, 'AAAA1111')
  check('resolveZoteroPdf 按 storage/<附件 key>/<文件名> 解析', resolved === path.join(storage, 'STORED01', '论文.pdf') && fs.existsSync(resolved))
  const linked = resolveZoteroPdf(dbPath, 'BBBB2222')
  check('resolveZoteroPdf 支持绝对路径附件', linked === path.normalize(linkedPdf))
  let missingError = ''
  try {
    resolveZoteroPdf(dbPath, 'HHHH8888')
  } catch (error) {
    missingError = error.message
  }
  check('只有 PDF 记录、文件不在本机 → 中文错误', missingError.includes('没有可访问的本地 PDF'))
  let invalid = ''
  try {
    resolveZoteroPdf(dbPath, '../etc/passwd')
  } catch (error) {
    invalid = error.message
  }
  check('非法 key 被拒绝', invalid === '无效的 Zotero 条目 key')
  let unknown = ''
  try {
    resolveZoteroPdf(dbPath, 'ZZZZ9999')
  } catch (error) {
    unknown = error.message
  }
  check('Zotero 里没有的 key → 中文错误', unknown === 'Zotero 中找不到这篇文献')
  check('resolveAttachmentPath 对无法解析的路径返回 null', resolveAttachmentPath(dbPath, { path: 'relative/无前缀.pdf', attachmentKey: 'X' }) === null)
  check('resolveAttachmentPath 对空路径返回 null', resolveAttachmentPath(dbPath, { path: '', attachmentKey: 'X' }) === null)
  let openError = ''
  try {
    readZotero(path.join(dir, 'missing.sqlite'))
  } catch (error) {
    openError = error.message
  }
  check('不存在的数据库 → 中文错误', openError.startsWith('无法打开 Zotero 数据库'))

  console.log(`\nzoteroFs 只读读取：${checks}/${checks} 通过`)
} finally {
  await fsp.rm(base, { recursive: true, force: true })
}
