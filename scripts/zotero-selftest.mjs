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
const { readZotero, resolveZoteroPdf, resolveAttachmentPath, readZoteroMarkup } = require('../electron/zoteroFs.cjs')

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
  CREATE TABLE items (itemID INTEGER PRIMARY KEY, key TEXT, itemTypeID INTEGER, dateAdded TEXT, dateModified TEXT);
  CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);
  CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT, parentCollectionID INTEGER);
  CREATE TABLE collectionItems (collectionID INTEGER, itemID INTEGER);
  CREATE TABLE itemData (itemID INTEGER, fieldID INTEGER, valueID INTEGER);
  CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value TEXT);
  CREATE TABLE itemAttachments (itemID INTEGER, parentItemID INTEGER, contentType TEXT, path TEXT, linkMode INTEGER);
  CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, lastName TEXT, firstName TEXT);
  CREATE TABLE itemCreators (itemID INTEGER, creatorID INTEGER, orderIndex INTEGER);
  CREATE TABLE itemAnnotations (itemID INTEGER PRIMARY KEY, parentItemID INTEGER, type INTEGER, text TEXT, comment TEXT, color TEXT, pageLabel TEXT, position TEXT);
  CREATE TABLE itemNotes (itemID INTEGER PRIMARY KEY, parentItemID INTEGER, note TEXT, title TEXT);
