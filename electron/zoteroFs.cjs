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
    `SELECT ia.itemID AS attachmentItemID, ai.key AS attachmentKey, ia.path, ia.linkMode
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

/**
 * 定位一条文献的本地 PDF。接受单个 key 或 key 列表（去重合并后的文献有多个
 * Zotero key，任一条目下有可访问 PDF 即可），按传入顺序取第一份存在的文件。
 */
function resolveZoteroPdf(dbPath, zoteroKey, extraKeys) {
  const keys = [zoteroKey, ...(Array.isArray(extraKeys) ? extraKeys : [])]
    .filter((key, index, all) => typeof key === 'string' && key && all.indexOf(key) === index)
  if (!keys.length) throw new Error('无效的 Zotero 条目 key')
  for (const key of keys) {
    if (!/^[A-Z0-9]{8}$/i.test(key)) throw new Error('无效的 Zotero 条目 key')
  }
  const db = openReadonly(dbPath)
  try {
    const itemStmt = db.prepare(
      `SELECT itemID FROM items WHERE key = ? AND itemID NOT IN (SELECT itemID FROM deletedItems)`,
    )
    let found = false
    for (const key of keys) {
      const item = itemStmt.get(key)
      if (!item) continue
      found = true
      for (const pdf of pdfRowsFor(db, item.itemID)) {
        const filename = resolveAttachmentPath(dbPath, pdf)
        if (filename && fs.existsSync(filename)) return filename
      }
    }
    if (!found) throw new Error('Zotero 中找不到这篇文献')
    throw new Error('这篇文献没有可访问的本地 PDF')
  } finally {
    db.close()
  }
}

/**
 * 批量取一批条目的 PDF 附件文件名（不检查文件是否存在）。
 * 用途：把磁盘上「换了附件 key 但文件还在」的 PDF 认回来。
 */
function pdfFileNamesForItems(dbPath, itemKeys) {
  const db = openReadonly(dbPath)
  try {
    const stmt = db.prepare(
      `SELECT ai.key AS attachmentKey, ia.path
       FROM itemAttachments ia
       JOIN items ai ON ai.itemID = ia.itemID
       JOIN items i ON i.itemID = ia.parentItemID
       WHERE i.key = ? AND lower(ia.contentType) = 'application/pdf'
         AND ai.itemID NOT IN (SELECT itemID FROM deletedItems)`,
    )
    const out = {}
    for (const key of itemKeys) {
      const files = []
      for (const row of stmt.all(key)) {
        const stored = String(row.path || '')
        if (stored.startsWith('storage:')) files.push({ attachmentKey: row.attachmentKey, name: stored.slice(8) })
      }
      if (files.length) out[key] = files
    }
    return out
  } finally {
    db.close()
  }
}

/**
 * Zotero 标注 / 子笔记只读读取（与书目同步 readZotero 完全分开）。
 *
 * 关联链：标注 itemAnnotations.parentItemID → PDF 附件 itemAttachments → 书目 items.key。
 * 只把「用户明确给出的书目 key」当作入口，附件路径由本库解析，渲染端不能指定任何文件。
 *
 * Zotero 7 的 itemAnnotations.type 是内部编号（没有 annotationTypes 表可 join）：
 *   1=highlight 2=note 3=image 4=ink 5=underline 6=text
 * 其中只有 highlight / underline 能落到本软件的 PDF 高亮上；其余仍返回并计入 skipped。
 */
const ANNOTATION_TYPE_NAMES = { 1: 'highlight', 2: 'note', 3: 'image', 4: 'ink', 5: 'underline', 6: 'text' }
const DRAWABLE_ANNOTATION_TYPES = new Set(['highlight', 'underline'])

/** Zotero 的日期是 UTC 的 "YYYY-MM-DD HH:MM:SS"；转成 ISO 才能安全交给 JS Date */
function isoFromSqlite(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return ''
  return `${value.replace(' ', 'T')}Z`
}

/**
 * position 是 Zotero 自己序列化的 JSON：rects 为 PDF 坐标（点、原点在左下）。
 * 解析失败 / 没有 pageIndex 时仍要保留这条标注（列表里展示并标记无法定位），不能静默丢弃。
 */
function parseAnnotationPosition(raw) {
  try {
    const value = JSON.parse(String(raw || ''))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const pageIndex = Number.isInteger(value.pageIndex) && value.pageIndex >= 0 ? value.pageIndex : null
    const rects = Array.isArray(value.rects)
      ? value.rects.filter((rect) => Array.isArray(rect) && rect.length === 4 && rect.every((n) => Number.isFinite(n)))
      : []
    return { pageIndex, rects }
  } catch {
    return null
  }
}

function readZoteroMarkup(dbPath, zoteroKey, extraKeys) {
  const keys = [zoteroKey, ...(Array.isArray(extraKeys) ? extraKeys : [])]
    .filter((key, index, all) => typeof key === 'string' && key && all.indexOf(key) === index)
  if (!keys.length) throw new Error('无效的 Zotero 条目 key')
  for (const key of keys) {
    if (!/^[A-Z0-9]{8}$/i.test(key)) throw new Error('无效的 Zotero 条目 key')
  }
  const db = openReadonly(dbPath)
  try {
    const parentStmt = db.prepare(
      `SELECT itemID, key FROM items WHERE key = ? AND itemID NOT IN (SELECT itemID FROM deletedItems)`,
    )
    const parents = []
    for (const key of keys) {
      const row = parentStmt.get(key)
      if (row && !parents.some((parent) => parent.itemID === row.itemID)) {
        parents.push({ itemID: row.itemID, key: String(row.key) })
      }
    }
    if (!parents.length) throw new Error('Zotero 中找不到这篇文献')

    // 附件：去重后的文献可能有多份 PDF（多个 key 各自挂附件），逐份登记，标注不能串附件。
    const attachments = []
    for (const parent of parents) {
      for (const pdf of pdfRowsFor(db, parent.itemID)) {
        const key = String(pdf.attachmentKey)
        if (attachments.some((entry) => entry.key === key)) continue
        const resolved = resolveAttachmentPath(dbPath, pdf)
        attachments.push({
          itemID: pdf.attachmentItemID,
          key,
          parentKey: parent.key,
          path: resolved || '',
          fileName: resolved ? path.basename(resolved) : '',
          exists: Boolean(resolved && fs.existsSync(resolved)),
          primary: false,
        })
      }
    }
    // 「当前 PDF」与 readZoteroPdf 用同一规则：按 key 顺序取第一份实际存在的附件
    const primary = attachments.find((entry) => entry.exists) || null
    if (primary) primary.primary = true

    const annotationStmt = db.prepare(
      `SELECT a.itemID, a.type, a.text, a.comment, a.color, a.pageLabel, a.position,
              i.key AS annotationKey, i.dateAdded, i.dateModified
       FROM itemAnnotations a
       JOIN items i ON i.itemID = a.itemID
       WHERE a.parentItemID = ? AND a.itemID NOT IN (SELECT itemID FROM deletedItems)
       ORDER BY a.itemID`,
    )
    const skipped = { unsupportedType: 0, missingText: 0, invalidPosition: 0, otherAttachment: 0 }
    const annotations = []
    const seenAnnotations = new Set()
    for (const attachment of attachments) {
      for (const row of annotationStmt.all(attachment.itemID)) {
        const key = String(row.annotationKey)
        if (seenAnnotations.has(key)) continue
        seenAnnotations.add(key)
        const type = ANNOTATION_TYPE_NAMES[row.type] || 'unknown'
        const position = parseAnnotationPosition(row.position)
        const text = String(row.text || '')
        let status = 'ok'
        if (!DRAWABLE_ANNOTATION_TYPES.has(type)) status = 'unsupported-type'
        else if (!position || position.pageIndex === null) status = 'invalid-position'
        else if (!text.trim()) status = 'missing-text'
        if (status === 'unsupported-type') skipped.unsupportedType++
        else if (status === 'invalid-position') skipped.invalidPosition++
        else if (status === 'missing-text') skipped.missingText++
        if (primary && attachment.key !== primary.key) skipped.otherAttachment++
        annotations.push({
          key,
          parentKey: attachment.parentKey,
          attachmentKey: attachment.key,
          attachmentPath: attachment.path,
          type,
          text,
          comment: String(row.comment || ''),
          color: String(row.color || ''),
          // Zotero 的 pageIndex 从 0 开始；调用方转到本软件时要 +1（pageLabel 只用于显示）
          pageIndex: position ? position.pageIndex : null,
          pageLabel: String(row.pageLabel || ''),
          rects: position ? position.rects : [],
          status,
          dateAdded: isoFromSqlite(row.dateAdded),
          dateModified: isoFromSqlite(row.dateModified),
        })
      }
    }

    // 子笔记：既可能挂在书目下，也可能挂在 PDF 附件下（真库两种都有），两处都查并按 key 去重。
    const noteStmt = db.prepare(
      `SELECT n.note, i.key AS noteKey, i.dateAdded, i.dateModified
       FROM itemNotes n
       JOIN items i ON i.itemID = n.itemID
       WHERE n.parentItemID = ? AND n.itemID NOT IN (SELECT itemID FROM deletedItems)
       ORDER BY n.itemID`,
    )
    const notes = []
    const seenNotes = new Set()
    const noteOwners = [
      ...parents.map((parent) => ({ itemID: parent.itemID, key: parent.key })),
      ...attachments.map((attachment) => ({ itemID: attachment.itemID, key: attachment.key })),
    ]
    for (const owner of noteOwners) {
      for (const row of noteStmt.all(owner.itemID)) {
        const key = String(row.noteKey)
        if (seenNotes.has(key)) continue
        seenNotes.add(key)
        notes.push({
          key,
          parentKey: owner.key,
          html: String(row.note || ''),
          dateAdded: isoFromSqlite(row.dateAdded),
          dateModified: isoFromSqlite(row.dateModified),
        })
      }
    }

    const publicAttachment = (entry) => ({
      key: entry.key,
      parentKey: entry.parentKey,
      path: entry.path,
      fileName: entry.fileName,
      exists: entry.exists,
      primary: entry.primary,
    })
    return {
      parentKeys: parents.map((parent) => parent.key),
      attachment: primary ? publicAttachment(primary) : null,
      attachments: attachments.map(publicAttachment),
      annotations,
      notes,
      skipped,
    }
  } finally {
    db.close()
  }
}

module.exports = { readZotero, resolveZoteroPdf, resolveAttachmentPath, pdfFileNamesForItems, readZoteroMarkup }
