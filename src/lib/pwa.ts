/**
 * PWA 接线：Service Worker 注册（离线壳）+ 「添加到主屏」安装提示。
 *
 * 能力检测口径：只有 `serviceWorker` 接口存在且当前是安全上下文时才注册；
 * 安装入口只在浏览器真的派发过 `beforeinstallprompt` 时才算「可安装」
 * （不猜平台、不看 User-Agent —— iOS Safari 没有这个事件，它走「共享 → 添加到主屏」，
 * 由 capability 面板里的文字提示说明）。
 */

/** `beforeinstallprompt` 不是 DOM 标准类型，这里只声明用到的部分 */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: InstallPromptEvent | null = null
let capturing = false

/** 尽早调用（main.tsx）：捕获浏览器给出的安装机会，避免事件已经派发过 */
export function captureInstallPrompt(): void {
  if (capturing || typeof window === 'undefined') return
  capturing = true
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as InstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
  })
}

/** 浏览器是否已经给了可用的安装机会 */
export function installPromptAvailable(): boolean {
  return deferredPrompt !== null
}

export type InstallResult = 'accepted' | 'dismissed' | 'unavailable'

/** 触发安装提示；没有可用机会时返回 'unavailable'（调用方要如实提示，不能假装成功） */
export async function promptInstall(): Promise<InstallResult> {
  const event = deferredPrompt
  if (!event) return 'unavailable'
  deferredPrompt = null
  try {
    await event.prompt()
    const choice = await event.userChoice
    return choice.outcome === 'accepted' ? 'accepted' : 'dismissed'
  } catch {
    return 'dismissed'
  }
}

/** 开发服务器不注册 SW（避免缓存干扰热更新）；生产构建且是安全上下文时注册 */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (typeof window !== 'undefined' && !window.isSecureContext) return
  if (import.meta.env.DEV) return
  const base = import.meta.env.BASE_URL || './'
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      /* 注册失败（例如 http://非回环 IP）只影响离线缓存，不影响应用本身 */
    })
  })
}