`)
const types = ['journalArticle', 'conferencePaper', 'webpage', 'attachment', 'annotation', 'note']
types.forEach((name, i) => db.prepare('INSERT INTO itemTypes VALUES (?, ?)').run(i + 1, name))
db.prepare('INSERT INTO items (itemID, key, itemTypeID) VALUES (1, ?, 1)').run('AAAA1111') // journalArticle，2 个 PDF（1 个在、1 个缺失）
db.prepare('INSERT INTO items (itemID, key, itemTypeID) VALUES (2, ?, 2)').run('BBBB2222') // conferencePaper，绝对路径 PDF
db.prepare('INSERT INTO items (itemID, key, itemTypeID) VALUES (3, ?, 3)').run('CCCC3333') // webpage
db.prepare('INSERT INTO items (itemID, key, itemTypeID) VALUES (10, ?, 4)').run('DDDD4444') // attachment（有题名也要排除）
db.prepare('INSERT INTO items (itemID, key, itemTypeID) VALUES (11, ?, 5)').run('EEEE5555') // annotation
db.prepare('INSERT INTO items (itemID, key, itemTypeID) VALUES (12, ?, 6)').run('FFFF6666') // note
db.prepare('INSERT INTO items (itemID, key, itemTypeID) VALUES (13, ?, 1)').run('GGGG7777') // 已删除
db.prepare('INSERT INTO items (itemID, key, itemTypeID) VALUES (14, ?, 1)').run('HHHH8888') // 没有题名 → 排除
for (const [id, key, filename] of [[20, 'STORED01', '论文.pdf'], [21, 'STORED02', '缺失.pdf']]) {
  db.prepare('INSERT INTO items (itemID, key, itemTypeID) VALUES (?, ?, 4)').run(id, key)
  if (id === 20) await fsp.mkdir(path.join(storage, key), { recursive: true })
  if (id === 20) await fsp.writeFile(path.join(storage, key, filename), '%PDF-1.4 stored')
}
db.prepare('INSERT INTO itemAttachments VALUES (20, 1, ?, ?, 1)').run('application/pdf', 'storage:论文.pdf')
db.prepare('INSERT INTO itemAttachments VALUES (21, 1, ?, ?, 0)').run('application/pdf', 'storage:缺失.pdf')
db.prepare('INSERT INTO itemAttachments VALUES (30, 2, ?, ?, 2)').run('application/pdf', linkedPdf)
db.prepare('INSERT INTO itemAttachments VALUES (10, NULL, ?, ?, 0)').run('application/pdf', 'storage:论文.pdf')
db.prepare('INSERT INTO items (itemID, key, itemTypeID) VALUES (30, ?, 4)').run('LINKED03')
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

// 标注 / 子笔记夹具：高亮、下划线、便签、缺文字、坏 position、另一份 PDF 上的标注
const stamp = '2025-02-10 11:28:35'
const annotationRows = [
  [40, 'ANNOTA01', 20, 1, '高亮文本', '批注', '#ffd400', '3', '{"pageIndex":0,"rects":[[1,2,30,14]]}'],
  [41, 'ANNOTA02', 20, 5, '下划线文本', '', '#5fb236', '4', '{"pageIndex":1,"rects":[[1,2,30,14]]}'],
  [42, 'ANNOTA03', 20, 2, '', '便签内容', '#2ea8e5', '5', '{"pageIndex":2,"rects":[[1,2,30,14]]}'],
  [43, 'ANNOTA04', 20, 1, '', '', '#ffd400', '3', '{"pageIndex":0}'],
  [44, 'ANNOTA05', 20, 1, '坏位置', '', '#ffd400', '6', '{oops'],
  [45, 'ANNOTA06', 21, 1, '另一份 PDF 的高亮', '', '#ff6666', '1', '{"pageIndex":0,"rects":[]}'],
  [46, 'ANNOTD07', 20, 1, '已删除的标注', '', '#ffd400', '7', '{"pageIndex":0}'],
]
for (const [itemID, key, parentItemID, type, text, comment, color, pageLabel, position] of annotationRows) {
  db.prepare('INSERT INTO items (itemID, key, itemTypeID, dateAdded, dateModified) VALUES (?, ?, 5, ?, ?)').run(itemID, key, stamp, stamp)
  db.prepare('INSERT INTO itemAnnotations VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(itemID, parentItemID, type, text, comment, color, pageLabel, position)
}
const noteRows = [
  [50, 'NOTEB001', 1, '<div class="zotero-note"><p>书目下的子笔记</p></div>'],
  [51, 'NOTEB002', 20, '<div class="zotero-note"><p>PDF 附件下的子笔记</p></div>'],
  [52, 'NOTEB003', null, '<div class="zotero-note"><p>独立笔记</p></div>'],
]
for (const [itemID, key, parentItemID, note] of noteRows) {
  db.prepare('INSERT INTO items (itemID, key, itemTypeID, dateAdded, dateModified) VALUES (?, ?, 6, ?, ?)').run(itemID, key, stamp, stamp)
  db.prepare('INSERT INTO itemNotes VALUES (?, ?, ?, ?)').run(itemID, parentItemID, note, '')
}
db.prepare('INSERT INTO deletedItems VALUES (46)').run()
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

  // ---- readZoteroMarkup：标注 / 子笔记（与书目同步完全独立的只读接口）----
  const markup = readZoteroMarkup(dbPath, 'AAAA1111')
  check(
    '标注沿「标注 → PDF 附件 → 书目」关联到文献',
    markup.parentKeys.length === 1 && markup.parentKeys[0] === 'AAAA1111' && markup.annotations.length === 6,
    `${markup.parentKeys.join(',')} / ${markup.annotations.length}`,
  )
  check('主附件是按 key 顺序第一份存在的 PDF', markup.attachment?.key === 'STORED01' && markup.attachment?.exists === true)
  check('标注保留 0 起页索引、颜色、批注与页码标签', (() => {
    const ann = markup.annotations.find((item) => item.key === 'ANNOTA01')
    return ann?.pageIndex === 0 && ann.color === '#ffd400' && ann.comment === '批注' && ann.pageLabel === '3'
  })())
  check('Zotero 的 UTC 日期转成 ISO', markup.annotations.find((item) => item.key === 'ANNOTA01')?.dateAdded === '2025-02-10T11:28:35Z')
  check('下划线保留为可绘制类型', (() => {
    const ann = markup.annotations.find((item) => item.key === 'ANNOTA02')
    return ann?.type === 'underline' && ann.status === 'ok' && ann.pageIndex === 1
  })())
  check('便签（不支持类型）保留并计入 skipped', (() => {
    const ann = markup.annotations.find((item) => item.key === 'ANNOTA03')
    return ann?.type === 'note' && ann.status === 'unsupported-type' && markup.skipped.unsupportedType === 1
  })())
  check('缺文字 / 坏 position 分别计数且不丢标注', (() => {
    const missing = markup.annotations.find((item) => item.key === 'ANNOTA04')
    const broken = markup.annotations.find((item) => item.key === 'ANNOTA05')
    return missing?.status === 'missing-text' && broken?.status === 'invalid-position' &&
      markup.skipped.missingText === 1 && markup.skipped.invalidPosition === 1
  })())
  check('另一份 PDF 的标注带自己的附件 key 并计入 otherAttachment', (() => {
    const other = markup.annotations.find((item) => item.key === 'ANNOTA06')
    return other?.attachmentKey === 'STORED02' && markup.skipped.otherAttachment === 1
  })())
  check('已删除的标注不返回', !markup.annotations.some((item) => item.key === 'ANNOTD07'))
  check('子笔记覆盖书目下与附件下两种挂法', (() => {
    const keys = markup.notes.map((item) => item.key).sort()
    return keys.length === 2 && keys[0] === 'NOTEB001' && keys[1] === 'NOTEB002' &&
      markup.notes.some((item) => item.parentKey === 'AAAA1111') && markup.notes.some((item) => item.parentKey === 'STORED01')
  })())
  check('独立笔记不会被当成文献子笔记', !markup.notes.some((item) => item.key === 'NOTEB003'))
  check('多个归并 key：父条目取并集', (() => {
    const merged = readZoteroMarkup(dbPath, 'BBBB2222', ['AAAA1111'])
    return merged.parentKeys.length === 2 && merged.parentKeys.includes('AAAA1111') && merged.parentKeys.includes('BBBB2222')
  })())
  check('重复 key 不会重复返回', readZoteroMarkup(dbPath, 'AAAA1111', ['AAAA1111']).parentKeys.length === 1)
  check('标注数据不串附件（主附件只拿自己的标注）', (() => {
    const primaryAnn = markup.annotations.filter((item) => item.attachmentKey === 'STORED01')
    return primaryAnn.length === 5 && primaryAnn.every((item) => item.parentKey === 'AAAA1111')
  })())
  let markupInvalid = ''
  try {
    readZoteroMarkup(dbPath, '../etc/passwd')
  } catch (error) {
    markupInvalid = error.message
  }
  check('标注接口同样拒绝非法 key', markupInvalid === '无效的 Zotero 条目 key')
  let markupUnknown = ''
  try {
    readZoteroMarkup(dbPath, 'ZZZZ9999')
  } catch (error) {
    markupUnknown = error.message
  }
  check('不存在的条目 → 中文错误而不是空结果', markupUnknown === 'Zotero 中找不到这篇文献')
  check('读标注后数据库字节不变（只读）', hash(dbPath) === before)

  console.log(`\nzoteroFs 只读读取：${checks}/${checks} 通过`)} finally {
  await fsp.rm(base, { recursive: true, force: true })
}
