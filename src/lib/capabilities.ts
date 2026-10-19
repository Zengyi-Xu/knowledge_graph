/**
 * 运行环境能力检测（移动端第一阶段：能力降级）。
 *
 * 三条原则：
 *
 * 1) **只用客观信号，不读 User-Agent**。判定依据只有四类：桥接方法是否存在、
 *    页面是否运行在安全上下文、页面是在本机还是被另一台设备打开、显示模式与指针粒度。
 *
 * 2) **能力分两档来源**。
 *    - `host` 档：目录、附件、Zotero 数据库、`localPdf` 绝对路径、系统阅读器、RTF 富文本
 *      剪贴板、本机 AI 网关 —— 这些都由「运行本机服务的那台电脑」提供，路径与数据库
 *      只在那一台机器上有意义。
 *    - `client` 档：纯文本剪贴板、文件下载/上传、添加到主屏 —— 浏览器自带。
 *
 * 3) **明确的降级**。`host` 档能力要求「桥接存在」**且**「当前页面就是在那台机器上打开的」
 *    （loopback）。手机通过局域网打开同一份网页时，桥接可能仍然存在，但绝对路径与 Zotero
 *    库属于服务端机器 —— 这时必须显式降级并说明原因，不能假装成功。
 */

/** 需要区分支持与否的能力项 */
export type CapabilityId =
  /** 本地笔记目录（每篇一个 .md + meta.json 索引） */
  | 'vaultDir'
  /** 笔记目录内的附件（attachments/） */
  | 'vaultAttachments'
  /** 本机 Zotero 数据库（只读 zotero.sqlite） */
  | 'zoteroSqlite'
  /** 笔记 literature.localPdf 里记录的本地 PDF 绝对路径 */
  | 'localPdf'
  /** 交给系统阅读器 / 文件管理器打开本机文件 */
  | 'systemOpener'
  /** CF_RTF 富文本剪贴板（Word 域代码；粘贴后 Zotero 能识别刷新） */
  | 'rtfClipboard'
  /** 纯文本剪贴板 */
  | 'plainClipboard'
  /** 本机 AI 网关（Kimi Code 模型网关，key 与配置文件都在那台电脑上） */
  | 'localAi'
  /** 浏览器自带：下载 JSON/MD、选择本地文件导入 */
  | 'fileTransfer'
  /** 已作为独立应用打开（添加到主屏 / 独立窗口） */
  | 'installedApp'
  /** 粗粒度指针（触摸为主）—— 只用于调整交互密度，不用于判定「是不是手机」 */
  | 'coarsePointer'

/** 能力的来源档位 */
export type CapabilityScope = 'host' | 'client'

export interface CapabilityState {
  id: CapabilityId
  /** 界面里显示的短名 */
  label: string
  scope: CapabilityScope
  supported: boolean
  /** 不支持时为给用户看的一句话原因；支持时为空串 */
  reason: string
  /** 不支持时可用的替代做法；支持时为空串 */
  fallback: string
}

export type CapabilityReport = Record<CapabilityId, CapabilityState>

/** 检测输入：全部来自当前页面能直接观察到的信号，便于用桩对象做单元测试 */
export interface CapabilityEnv {
  /** `window.knowledgeGraphDesktop` 是否存在（Electron preload 或本地网页桥） */
  hasBridge: boolean
  isElectron: boolean
  isLocalWeb: boolean
  /** `location.hostname` */
  hostname: string
  secureContext: boolean
  vaultApi: boolean
  attachmentApi: boolean
  zoteroApi: boolean
  externalPdfApi: boolean
  systemOpenerApi: boolean
  rtfApi: boolean
  aiApi: boolean
  /** `ClipboardItem.supports('text/rtf')`（Safari 等） */
  nativeRtfClipboard: boolean
  clipboardWriteText: boolean
  /** `a[download]` + `URL.createObjectURL` 可用 */
  download: boolean
  /** 浏览器支持 `beforeinstallprompt`（可添加到主屏，宿主由浏览器决定） */
  installPromptApi: boolean
  /** `matchMedia('(display-mode: standalone)')` */
  standalone: boolean
  /** `matchMedia('(pointer: coarse)')` */
  coarsePointer: boolean
}

