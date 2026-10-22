import http from 'node:http'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { describeBlockedWrites, findBlockedWrites, findMetaLoss } from './vault-write-guard.mjs'
import { matchLocalPdfTitles } from './pdf-match.mjs'

const require = createRequire(import.meta.url)
const vaultFs = require('../electron/vaultFs.cjs')
const attachmentFs = require('../electron/attachmentFs.cjs')
const zoteroFs = require('../electron/zoteroFs.cjs')
const zoteroLocalApi = require('../electron/zoteroLocalApi.cjs')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 版本号只从 package.json 读一次，打印在启动横幅里（避免 .cmd 里再硬编码一份，写死了就会过期）
const { version } = (() => {
  try { return JSON.parse(fsSync.readFileSync(path.join(root, 'package.json'), 'utf8')) } catch { return { version: '?' } }
})()
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json; charset=utf-8' }
const canonical = (p) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p)
const MAX_INLINE_PDF_BYTES = 150 * 1024 * 1024

/**
 * 默认用系统关联程序打开文件。Windows 走 explorer.exe、macOS 走 open、Linux 走 xdg-open：
 * 都直接 spawn 可执行文件并单独传参，不经过 cmd/sh，文件名里的 & ( ) 等字符不会被解释。
 */
export function openerCommand(filePath) {
  if (process.platform === 'win32') return ['explorer.exe', [filePath]]
  return [process.platform === 'darwin' ? 'open' : 'xdg-open', [filePath]]
}

function systemOpener(filePath) {
  const [command, args] = openerCommand(filePath)
  spawn(command, args, { windowsHide: true, detached: true, stdio: 'ignore' }).unref()
}

/** 打开自定义协议 URL（zotero://…）：Windows 走 rundll32 的协议处理器，不经 shell */
function systemUrlOpener(url) {
  if (process.platform === 'win32') {
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref()
    return
  }
  systemOpener(url)
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
    "$written = [System.Windows.Forms.Clipboard]::GetDataObject()",
    "if (-not $written.GetDataPresent('Rich Text Format')) { throw 'CF_RTF 写入后校验失败' }",
  ].join('\n'), 'utf8')
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', psFile], { windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`写剪贴板失败（PowerShell 退出码 ${code}）`)))
  }).finally(() => { fs.rm(dir, { recursive: true, force: true }).catch(() => {}) })
  return { error: null }
}

