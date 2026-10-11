const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('knowledgeGraphDesktop', {
  isElectron: true,
  chooseSyncFile: () => ipcRenderer.invoke('sync:choose-file'),
  writeSyncFile: (filePath, contents) =>
    ipcRenderer.invoke('sync:write-file', { filePath, contents }),
  readSyncFile: (filePath) => ipcRenderer.invoke('sync:read-file', { filePath }),

  // vault：本地以「每篇一个 md + 一个 meta.json 索引」存储
  chooseVaultDir: () => ipcRenderer.invoke('vault:choose-dir'),
  listVault: (dir) => ipcRenderer.invoke('vault:list', { dir }),
  readVaultFiles: (dir, names) => ipcRenderer.invoke('vault:read-files', { dir, names }),
  writeVault: (dir, plan) => ipcRenderer.invoke('vault:write', { dir, ...plan }),
  openVaultDir: (dir) => ipcRenderer.invoke('vault:open-dir', { dir }),

  // 附件：vault 内 attachments/ 目录（一层文件名白名单，路径校验在主进程）
  listAttachments: (dir) => ipcRenderer.invoke('attachments:list', { dir }),
  readAttachment: (dir, rel) => ipcRenderer.invoke('attachments:read', { dir, rel }),
  writeAttachment: (dir, rel, data) => ipcRenderer.invoke('attachments:write', { dir, rel, data }),
  removeAttachment: (dir, rel) => ipcRenderer.invoke('attachments:remove', { dir, rel }),
  chooseOpenAttachment: () => ipcRenderer.invoke('attachments:choose-open'),
  chooseSaveAttachment: (defaultName) => ipcRenderer.invoke('attachments:choose-save', { defaultName }),
})
