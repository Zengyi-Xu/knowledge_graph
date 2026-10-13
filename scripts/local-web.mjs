import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const vaultFs = require('../electron/vaultFs.cjs')
const attachmentFs = require('../electron/attachmentFs.cjs')
const zoteroFs = require('../electron/zoteroFs.cjs')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.mjs': 'text/javascript' }
const canonical = (p) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p)

/** 默认用系统关联程序打开文件（Windows 走 cmd start，其他平台走 open / xdg-open） */
function systemOpener(filePath) {
  const [command, args] = process.platform === 'win32'
    ? ['cmd.exe', ['/c', 'start', '', filePath]]
    : [process.platform === 'darwin' ? 'open' : 'xdg-open', [filePath]]
  spawn(command, args, { windowsHide: true, detached: true, stdio: 'ignore' }).unref()
}

/**
 * 由本机服务代写富文本剪贴板（CF_RTF）：浏览器写不了 text/rtf，Word 域代码引用需要它。
 * 载荷走临时文件（不拼接进命令行），PowerShell 脚本文件内容固定，避免注入。
 */
async function writeClipboardRtf(rtf, text) {
  if (typeof rtf !== 'string' || typeof text !== 'string') throw new Error('无效的剪贴板内容')
  if (process.platform !== 'win32') throw new Error('当前平台不支持代写富文本剪贴板')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kg-clip-'))
  const rtfFile = path.join(dir, 'payload.rtf')
  const txtFile = path.join(dir, 'payload.txt')
  const psFile = path.join(dir, 'set-clipboard.ps1')
  await fs.writeFile(rtfFile, rtf, 'utf8')
  await fs.writeFile(txtFile, text, 'utf8')
  const quote = (p) => `'${p.replace(/'/g, "''")}'`
  await fs.writeFile(psFile, [
    'Add-Type -AssemblyName System.Windows.Forms',
    `$rtf = [System.IO.File]::ReadAllText(${quote(rtfFile)}, [System.Text.Encoding]::UTF8)`,
    `$text = [System.IO.File]::ReadAllText(${quote(txtFile)}, [System.Text.Encoding]::UTF8)`,
    "$do = New-Object System.Windows.Forms.DataObject",
    "$bytes = [System.Text.Encoding]::ASCII.GetBytes($rtf)",
    "$ms = New-Object System.IO.MemoryStream",
    "$ms.Write($bytes, 0, $bytes.Length); $ms.Position = 0",
    "$do.SetData('Rich Text Format', $false, $ms)",
    "$do.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $true, $text)",
    "[System.Windows.Forms.Clipboard]::SetDataObject($do, $true)",
  ].join('\n'), 'utf8')
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', psFile], { windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`写剪贴板失败（PowerShell 退出码 ${code}）`)))
  }).finally(() => { fs.rm(dir, { recursive: true, force: true }).catch(() => {}) })
  return { error: null }
}

