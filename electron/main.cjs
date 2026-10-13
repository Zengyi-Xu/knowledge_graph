const { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, shell } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { listVault, readVaultFiles, writeVault } = require('./vaultFs.cjs')
const { readZotero, resolveZoteroPdf } = require('./zoteroFs.cjs')
const { aiStatus, aiComplete } = require('./aiGateway.cjs')
const attachmentFs = require('./attachmentFs.cjs')

const APP_SCHEME = 'kg'
const APP_HOST = 'desktop'

/**
 * 开发版 / 正式版隔离：
 * - 开发版 = 未打包运行（`npm run desktop:dev`），加载 dist-dev/、单独的用户数据目录、
 *   窗口标题带「开发版」、允许打开 DevTools；
 * - 正式版 = 打包后的 exe，加载 dist/，使用正式的用户数据目录，禁用开发工具，
 *   并且只接受来自 kg://desktop 的页面。
 * 两套 userData 分开后，开发版里的 localStorage（含 vault 目录、同步路径）
 * 永远不会写到正式版，反之亦然。
 */
const IS_DEV = !app.isPackaged
const APP_ENV = IS_DEV ? 'development' : 'production'
const APP_TITLE = IS_DEV ? '知识图谱（开发版）' : '知识图谱'
const APP_USER_MODEL_ID = 'com.zengyixu.knowledgegraph'

