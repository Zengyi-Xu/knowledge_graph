/**
 * Zotero 10+ 本地写入 API 客户端（Node 侧，桌面主进程与本机网页服务共用）。
 *
 * 只做三件事：
 * - status：`GET /api/` 探测 Zotero 是否在运行、拿 `Zotero-Server-ID`（写请求必须带）；
 * - authorize：`POST /api/local/authorize`，由 Zotero 弹窗让用户授权，密钥只留在本进程内存里；
 * - write：`POST /api/users/0/items` 批量创建 annotation 条目。
 *
 * 密钥是单次或长期（用户选「Always Allow」）两种；单次密钥在成功写入后即失效，
 * 所以调用方收到 `unauthorized` 时重新 authorize 再试一次即可。
 * 读取 Zotero 库仍然走 zoteroFs.cjs 的只读 SQLite，这里绝不改库文件。
 */
'use strict'

const DEFAULT_BASE_URL = 'http://127.0.0.1:23119/api/'
const DEFAULT_TIMEOUT_MS = 8000
const MAX_BATCH = 50
const APP_NAME = '知识图谱'
const KEY_RE = /^[A-Za-z0-9]{8}$/

/** 把底层 fetch 错误翻成人能看懂的提示（Node 的 cause 里才有 ECONNREFUSED） */
function describeNetworkError(error) {
  if (error && error.name === 'AbortError') return '连接 Zotero 超时，请确认 Zotero 正在运行'
  const code = error && error.cause && error.cause.code
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') {
    return 'Zotero 没有在运行（或本地 API 没有打开：设置 → 高级 → 允许本机其它应用与 Zotero 通信）'
  }
  const message = error instanceof Error ? error.message : String(error)
  return message || '无法连接 Zotero 本地 API'
}

function baseOf(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '') + '/'
}

function failedAction(action, code, error) {
  if (action === 'authorize') return { action, ok: false, remember: false, code, error }
  return { action: 'write', ok: false, saved: [], failed: [], code, error }
}

/**
 * @param {{ baseUrl?: string, timeoutMs?: number, fetch?: typeof fetch, appName?: string }} [options]
 */
