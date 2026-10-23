// FROZEN(desktop-bridge) 契约冻结：本文件就是契约，可以读；实现在 electron/*.cjs（黑箱，排查故障时才读）。
// 新增/改名方法要同时改 electron/preload.cjs，然后 npm run frozen:update -- "desktop-bridge ..."（docs/FROZEN.md）
import type { ZoteroMarkupBundle } from '@/lib/zoteroMarkup'
import type { ZoteroLocalApiRequest, ZoteroLocalApiResult } from '@/lib/zoteroWriteback'

export {}

/** 与 electron/vaultFs.cjs 的返回结构保持一致 */
export interface VaultDirListing {
  exists: boolean
  meta: string | null
  md: { name: string; mtimeMs: number; size: number }[]
}

export interface VaultWritePayload {
  writes: { file: string; text: string }[]
  deletes: string[]
  meta: string | null
}

declare global {
  interface Window {
    knowledgeGraphDesktop?: {
      isElectron: boolean
      isLocalWeb?: boolean
      defaultVaultDir?: string
      defaultZoteroDb?: string
      chooseSyncFile: () => Promise<string | null>
      writeSyncFile: (
        filePath: string,
        contents: string,
      ) => Promise<{ filePath: string }>
      readSyncFile: (filePath: string) => Promise<{ content: string | null }>

      chooseVaultDir: () => Promise<string | null>
      listVault: (dir: string) => Promise<VaultDirListing>
      readVaultFiles: (
        dir: string,
        names: string[],
      ) => Promise<{ name: string; text: string | null }[]>
      writeVault: (
        dir: string,
        plan: VaultWritePayload,
      ) => Promise<{ written: number; deleted: number; filePath: string }>
      openVaultDir: (dir: string) => Promise<{ error: string | null }>

      // 附件：vault 内 attachments/ 目录；二进制以 Uint8Array 传输
      listAttachments: (
        dir: string,
      ) => Promise<{ name: string; mtimeMs: number; size: number }[]>
      readAttachment: (dir: string, rel: string) => Promise<Uint8Array | null>
      writeAttachment: (
        dir: string,
        rel: string,
        data: Uint8Array,
      ) => Promise<{ name: string }>
      removeAttachment: (dir: string, rel: string) => Promise<{ name: string }>
      /** 用系统默认程序打开附件（如 PDF 阅读器）；成功返回 { error: null } */
      openAttachmentExternal: (dir: string, rel: string) => Promise<{ error: string | null }>
      /** 写富文本剪贴板（CF_RTF）：Word 域代码引用需要；浏览器写不了 text/rtf */
      writeClipboardRtf: (rtf: string, text: string) => Promise<{ error: string | null }>
      /** 原生打开对话框选 PDF；返回文件名与二进制；取消返回 null */
      chooseOpenAttachment: () => Promise<{
        filePath: string
        name: string
        data: Uint8Array
      } | null>
      /** 原生保存对话框选目标路径；取消返回 null */
      chooseSaveAttachment: (defaultName: string) => Promise<string | null>

      // Zotero：只读同步 zotero.sqlite（需先退出 Zotero 释放锁）
      readZotero: (
        dbPath: string,
      ) => Promise<{
        collections: string[]
        items: {
          zoteroKey: string
          itemType: string
          title: string
          doi: string
          year: number | null
          venue: string
          authors: string[]
          collectionPaths: string[]
          pdfCount: number
          availablePdfCount: number
        }[]
      }>
      openZoteroPdf: (dbPath: string, zoteroKey: string, zoteroKeys?: string[]) => Promise<{ path: string }>
      /** 读取 Zotero key 对应的本地 PDF，供应用内 PDF.js 阅读；最大 150 MB */
      readZoteroPdf: (dbPath: string, zoteroKey: string, zoteroKeys?: string[]) => Promise<{ data: Uint8Array; name: string; path: string }>
      /**
       * 只读读取一篇文献的 Zotero 标注与子笔记（不写 Zotero）。
       * 附件归属由主进程按书目 key 从数据库解析，渲染端不能指定任意附件路径；
       * 数据库被占用 / 查询失败会抛错，绝不以「空结果」冒充同步成功。
       */
      readZoteroMarkup: (
        dbPath: string,
        zoteroKey: string,
        zoteroKeys?: string[],
      ) => Promise<ZoteroMarkupBundle>
      /**
       * Zotero 10+ 本地写入（只增，绝不删改 Zotero 里的对象）：
       * status 探测本地 API 与 Server ID；authorize 让 Zotero 弹窗授权（密钥只留在宿主进程内存）；
       * write 把本软件画的高亮批量创建成 attachment 下的 annotation 条目。
       * 只连 127.0.0.1:23119，不联网；401 时调用方重新 authorize 再试一次即可。
       */
      zoteroLocalApi?: (request: ZoteroLocalApiRequest) => Promise<ZoteroLocalApiResult>
      /** 打开笔记 localPdf 字段记录的本地 PDF（只接受存在的 .pdf 绝对路径） */
      openExternalFile: (filePath: string) => Promise<{ error: string | null }>
      /** 读取笔记 localPdf 字段记录的 PDF，供应用内 PDF.js 阅读；最大 150 MB */
      readExternalPdf: (filePath: string) => Promise<{ data: Uint8Array; name: string; path: string }>
      /**
       * 本地 PDF 兜底：把缺 PDF 的文献标题交给本机服务，在授权目录里按文件名保守匹配。
       * 只有本机网页端（服务端持 --pdf-root 清单）提供；桌面端没有这个方法，调用方要判空。
       */
      matchLocalPdf?: (titles: { id: string; title: string }[]) => Promise<{
        matches: Record<string, { path: string; score: number; reason: string }>
        stats: { titles: number; files: number; compared: number; matched: number }
      }>
      /** 在 Zotero 里定位到该条目（zotero://select） */
      selectZoteroItem: (zoteroKey: string) => Promise<{ error: string | null }>

      // AI 网关：状态里的 keyPreview 已脱敏，绝不包含完整 key。
      // provider 默认 kimi；deepseek 的 key 从本机 ZCode / DSH 配置只读提取；
      // ollama = 本机 Qwen（Ollama，无 key，baseUrl 由渲染端设置传入，默认 127.0.0.1:11434）。
      aiStatus: (request?: { provider?: 'kimi' | 'deepseek' | 'ollama'; configPath?: string; baseUrl?: string }) => Promise<
        | {
            configured: true
            provider?: 'kimi' | 'deepseek' | 'ollama'
            baseUrl: string
            model: string
            models?: string[]
            keyPreview: string
          }
        | { configured: false; provider?: 'kimi' | 'deepseek' | 'ollama'; error: string }
      >
      aiComplete: (payload: {
        provider?: 'kimi' | 'deepseek' | 'ollama'
        /** 单轮请求；与 messages 二选一 */
        prompt?: string
        /** 多轮对话（自由提问用）；必须至少有一条 user 消息 */
        messages?: { role: 'user' | 'assistant'; content: string }[]
        system?: string
        /** deepseek/ollama 可指定模型；kimi 始终用配置里的模型 */
        model?: string
        maxTokens?: number
        configPath?: string
        /** ollama 的服务地址（OpenAI 兼容 loopback） */
        baseUrl?: string
      }) => Promise<
        | { ok: true; text: string; model: string; usage: unknown }
        | { ok: false; error: string }
      >
    }
  }
}
