const { contextBridge, ipcRenderer } = require('electron')

/** 主进程通过 additionalArguments 注入本机默认位置（笔记目录 / Zotero 库） */
const zoteroArg = process.argv.find((a) => a.startsWith('--kg-default-zotero-db='))
const vaultArg = process.argv.find((a) => a.startsWith('--kg-default-vault='))

contextBridge.exposeInMainWorld('knowledgeGraphDesktop', {
  isElectron: true,
  defaultZoteroDb: zoteroArg ? zoteroArg.slice('--kg-default-zotero-db='.length) : '',
  defaultVaultDir: vaultArg ? vaultArg.slice('--kg-default-vault='.length) : '',
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
  openAttachmentExternal: (dir, rel) => ipcRenderer.invoke('attachments:open-external', { dir, rel }),
  writeClipboardRtf: (rtf, text) => ipcRenderer.invoke('clipboard:write-rtf', { rtf, text }),
  chooseOpenAttachment: () => ipcRenderer.invoke('attachments:choose-open'),
  chooseSaveAttachment: (defaultName) => ipcRenderer.invoke('attachments:choose-save', { defaultName }),

  // Zotero：只读同步 zotero.sqlite（需先退出 Zotero 释放锁）
  readZotero: (dbPath) => ipcRenderer.invoke('zotero:read', { dbPath }),
  openZoteroPdf: (dbPath, zoteroKey, zoteroKeys) => ipcRenderer.invoke('zotero:open-pdf', { dbPath, zoteroKey, zoteroKeys }),
  readZoteroPdf: (dbPath, zoteroKey, zoteroKeys) => ipcRenderer.invoke('zotero:read-pdf', { dbPath, zoteroKey, zoteroKeys }),
  // 标注与子笔记（只读）：附件归属由主进程从数据库解析，渲染端只给书目 key
  readZoteroMarkup: (dbPath, zoteroKey, zoteroKeys) => ipcRenderer.invoke('zotero:read-markup', { dbPath, zoteroKey, zoteroKeys }),
  // Zotero 10+ 本地写入（只增）：status / authorize / write，密钥只在主进程内存里
  zoteroLocalApi: (request) => ipcRenderer.invoke('zotero:local-api', request),
  // 打开笔记里记录的本地 PDF（localPdf 字段）
  openExternalFile: (filePath) => ipcRenderer.invoke('file:open-external', { path: filePath }),
  readExternalPdf: (filePath) => ipcRenderer.invoke('file:read-pdf', { path: filePath }),
  // 在 Zotero 里定位条目（zotero:// 协议）
  selectZoteroItem: (zoteroKey) => ipcRenderer.invoke('zotero:select-item', { zoteroKey }),

  // AI 网关：状态（脱敏）与补全；端点/key 由主进程从 Kimi Code / ZCode 配置读取
  aiStatus: (request) => ipcRenderer.invoke('ai:status', request ?? {}),
  aiComplete: (payload) => ipcRenderer.invoke('ai:complete', payload),
})