/** IPv4 回环：127.0.0.0/8 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return false
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  const parts = host.split('.')
  if (parts.length !== 4) return false
  if (parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false
  return parts[0] === '127'
}

/**
 * 当前页面是不是「运行本机服务的那台电脑」上打开的。
 * Electron 天然是；本地网页端只有走回环地址才算（跨设备打开时绝对路径没有意义）。
 */
export function isHostClient(env: CapabilityEnv): boolean {
  if (env.isElectron) return true
  return env.isLocalWeb && isLoopbackHost(env.hostname)
}

/** 服务端能力的统一降级理由：桥在不在、客户端是不是那台机器 */
function hostScopeReason(env: CapabilityEnv, what: string): string {
  if (!env.hasBridge) {
    return `${what}只能在运行本机服务的电脑上使用（桌面版或本机网页端的 127.0.0.1）：当前页面没有本机服务桥接`
  }
  if (!isHostClient(env)) {
    return `${what}只能在运行本机服务的那台电脑上使用：当前页面是从其他设备（${env.hostname || '未知地址'}）打开的`
  }
  return `当前环境没有「${what}」所需的接口`
}

interface CapabilityInput {
  id: CapabilityId
  label: string
  scope: CapabilityScope
  supported: boolean
  /** 不支持时的原因；说明里用 what 的场合交给 hostScopeReason 生成 */
  reason?: string
  fallback: string
}

const BROWSER_STORAGE_FALLBACK =
  '笔记保存在本机浏览器的本地存储里；换设备请用顶栏「导出备份 / 导入备份」搬运 JSON'

function make(input: CapabilityInput): CapabilityState {
  return {
    id: input.id,
    label: input.label,
    scope: input.scope,
    supported: input.supported,
    reason: input.supported ? '' : (input.reason ?? ''),
    fallback: input.supported ? '' : input.fallback,
  }
}

