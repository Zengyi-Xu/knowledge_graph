/**
 * 读取本机 Zotero 数据库（只读）的实现。
 * 只用 better-sqlite3 以 readonly 方式打开 zotero.sqlite，绝不写库，
 * 因此只在 Zotero 未运行（未持锁）时可用；锁定则返回友好中文错误。
 *
 * 该模块是 CJS、不依赖 Electron，可直接用 node 单测 / 探查。
 */

/**
 * 从 Zotero 数据库读取分类树与文献条目。
 * @param {string} dbPath zotero.sqlite 的绝对路径
 * @returns {{ collections: string[], items: ZoteroItem[] }}
 */
function readZotero(dbPath) {
  if (typeof dbPath !== 'string' || !dbPath.trim()) throw new Error('缺少 Zotero 数据库路径')
  let db
  try {
    const Database = require('better-sqlite3')
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch (error) {
    const msg = String((error && error.message) || error)
    if (/locked|busy/i.test(msg)) throw new Error('Zotero 数据库被占用：请先完全退出 Zotero 再同步')
    throw new Error(`无法打开 Zotero 数据库：${msg}`)
  }

  try {
    // ---- 分类树：拼出 "父/子/孙" 全路径 ----
    const colRows = db
      .prepare('SELECT collectionID, collectionName, parentCollectionID FROM collections')
      .all()
    const byId = new Map(colRows.map((r) => [r.collectionID, r]))
    const pathOf = (id, seen = new Set()) => {
      if (seen.has(id)) return '' // 环保护
      seen.add(id)
      const row = byId.get(id)
      if (!row) return ''
      if (!row.parentCollectionID) return row.collectionName
      const parent = pathOf(row.parentCollectionID, seen)
      return parent ? `${parent}/${row.collectionName}` : row.collectionName
    }
    const collections = colRows.map((r) => pathOf(r.collectionID)).sort()

    // ---- 条目：题目 / DOI / 年份 / 期刊 / 作者 / 所属分类 ----
    const FIELD = { title: 1, date: 6, doi: 8, venue: 41 }
    const rows = db
      .prepare(
        `SELECT i.itemID, it.typeName AS itemType
         FROM items i
         JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
         WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems)`,
      )
      .all()

    const fieldStmt = db.prepare(
      `SELECT idv.value
       FROM itemData id
       JOIN itemDataValues idv ON idv.valueID = id.valueID
       WHERE id.itemID = ? AND id.fieldID = ?`,
    )
    const creatorsStmt = db.prepare(
      `SELECT c.lastName, c.firstName
       FROM itemCreators ic
       JOIN creators c ON c.creatorID = ic.creatorID
       WHERE ic.itemID = ?
       ORDER BY ic.orderIndex`,
    )
    const colItemsStmt = db.prepare(
      `SELECT collectionID FROM collectionItems WHERE itemID = ?`,
    )

    const items = []
    for (const row of rows) {
      const getField = (fieldID) => {
        const r = fieldStmt.get(row.itemID, fieldID)
        return r ? String(r.value) : ''
      }
      const title = getField(FIELD.title)
      if (!title) continue // 无题名的通常是附件/笔记条目，跳过
      const date = getField(FIELD.date)
      const m = date.match(/(\d{4})/)
      items.push({
        zoteroKey: row.itemID,
        itemType: row.itemType,
        title,
        doi: getField(FIELD.doi).trim().toLowerCase(),
        year: m ? Number(m[1]) : null,
        venue: getField(FIELD.venue),
        authors: creatorsStmt
          .all(row.itemID)
          .map((c) =>
            c.lastName && c.firstName
              ? `${c.lastName}, ${c.firstName}`
              : c.lastName || c.firstName || '',
          )
          .filter(Boolean),
        collectionPaths: colItemsStmt
          .all(row.itemID)
          .map((r) => pathOf(r.collectionID))
          .filter(Boolean)
          .sort(),
      })
    }
    return { collections, items }
  } finally {
    db.close()
  }
}

module.exports = { readZotero }
