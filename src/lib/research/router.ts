/**
 * 研究追问的模型路由：哪个环节用哪个模型，失败时怎么办。
 * 纯逻辑模块：不碰 IO，所有函数可单测。
 *
 * 产品边界（第一轮）：
 * - 生成追问：只用本地 Ollama（Qwen）。本地不可用 → 明确报错，绝不静默切云端。
 * - 云端「深入分析」：用户显式手动触发，用用户选好的云端提供方（deepseek/kimi）。
 */

export type CloudProvider = 'deepseek' | 'kimi'
export type ResearchRoute = 'generate' | 'deep-dive'

export interface OllamaSettings {
  baseUrl: string
  model: string
}

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  return trimmed || DEFAULT_OLLAMA_BASE_URL
}

export interface ProviderStatusLike {
  configured: boolean
  error?: string
  model?: string
  models?: string[]
  baseUrl?: string
}

export type GenerateDecision =
  | { ok: true; provider: 'ollama'; baseUrl: string; model: string }
  | { ok: false; error: string }

/**
 * 生成追问的路由决策。ollama 未配置/不可达 → 返回明确错误，调用方展示错误态；
 * 这里绝不回退到云端（隐私承诺：默认环节不出本机）。
 */
export function decideGenerate(settings: OllamaSettings, status: ProviderStatusLike | undefined): GenerateDecision {
  const baseUrl = normalizeBaseUrl(settings.baseUrl)
  const model = settings.model.trim()
  if (!model) {
    return { ok: false, error: '本地模型未配置：请在「研究追问」面板里设置 Ollama 地址与模型名，并做一次连接测试。' }
  }
  if (!status) {
    return { ok: false, error: '本机服务不可用：无法连接本地模型网关。' }
  }
  if (!status.configured) {
    return {
      ok: false,
      error: `本地 Qwen 不可用：${status.error ?? '未配置'}。生成追问不会改用云端模型（隐私边界）。`,
    }
  }
  return { ok: true, provider: 'ollama', baseUrl, model }
}

export type DeepDiveDecision =
  | { ok: true; provider: CloudProvider; model?: string }
  | { ok: false; error: string }

/** 深入分析：用户显式触发；只允许用户选定的云端提供方，且必须已配置 */
export function decideDeepDive(
  chosen: CloudProvider,
  statuses: Partial<Record<CloudProvider, ProviderStatusLike | undefined>>,
): DeepDiveDecision {
  const status = statuses[chosen]
  if (!status) return { ok: false, error: '本机 AI 网关不可用，无法运行云端深入分析。' }
  if (!status.configured) {
    return { ok: false, error: `${chosen === 'deepseek' ? 'DeepSeek' : 'Kimi'} 未配置：${status.error ?? '不可用'}` }
  }
  return { ok: true, provider: chosen }
}

/**
 * 深入分析的材料组装（隐私边界的核心）：返回的笔记清单只包含
 * 当前笔记 + 用户显式勾选的相关笔记，绝不追加任何「顺手带上的」内容。
 */
export function deepDiveMaterialIds(activeId: string, selectedIds: ReadonlySet<string>): string[] {
  const ids = [activeId, ...selectedIds]
  return [...new Set(ids.filter((id) => typeof id === 'string' && id))]
}
