/**
 * 本机 Kimi 模型网关调用（anthropic-messages 协议）。
 * key 的来源：Kimi Code 的 openclaw.json（只读提取）。
 *
 * 安全红线（写死）：
 * - API key 只存在于本机进程内，绝不写日志、绝不进返回值（渲染端只能拿到脱敏预览）；
 * - 只向配置里的 baseUrl 发请求，不允许调用方传任意 URL（只允许覆盖配置文件路径）；
 * - 报错信息一律脱敏。
 */
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_CONFIG = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.kimi',
  'kimi-claw',
  'openclaw.json',
)

/** 脱敏：前 6 位 + … + 后 4 位；非字符串直接返回空 */
function maskKey(key) {
  if (typeof key !== 'string' || key.length < 10) return ''
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

/**
 * 从 openclaw.json 提取 kimi-coding 网关配置。
 * @param {string} [configPath] 配置文件绝对路径（默认 ~/.kimi/kimi-claw/openclaw.json）
 * @returns {{ ok: true, baseUrl, apiKey, model, headers } | { ok: false, error }}
 */
function loadKimiConfig(configPath = DEFAULT_CONFIG) {
  let raw
  try {
    raw = fs.readFileSync(configPath, 'utf-8')
  } catch {
    return { ok: false, error: `找不到 Kimi Code 配置文件：${configPath}` }
  }
  let json
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Kimi Code 配置文件不是合法 JSON' }
  }
  const provider = json?.models?.providers?.['kimi-coding']
  if (!provider || typeof provider.baseUrl !== 'string' || typeof provider.apiKey !== 'string') {
    return { ok: false, error: '配置里缺少 models.providers.kimi-coding（baseUrl/apiKey）' }
  }
  const model = Array.isArray(provider.models) && provider.models[0]?.id ? provider.models[0].id : ''
  if (!model) return { ok: false, error: '配置里 kimi-coding 没有可用模型' }
  return {
    ok: true,
    baseUrl: provider.baseUrl.replace(/\/+$/, ''),
    apiKey: provider.apiKey,
    model,
    headers: provider.headers && typeof provider.headers === 'object' ? provider.headers : {},
  }
}

/** 渲染端可见的状态：脱敏，绝不包含完整 key */
function aiStatus(configPath) {
  const cfg = loadKimiConfig(configPath)
  if (!cfg.ok) return { configured: false, error: cfg.error }
  return {
    configured: true,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    keyPreview: maskKey(cfg.apiKey),
  }
}

/**
 * 调 anthropic-messages 网关（非流式，取完整文本）。
 * @param {{ system?: string, prompt: string, maxTokens?: number, configPath?: string }} payload
 * @returns {{ ok: true, text, model, usage? } | { ok: false, error }}
 */
async function aiComplete(payload) {
  if (!payload || typeof payload.prompt !== 'string' || !payload.prompt.trim()) {
    return { ok: false, error: '缺少 prompt' }
  }
  const cfg = loadKimiConfig(payload.configPath)
  if (!cfg.ok) return { ok: false, error: cfg.error }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  try {
    const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        ...cfg.headers,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: Math.min(Math.max(payload.maxTokens || 8192, 256), 32768),
        ...(payload.system ? { system: payload.system } : {}),
        messages: [{ role: 'user', content: payload.prompt }],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // 只透出状态码与服务器返回的 error.message，不透出请求体（可能含 key 上下文）
      let detail = ''
      try {
        const j = JSON.parse(body)
        detail = j?.error?.message ? String(j.error.message).slice(0, 200) : ''
      } catch {
        detail = ''
      }
      return { ok: false, error: `网关返回 ${res.status}${detail ? `：${detail}` : ''}` }
    }
    const data = await res.json()
    const text = (Array.isArray(data.content) ? data.content : [])
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (!text) return { ok: false, error: '网关返回了空内容' }
    return { ok: true, text, model: cfg.model, usage: data.usage ?? null }
  } catch (error) {
    if (error && error.name === 'AbortError') return { ok: false, error: '请求超时（180 秒）' }
    return { ok: false, error: `网络错误：${String((error && error.message) || error).slice(0, 200)}` }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { aiStatus, aiComplete, maskKey, DEFAULT_CONFIG }
