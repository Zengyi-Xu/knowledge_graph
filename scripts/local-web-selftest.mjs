import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { createLocalServer, openerCommand } from './local-web.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const base = path.resolve('.tmp-local-web-test')
await fs.mkdir(base, { recursive: true })
const dir = await fs.mkdtemp(path.join(base, 'run-'))
const vault = path.join(dir, 'vault')
const dist = path.join(dir, 'dist')
await fs.mkdir(vault)
await fs.mkdir(dist)
await fs.writeFile(path.join(dist, 'index.html'), '<html><head></head><body>test</body></html>')
const local = await createLocalServer({ port: 0, dist, vault })
let checks = 0
function check(name, ok) { assert.ok(ok, name); checks++; console.log('✓ ' + name) }
async function request(method, payload, headers = {}) {
  return fetch(local.origin + '/api/local', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KG-Token': local.token, ...headers }, body: JSON.stringify({ method, payload }) })
}
async function call(method, payload) {
  const response = await request(method, payload)
  const body = await response.json()
  assert.equal(response.status, 200, body.error)
  return body.result
}

/** 合成一个最小 Zotero 库：1 篇有本地 PDF 的书目 + 1 篇只有记录的（文件不在本机）+ 1 篇备用 PDF */
async function makeZoteroFixture(zoteroDir) {
  const dbPath = path.join(zoteroDir, 'zotero.sqlite')
  await fs.mkdir(path.join(zoteroDir, 'storage', 'PDFKEY01'), { recursive: true })
  await fs.mkdir(path.join(zoteroDir, 'storage', 'PDFKEY09'), { recursive: true })
  await fs.writeFile(path.join(zoteroDir, 'storage', 'PDFKEY01', '论文.pdf'), '%PDF-1.4 fixture')
  await fs.writeFile(path.join(zoteroDir, 'storage', 'PDFKEY09', '备用.pdf'), '%PDF-1.4 backup')
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
  db.prepare('INSERT INTO itemTypes VALUES (1, ?)').run('journalArticle')
  db.prepare('INSERT INTO itemTypes VALUES (2, ?)').run('attachment')
  db.prepare('INSERT INTO items VALUES (1, ?, 1)').run('PDFKEY02')
  db.prepare('INSERT INTO items VALUES (2, ?, 1)').run('NOPDFF03')
  db.prepare('INSERT INTO items VALUES (3, ?, 2)').run('PDFKEY01')
  db.prepare('INSERT INTO items VALUES (4, ?, 2)').run('MISSING1')
  db.prepare('INSERT INTO items VALUES (5, ?, 1)').run('MULTIKEY')
  db.prepare('INSERT INTO items VALUES (6, ?, 2)').run('PDFKEY09')
  db.prepare('INSERT INTO itemAttachments VALUES (3, 1, ?, ?, 1)').run('application/pdf', 'storage:论文.pdf')
  db.prepare('INSERT INTO itemAttachments VALUES (4, 2, ?, ?, 0)').run('application/pdf', 'storage:不在本机.pdf')
  db.prepare('INSERT INTO itemAttachments VALUES (6, 5, ?, ?, 1)').run('application/pdf', 'storage:备用.pdf')
  const values = [[1, 1, '有本地 PDF 的论文'], [2, 1, 'PDF 不在本机的论文'], [5, 1, '去重合并后的重复条目']]
  values.forEach(([itemID, fieldID, value], i) => {
    db.prepare('INSERT INTO itemDataValues VALUES (?, ?)').run(i + 1, value)
    db.prepare('INSERT INTO itemData VALUES (?, ?, ?)').run(itemID, fieldID, i + 1)
  })
  db.close()
  return dbPath
}
try {
  const html = await fetch(local.origin).then((r) => r.text())
  check('本地页面在 React 之前装载文件桥接', html.includes('/local-bridge.js') && html.includes('__KG_LOCAL_CONFIG__'))
  check('错误令牌不能访问文件', (await request('vault:list', { dir: vault }, { 'X-KG-Token': 'invalid' })).status === 403)
  check('其他网页来源不能访问文件', (await request('vault:list', { dir: vault }, { Origin: 'https://example.com' })).status === 403)
  const wrongHost = await new Promise((resolve, reject) => {
    const req = http.get(local.origin + '/api/health', { headers: { Host: 'evil.example' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', reject)
  })
  check('DNS 重绑定主机被拒绝', wrongHost === 403)
  check('未经选择的目录被拒绝', (await request('vault:list', { dir })).status === 400)
  const text = '---\nformat: kaust-kg-note\n---\n\n# 测试\n[[另一篇]]\n'
  const meta = JSON.stringify({ format: 'test', notes: [{ id: 'test', file: '学习/测试.md' }] })
  const result = await call('vault:write', { dir: vault, plan: { writes: [{ file: '学习/测试.md', text }], deletes: [], meta } })
  check('写入原类型分区中的 md 文件', result.written === 1 && await fs.readFile(path.join(vault, '学习', '测试.md'), 'utf8') === text)
  const listing = await call('vault:list', { dir: vault })
  check('meta 索引与 md 分区路径保留', listing.meta === meta && listing.md[0].name === '学习/测试.md')
  const read = await call('vault:read-files', { dir: vault, names: ['学习/测试.md', 'missing.md'] })
  check('读取正文逐字一致', read.find((r) => r.name === '学习/测试.md').text === text)
  check('拒绝通过 vault 读取外部路径', (await request('vault:read-files', { dir: vault, names: ['../outside.md'] })).status === 400)
  check('拒绝通过 vault 写入外部路径', (await request('vault:write', { dir: vault, plan: { writes: [{ file: '../outside.md', text: 'bad' }], deletes: [], meta: null } })).status === 400)
  await fs.writeFile(path.join(vault, 'foreign.md'), 'untouched')
  await call('vault:write', { dir: vault, plan: { writes: [{ file: '学习/测试.md', text: text + '\n更新' }], deletes: [], meta: null } })
  check('增量写盘保留未纳管文件', await fs.readFile(path.join(vault, 'foreign.md'), 'utf8') === 'untouched')
  const filePath = path.join(vault, 'sync', 'notes.json')
  await call('sync:write-file', { filePath, contents: '[]' })
  check('同步文件仍在本地 vault/sync 分区', (await call('sync:read-file', { filePath })).content === '[]')
  check('非 JSON 同步路径被拒绝', (await request('sync:authorize', { filePath: path.join(dir, 'outside.exe') })).status === 400)
  const binary = Buffer.from([0, 255, 128, 40, 42])
  await call('attachments:write', { dir: vault, rel: 'attachments/test.pdf', data: binary.toString('base64') })
  check('PDF 二进制本地读写逐字一致', Buffer.from(await call('attachments:read', { dir: vault, rel: 'attachments/test.pdf' }), 'base64').equals(binary))
  check('附件不能越出附件分区', (await request('attachments:read', { dir: vault, rel: '../outside.pdf' })).status === 400)
  await call('attachments:remove', { dir: vault, rel: 'attachments/test.pdf' })
  check('附件删除仅针对指定文件', await call('attachments:read', { dir: vault, rel: 'attachments/test.pdf' }) === null)
  check('不存在的 Zotero 数据库返回可读错误', (await request('zotero:read', { dbPath: path.join(dir, 'missing.sqlite') })).status === 400)
  check('未授权的 sqlite 一律拒绝（不是任意文件读取通道）', (await request('zotero:read', { dbPath: path.join(dir, 'evil.sqlite') })).status === 400)
  check('未配置 Zotero 时 open-pdf 明确报错', (await request('zotero:open-pdf', { zoteroKey: 'PDFKEY02' })).status === 400)

  // ---- Zotero PDF：白名单数据库 + 注入 opener（测试里不真的启动阅读器）----
  const zoteroDb = await makeZoteroFixture(path.join(dir, 'zotero'))
  const opened = []
  const local2 = await createLocalServer({ port: 0, dist, vault, zoteroDb, opener: (file) => { opened.push(file) } })
  async function call2(method, payload) {
    const response = await fetch(local2.origin + '/api/local', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KG-Token': local2.token }, body: JSON.stringify({ method, payload }) })
    return { status: response.status, body: await response.json() }
  }
  try {
    const html2 = await fetch(local2.origin).then((r) => r.text())
    check('页面注入 zoteroDb 配置（供文献表 PDF 徽标使用）', html2.includes(zoteroDb.replace(/\\/g, '\\\\')))
    const read = await call2('zotero:read', { dbPath: zoteroDb })
    check('授权的数据库可以只读读取', read.status === 200 && read.body.result.items.length === 3)
    check('仍拒绝其他 sqlite 路径', (await call2('zotero:read', { dbPath: path.join(dir, 'other.sqlite') })).status === 400)
    const open = await call2('zotero:open-pdf', { zoteroKey: 'PDFKEY02' })
    check('open-pdf 用系统默认程序打开解析出的 PDF', open.status === 200 && open.body.result.path === path.join(dir, 'zotero', 'storage', 'PDFKEY01', '论文.pdf'))
    check('opener 收到的就是 Zotero 库里的那份 PDF', opened.length === 1 && opened[0] === open.body.result.path)
    check('前端夹带的任意路径参数被忽略', (await call2('zotero:open-pdf', { zoteroKey: 'PDFKEY02', path: 'C:\\Windows\\System32\\calc.exe', dbPath: path.join(dir, 'other.sqlite') })).status === 200 && opened.length === 2 && opened[1].endsWith('论文.pdf'))
    const missing = await call2('zotero:open-pdf', { zoteroKey: 'NOPDFF03' })
    check('没有本地 PDF → 400 且不调用 opener', missing.status === 400 && opened.length === 2 && missing.body.error.includes('没有可访问的本地 PDF'))
    // 去重合并后的文献带多个 key：主 key 没 PDF 时按 zoteroKeys 顺序找下一份
    const multi = await call2('zotero:open-pdf', { zoteroKey: 'NOPDFF03', zoteroKeys: ['MULTIKEY'] })
    check('多 key 文献：主 key 无 PDF 时回退到合并保留的其它 key', multi.status === 200 && opened.length === 3 && opened[2].endsWith('备用.pdf'))
    check('多 key 非法 key → 400', (await call2('zotero:open-pdf', { zoteroKey: 'PDFKEY02', zoteroKeys: ['..\\..\\etc'] })).status === 400)
    const unknown = await call2('zotero:open-pdf', { zoteroKey: 'ZZZZ9999' })
    check('Zotero 里不存在的 key → 400', unknown.status === 400 && unknown.body.error.includes('找不到'))
    const invalid = await call2('zotero:open-pdf', { zoteroKey: '..\\..\\etc' })
    check('非法 key → 400', invalid.status === 400 && invalid.body.error.includes('无效的 Zotero 条目 key'))
    check('缺 key → 400 而不是崩溃', (await call2('zotero:open-pdf', {})).status === 400)
  } finally { await local2.close() }

  // ---- 系统打开器：不经过 cmd/sh，文件名里的 shell 字符不会被解释 ----
  {
    const [, argv] = openerCommand('D:/tmp/名字 & (1) - 副本.pdf')
    const [command] = openerCommand('D:/tmp/x.pdf')
    check('系统打开器只传一个文件参数、不经 shell', argv.length === 1 && argv[0] === 'D:/tmp/名字 & (1) - 副本.pdf')
    check('系统打开器不是 cmd/sh 命令解释器', !/(^|[\\/])(cmd|powershell|wscript|cscript)$/i.test(command.replace(/\.exe$/i, '')))
  }
  console.log(`\n本地网页服务：${checks}/${checks} 通过`)
} finally { await local.close() }
