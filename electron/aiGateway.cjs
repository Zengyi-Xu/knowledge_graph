/**
 * 本机 AI 网关调用。支持两个提供方：
 * - kimi：Kimi Code 的 anthropic-messages 兼容网关（key 从 openclaw.json 只读提取）
 * - deepseek：DeepSeek 官方 OpenAI 兼容接口（key 从 ZCode 的 provider_config.json 只读提取）
 *
 * 安全红线（写死）：
 * - API key 只存在于本机进程内，绝不写日志、绝不进返回值（渲染端只能拿到脱敏预览）；
 * - 端点由本模块决定（只允许用环境变量覆盖），调用方不能传任意 URL；
 * - 报错信息一律脱敏。
 */
const fs = require('node:fs')
const path = require('node:path')

const HOME = process.env.USERPROFILE || process.env.HOME || ''

const DEFAULT_CONFIG = path.join(HOME, '.kimi', 'kimi-claw', 'openclaw.json')
/** ZCode 桌面端的 provider 配置（DeepSeek key 的“单一来源”，只读） */
const DEFAULT_DEEPSEEK_CONFIG = path.join(HOME, '.zcode', 'v2', 'provider_config.json')
/** 备用来源：DSH 的凭据文件（与 ZCode 当前使用的是同一把 key） */
const DSH_CREDENTIALS = path.join(HOME, '.dsh', '.credentials.yaml')

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-flash'

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

/** 读取 DSH 凭据文件里的 DEEPSEEK_API_KEY（没有就返回空） */
function readDshKey() {
  try {
    const text = fs.readFileSync(DSH_CREDENTIALS, 'utf-8')
    const match = text.match(/DEEPSEEK_API_KEY\s*:\s*["']?([^"'\s]+)/)
    return match ? match[1] : ''
  } catch {
    return ''
  }
}

/**
 * DeepSeek 配置：key 优先级 = 环境变量 → ZCode provider_config.json → DSH 凭据文件。
 * 模型列表取自 provider 的 modelOrder；可用 DEEPSEEK_BASE_URL / DEEPSEEK_MODEL 覆盖。
 * @param {string} [configPath] ZCode provider_config.json 路径
 */
function loadDeepSeekConfig(configPath = process.env.DEEPSEEK_CONFIG || DEFAULT_DEEPSEEK_CONFIG) {
  let models = []
  let fileKey = ''
  let fileError = ''
  try {
    const json = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const rules = json?.config?.providerConfigRules?.providerRules
    const rule = Array.isArray(rules) ? rules.find((r) => r && r.providerId === 'deepseek') : null
    if (rule) {
      const order = rule?.config?.modelOrder
      if (Array.isArray(order)) models = order.filter((m) => typeof m === 'string' && m.trim())
      const key = rule?.config?.access?.apiKey
      if (typeof key === 'string') fileKey = key.trim()
    } else {
      fileError = `${configPath} 里没有 deepseek provider`
    }
  } catch {
    fileError = `读不到 ${configPath}`
  }

  const apiKey = (process.env.DEEPSEEK_API_KEY || '').trim() || fileKey || readDshKey()
  if (!apiKey) {
    return {
      ok: false,
      error: `找不到 DeepSeek key：请设置环境变量 DEEPSEEK_API_KEY，或在 ${configPath} 的 deepseek provider 里配置${
        fileError ? `（${fileError}）` : ''
      }`,
    }
  }

  const model = (process.env.DEEPSEEK_MODEL || '').trim() || models[0] || DEEPSEEK_DEFAULT_MODEL
  if (!models.includes(model)) models = [model, ...models]
  return {
    ok: true,
    baseUrl: (process.env.DEEPSEEK_BASE_URL || DEEPSEEK_BASE_URL).replace(/\/+$/, ''),
    apiKey,
    model,
    models,
  }
}

/** 兼容旧调用：字符串参数视为 Kimi 的 configPath */
function normalizeStatusRequest(options) {
  if (typeof options === 'string') return { provider: 'kimi', configPath: options || undefined }
  if (options && typeof options === 'object') {
    return {
      provider: options.provider === 'deepseek' ? 'deepseek' : 'kimi',
      configPath: typeof options.configPath === 'string' && options.configPath ? options.configPath : undefined,
    }
  }
  return { provider: 'kimi', configPath: undefined }
}

/** 渲染端可见的状态：脱敏，绝不包含完整 key */
function aiStatus(options) {
  const { provider, configPath } = normalizeStatusRequest(options)
  if (provider === 'deepseek') {
    const cfg = loadDeepSeekConfig(configPath)
    if (!cfg.ok) return { configured: false, provider, error: cfg.error }
    return {
      configured: true,
      provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      models: cfg.models,
      keyPreview: maskKey(cfg.apiKey),
    }
  }
  const cfg = loadKimiConfig(configPath)
  if (!cfg.ok) return { configured: false, provider, error: cfg.error }
  return {
    configured: true,
    provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    models: [cfg.model],
    keyPreview: maskKey(cfg.apiKey),
  }
}

/** prompt 或 messages 至少给一个；messages 支持多轮对话 */
function normalizeConversation(payload) {
  if (Array.isArray(payload.messages)) {
    const messages = payload.messages
      .filter(
        (m) =>
          m &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string' &&
          m.content.trim(),
      )
      .slice(-40)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 200_000) }))
    if (messages.length) return messages
  }
  if (typeof payload.prompt === 'string' && payload.prompt.trim()) {
    return [{ role: 'user', content: payload.prompt }]
  }
  return null
}

