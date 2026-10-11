const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { listVault, readVaultFiles, writeVault } = require('./vaultFs.cjs')

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
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