/** 由一组客观信号算出完整能力表（纯函数） */
export function capabilitiesFor(env: CapabilityEnv): CapabilityReport {
  const host = isHostClient(env)
  const hostOnly = (api: boolean) => api && host

  const list: CapabilityState[] = [
    make({
      id: 'vaultDir',
      label: '本地笔记目录',
      scope: 'host',
      supported: hostOnly(env.vaultApi),
      reason: hostScopeReason(env, '读写本地笔记目录'),
      fallback: `${BROWSER_STORAGE_FALLBACK}（手机端先用本地存储，回到电脑再导入导出）`,
    }),
    make({
      id: 'vaultAttachments',
      label: '目录内附件（attachments/）',
      scope: 'host',
      supported: hostOnly(env.attachmentApi && env.vaultApi),
      reason: hostScopeReason(env, '读写笔记目录里的附件'),
      fallback: '附件（PDF 标注）不会落盘；PDF 阅读与标注仅在支持的环境可用',
    }),
    make({
      id: 'zoteroSqlite',
      label: '本机 Zotero 数据库',
      scope: 'host',
      supported: hostOnly(env.zoteroApi),
      reason: hostScopeReason(env, '读取本机 Zotero 数据库'),
      fallback: '仍可用文献页的「按 DOI / arXiv 导入」和「导入 BibTeX / RIS」手工建立文献笔记',
    }),
    make({
      id: 'localPdf',
      label: '本地 PDF 绝对路径（localPdf）',
      scope: 'host',
      supported: hostOnly(env.externalPdfApi),
      reason: hostScopeReason(env, '读取本机绝对路径下的 PDF'),
      fallback: '文献笔记里的 localPdf 只是那台电脑上的路径，这里会显示为不可用，不会假装打开成功',
    }),
    make({
      id: 'systemOpener',
      label: '系统阅读器 / 文件管理器',
      scope: 'host',
      supported: hostOnly(env.systemOpenerApi),
      reason: hostScopeReason(env, '调用本机系统程序打开文件'),
      fallback: '改用浏览器内置预览；不支持的类型请不要在本机以外依赖它',
    }),
    make({
      id: 'rtfClipboard',
      label: 'Word 域（RTF 富文本剪贴板）',
      scope: 'host',
      supported: hostOnly(env.rtfApi) || (env.nativeRtfClipboard && env.secureContext),
      reason: env.nativeRtfClipboard && !env.secureContext
        ? '当前页面不是安全上下文（HTTPS 或回环地址），浏览器剪贴板接口不可用'
        : '当前环境的剪贴板写不了 CF_RTF：粘贴到 Word 只会得到纯文本，Zotero 不会把它当作可刷新域',
      fallback: '仍会复制纯文本引用，并明确标注「不是 Word 域」',
    }),
    make({
      id: 'plainClipboard',
      label: '纯文本剪贴板',
      scope: 'client',
      supported: env.clipboardWriteText && env.secureContext,
      reason: env.clipboardWriteText
        ? '当前页面不是安全上下文（HTTPS 或回环地址），浏览器剪贴板接口不可用'
        : '当前浏览器没有 navigator.clipboard.writeText',
      fallback: '请手动选中文本复制',
    }),
    make({
      id: 'localAi',
      label: '本机 AI 网关',
      scope: 'host',
      supported: hostOnly(env.aiApi),
      reason: hostScopeReason(env, '调用本机 AI 网关'),
      fallback: 'AI 统筹不会运行，也不会给出「成功」提示；手工整理笔记不受影响',
    }),
    make({
      id: 'fileTransfer',
      label: '文件下载 / 导入',
      scope: 'client',
      supported: env.download,
      reason: '当前浏览器不支持 Blob 下载',
      fallback: '请改用桌面版或本机网页端导出备份',
    }),
    make({
      id: 'installedApp',
      label: '已添加到主屏（独立窗口）',
      scope: 'client',
      supported: env.standalone,
      reason: env.installPromptApi
        ? '当前在浏览器标签页里运行；浏览器会提供「添加到主屏 / 安装应用」入口'
        : '当前浏览器没有提供安装入口（或已经安装）',
      fallback: '直接用浏览器打开也能用，界面与安装后一致',
    }),
    make({
      id: 'coarsePointer',
      label: '触摸优先指针',
      scope: 'client',
      supported: env.coarsePointer,
      reason: '当前使用精细指针（鼠标 / 触控板）',
      fallback: '界面按桌面密度渲染',
    }),
  ]

  const report = {} as CapabilityReport
  for (const item of list) report[item.id] = item
  return report
}

