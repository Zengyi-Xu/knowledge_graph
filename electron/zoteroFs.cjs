/**
 * Zotero 数据库只读访问。书目、分类和附件都从 sqlite 读取，绝不修改 Zotero。
 */
const fs = require('node:fs')
const path = require('node:path')

const SKIP_ITEM_TYPES = new Set(['attachment', 'annotation', 'note'])

/** Zotero 的 fieldID 是 schema 内部编号：1=title、6=date、59=DOI（8 是 shortTitle，不是 DOI） */
const FIELD = { title: 1, date: 6, doi: 59 }

/**
 * 各条目类型的「期刊/会议/出版方」字段（Zotero fieldID）。
 * journalArticle 用 publicationTitle(38)、conferencePaper 用 proceedingsTitle(57)……
 * 找不到类型专属字段时回退到通用序列。
 */
const VENUE_FIELDS = {
  journalArticle: [38],
  conferencePaper: [57, 38],
  bookSection: [45, 38],
  book: [23],
  thesis: [111],
  webpage: [113],
  computerProgram: [55, 62],
  preprint: [61, 62],
  document: [23, 104],
  report: [104],
}
const DEFAULT_VENUE_FIELDS = [38, 57, 45, 113, 23, 104]

function openReadonly(dbPath) {
  if (typeof dbPath !== 'string' || !dbPath.trim()) throw new Error('缺少 Zotero 数据库路径')
  try {
    const Database = require('better-sqlite3')
    return new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch (error) {
    const msg = String((error && error.message) || error)
    if (/locked|busy/i.test(msg)) throw new Error('Zotero 数据库被占用：请先完全退出 Zotero 再同步')
    throw new Error(`无法打开 Zotero 数据库：${msg}`)
  }
}

function resolveAttachmentPath(dbPath, attachment) {
  const stored = String(attachment.path || '')
  if (!stored) return null
  if (stored.startsWith('storage:')) {
    return path.join(path.dirname(path.resolve(dbPath)), 'storage', attachment.attachmentKey, stored.slice(8))
  }
  if (path.isAbsolute(stored)) return path.normalize(stored)
  return null
}

function pdfRowsFor(db, itemID) {
  return db.prepare(
    `SELECT ai.key AS attachmentKey, ia.path, ia.linkMode
     FROM itemAttachments ia
     JOIN items ai ON ai.itemID = ia.itemID
     WHERE ia.parentItemID = ?
       AND lower(ia.contentType) = 'application/pdf'
       AND ai.itemID NOT IN (SELECT itemID FROM deletedItems)
     ORDER BY ia.itemID`,
  ).all(itemID)
}

function readZotero(dbPath) {
  const db = openReadonly(dbPath)
  try {
    const colRows = db.prepare('SELECT collectionID, collectionName, parentCollectionID FROM collections').all()
    const byId = new Map(colRows.map((row) => [row.collectionID, row]))
    const pathOf = (id, seen = new Set()) => {
      if (seen.has(id)) return ''
      seen.add(id)
      const row = byId.get(id)
      if (!row) return ''
      if (!row.parentCollectionID) return row.collectionName
      const parent = pathOf(row.parentCollectionID, seen)
      return parent ? `${parent}/${row.collectionName}` : row.collectionName
    }
    const collections = colRows.map((row) => pathOf(row.collectionID)).filter(Boolean).sort()

    const rows = db.prepare(
      `SELECT i.itemID, i.key AS zoteroKey, it.typeName AS itemType
       FROM items i
       JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
       WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems)`,
    ).all()
    const fieldStmt = db.prepare(
      `SELECT idv.value FROM itemData id
       JOIN itemDataValues idv ON idv.valueID = id.valueID
       WHERE id.itemID = ? AND id.fieldID = ?`,
    )
    const creatorsStmt = db.prepare(
      `SELECT c.lastName, c.firstName FROM itemCreators ic
       JOIN creators c ON c.creatorID = ic.creatorID
       WHERE ic.itemID = ? ORDER BY ic.orderIndex`,
    )
    const colItemsStmt = db.prepare('SELECT collectionID FROM collectionItems WHERE itemID = ?')

    const items = []
    for (const row of rows) {
      if (SKIP_ITEM_TYPES.has(row.itemType)) continue
      const getField = (fieldID) => {
        const value = fieldStmt.get(row.itemID, fieldID)
        return value ? String(value.value) : ''
      }
      const title = getField(FIELD.title)
      if (!title) continue
      const date = getField(FIELD.date)
      const year = date.match(/(\d{4})/)
      const venueFields = VENUE_FIELDS[row.itemType] ?? DEFAULT_VENUE_FIELDS
      const venue = venueFields.map(getField).find((value) => value.trim()) ?? ''
      const pdfs = pdfRowsFor(db, row.itemID)
      const availablePdfCount = pdfs.reduce((count, pdf) => {
        const filename = resolveAttachmentPath(dbPath, pdf)
        return count + (filename && fs.existsSync(filename) ? 1 : 0)
      }, 0)
      items.push({
        zoteroKey: String(row.zoteroKey),
        itemType: row.itemType,
        title,
        doi: getField(FIELD.doi).trim().toLowerCase(),
        year: year ? Number(year[1]) : null,
        venue,
        authors: creatorsStmt.all(row.itemID).map((creator) =>
          creator.lastName && creator.firstName
            ? `${creator.lastName}, ${creator.firstName}`
            : creator.lastName || creator.firstName || '',
        ).filter(Boolean),
        collectionPaths: colItemsStmt.all(row.itemID).map((entry) => pathOf(entry.collectionID)).filter(Boolean).sort(),
        pdfCount: pdfs.length,
        availablePdfCount,
      })
    }
    return { collections, items }
  } finally {
    db.close()
  }
}

function resolveZoteroPdf(dbPath, zoteroKey) {
  if (typeof zoteroKey !== 'string' || !/^[A-Z0-9]{8}$/i.test(zoteroKey)) {
    throw new Error('无效的 Zotero 条目 key')
  }
  const db = openReadonly(dbPath)
  try {
    const item = db.prepare(
      `SELECT itemID FROM items WHERE key = ? AND itemID NOT IN (SELECT itemID FROM deletedItems)`,
    ).get(zoteroKey)
    if (!item) throw new Error('Zotero 中找不到这篇文献')
    for (const pdf of pdfRowsFor(db, item.itemID)) {
      const filename = resolveAttachmentPath(dbPath, pdf)
      if (filename && fs.existsSync(filename)) return filename
    }
    throw new Error('这篇文献没有可访问的本地 PDF')
  } finally {
    db.close()
  }
}

module.exports = { readZotero, resolveZoteroPdf, resolveAttachmentPath }