export async function createLocalServer({ port = 4173, vault = '', zoteroDb = '', dist = path.join(root, 'dist'), opener } = {}) {
  const token = randomBytes(32).toString('hex')
  const vaults = new Set(vault ? [canonical(vault)] : [])
  const syncFiles = new Set()
  // Zotero 数据库白名单：只认启动参数授权的那个库，前端不能请求任意 sqlite
  const zoteroDbPath = zoteroDb && path.isAbsolute(zoteroDb) ? path.resolve(zoteroDb) : ''
  const zoteroDbs = new Set(zoteroDbPath ? [canonical(zoteroDbPath)] : [])
  const openFile = opener ?? systemOpener
  const locks = new Map()
  let origin
  const assertVault = (dir) => {
    if (typeof dir !== 'string' || !vaults.has(canonical(dir))) throw new Error('请先在网页中选择此笔记目录')
    return path.resolve(dir)
  }
  const assertSync = (file) => {
    if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.json') throw new Error('同步文件必须为 JSON')
    const target = canonical(file)
    const inVault = [...vaults].some((dir) => target.startsWith(dir + path.sep) && path.relative(dir, target).split(path.sep)[0] === 'sync')
    if (!inVault && !syncFiles.has(target)) throw new Error('请先在网页中选择此同步文件')
    return path.resolve(file)
  }
  const assertZoteroDb = (dbPath) => {
    if (typeof dbPath !== 'string' || !path.isAbsolute(dbPath) || path.extname(dbPath).toLowerCase() !== '.sqlite') throw new Error('请选择 Zotero 的 sqlite 数据库')
    if (!zoteroDbs.has(canonical(dbPath))) throw new Error('本地网页端未授权此 Zotero 数据库：请用 --zotero-db 启动本地网页端')
    return path.resolve(dbPath)
  }
  const serial = async (dir, operation) => {
    const key = canonical(dir)
    const previous = locks.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(operation)
    locks.set(key, next)
    try { return await next } finally { if (locks.get(key) === next) locks.delete(key) }
  }
  async function dispatch(method, p) {
    switch (method) {
      case 'vault:authorize': {
        if (typeof p.dir !== 'string' || !path.isAbsolute(p.dir)) throw new Error('请输入笔记目录的绝对路径')
        if (!(await fs.stat(p.dir)).isDirectory()) throw new Error('笔记目录不存在，请先创建目录')
        vaults.add(canonical(p.dir))
        return path.resolve(p.dir)
      }
      case 'vault:list': return vaultFs.listVault(assertVault(p.dir))
      case 'vault:read-files': return vaultFs.readVaultFiles(assertVault(p.dir), p.names)
      case 'vault:write': return serial(assertVault(p.dir), () => vaultFs.writeVault(p.dir, p.plan))
      case 'vault:open-dir': {
        const dir = assertVault(p.dir)
        if (process.platform === 'win32') spawn('explorer.exe', [dir], { windowsHide: true, detached: true, stdio: 'ignore' }).unref()
        return { error: null }
      }
      case 'sync:authorize': {
        if (typeof p.filePath !== 'string' || !path.isAbsolute(p.filePath) || path.extname(p.filePath).toLowerCase() !== '.json') throw new Error('请输入 JSON 文件的绝对路径')
        syncFiles.add(canonical(p.filePath))
        return path.resolve(p.filePath)
      }
      case 'sync:read-file': {
        const file = assertSync(p.filePath)
        return { content: await fs.readFile(file, 'utf8').catch((e) => { if (e.code === 'ENOENT') return null; throw e }) }
      }
      case 'sync:write-file': {
        const file = assertSync(p.filePath)
        if (typeof p.contents !== 'string') throw new Error('无效的同步内容')
        return serial(file, async () => {
          await fs.mkdir(path.dirname(file), { recursive: true })
          const temporary = file + '.tmp-' + randomBytes(6).toString('hex')
          try { await fs.writeFile(temporary, p.contents, 'utf8'); await fs.rename(temporary, file) }
          finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
          return { filePath: file }
        })
      }
      case 'attachments:list': return attachmentFs.list(assertVault(p.dir))
      case 'attachments:read': {
        const bytes = await attachmentFs.read(assertVault(p.dir), p.rel)
        return bytes === null ? null : Buffer.from(bytes).toString('base64')
      }
      case 'attachments:write': return attachmentFs.write(assertVault(p.dir), p.rel, Buffer.from(p.data, 'base64'))
      case 'attachments:remove': return attachmentFs.remove(assertVault(p.dir), p.rel)
      case 'zotero:read': return zoteroFs.readZotero(assertZoteroDb(p.dbPath))
      case 'zotero:open-pdf': {
        // 只接收书目 key；数据库路径固定用服务端启动时授权的那个，前端无法指定任意文件
        if (!zoteroDbPath) throw new Error('本地网页端未配置 Zotero 数据库（启动参数 --zotero-db）')
        const pdfPath = zoteroFs.resolveZoteroPdf(zoteroDbPath, p.zoteroKey)
        openFile(pdfPath)
        return { path: pdfPath }
      }
      case 'ai:status': return require('../electron/aiGateway.cjs').aiStatus(p.configPath)
      case 'ai:complete': return require('../electron/aiGateway.cjs').aiComplete(p)
      case 'clipboard:write-rtf': return writeClipboardRtf(p.rtf, p.text)
      default: throw new Error('不支持的本地操作')
    }
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, content, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' })
      res.end(typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content))
    }
    try {
      if (req.headers.host !== new URL(origin).host) return send(403, { error: '无效的本地主机' })
      const url = new URL(req.url, origin)
      if (url.pathname === '/api/health') return send(200, { service: 'knowledge-graph-local', version: 1 })
      if (url.pathname === '/api/local') {
        const supplied = Buffer.from(String(req.headers['x-kg-token'] ?? ''))
        const expected = Buffer.from(token)
        if (req.method !== 'POST' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || (req.headers.origin && req.headers.origin !== origin)) return send(403, { error: '本地访问校验失败' })
        let bytes = 0
        const chunks = []
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > 128 * 1024 * 1024) return send(413, { error: '文件过大' })
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        return send(200, { result: await dispatch(body.method, body.payload ?? {}) })
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { error: '不支持的请求' })
      if (url.pathname === '/local-bridge.js') return send(200, await fs.readFile(path.join(root, 'scripts', 'local-bridge.js')), mime['.js'])
      const filename = path.resolve(dist, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
      const relative = path.relative(dist, filename)
      if (relative.startsWith('..') || path.isAbsolute(relative)) return send(403, { error: '路径不允许' })
      let content = await fs.readFile(filename)
      if (path.basename(filename) === 'index.html') {
        const config = JSON.stringify({ token, vault, zoteroDb: zoteroDbPath }).replace(/</g, '\\u003c')
        content = content.toString().replace('<head>', `<head><script>window.__KG_LOCAL_CONFIG__=${config}</script><script src="/local-bridge.js"></script>`)
      }
      send(200, content, mime[path.extname(filename)] ?? 'application/octet-stream')
    } catch (e) { send(e.code === 'ENOENT' ? 404 : 400, { error: e.message }) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${server.address().port}`
  return { server, origin, token, close: () => new Promise((resolve) => server.close(resolve)) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback }
  try {
    const configured = option('--vault', '')
    const configuredZotero = option('--zotero-db', '')
    const local = await createLocalServer({ port: Number(option('--port', '4173')), vault: configured, zoteroDb: configuredZotero, dist: path.resolve(option('--dist', path.join(root, 'dist'))) })
    console.log(`知识图谱本地网页端：${local.origin}`)
    console.log(configured ? `笔记库：${configured}` : '在网页内选择已有笔记目录；目录与类型分区会保留。')
    console.log(configuredZotero ? `Zotero 数据库（只读）：${configuredZotero}` : '未配置 Zotero 数据库：文献表双击打开 PDF 需用 --zotero-db 指定 zotero.sqlite。')
    if (!process.argv.includes('--no-open') && process.platform === 'win32') {
      spawn('rundll32.exe', ['url.dll,FileProtocolHandler', local.origin], { detached: true, windowsHide: true, stdio: 'ignore' }).unref()
    }
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      const url = `http://127.0.0.1:${option('--port', '4173')}`
      const health = await fetch(url + '/api/health').then((r) => r.json()).catch(() => null)
      if (health?.service === 'knowledge-graph-local') {
        console.log(`本地网页端已在运行：${url}`)
        if (!process.argv.includes('--no-open') && process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, windowsHide: true, stdio: 'ignore' }).unref()
      } else { console.error('4173 端口已被其他程序占用；可使用 --port 指定其他端口。'); process.exitCode = 1 }
    } else { console.error(e.message); process.exitCode = 1 }
  }
}
