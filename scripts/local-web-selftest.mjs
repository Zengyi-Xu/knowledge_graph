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

  // ---- 服务端写入门禁：盘上声明 requiredCapabilities 的笔记，新文本必须还带着这些字段 ----
  {
    const guardedFile = '文献/带能力的文献.md'
    const guarded = '---\nformat: kaust-kg-note\nid: "zotero-abc"\ntitle: "带能力的文献"\ntype: literature\nformatVersion: 2\nminimumWriterVersion: 2\nrequiredCapabilities: ["zoteroKeys"]\nauthors: []\nvenue: ""\nyear: ""\ndoi: ""\ncitekey: "abc2020"\nattachments: []\ncollections: []\nzoteroKey: "ABC12345"\nzoteroKeys: ["ABC12345"]\nlocalPdf: "D:/lib/a.pdf"\ntags: []\ncreated: 2026-10-15T00:00:00.000Z\nupdated: 2026-10-15T00:00:00.000Z\n---\n\n正文\n'
    const readGuarded = () => fs.readFile(path.join(vault, '文献', '带能力的文献.md'), 'utf8')
    const writeback = (text) => request('vault:write', { dir: vault, plan: { writes: [{ file: guardedFile, text }], deletes: [], meta: null } })
    await call('vault:write', { dir: vault, plan: { writes: [{ file: guardedFile, text: guarded }], deletes: [], meta: null } })

    const stripped = guarded.replace(/^(formatVersion|minimumWriterVersion|requiredCapabilities|zoteroKey|zoteroKeys|localPdf):.*\n/gm, '')
    const rejected = await writeback(stripped)
    const rejectedBody = await rejected.json()
    check('旧客户端抹掉 zoteroKeys/localPdf/声明 → 拒绝写入并说明原因', rejected.status === 400 && /拒绝写入/.test(rejectedBody.error))
    check('被拒绝的笔记在磁盘上保持原样', (await readGuarded()) === guarded)
    check('只丢声明行也拒（不然这篇下一轮就没人保护）', (await writeback(guarded.replace(/^requiredCapabilities:.*\n/gm, ''))).status === 400)
    check('字段被清空成空数组同样算丢', (await writeback(guarded.replace('zoteroKeys: ["ABC12345"]', 'zoteroKeys: []'))).status === 400)
    const keepFields = guarded.replace('正文', '正文改了')
    const allowed = await call('vault:write', { dir: vault, plan: { writes: [{ file: guardedFile, text: keepFields }], deletes: [], meta: null } })
    check('保留全部声明字段的正常改写放行', allowed.written === 1 && (await readGuarded()).includes('正文改了'))
    const plain = '---\nformat: kaust-kg-note\nid: "plain"\ntitle: "普通笔记"\ntype: other\ntags: []\ncreated: 2026-10-15T00:00:00.000Z\nupdated: 2026-10-15T00:00:00.000Z\n---\n\n正文\n'
    await call('vault:write', { dir: vault, plan: { writes: [{ file: 'Inbox/普通.md', text: plain }], deletes: [], meta: null } })
    const plainEdited = await request('vault:write', { dir: vault, plan: { writes: [{ file: 'Inbox/普通.md', text: plain.replace('正文', '改了') }], deletes: [], meta: null } })
    check('没有能力声明的普通笔记不受门禁影响', plainEdited.status === 200)

    // meta.json 同一类保护：不能悄悄丢掉声明过的东西
    const metaWithDecl = JSON.stringify({ format: 'kaust-kg-vault', version: 1, formatVersion: 2, custom: 'x', notes: [] })
    await call('vault:write', { dir: vault, plan: { writes: [], deletes: [], meta: metaWithDecl } })
    const metaDowngraded = await request('vault:write', { dir: vault, plan: { writes: [], deletes: [], meta: JSON.stringify({ format: 'kaust-kg-vault', version: 1, notes: [] }) } })
    check('索引 meta.json 丢掉 formatVersion / 自定义字段 → 拒绝', metaDowngraded.status === 400 && /meta\./.test((await metaDowngraded.json()).error))
    check('被拒绝后 meta.json 未被改写', (await fs.readFile(path.join(vault, 'meta.json'), 'utf8')) === metaWithDecl)
    const metaKept = await request('vault:write', { dir: vault, plan: { writes: [], deletes: [], meta: JSON.stringify({ format: 'kaust-kg-vault', version: 1, formatVersion: 2, custom: 'x', notes: [{ id: 'a', file: '学习/测试.md', title: 't' }] }) } })
    check('保留声明的索引正常写入', metaKept.status === 200)
  }

  // ---- 本地 PDF 兜底：按标题在授权目录里匹配（只提名，不写盘） ----
  {
    const pdfRoot = path.join(dir, 'pdfs')
    await fs.mkdir(path.join(pdfRoot, 'Journal'), { recursive: true })
    await fs.writeFile(path.join(pdfRoot, 'Journal', '2.6_GHz_high-speed_visible_light_communication_of_450_nm_GaN_laser_diode_by_direct_modulation.pdf'), '%PDF-1.4 a')
    await fs.writeFile(path.join(pdfRoot, 'Journal', 'Cold atoms in optical lattices revisited.pdf'), '%PDF-1.4 b')
    const local5 = await createLocalServer({ port: 0, dist, vault, pdfRoots: [pdfRoot] })
    try {
      const response = await fetch(local5.origin + '/api/local', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KG-Token': local5.token }, body: JSON.stringify({ method: 'pdf:match-titles', payload: { titles: [{ id: 'hit', title: '2.6 GHz high-speed visible light communication of 450 nm GaN laser diode by direct modulation' }, { id: 'miss', title: 'A completely different subject entirely about economics' }] } }) })
      const { result } = await response.json()
      check('按标题在 --pdf-root 目录里匹配到本地 PDF', response.status === 200 && result.matches.hit?.path.endsWith('450_nm_GaN_laser_diode_by_direct_modulation.pdf'))
      check('匹配不到的标题不给假结果', result.matches.miss === undefined && result.stats.matched === 1)
      check('匹配只提名、不建文件', !(await fs.readdir(path.join(vault, '文献'))).some((f) => f.includes('2.6 GHz')))
    } finally { await local5.close() }
  }

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
    const inline = await call2('zotero:read-pdf', { zoteroKey: 'PDFKEY02' })
    check('内置阅读器可只读取得 Zotero PDF 字节', inline.status === 200 && Buffer.from(inline.body.result.data, 'base64').toString() === '%PDF-1.4 fixture')
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

  // ---- 打开笔记里记录的本地 PDF（localPdf）：白名单 + 只认 .pdf ----
  {
    await fs.mkdir(path.join(vault, 'pdfs'), { recursive: true })
    await fs.writeFile(path.join(vault, 'pdfs', '本地.pdf'), '%PDF-1.4 local')
    const outsideDir = path.join(dir, 'outside-pdfs')
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(path.join(outsideDir, '外面.pdf'), '%PDF-1.4 outside')
    const opened2 = []
    const urlOpened = []
    const local3 = await createLocalServer({ port: 0, dist, vault, opener: (file) => { opened2.push(file) }, urlOpener: (url) => { urlOpened.push(url) } })
    async function call3(method, payload) {
      const response = await fetch(local3.origin + '/api/local', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KG-Token': local3.token }, body: JSON.stringify({ method, payload }) })
      return { status: response.status, body: await response.json() }
    }
    try {
      const okOpen = await call3('file:open-external', { path: path.join(vault, 'pdfs', '本地.pdf') })
      check('打开笔记库内的本地 PDF', okOpen.status === 200 && opened2.length === 1 && okOpen.body.result.path.endsWith('本地.pdf'))
      const inline = await call3('file:read-pdf', { path: path.join(vault, 'pdfs', '本地.pdf') })
      check('内置阅读器可只读取得白名单内 PDF 字节', inline.status === 200 && Buffer.from(inline.body.result.data, 'base64').toString() === '%PDF-1.4 local')
      check('笔记库外的 PDF 默认拒绝', (await call3('file:open-external', { path: path.join(outsideDir, '外面.pdf') })).status === 400 && opened2.length === 1)
      check('内置阅读器同样拒绝白名单外 PDF', (await call3('file:read-pdf', { path: path.join(outsideDir, '外面.pdf') })).status === 400)
      check('非 PDF 一律拒绝', (await call3('file:open-external', { path: path.join(vault, '学习', '测试.md') })).status === 400)
      check('缺路径/相对路径拒绝', (await call3('file:open-external', {})).status === 400 && (await call3('file:open-external', { path: 'pdfs/本地.pdf' })).status === 400)
      check('在 Zotero 里定位条目的 URL 由服务端拼', (await call3('zotero:select-item', { zoteroKey: 'abcd1234' })).status === 200 && urlOpened.length === 1 && urlOpened[0] === 'zotero://select/library/items/ABCD1234')
      check('非法条目 key 拒绝且不调用协议', (await call3('zotero:select-item', { zoteroKey: '..\\..\\etc' })).status === 400 && urlOpened.length === 1)
    } finally { await local3.close() }
    const local4 = await createLocalServer({ port: 0, dist, vault, pdfRoots: [outsideDir], opener: (file) => { opened2.push(file) } })
    try {
      const response = await fetch(local4.origin + '/api/local', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KG-Token': local4.token }, body: JSON.stringify({ method: 'file:open-external', payload: { path: path.join(outsideDir, '外面.pdf') } }) })
      const body = await response.json()
      check('--pdf-root 授权的目录可以打开', response.status === 200 && opened2.length === 2 && body.result.path.endsWith('外面.pdf'))
      const inlineResponse = await fetch(local4.origin + '/api/local', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KG-Token': local4.token }, body: JSON.stringify({ method: 'file:read-pdf', payload: { path: path.join(outsideDir, '外面.pdf') } }) })
      const inlineBody = await inlineResponse.json()
      check('--pdf-root 授权的目录可供内置阅读器读取', inlineResponse.status === 200 && Buffer.from(inlineBody.result.data, 'base64').toString() === '%PDF-1.4 outside')
    } finally { await local4.close() }
  }

  // ---- 系统打开器：不经过 cmd/sh，文件名里的 shell 字符不会被解释 ----
  {
    const [, argv] = openerCommand('D:/tmp/名字 & (1) - 副本.pdf')
    const [command] = openerCommand('D:/tmp/x.pdf')
    check('系统打开器只传一个文件参数、不经 shell', argv.length === 1 && argv[0] === 'D:/tmp/名字 & (1) - 副本.pdf')
    check('系统打开器不是 cmd/sh 命令解释器', !/(^|[\\/])(cmd|powershell|wscript|cscript)$/i.test(command.replace(/\.exe$/i, '')))
  }
  console.log(`\n本地网页服务：${checks}/${checks} 通过`)
} finally { await local.close() }
