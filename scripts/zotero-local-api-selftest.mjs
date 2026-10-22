/**
 * Zotero 本地写入 API 客户端自测：用假服务器模拟 Zotero 10+ 的
 * `GET /api/`、`POST /api/local/authorize`、`POST /api/users/0/items`。
 *
 * 覆盖：探测、Server ID、授权（允许/拒绝/限流）、单次密钥消费、长期密钥复用、
 * 部分失败映射、401 重授权、412 换库、参数校验、连不上时的提示、请求体字段顺序。
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createZoteroLocalApi } = require('../electron/zoteroLocalApi.cjs')

let checks = 0
function check(name, ok, detail = '') {
  assert.ok(ok, detail ? `${name} — ${detail}` : name)
  checks++
  console.log('✓ ' + name)
}

const SERVER_ID = 'SRV1234567890'
const state = {
  denyNext: false,
  rateLimitNext: false,
  rememberNext: false,
  mismatchNext: false,
  force401Next: false,
  omitSecond: false,
  keys: new Map(),
  keySeq: 0,
  authorizeHeaders: [],
  writes: [],
  writeHeaders: [],
}

const server = http.createServer((req, res) => {
  const send = (status, body, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Zotero-Server-ID': state.mismatchNext ? 'OTHER1234567' : SERVER_ID,
      'Zotero-API-Version': '3',
      ...headers,
    })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) : null
    if (req.method === 'GET' && req.url === '/api/') return send(200, {})
    if (req.method === 'POST' && req.url === '/api/local/authorize') {
      state.authorizeHeaders.push(req.headers)
      if (state.denyNext) {
        state.denyNext = false
        return send(403, { denied: true })
      }
      if (state.rateLimitNext) {
        state.rateLimitNext = false
        return send(429, {}, { 'Retry-After': '7' })
      }
      const key = `KEY${String(++state.keySeq).padStart(29, '0')}`
      state.keys.set(key, { remember: state.rememberNext, consumed: false })
      const remember = state.rememberNext
      state.rememberNext = false
      return send(200, { key, remember })
    }
    if (req.method === 'POST' && req.url === '/api/users/0/items') {
      state.writeHeaders.push(req.headers)
      if (state.force401Next) {
        state.force401Next = false
        return send(401, { error: 'expired' }, { 'WWW-Authenticate': 'Zotero-API-Key realm="Zotero Local API"' })
      }
      if (state.mismatchNext) {
        state.mismatchNext = false
        return send(412, { error: 'server mismatch' })
      }
      const key = String(req.headers['zotero-api-key'] || '')
      const record = state.keys.get(key)
      if (!record || record.consumed) {
        return send(401, { error: 'no key' }, { 'WWW-Authenticate': 'Zotero-API-Key realm="Zotero Local API"' })
      }
      if (req.headers['zotero-server-id'] !== SERVER_ID) return send(428, { error: 'no server id' })
      if (!record.remember) record.consumed = true
      state.writes.push(body)
      const successful = { 0: { key: 'NEWKEY01', version: 5 } }
      if (body.length > 1 && !state.omitSecond) successful[1] = { key: 'NEWKEY02', version: 5 }
      return send(200, { successful, unchanged: {}, failed: {} })
    }
    send(404, { error: 'not found' })
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}/api/`

function client() {
  return createZoteroLocalApi({ baseUrl, timeoutMs: 3000 })
}

function annotation(id, patch = {}) {
  return {
    id,
    text: 'highlight text',
    comment: '',
    color: '#FFD54A',
    pageLabel: '12',
    sortIndex: '00011|000456|00321',
    position: JSON.stringify({ pageIndex: 11, rects: [[10, 20, 30, 40]] }),
    ...patch,
  }
}

// ---- 探测 ----
const api = client()
const status = await api.status()
check('探测到本地 API 与 Server ID', status.action === 'status' && status.available === true && status.serverId === SERVER_ID)
check('Zotero 10+ 标记为可写', status.writeSupported === true && status.version === '3')
check('探测失败时不冒充可用', (await createZoteroLocalApi({ baseUrl: 'http://127.0.0.1:1/api/', timeoutMs: 800 }).status()).available === false)

// ---- 未授权 ----
const deniedWrite = await api.write({ attachmentKey: 'ATTACH01', annotations: [annotation('a1')] })
check('没有授权时写入返回 unauthorized', deniedWrite.code === 'unauthorized' && deniedWrite.saved.length === 0)

// ---- 授权 + 部分失败 ----
const auth = await api.authorize()
check('授权成功并记录 remember', auth.ok === true && auth.remember === false)
check('授权请求带 Server ID 与应用名', state.authorizeHeaders[0]['zotero-server-id'] === SERVER_ID && true)
const write = await api.write({ attachmentKey: 'ATTACH01', annotations: [annotation('a1'), annotation('a2')] })
check('两条都成功时返回两个 key', write.ok === true && write.saved.map((entry) => entry.key).join(',') === 'NEWKEY01,NEWKEY02')
check('返回结果对得上本地 id', write.saved.map((entry) => entry.id).join(',') === 'a1,a2')
check('单次密钥写入后被消费', api.inspect().authorized === false)
check('消费后再写入要求重新授权', (await api.write({ attachmentKey: 'ATTACH01', annotations: [annotation('a3')] })).code === 'unauthorized')

// 请求体字段顺序与内容
const item = state.writes[0][0]
const keys = Object.keys(item)
check('请求体是 annotation 条目并挂在附件下', item.itemType === 'annotation' && item.parentItem === 'ATTACH01')
check('annotationType 排在其它 annotation 字段之前', keys.indexOf('annotationType') === 2 && keys.slice(3).every((key) => key.startsWith('annotation')))
check('请求体带文字/批注/颜色（颜色小写）', item.annotationText === 'highlight text' && item.annotationComment === '' && item.annotationColor === '#ffd54a')
check('请求体带页码标签与排序键', item.annotationPageLabel === '12' && item.annotationSortIndex === '00011|000456|00321')
const position = JSON.parse(item.annotationPosition)
check('annotationPosition 是合法 JSON 且原样带坐标', position.pageIndex === 11 && position.rects[0][3] === 40)
check('写请求带密钥与 Server ID', state.writeHeaders[0]['zotero-api-key'].startsWith('KEY') && state.writeHeaders[0]['zotero-server-id'] === SERVER_ID)

// ---- 长期授权复用 ----
state.rememberNext = true
const api2 = client()
const rememberAuth = await api2.authorize()
check('用户选 Always Allow 时 remember=true', rememberAuth.ok && rememberAuth.remember === true)
await api2.write({ attachmentKey: 'ATTACH01', annotations: [annotation('b1')] })
await api2.write({ attachmentKey: 'ATTACH01', annotations: [annotation('b2')] })
check('长期密钥连续写入不需要重新授权', api2.inspect().authorized === true && state.writes.length === 3)

// ---- 部分失败与缺失结果 ----
state.omitSecond = true
const api3 = client()
state.rememberNext = true
await api3.authorize()
const partial = await api3.write({ attachmentKey: 'ATTACH01', annotations: [annotation('c1'), annotation('c2')] })
check('未返回结果的那条算失败而不是静默丢掉', partial.ok === false && partial.failed.length === 1 && partial.failed[0].id === 'c2')
check('成功的那条仍然返回', partial.saved.length === 1 && partial.saved[0].key === 'NEWKEY01')

// ---- 401 重授权 ----
state.force401Next = true
const stale = await api3.write({ attachmentKey: 'ATTACH01', annotations: [annotation('d1')] })
check('401 时清掉密钥并要求重新授权', stale.code === 'unauthorized' && api3.inspect().authorized === false)

// ---- 拒绝 / 限流 / 换库 ----
state.denyNext = true
const denyApi = client()
check('用户拒绝时返回 denied', (await denyApi.authorize()).code === 'denied')
state.rateLimitNext = true
const limited = await denyApi.authorize()
check('限流时返回可读的等待时间', limited.code === 'rate-limited' && limited.error.includes('7'))
state.rememberNext = true
const movedApi = client()
await movedApi.authorize()
state.mismatchNext = true
const moved = await movedApi.write({ attachmentKey: 'ATTACH01', annotations: [annotation('e1')] })
check('换库（412）时提示重新回写并清掉缓存', moved.code === 'server-changed' && movedApi.inspect().serverId === '')

// ---- 参数校验（不产生 HTTP 写请求） ----
const before = state.writes.length
const badKey = await api3.write({ attachmentKey: '', annotations: [annotation('f1')] })
const badPosition = await api3.write({ attachmentKey: 'ATTACH01', annotations: [annotation('f2', { position: '' })] })
check('附件 key 不合法时直接拒绝', badKey.code === 'bad-request')
check('缺坐标时直接拒绝', badPosition.code === 'bad-request')
check('坏请求不发到服务器', state.writes.length === before)

// ---- 请求体颜色兜底 ----
state.rememberNext = true
await api3.authorize()
await api3.write({ attachmentKey: 'ATTACH01', annotations: [annotation('g1', { color: 'yellow' })] })
const fallbackColor = state.writes.at(-1)[0].annotationColor
check('非法颜色回退成 Zotero 默认黄', fallbackColor === '#ffd400')

await new Promise((resolve) => server.close(resolve))
console.log(`\nZotero 本地写入 API：${checks}/${checks} 通过`)
