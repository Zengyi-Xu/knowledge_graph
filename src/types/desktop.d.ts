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
    }
  }
}