function clamp(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.round(n), min), max)
}

async function kimiComplete(payload, cfg, conversation) {
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
        max_tokens: clamp(payload.maxTokens, 256, 32768, 8192),
        ...(payload.system ? { system: payload.system } : {}),
        messages: conversation,
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
      return { ok: false, error: `Kimi 网关返回 ${res.status}${detail ? `：${detail}` : ''}` }
    }
    const data = await res.json()
    const text = (Array.isArray(data.content) ? data.content : [])
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (!text) return { ok: false, error: 'Kimi 网关返回了空内容' }
    return { ok: true, text, model: data.model || cfg.model, usage: data.usage ?? null }
  } catch (error) {
    if (error && error.name === 'AbortError') return { ok: false, error: 'Kimi 请求超时（180 秒）' }
    return { ok: false, error: `Kimi 网络错误：${String((error && error.message) || error).slice(0, 200)}` }
  } finally {
    clearTimeout(timer)
  }
}

async function deepseekComplete(payload, cfg, conversation) {
  const requested = typeof payload.model === 'string' && /^[A-Za-z0-9._-]+$/.test(payload.model) ? payload.model : ''
  const model = requested || cfg.model
  const messages = payload.system ? [{ role: 'system', content: payload.system }, ...conversation] : conversation
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: clamp(payload.maxTokens, 256, 8192, 8192),
        stream: false,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      let detail = ''
      try {
        const j = JSON.parse(body)
        detail = j?.error?.message ? String(j.error.message).slice(0, 200) : ''
      } catch {
        detail = ''
      }
      return { ok: false, error: `DeepSeek 网关返回 ${res.status}${detail ? `：${detail}` : ''}` }
    }
    const data = await res.json()
    const choice = Array.isArray(data.choices) ? data.choices[0] : null
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : ''
    if (!text.trim()) return { ok: false, error: 'DeepSeek 网关返回了空内容' }
    return { ok: true, text, model: data.model || model, usage: data.usage ?? null }
  } catch (error) {
    if (error && error.name === 'AbortError') return { ok: false, error: 'DeepSeek 请求超时（180 秒）' }
    return { ok: false, error: `DeepSeek 网络错误：${String((error && error.message) || error).slice(0, 200)}` }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 调模型网关（非流式，取完整文本）。
 * @param {{
 *   provider?: 'kimi'|'deepseek', prompt?: string,
 *   messages?: { role: 'user'|'assistant', content: string }[],
 *   system?: string, model?: string, maxTokens?: number, configPath?: string
 * }} payload
 * @returns {{ ok: true, text, model, usage? } | { ok: false, error }}
 */
async function aiComplete(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: '缺少请求内容' }
  const conversation = normalizeConversation(payload)
  if (!conversation) return { ok: false, error: '缺少 prompt' }

  if (payload.provider === 'deepseek') {
    const cfg = loadDeepSeekConfig(payload.configPath)
    if (!cfg.ok) return { ok: false, error: cfg.error }
    return deepseekComplete(payload, cfg, conversation)
  }

  const cfg = loadKimiConfig(payload.configPath)
  if (!cfg.ok) return { ok: false, error: cfg.error }
  return kimiComplete(payload, cfg, conversation)
}

module.exports = {
  aiStatus,
  aiComplete,
  maskKey,
  DEFAULT_CONFIG,
  DEFAULT_DEEPSEEK_CONFIG,
  DSH_CREDENTIALS,
}
