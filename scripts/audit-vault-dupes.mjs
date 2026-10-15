/** 核查 vault 文献库重复情况：按 zoteroKey / DOI / 规范化标题 / 前缀截断分组 */
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) throw new Error('用法：node scripts/audit-vault-dupes.mjs <vault/文献>')
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))

const readField = (text, field) => {
  const m = text.match(new RegExp(`^${field}:\\s*(.*)$`, 'm'))
  if (!m) return ''
  let v = m[1].trim()
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
  return v.replace(/\\"/g, '"')
}

const rows = files.map((file) => {
  const text = fs.readFileSync(path.join(dir, file), 'utf8')
  return {
    file,
    title: readField(text, 'title'),
    doi: readField(text, 'doi').toLowerCase(),
    key: readField(text, 'zoteroKey'),
    collections: readField(text, 'collections'),
  }
})

const norm = (s) => s.toLowerCase().replace(/[\s\-–—_]+/g, '').replace(/[：:，,。.、()（）[\]【】"']/g, '')
const group = (keyFn, label) => {
  const map = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    if (!k) continue
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r)
  }
  const dups = [...map.entries()].filter(([, v]) => v.length > 1)
  console.log(`${label}: 重复组 ${dups.length}，涉及条目 ${dups.reduce((s, [, v]) => s + v.length, 0)}，多出 ${dups.reduce((s, [, v]) => s + v.length - 1, 0)}`)
  for (const [k, v] of dups.slice(0, 5)) {
    console.log(`  · ${k.slice(0, 50)} ×${v.length}`)
    for (const r of v.slice(0, 3)) console.log(`      ${r.file}`)
  }
  return dups
}

console.log(`文献文件总数: ${rows.length}`)
console.log(`有 zoteroKey: ${rows.filter((r) => r.key).length}，唯一 key: ${new Set(rows.map((r) => r.key).filter(Boolean)).size}`)
console.log(`有 DOI: ${rows.filter((r) => r.doi).length}，唯一 DOI: ${new Set(rows.map((r) => r.doi).filter(Boolean)).size}`)
console.log('---')
group((r) => r.key, '按 zoteroKey')
group((r) => r.doi, '按 DOI（小写）')
group((r) => norm(r.title), '按规范化标题')
// 截断文件名：去掉结尾 -数字 后同名
group((r) => r.file.replace(/-\d+\.md$/, '.md'), '按截断文件名')
