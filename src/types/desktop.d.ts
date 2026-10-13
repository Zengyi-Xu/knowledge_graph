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

      // AI 网关：状态里的 keyPreview 已脱敏，绝不包含完整 key
      aiStatus: (configPath?: string) => Promise<
        | { configured: true; baseUrl: string; model: string; keyPreview: string }
        | { configured: false; error: string }
      >
      aiComplete: (payload: {
        prompt: string
        system?: string
        maxTokens?: number
        configPath?: string
      }) => Promise<
        | { ok: true; text: string; model: string; usage: unknown }
        | { ok: false; error: string }
      >
    }
  }
}