if (IS_DEV) {
  // 必须在 app ready 之前改，才能影响 Chromium profile / localStorage / 单实例锁
  app.setPath('userData', path.join(app.getPath('appData'), '知识图谱-dev'))
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

function registerAppProtocol() {
  // 开发版读 dist-dev/（`npm run build:dev` 的产物），正式版读 dist/
  const distRoot = path.resolve(__dirname, '..', IS_DEV ? 'dist-dev' : 'dist')

  protocol.handle(APP_SCHEME, (request) => {
    const requestUrl = new URL(request.url)
    let relativePath = decodeURIComponent(requestUrl.pathname)

    if (requestUrl.host !== APP_HOST) {
      return new Response('Not found', { status: 404 })
    }

    if (relativePath === '/' || relativePath === '') {
      relativePath = '/index.html'
    }

    const filePath = path.resolve(distRoot, `.${relativePath}`)
    const relativeToRoot = path.relative(distRoot, filePath)
    const isOutsideRoot =
      relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)

    if (isOutsideRoot) {
      return new Response('Not found', { status: 404 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    title: APP_TITLE,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: IS_DEV,
      preload: path.join(__dirname, 'preload.cjs'),
      // 默认 Zotero 库位置（若存在）：由 preload 注入渲染端的 defaultZoteroDb
      additionalArguments: [...defaultZoteroDbArg(), ...defaultVaultArg()],
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const allowedOrigin = `${APP_SCHEME}://${APP_HOST}`
    if (!url.startsWith(allowedOrigin)) {
      event.preventDefault()
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url)
      }
    }
  })

  window.once('ready-to-show', () => window.show())
  if (IS_DEV) {
    // 开发版固定标题，避免被页面 <title> 覆盖，一眼能看出当前不是正式版
    window.on('page-title-updated', (event) => event.preventDefault())
  }
  // 正式版：禁用 DevTools 与页面缩放类的开发入口；开发版保持可用
  if (!IS_DEV) {
    window.webContents.on('devtools-opened', () => window.webContents.closeDevTools())
  }
  void window.loadURL(`${APP_SCHEME}://${APP_HOST}/`)
}

function registerSyncHandlers() {
  ipcMain.handle('sync:choose-file', async () => {
    const result = await dialog.showSaveDialog({
      title: '选择笔记同步文件',
      defaultPath: 'notes.json',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      properties: ['createDirectory'],
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle('sync:write-file', async (_event, payload) => {
    if (!payload || typeof payload.filePath !== 'string' || typeof payload.contents !== 'string') {
      throw new Error('Invalid sync payload')
    }

    const targetPath = path.resolve(payload.filePath)
    const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(tempPath, payload.contents, 'utf8')
    await fs.rename(tempPath, targetPath)
    return { filePath: targetPath }
  })

  ipcMain.handle('sync:read-file', async (_event, payload) => {
    if (!payload || typeof payload.filePath !== 'string') {
      throw new Error('Invalid read payload')
    }
    const targetPath = path.resolve(payload.filePath)
    try {
      const content = await fs.readFile(targetPath, 'utf8')
      return { content }
    } catch (error) {
      if (error && error.code === 'ENOENT') return { content: null }
      throw error
    }
  })
}

/**
 * vault（本地 md + meta.json）相关通道。
 * 渲染进程只能通过这些通道访问磁盘，路径由用户在原生对话框里选定后保存。
 */
function registerVaultHandlers() {
  ipcMain.handle('vault:choose-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择笔记目录（vault）',
      buttonLabel: '使用此目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('vault:list', async (_event, payload) => {
    if (!payload || typeof payload.dir !== 'string' || !payload.dir) {
      throw new Error('Invalid vault dir')
    }
    return listVault(payload.dir)
  })

  ipcMain.handle('vault:read-files', async (_event, payload) => {
    if (!payload || typeof payload.dir !== 'string' || !Array.isArray(payload.names)) {
      throw new Error('Invalid vault read payload')
    }
    return readVaultFiles(payload.dir, payload.names)
  })

  ipcMain.handle('vault:write', async (_event, payload) => {
    if (!payload || typeof payload.dir !== 'string' || !payload.dir) {
      throw new Error('Invalid vault write payload')
    }
    return writeVault(payload.dir, payload)
  })

  ipcMain.handle('vault:open-dir', async (_event, payload) => {
    if (!payload || typeof payload.dir !== 'string' || !payload.dir) {
      throw new Error('Invalid vault dir')
    }
    const error = await shell.openPath(path.resolve(payload.dir))
    return { error: error || null }
  })
}

/**
 * Zotero 库的默认位置。Zotero 数据目录可能被放到同步盘（本研究环境是
 * D:\BaiduSyncdisk\Bibliotx\Zotero），因此先探测候选路径，只把真实存在的那个交给渲染端。
 */
function defaultZoteroDb() {
  const candidates = [
    process.env.KG_ZOTERO_DB,
    path.join(process.env.APPDATA ?? '', 'Zotero', 'Zotero', 'zotero.sqlite'),
    'D:\\BaiduSyncdisk\\Bibliotx\\Zotero\\zotero.sqlite',
    path.join(require('node:os').homedir(), 'Zotero', 'zotero.sqlite'),
  ].filter((p) => typeof p === 'string' && p)
  for (const candidate of candidates) {
    try {
      if (require('node:fs').existsSync(candidate)) return candidate
    } catch {
      /* 下一个候选 */
    }
  }
  return ''
}

function defaultZoteroDbArg() {
  const found = defaultZoteroDb()
  return found ? [`--kg-default-zotero-db=${found}`] : []
}

/**
 * 笔记目录（vault）的默认位置。与 Zotero 同样先探测候选：
 * 环境变量 KG_VAULT_DIR → 本研究环境的同步盘路径 → 用户「文档/知识图谱」。
 * 只有真实存在的目录才会交给渲染端，用户仍可在界面里改成别的目录。
 */
function defaultVaultDir() {
  const candidates = [
    process.env.KG_VAULT_DIR,
    'D:\\BaiduSyncdisk\\Bibliotx\\Vault',
    path.join(require('node:os').homedir(), 'Documents', '知识图谱'),
  ].filter((p) => typeof p === 'string' && p)
  for (const candidate of candidates) {
    try {
      if (require('node:fs').statSync(candidate).isDirectory()) return candidate
    } catch {
      /* 下一个候选 */
    }
  }
  return ''
}

function defaultVaultArg() {
  const found = defaultVaultDir()
  return found ? [`--kg-default-vault=${found}`] : []
}

/**
 * Zotero 只读同步通道：仅接受用户显式给出的 zotero.sqlite 路径，
 * 以 readonly 打开（Zotero 运行时锁库会返回友好错误），绝不写入。
 * open-pdf 只接收书目 key，PDF 路径由本机 Zotero 库解析，不让渲染端指定任意文件。
 */
function registerZoteroHandlers() {
  ipcMain.handle('zotero:read', async (_event, payload) => {
    if (!payload || typeof payload.dbPath !== 'string' || !payload.dbPath) {
      throw new Error('Invalid zotero db path')
    }
    return readZotero(payload.dbPath)
  })

  ipcMain.handle('zotero:open-pdf', async (_event, payload) => {
    if (!payload || typeof payload.dbPath !== 'string' || !payload.dbPath || typeof payload.zoteroKey !== 'string') {
      throw new Error('Invalid zotero pdf request')
    }
    const extraKeys = Array.isArray(payload.zoteroKeys) ? payload.zoteroKeys.filter((k) => typeof k === 'string') : []
    const pdfPath = resolveZoteroPdf(payload.dbPath, payload.zoteroKey, extraKeys)
    const error = await shell.openPath(pdfPath)
    if (error) throw new Error(`无法打开 PDF：${error}`)
    return { path: pdfPath }
  })

  // 在 Zotero 里定位到该条目（zotero:// 协议；Zotero 会选中并展示它，可顺手下载附件）
  ipcMain.handle('zotero:select-item', async (_event, payload) => {
    const key = payload && typeof payload.zoteroKey === 'string' ? payload.zoteroKey : ''
    if (!/^[A-Z0-9]{8}$/i.test(key)) throw new Error('Invalid zotero item key')
    await shell.openExternal(`zotero://select/library/items/${key.toUpperCase()}`)
    return { error: null }
  })
}

/**
 * AI 网关通道：状态查询（脱敏）与非流式补全。
 * 渲染端只能传 prompt/system/maxTokens，端点与 key 全部由主进程从
 * Kimi Code 配置里读，调用方无法指定任意 URL。
 */
function registerAiHandlers() {
  ipcMain.handle('ai:status', async (_event, payload) => {
    const configPath =
      payload && typeof payload.configPath === 'string' && payload.configPath
        ? payload.configPath
        : undefined
    return aiStatus(configPath)
  })

  ipcMain.handle('ai:complete', async (_event, payload) => {
    if (!payload || typeof payload !== 'object' || typeof payload.prompt !== 'string') {
      throw new Error('Invalid ai payload')
    }
    return aiComplete({
      prompt: payload.prompt,
      system: typeof payload.system === 'string' ? payload.system : undefined,
      maxTokens: typeof payload.maxTokens === 'number' ? payload.maxTokens : undefined,
      configPath:
        typeof payload.configPath === 'string' && payload.configPath
          ? payload.configPath
          : undefined,
    })
  })
}

/**
 * 附件（vault 内 attachments/ 目录）相关通道。
 * 参数校验风格与 vault 通道一致：dir 必须是字符串，rel 由 attachmentFs 做路径白名单校验。
 */
function registerAttachmentHandlers() {
  ipcMain.handle('attachments:list', async (_event, payload) => {
    if (!payload || typeof payload.dir !== 'string' || !payload.dir) {
      throw new Error('Invalid attachments list payload')
    }
    return attachmentFs.list(payload.dir)
  })

  ipcMain.handle('attachments:read', async (_event, payload) => {
    if (!payload || typeof payload.dir !== 'string' || typeof payload.rel !== 'string') {
      throw new Error('Invalid attachments read payload')
    }
    return attachmentFs.read(payload.dir, payload.rel)
  })

  ipcMain.handle('attachments:write', async (_event, payload) => {
    if (!payload || typeof payload.dir !== 'string' || typeof payload.rel !== 'string' || !payload.data) {
      throw new Error('Invalid attachments write payload')
    }
    return attachmentFs.write(payload.dir, payload.rel, Buffer.from(payload.data))
  })

  ipcMain.handle('attachments:remove', async (_event, payload) => {
    if (!payload || typeof payload.dir !== 'string' || typeof payload.rel !== 'string') {
      throw new Error('Invalid attachments remove payload')
    }
    return attachmentFs.remove(payload.dir, payload.rel)
  })

  // 写富文本剪贴板（CF_RTF）：Word 才能拿到真域；浏览器自身写不了 text/rtf
  ipcMain.handle('clipboard:write-rtf', async (_event, payload) => {
    if (!payload || typeof payload.rtf !== 'string' || typeof payload.text !== 'string') {
      throw new Error('Invalid clipboard payload')
    }
    clipboard.write({ rtf: payload.rtf, text: payload.text })
    if (!clipboard.readRTF().trim()) {
      throw new Error('CF_RTF clipboard verification failed')
    }
    return { error: null }
  })

  // 用系统默认程序打开附件（如 PDF 阅读器）；返回 { error } 供渲染进程提示
  ipcMain.handle('attachments:open-external', async (_event, payload) => {
    if (!payload || typeof payload.dir !== 'string' || typeof payload.rel !== 'string') {
      throw new Error('Invalid attachments open-external payload')
    }
    const abs = path.resolve(payload.dir, payload.rel)
    const root = path.resolve(payload.dir)
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      return { error: '路径越界' }
    }
    try {
      await fs.access(abs)
    } catch {
      return { error: '文件不存在' }
    }
    const error = await shell.openPath(abs)
    return { error: error || null }
  })

  // 用系统默认程序打开任意 PDF（pdf:link 脚本写进笔记的 localPdf 路径）；只接受 .pdf 且必须存在
  ipcMain.handle('file:open-external', async (_event, payload) => {
    const target = payload && typeof payload.path === 'string' ? payload.path : ''
    if (!target || !path.isAbsolute(target) || path.extname(target).toLowerCase() !== '.pdf') {
      return { error: '只允许打开本地 PDF 文件' }
    }
    try {
      await fs.access(target)
    } catch {
      return { error: '文件不存在（可能已移动或改名）' }
    }
    const error = await shell.openPath(target)
    return { error: error || null }
  })

  ipcMain.handle('attachments:choose-open', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 PDF 附件',
      buttonLabel: '添加',
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths.length) return null
    const filePath = result.filePaths[0]
    const buf = await fs.readFile(filePath)
    return { filePath, name: path.basename(filePath), data: buf }
  })

  ipcMain.handle('attachments:choose-save', async (_event, payload) => {
    const defaultName = payload && typeof payload.defaultName === 'string' ? payload.defaultName : 'annotations.txt'
    const result = await dialog.showSaveDialog({
      title: '选择保存位置',
      defaultPath: defaultName,
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_USER_MODEL_ID)
    console.log(`[知识图谱] env=${APP_ENV} userData=${app.getPath('userData')}`)
    registerAppProtocol()
    registerSyncHandlers()
    registerVaultHandlers()
    registerAttachmentHandlers()
    registerZoteroHandlers()
    registerAiHandlers()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