export async function createLocalServer({ port = 4173, vault = '', zoteroDb = '', pdfRoots = [], dist = path.join(root, 'dist'), opener, urlOpener } = {}) {
  const token = randomBytes(32).toString('hex')
  const vaults = new Set(vault ? [canonical(vault)] : [])
  const syncFiles = new Set()
  // PDF 白名单根：笔记里 localPdf 记录的路径必须落在这些目录（或笔记库）里才允许打开
  const allowedPdfRoots = pdfRoots.filter((dir) => typeof dir === 'string' && path.isAbsolute(dir)).map((dir) => canonical(dir))
  // Zotero 数据库白名单：只认启动参数授权的那个库，前端不能请求任意 sqlite
  const zoteroDbPath = zoteroDb && path.isAbsolute(zoteroDb) ? path.resolve(zoteroDb) : ''
  const zoteroDbs = new Set(zoteroDbPath ? [canonical(zoteroDbPath)] : [])
  const openFile = opener ?? systemOpener
  const openUrl = urlOpener ?? systemUrlOpener
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
  const assertLocalPdf = (filePath) => {
    const target = typeof filePath === 'string' ? path.resolve(filePath) : ''
    if (!target || path.extname(target).toLowerCase() !== '.pdf') throw new Error('只允许读取本地 PDF 文件')
    const key = canonical(target)
    const inVault = [...vaults].some((dir) => key.startsWith(dir + path.sep))
    const inRoot = allowedPdfRoots.some((dir) => key.startsWith(dir + path.sep))
    if (!inVault && !inRoot) throw new Error('该 PDF 不在允许的目录里：请用 --pdf-root 指定它的上级目录后重启本地网页端')
    if (!fsSync.existsSync(target)) throw new Error('文件不存在（可能已移动或改名）')
    return target
  }
  const readPdfPayload = async (filePath) => {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) throw new Error('PDF 文件不存在')
    if (stat.size > MAX_INLINE_PDF_BYTES) throw new Error('PDF 超过 150 MB，请改用系统阅读器打开')
    return { data: (await fs.readFile(filePath)).toString('base64'), name: path.basename(filePath), path: filePath }
  }

  // ---- 本地 PDF 兜底：把缺 PDF 的文献标题与授权目录里的文件名做保守匹配 ----------
  /** 写入计划里的 md 项（只有 file/text 都合法的才参与门禁判断） */
  const planWrites = (plan) => (Array.isArray(plan?.writes) ? plan.writes : [])
  /** 读笔记库里的一个 md 原文（不存在返回 null；其它错误抛给调用方） */
  const readVaultFile = async (dir, rel) => {
    const target = vaultFs.resolveInside(path.resolve(dir), vaultFs.normalizeRel(rel))
    return fs.readFile(target, 'utf8').catch((error) => { if (error?.code === 'ENOENT') return null; throw error })
  }
  /** 授权 PDF 目录里的文件清单（递归）：缓存 5 分钟，避免每次开文献列表都扫盘 */
  const pdfIndexCache = { at: 0, files: [] }
  const listPdfRootFiles = async () => {
    if (Date.now() - pdfIndexCache.at < 5 * 60 * 1000) return pdfIndexCache.files
    const files = []
    const walk = async (dir, depth) => {
      if (depth > 8) return
      let entries = []
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) await walk(full, depth + 1)
        else if (entry.isFile() && full.toLowerCase().endsWith('.pdf')) files.push(full)
      }
    }
    for (const dir of allowedPdfRoots) await walk(dir, 0)
    pdfIndexCache.at = Date.now()
    pdfIndexCache.files = files
    return files
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
      case 'vault:write': return serial(assertVault(p.dir), async () => {
        // 最后一道门禁：磁盘声明了 requiredCapabilities 的笔记，新文本必须还带着这些字段。
        // 旧页面/旧构建不会这么干，于是它们改不动这个库（2026-10-16 的事故见 scripts/vault-write-guard.mjs）。
        const blocked = await findBlockedWrites(planWrites(p.plan), (rel) => readVaultFile(p.dir, rel))
        if (blocked.length) throw new Error(describeBlockedWrites(blocked))
        if (typeof p.plan?.meta === 'string') {
          const diskMeta = await fs.readFile(path.join(path.resolve(p.dir), vaultFs.META_NAME), 'utf8').catch(() => null)
          const metaLost = findMetaLoss(diskMeta, p.plan.meta)
          if (metaLost.length) throw new Error(`拒绝写入索引 meta.json：${metaLost.join('、')} —— 写入方大概是旧版本，请强刷页面（Ctrl+F5）`)
        }
        return vaultFs.writeVault(p.dir, p.plan)
      })
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
      case 'file:open-external': {
        // 只允许打开笔记库内或白名单根下的 .pdf（localPdf 字段）；路径一律先解析再比对
        const target = typeof p.path === 'string' ? path.resolve(p.path) : ''
        if (!target || path.extname(target).toLowerCase() !== '.pdf') throw new Error('只允许打开本地 PDF 文件')
        const key = canonical(target)
        const inVault = [...vaults].some((dir) => key.startsWith(dir + path.sep))
        const inRoot = allowedPdfRoots.some((dir) => key.startsWith(dir + path.sep))
        if (!inVault && !inRoot) throw new Error('该 PDF 不在允许的目录里：请用 --pdf-root 指定它的上级目录后重启本地网页端')
        if (!fsSync.existsSync(target)) throw new Error('文件不存在（可能已移动或改名）')
        openFile(target)
        return { path: target, error: null }
      }
      case 'file:read-pdf': return readPdfPayload(assertLocalPdf(p.path))
      case 'pdf:match-titles': {
        // 只读兜底：标题 → 授权目录里的 PDF。命中只是「提名」，不写任何文件。
        const titles = (Array.isArray(p.titles) ? p.titles : [])
          .filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string')
          .slice(0, 2000)
        if (!titles.length) return { matches: {}, stats: { titles: 0, files: 0, compared: 0, matched: 0 } }
        return matchLocalPdfTitles(titles, await listPdfRootFiles())
      }
      case 'zotero:select-item': {
        // 在 Zotero 里定位条目；只接受 8 位条目 key，URL 由服务端拼
        const key = typeof p.zoteroKey === 'string' ? p.zoteroKey : ''
        if (!/^[A-Z0-9]{8}$/i.test(key)) throw new Error('无效的 Zotero 条目 key')
        const url = `zotero://select/library/items/${key.toUpperCase()}`
        openUrl(url)
        return { url }
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
        // 只接收书目 key（去重合并后的文献可带多个 key）；数据库路径固定用服务端启动时授权的那个
        if (!zoteroDbPath) throw new Error('本地网页端未配置 Zotero 数据库（启动参数 --zotero-db）')
        const extraKeys = Array.isArray(p.zoteroKeys) ? p.zoteroKeys.filter((k) => typeof k === 'string') : []
        const pdfPath = zoteroFs.resolveZoteroPdf(zoteroDbPath, p.zoteroKey, extraKeys)
        openFile(pdfPath)
        return { path: pdfPath }
      }
      case 'zotero:read-pdf': {
        if (!zoteroDbPath) throw new Error('本地网页端未配置 Zotero 数据库（启动参数 --zotero-db）')
        const extraKeys = Array.isArray(p.zoteroKeys) ? p.zoteroKeys.filter((k) => typeof k === 'string') : []
        return readPdfPayload(zoteroFs.resolveZoteroPdf(zoteroDbPath, p.zoteroKey, extraKeys))
      }
      case 'zotero:read-markup': {
        // 只读标注/子笔记：数据库固定用启动时授权的那个，前端只给书目 key
        if (!zoteroDbPath) throw new Error('本地网页端未配置 Zotero 数据库（启动参数 --zotero-db）')
        if (typeof p.zoteroKey !== 'string') throw new Error('无效的 Zotero 条目 key')
        const extraKeys = Array.isArray(p.zoteroKeys) ? p.zoteroKeys.filter((k) => typeof k === 'string') : []
        return zoteroFs.readZoteroMarkup(zoteroDbPath, p.zoteroKey, extraKeys)
      }
      case 'zotero:local-api': {
        // Zotero 10+ 本地写入：只增；密钥由服务端内存缓存，前端拿不到
        const action = p && p.action
        if (action === 'status') return zoteroLocalApi.status()
        if (action === 'authorize') return zoteroLocalApi.authorize()
        if (action === 'write') {
          const annotations = Array.isArray(p.annotations) ? p.annotations.slice(0, 50) : []
          return zoteroLocalApi.write({
            attachmentKey: typeof p.attachmentKey === 'string' ? p.attachmentKey : '',
            annotations,
          })
        }
        throw new Error('不支持的 Zotero 写入请求')
      }
      case 'ai:status': return require('../electron/aiGateway.cjs').aiStatus(p)
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
  const optionAll = (name) => process.argv.flatMap((value, index) => (value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []))
  try {
    const configured = option('--vault', '')
    const configuredZotero = option('--zotero-db', '')
    // 允许打开笔记 localPdf 字段记录的 PDF：除笔记库外，还可显式授权若干 PDF 根目录
    const pdfRoots = optionAll('--pdf-root')
    const local = await createLocalServer({ port: Number(option('--port', '4173')), vault: configured, zoteroDb: configuredZotero, pdfRoots, dist: path.resolve(option('--dist', path.join(root, 'dist'))) })
    console.log(`知识图谱 v${version} 本地网页端：${local.origin}`)
    console.log(configured ? `笔记库：${configured}` : '在网页内选择已有笔记目录；目录与类型分区会保留。')
    console.log(configuredZotero ? `Zotero 数据库（只读）：${configuredZotero}` : '未配置 Zotero 数据库：点文献表的 PDF 徽标打开本地 PDF 需用 --zotero-db 指定 zotero.sqlite。')
    if (pdfRoots.length) console.log(`已授权的 PDF 目录：${pdfRoots.join('；')}`)
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