function createZoteroLocalApi(options = {}) {
  const baseUrl = baseOf(options.baseUrl)
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS
  const appName = options.appName || APP_NAME
  const fetchImpl = options.fetch || ((url, init) => globalThis.fetch(url, init))
  const state = { serverId: '', key: '', remember: false, version: '' }

  async function request(pathname, init = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetchImpl(baseUrl + pathname, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  function headers(extra) {
    return { 'Zotero-API-Version': '3', ...extra }
  }

  function clearKey() {
    state.key = ''
    state.remember = false
  }

  async function status() {
    let response
    try {
      response = await request('', { method: 'GET', headers: headers() })
    } catch (error) {
      return {
        action: 'status',
        available: false,
        serverId: '',
        version: '',
        writeSupported: false,
        error: describeNetworkError(error),
      }
    }
    const serverId = response.headers.get('zotero-server-id') || ''
    const version = response.headers.get('zotero-api-version') || ''
    if (!response.ok) {
      if (response.status === 403) {
        return {
          action: 'status',
          available: false,
          serverId,
          version,
          writeSupported: false,
          error: 'Zotero 本地 API 没有打开：设置 → 高级 → 勾选「允许本机其它应用与 Zotero 通信」',
        }
      }
      return {
        action: 'status',
        available: false,
        serverId,
        version,
        writeSupported: false,
        error: `Zotero 本地 API 返回 HTTP ${response.status}`,
      }
    }
    // 换了数据库（Server ID 变了）就不再复用旧密钥
    if (state.serverId && serverId !== state.serverId) clearKey()
    if (serverId) state.serverId = serverId
    state.version = version
    return {
      action: 'status',
      available: true,
      serverId,
      version,
      writeSupported: Boolean(serverId),
      error: serverId ? '' : 'Zotero 版本过低：回写需要 Zotero 10+（带本地写入接口）',
    }
  }

  async function authorize() {
    if (!state.serverId) {
      const probe = await status()
      if (!probe.available) return failedAction('authorize', 'unavailable', probe.error)
      if (!probe.writeSupported) return failedAction('authorize', 'unsupported', probe.error)
    }
    let response
    try {
      response = await request('local/authorize', {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json', 'Zotero-Server-ID': state.serverId }),
        body: JSON.stringify({ appName }),
      })
    } catch (error) {
      return failedAction('authorize', 'unavailable', describeNetworkError(error))
    }
    if (response.status === 403) {
      const body = await response.json().catch(() => null)
      const denied = Boolean(body && body.denied)
      return failedAction('authorize', 'denied', denied ? '你在 Zotero 里拒绝了这次写入' : 'Zotero 拒绝了写入授权（HTTP 403）')
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after') || ''
      return failedAction(
        'authorize',
        'rate-limited',
        retryAfter ? `授权请求太频繁，请 ${retryAfter} 秒后再试` : '授权请求太频繁，请稍后再试',
      )
    }
    if (!response.ok) {
      return failedAction('authorize', 'failed', `授权失败（HTTP ${response.status}）`)
    }
    const body = await response.json().catch(() => null)
    if (!body || typeof body.key !== 'string' || !body.key) {
      return failedAction('authorize', 'failed', 'Zotero 没有返回写入密钥')
    }
    state.key = body.key
    state.remember = Boolean(body.remember)
    return { action: 'authorize', ok: true, remember: state.remember, code: '', error: '' }
  }

  /** 单条annotation：itemType → parentItem → annotationType 的顺序不能动（Zotero 要求先定类型） */
  function annotationItem(attachmentKey, annotation) {
    const color = typeof annotation.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(annotation.color)
      ? annotation.color.toLowerCase()
      : '#ffd400'
    return {
      itemType: 'annotation',
      parentItem: attachmentKey,
      annotationType: 'highlight',
      annotationText: String(annotation.text || ''),
      annotationComment: String(annotation.comment || ''),
      annotationColor: color,
      annotationPageLabel: String(annotation.pageLabel || ''),
      annotationSortIndex: String(annotation.sortIndex || ''),
      annotationPosition: String(annotation.position || ''),
    }
  }

  function mapSaved(annotations, body) {
    const successful = (body && (body.successful || body.success)) || {}
    const saved = []
    const seen = new Set()
    for (const [index, value] of Object.entries(successful)) {
      const item = annotations[Number(index)]
      const key = typeof value === 'string' ? value : (value && (value.key || (value.data && value.data.key))) || ''
      if (!item || !key) continue
      saved.push({ index: Number(index), id: String(item.id || ''), key })
      seen.add(Number(index))
    }
    const failed = []
    const failures = (body && body.failed) || {}
    for (const [index, value] of Object.entries(failures)) {
      const item = annotations[Number(index)]
      if (!item) continue
      failed.push({
        index: Number(index),
        id: String(item.id || ''),
        message: (value && (value.message || `HTTP ${value.code}`)) || 'Zotero 拒绝了这条高亮',
      })
      seen.add(Number(index))
    }
    for (let index = 0; index < annotations.length; index++) {
      if (seen.has(index)) continue
      failed.push({ index, id: String(annotations[index].id || ''), message: 'Zotero 没有返回这条高亮的结果' })
    }
    return { saved, failed }
  }

  async function write(payload) {
    const attachmentKey = payload && typeof payload.attachmentKey === 'string' ? payload.attachmentKey : ''
    const annotations = payload && Array.isArray(payload.annotations) ? payload.annotations : []
    if (!KEY_RE.test(attachmentKey)) return failedAction('write', 'bad-request', '回写目标不是有效的 Zotero 附件 key')
    if (!annotations.length) return { action: 'write', ok: true, saved: [], failed: [], code: '', error: '' }
    if (annotations.length > MAX_BATCH) {
      return failedAction('write', 'bad-request', `一次最多回写 ${MAX_BATCH} 条高亮`)
    }
    for (const annotation of annotations) {
      if (!annotation || typeof annotation.position !== 'string' || !annotation.position) {
        return failedAction('write', 'bad-request', '高亮缺少 PDF 坐标，无法回写')
      }
    }
    if (!state.serverId) {
      const probe = await status()
      if (!probe.available) return failedAction('write', 'unavailable', probe.error)
      if (!probe.writeSupported) return failedAction('write', 'unsupported', probe.error)
    }
    if (!state.key) return failedAction('write', 'unauthorized', '需要先在 Zotero 里允许写入')

    const items = annotations.map((annotation) => annotationItem(attachmentKey, annotation))
    let response
    try {
      response = await request('users/0/items', {
        method: 'POST',
        headers: headers({
          'Content-Type': 'application/json',
          'Zotero-Server-ID': state.serverId,
          'Zotero-API-Key': state.key,
        }),
        body: JSON.stringify(items),
      })
    } catch (error) {
      return failedAction('write', 'unavailable', describeNetworkError(error))
    }

    if (response.status === 401) {
      clearKey()
      return failedAction('write', 'unauthorized', 'Zotero 写入授权已失效，需要重新授权')
    }
    if (response.status === 409) {
      return failedAction('write', 'locked', 'Zotero 数据库被锁定（正在同步或维护），请稍后再试')
    }
    if (response.status === 412) {
      clearKey()
      state.serverId = ''
      return failedAction('write', 'server-changed', 'Zotero 数据库已经换了（Server ID 不一致），请重新回写')
    }
    if (response.status === 428) {
      state.serverId = ''
      clearKey()
      return failedAction('write', 'unsupported', 'Zotero 版本过低：回写需要 Zotero 10+')
    }
    if (!response.ok) {
      if (response.status === 400) return failedAction('write', 'bad-request', 'Zotero 认为高亮数据不合法（HTTP 400）')
      return failedAction('write', 'failed', `Zotero 返回 HTTP ${response.status}`)
    }

    const body = await response.json().catch(() => null)
    const { saved, failed } = mapSaved(annotations, body)
    // 单次密钥在这次写入后就被消费掉了；长期密钥（remember）继续用
    if (!state.remember) clearKey()
    return { action: 'write', ok: failed.length === 0, saved, failed, code: '', error: '' }
  }

  return {
    status,
    authorize,
    write,
    /** 测试与排查用：当前缓存的 Server ID / 是否已授权（绝不返回密钥本身） */
    inspect() {
      return { serverId: state.serverId, version: state.version, authorized: Boolean(state.key), remember: state.remember }
    },
  }
}

// 进程级单例：桌面主进程与本机网页服务各自持有一份（内存缓存，不落盘）
const shared = createZoteroLocalApi()

module.exports = {
  createZoteroLocalApi,
  status: () => shared.status(),
  authorize: () => shared.authorize(),
  write: (payload) => shared.write(payload),
  inspect: () => shared.inspect(),
  DEFAULT_BASE_URL,
  MAX_BATCH,
}