/** 读取当前页面的真实信号（浏览器环境；服务端渲染时返回一份「全部不可用」的快照） */
export function readCapabilityEnv(): CapabilityEnv {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      hasBridge: false,
      isElectron: false,
      isLocalWeb: false,
      hostname: '',
      secureContext: false,
      vaultApi: false,
      attachmentApi: false,
      zoteroApi: false,
      externalPdfApi: false,
      systemOpenerApi: false,
      rtfApi: false,
      aiApi: false,
      nativeRtfClipboard: false,
      clipboardWriteText: false,
      download: false,
      installPromptApi: false,
      standalone: false,
      coarsePointer: false,
    }
  }
  const bridge = window.knowledgeGraphDesktop
  const media = (query: string) => {
    try {
      return typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false
    } catch {
      return false
    }
  }
  let nativeRtfClipboard = false
  try {
    nativeRtfClipboard = typeof ClipboardItem !== 'undefined' && Boolean(ClipboardItem.supports?.('text/rtf'))
  } catch {
    nativeRtfClipboard = false
  }
  return {
    hasBridge: Boolean(bridge),
    isElectron: Boolean(bridge?.isElectron),
    isLocalWeb: Boolean(bridge?.isLocalWeb),
    hostname: typeof location === 'undefined' ? '' : location.hostname,
    secureContext: window.isSecureContext === true,
    vaultApi: Boolean(bridge?.listVault && bridge?.writeVault),
    attachmentApi: Boolean(bridge?.readAttachment && bridge?.writeAttachment),
    zoteroApi: Boolean(bridge?.readZotero && bridge?.readZoteroPdf),
    externalPdfApi: Boolean(bridge?.readExternalPdf && bridge?.openExternalFile),
    systemOpenerApi: Boolean(bridge?.openExternalFile && bridge?.openAttachmentExternal),
    rtfApi: Boolean(bridge?.writeClipboardRtf),
    aiApi: Boolean(bridge?.aiStatus && bridge?.aiComplete),
    nativeRtfClipboard,
    clipboardWriteText: typeof navigator.clipboard?.writeText === 'function',
    download: typeof document !== 'undefined' && 'download' in document.createElement('a') && typeof URL?.createObjectURL === 'function',
    installPromptApi: 'onbeforeinstallprompt' in window,
    standalone: media('(display-mode: standalone)') || media('(display-mode: fullscreen)') || media('(display-mode: minimal-ui)'),
    coarsePointer: media('(pointer: coarse)'),
  }
}

/** 当前页面（浏览器）里的能力表；等价于 `capabilitiesFor(readCapabilityEnv())` */
export function currentCapabilities(): CapabilityReport {
  return capabilitiesFor(readCapabilityEnv())
}

/** 单项能力（读一次真实环境；调用方通常是弹提示前的一次性判断） */
export function capability(id: CapabilityId): CapabilityState {
  return currentCapabilities()[id]
}

/** 能力表里「能用的」与「降级的」分开，便于界面与测试断言 */
export function splitCapabilities(report: CapabilityReport): {
  available: CapabilityState[]
  degraded: CapabilityState[]
} {
  const order: CapabilityId[] = [
    'vaultDir',
    'vaultAttachments',
    'zoteroSqlite',
    'localPdf',
    'systemOpener',
    'rtfClipboard',
    'plainClipboard',
    'localAi',
    'fileTransfer',
    'installedApp',
    'coarsePointer',
  ]
  const sorted = order.map((id) => report[id]).filter(Boolean)
  return {
    available: sorted.filter((c) => c.supported),
    degraded: sorted.filter((c) => !c.supported),
  }
}

/**
 * 一句话环境摘要（顶栏 / 移动端状态条用）。
 * 例：`本机服务：目录 / Zotero / 本机 AI 可用`、`移动端：仅浏览器本地存储`
 */
export function capabilitySummary(report: CapabilityReport): string {
  const hostIds: CapabilityId[] = ['vaultDir', 'zoteroSqlite', 'localPdf', 'rtfClipboard', 'localAi']
  const names: Record<CapabilityId, string> = {
    vaultDir: '目录',
    vaultAttachments: '附件',
    zoteroSqlite: 'Zotero',
    localPdf: '本地 PDF',
    systemOpener: '系统打开',
    rtfClipboard: 'Word 域',
    plainClipboard: '剪贴板',
    localAi: '本机 AI',
    fileTransfer: '导入导出',
    installedApp: '主屏应用',
    coarsePointer: '触摸',
  }
  const ok = hostIds.filter((id) => report[id].supported).map((id) => names[id])
  const total = hostIds.length
  if (ok.length === total) return `本机服务：${ok.join(' / ')} 全部可用`
  if (ok.length === 0) return '移动端：仅浏览器本地存储与导入导出'
  return `本机服务：${ok.join(' / ')} 可用，${total - ok.length} 项已降级`
}
