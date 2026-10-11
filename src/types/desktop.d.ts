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
      isElectron: true
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
      /** 原生打开对话框选 PDF；返回文件名与二进制；取消返回 null */
      chooseOpenAttachment: () => Promise<{
        filePath: string
        name: string
        data: Uint8Array
      } | null>
      /** 原生保存对话框选目标路径；取消返回 null */
      chooseSaveAttachment: (defaultName: string) => Promise<string | null>
    }
  }
}
