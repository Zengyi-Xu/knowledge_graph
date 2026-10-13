/** 核查 Zotero 库：条目总数、DOI/标题重复情况、重复项分布 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { readZotero } = require('../electron/zoteroFs.cjs')

const db = process.argv[2] ?? 'D:/BaiduSyncdisk/Bibliotx/Zotero/zotero.sqlite'
const { items, collections } = await readZotero(db)
console.log(`collection 数: ${collections.length}；Zotero 条目数: ${items.length}`)

const byDoi = new Map()
const norm = (s) => (s || '').toLowerCase().replace(/[\s\-–—_]+/g, '').replace(/[：:，,。.、()（）[\]【】"']/g, '')
const byTitle = new Map()
for (const it of items) {
  const d = (it.doi || '').trim().toLowerCase()
  if (d) byDoi.set(d, [...(byDoi.get(d) ?? []), it])
  const t = norm(it.title)
  byTitle.set(t, [...(byTitle.get(t) ?? []), it])
}
const report = (map, label) => {
  const dups = [...map.values()].filter((v) => v.length > 1)
  console.log(`${label}: 重复组 ${dups.length}，多出条目 ${dups.reduce((s, v) => s + v.length - 1, 0)}`)
  return dups
}
const doiDups = report(byDoi, '按 DOI')
const titleDups = report(byTitle, '按规范化标题')
console.log('--- 例子 ---')
for (const g of doiDups.slice(0, 3)) {
  console.log(`DOI ${g[0].doi} ×${g.length}`)
  for (const it of g) console.log(`   ${it.zoteroKey} | ${it.title.slice(0, 70)} | 分类 ${it.collectionPaths?.[0] ?? '无'}`)
}
// 抽查：无 DOI 的条目里同标题的
console.log('--- 无 DOI 但同标题 ---')
let shown = 0
for (const g of titleDups) {
  if (g[0].doi) continue
  console.log(`×${g.length} ${g[0].title.slice(0, 60)}`)
  for (const it of g.slice(0, 3)) console.log(`   ${it.zoteroKey} | doi="${it.doi}" | ${it.year} | 分类 ${it.collectionPaths?.[0] ?? '无'}`)
  if (++shown >= 3) break
}
