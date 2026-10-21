/**
 * 批量同步脚本端到端测试：造一个合成 Zotero 库 + 合成笔记库，真的跑
 * .tmp-zotero/zotero-vault-sync.cjs 与 .tmp-vault-test/dedupe.cjs，验证：
 * 只导入真正书目、写入 文献/ 分区、未纳管文件与原笔记不被改动、备份完整、
 * 删除数为 0、重复执行幂等、dry-run 不在笔记库留任何目录/文件、
 * 【关键】去重合并后再同步不会重新长出重复文献（多 key 映射），
 * 以及索引里的文件读不到时中止、--allow-missing 才放行。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { readBackupZip } = require('./lib/backup-zip.cjs')
const bundle = path.resolve('.tmp-zotero/zotero-vault-sync.cjs')
const dedupeBundle = path.resolve('.tmp-vault-test/dedupe.cjs')
assert.ok(fs.existsSync(bundle), '先运行 npm run zotero:build')
assert.ok(fs.existsSync(dedupeBundle), '先运行 npm run dedupe:build')

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

// ---- 合成 Zotero 库：4 篇真正书目（2 篇 + 2 篇重复条目）+ 附件/批注/笔记 ----
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
db.prepare('INSERT INTO items VALUES (7, ?, 1)').run('DUPKEY01') // 旧版导入留下的重复条目：与 1 同 DOI
db.prepare('INSERT INTO items VALUES (8, ?, 1)').run('DUPKEY02') // 与 2 同题名的重复条目（无 DOI）
db.prepare('INSERT INTO collections VALUES (1, ?, NULL)').run('硅光')
db.prepare('INSERT INTO collections VALUES (2, ?, 1)').run('调制器')
db.prepare('INSERT INTO collectionItems VALUES (2, 1)').run()
db.prepare('INSERT INTO itemAttachments VALUES (6, 1, ?, ?, 1)').run('application/pdf', 'storage:论文.pdf')
const values = [
  [1, 1, 'A classified paper on modulators'], [1, 6, '2024-03-00 2024-03'], [1, 59, '10.1/classified'], [1, 38, 'Nature Photonics'],
  [2, 1, 'An unclassified paper'], [2, 6, '2021'], [2, 38, 'Optics Express'],
  [3, 1, '附件题名'], [4, 1, '批注'], [5, 1, '笔记'],
  [7, 1, 'A classified paper on modulators (duplicate)'], [7, 59, '10.1/classified'], [7, 38, 'Nature Photonics'],
  [8, 1, 'An unclassified paper'], [8, 38, 'Optics Express'],
]
values.forEach(([itemID, fieldID, value], i) => {
  db.prepare('INSERT INTO itemDataValues VALUES (?, ?)').run(i + 1, value)
  db.prepare('INSERT INTO itemData VALUES (?, ?, ?)').run(itemID, fieldID, i + 1)
})
db.prepare('INSERT INTO creators VALUES (1, ?, ?)').run('Zhang', 'San')
db.prepare('INSERT INTO itemCreators VALUES (1, 1, 0)').run()
db.close()

// ---- 合成笔记库：1 篇待匹配的文献笔记 + 1 篇重复条目留下的老文献 + 1 篇普通笔记 + 1 个未纳管 md ----
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
const dupLitFile = 'A classified paper on modulators（重复导入）.md'
const dupLit = `---
format: kaust-kg-note
id: "lit-dup"
title: "A classified paper on modulators"
type: literature
authors: []
venue: ""
year: ""
doi: "10.1/classified"
citekey: "zhang2024classifieddup"
attachments: []
collections: []
tags: []
zoteroKey: "DUPKEY01"
created: 2024-06-01T00:00:00.000Z
updated: 2024-06-01T00:00:00.000Z
---

重复条目里的正文（去重合并后必须还能找到）
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
await fsp.writeFile(path.join(vault, '文献', dupLitFile), dupLit)
await fsp.writeFile(path.join(vault, 'Inbox', '普通笔记.md'), plainNote)
await fsp.writeFile(path.join(vault, '学习', '未纳管.md'), '未纳管的文件，脚本不能动它\n')
const meta = JSON.stringify({
  format: 'kaust-kg-vault',
  version: 1,
  notes: [
    { id: 'lit-existing', file: '文献/A classified paper on modulators.md', title: 'A classified paper on modulators' },
    { id: 'lit-dup', file: `文献/${dupLitFile}`, title: 'A classified paper on modulators' },
    { id: 'plain-1', file: 'Inbox/普通笔记.md', title: '普通笔记' },
  ],
}, null, 2) + '\n'
await fsp.writeFile(path.join(vault, 'meta.json'), meta)

const runScript = (...extra) => {
  const out = execFileSync(process.execPath, [bundle, '--vault', vault, '--db', dbPath, ...extra], { encoding: 'utf8' })
  console.log(out.split('\n').filter((l) => l.trim()).slice(0, 6).map((l) => '    ' + l).join('\n'))
  return out
}
const runScriptExpectFail = (args) => {
  try {
    execFileSync(process.execPath, [bundle, ...args], { encoding: 'utf8', stdio: 'pipe' })
    return ''
  } catch (error) {
    return String(error.stdout) + String(error.stderr)
  }
}
const runDedupe = (...extra) => {
  const out = execFileSync(process.execPath, [dedupeBundle, '--vault', vault, ...extra], { encoding: 'utf8' })
  console.log(out.split('\n').filter((l) => l.trim()).slice(0, 6).map((l) => '    ' + l).join('\n'))
  return out
}

try {
  // ---- 1) dry-run：不动笔记库，也不在笔记库里建任何目录 ----
  const dryReport = path.join(root, 'reports', 'dry.json')
  runScript('--report', dryReport)
  const mdAfterDry = fs.readdirSync(path.join(vault, '文献')).sort()
  check('dry-run 不新建/不删除任何 md', mdAfterDry.length === 2 && mdAfterDry.includes(dupLitFile), mdAfterDry.join(','))
  check('dry-run 不改 meta.json', await fsp.readFile(path.join(vault, 'meta.json'), 'utf8') === meta)
  check('dry-run 不在笔记库里创建 .backups 目录', !fs.existsSync(path.join(vault, '.backups')))
  check('dry-run 报告落到 --report 指定位置', fs.existsSync(dryReport))
  const preview = JSON.parse(await fsp.readFile(dryReport, 'utf8'))
  check('dry-run 报告只统计真正书目（附件/批注/笔记不算）', preview.counts.zoteroItems === 4, String(preview.counts.zoteroItems))
  check('dry-run 报告：重复条目归并后按 key 匹配、只新建 1 篇、0 删除', preview.counts.matchedByKey === 2 && preview.counts.created === 1 && preview.counts.deletes === 0, JSON.stringify(preview.counts))

  // ---- 2) apply：写盘 + 备份 ----
  const applyOut = runScript('--apply')
  const files = fs.readdirSync(path.join(vault, '文献')).sort()
  check('新建文献落到 文献/ 分区', files.length === 3 && files.includes('An unclassified paper.md'), files.join(','))
  const newText = await fsp.readFile(path.join(vault, '文献', 'An unclassified paper.md'), 'utf8')
  check('未分类新笔记：不写占位分类/标签，界面动态显示「未分类」', !newText.includes('collections: ["未分类"]') && newText.includes('collections: []') && !newText.includes('方向:未分类'))
  check('未分类新笔记带合并后的全部 zoteroKey', newText.includes('zoteroKey: "LOOSEZZZ"') && newText.includes('zoteroKeys: ["LOOSEZZZ","DUPKEY02"]'))
  check('新笔记的 PDF 状态是 0（本机没有文件）', newText.includes('zoteroAvailablePdfCount: 0'))
  const matched = await fsp.readFile(path.join(vault, '文献', 'A classified paper on modulators.md'), 'utf8')
  const litDir = path.join(vault, '文献')
  const litFiles = () => fs.readdirSync(litDir).filter((f) => f.endsWith('.md'))
  const litText = (f) => fs.readFileSync(path.join(litDir, f), 'utf8')
  const classified = litFiles().filter((f) => litText(f).includes('10.1/classified'))
  check('匹配到的笔记：正文原样保留（未被匹配的同 DOI 笔记也不动）', matched.includes('用户自己写的正文，不能丢') && matched === existingLit)
  check('匹配到的笔记：分类写入且不再有「未分类」', classified.some((f) => litText(f).includes('collections: ["硅光/调制器"]') && !litText(f).includes('未分类')))
  check('匹配到的笔记：key 列表含重复条目（去重后再同步用）', classified.some((f) => litText(f).includes('zoteroKeys: ["KLASSIFY","DUPKEY01"]')))
  check('匹配到的笔记：key/PDF 状态更新', classified.some((f) => litText(f).includes('zoteroKey: "KLASSIFY"') && litText(f).includes('zoteroPdfCount: 1') && litText(f).includes('zoteroAvailablePdfCount: 1')))
  check('同 DOI 的另一篇笔记：附件与已有标签原样保留', matched.includes('"att-keep"') && matched.includes('我的标签'))
  check('匹配到的笔记：补「期刊:」标签、不写「方向:」标签', classified.some((f) => litText(f).includes('期刊:Nature Photonics')) && !classified.some((f) => litText(f).includes('方向:')))
  const metaAfter = JSON.parse(await fsp.readFile(path.join(vault, 'meta.json'), 'utf8'))
  check('meta.json 四条笔记齐全且路径带分区', metaAfter.notes.length === 4 && metaAfter.notes.every((n) => n.file.includes('/')))
  const litIds = metaAfter.notes.map((n) => n.id)
  check('新文献的 id 稳定为 zotero-<key>', litIds.includes('zotero-loosezzz') && litIds.includes('lit-existing'))
  check('普通笔记与未纳管 md 未被改动', fs.readFileSync(path.join(vault, 'Inbox', '普通笔记.md'), 'utf8') === plainNote && fs.readFileSync(path.join(vault, '学习', '未纳管.md'), 'utf8') === '未纳管的文件，脚本不能动它\n')
  check('apply 输出声明 0 删除', applyOut.includes('删除 0 个'))
  const backupZips = (await fsp.readdir(path.join(vault, '.backups'))).filter((d) => d.startsWith('zotero-import-') && d.endsWith('.zip'))
  check('apply 建立带时间戳的备份压缩包（单个 zip）', backupZips.length === 1)
  const backup = readBackupZip(path.join(vault, '.backups', backupZips[0]))
  const backupText = (name) => backup.find((e) => e.name === name)?.data.toString('utf8')
  check('备份里含原始 meta.json 与全部原 md', backupText('meta.json') === meta &&
    backupText('文献/A classified paper on modulators.md') === existingLit &&
    backup.some((e) => e.name === '学习/未纳管.md'))
  check('备份里带 report.json', backup.some((e) => e.name === 'report.json'))

  // ---- 3) 去重：合并同 DOI 的两篇笔记，保留全部 key 与正文 ----
  const dedupeReport = path.join(root, 'reports', 'dedupe.json')
  const dedupeDry = runDedupe('--report', dedupeReport)
  check('去重 dry-run：识别出 1 组重复且不改文件', dedupeDry.includes('重复组：1 组') && fs.existsSync(path.join(litDir, dupLitFile)))
  const dedupeOut = runDedupe('--apply')
  check('去重 apply：合并 1 组、删除 1 个文件', dedupeOut.includes('已合并 1 组') && dedupeOut.includes('删除 1 个文件'))
  const mergedFile = litFiles().find((f) => litText(f).includes('zoteroKeys: ["KLASSIFY","DUPKEY01"]'))
  const merged = mergedFile ? litText(mergedFile) : ''
  check('同 DOI 的两篇合并成一篇', litFiles().filter((f) => litText(f).includes('10.1/classified')).length === 1)
  check('保留项记下全部 zoteroKey（去重后再同步不会重新长出重复文献）', Boolean(mergedFile))
  check('被合并项的正文追加保留，不丢', merged.includes('重复条目里的正文（去重合并后必须还能找到）') && merged.includes('用户自己写的正文，不能丢'))
  check('被合并项的附件与标签取并集', merged.includes('"att-keep"') && merged.includes('我的标签'))
  const dedupeBackup = (await fsp.readdir(path.join(vault, '.backups'))).filter((d) => d.startsWith('dedupe-') && d.endsWith('.zip'))
  const dedupeEntries = dedupeBackup.length === 1 ? readBackupZip(path.join(vault, '.backups', dedupeBackup[0])) : []
  check('去重前备份了会改动的文件', dedupeBackup.length === 1 && dedupeEntries.filter((e) => e.name.startsWith('文献/') && e.name.endsWith('.md')).length === 2)
  const metaAfterDedupe = JSON.parse(await fsp.readFile(path.join(vault, 'meta.json'), 'utf8'))
  check('meta 里被合并的重复条目已移除、保留项留下', metaAfterDedupe.notes.length === 3 &&
    !metaAfterDedupe.notes.some((n) => n.id === 'lit-existing') && metaAfterDedupe.notes.some((n) => n.id === 'lit-dup'))

  // ---- 4) 关键链路：去重之后再次同步必须完全稳定 ----
  const stableOut = runScript('--apply')
  check('去重后再次同步：新建 0、更新 0、写盘 0、删除 0', stableOut.includes('新建：0') && stableOut.includes('更新：0') && stableOut.includes('写盘：0 个 md') && stableOut.includes('删除：0'), stableOut)
  const filesStable = litFiles().sort()
  check('文献数不膨胀：仍是 2 篇', filesStable.length === 2, filesStable.join(','))
  check('合并后的笔记字节不变', mergedFile !== undefined && litText(mergedFile) === merged)

  // ---- 5) 重复 apply 幂等（第 3 次） ----
  const againOut = runScript('--apply')
  check('重复执行仍不新增文件', litFiles().length === 2)
  check('重复执行：新建 0、更新 0、写盘 0、删除 0', againOut.includes('新建：0') && againOut.includes('更新：0') && againOut.includes('写盘：0 个 md') && againOut.includes('删除：0'))
  const dirsAfter = (await fsp.readdir(path.join(vault, '.backups'))).filter((d) => d.startsWith('zotero-import-') && d.endsWith('.zip'))
  check('重复 apply 仍各自备份（不影响幂等判定）', dirsAfter.length === 3)

  // ---- 6) 参数与边界 ----
  check('缺 --db 时明确报错', runScriptExpectFail(['--vault', vault]).includes('缺少 --db'))
  check('笔记库不存在时拒绝执行', runScriptExpectFail(['--vault', path.join(root, '不存在'), '--db', dbPath]).includes('笔记库不存在'))

  // ---- 7) 索引里登记的文件读不到 → 中止；--allow-missing 才放行 ----
  await fsp.rm(path.join(vault, 'Inbox', '普通笔记.md'))
  const missingOut = runScriptExpectFail(['--vault', vault, '--db', dbPath])
  check('索引内文件读不到 → 中止同步并给出原因', missingOut.includes('读不到') && missingOut.includes('--allow-missing'), missingOut.split('\n').slice(-3).join(' '))
  const allowOut = runScript('--allow-missing', '--apply')
  check('--allow-missing 明确提示跳过了索引条目', allowOut.includes('1 个索引内文件读不到'))
  const metaAfterMissing = JSON.parse(await fsp.readFile(path.join(vault, 'meta.json'), 'utf8'))
  check('放行后缺失条目退出索引，其余笔记完好', metaAfterMissing.notes.length === 2 && !metaAfterMissing.notes.some((n) => n.id === 'plain-1'))

  console.log(`\n批量同步端到端：${checks}/${checks} 通过`)
} finally {
  await fsp.rm(base, { recursive: true, force: true })
}
