import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] }
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const name = `knowledge-graph-web-${pkg.version}-windows-x64`
const output = path.join(root, 'release', `web-v${pkg.version}`)
const stage = path.join(output, name)
// 重新打包同一版本（本地验收/返工）时用 --replace：把已有产物改名保留，绝不删除。
const replace = args.includes('--replace')
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')
const supersede = (target) => {
  const archived = `${target}.superseded-${stamp}`
  fs.renameSync(target, archived)
  console.log(`已保留既有产物：${path.relative(root, archived)}`)
}
const node = path.resolve(option('--node', process.execPath))
const nodeLicense = path.resolve(option('--node-license', path.join(root, '.tmp-release-tools', 'NODE-LICENSE')))
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(dir, entry.name)
  return entry.isDirectory() ? walk(file) : [file]
})
const copy = (source, destination) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.cpSync(source, destination, { recursive: true })
}
fs.mkdirSync(output, { recursive: true })
if (!args.includes('--zip-only')) {
  if (fs.existsSync(stage)) {
    if (!replace) throw new Error(`输出目录已存在：${stage}；为避免覆盖用户 data，请改用新版本号，或用 --replace 把既有产物改名保留后重建。`)
    supersede(stage)
  }
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('先运行 npm run build')
  const runtime = JSON.parse(execFileSync(node, ['-p', 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'], { encoding: 'utf8' }))
  if (runtime.platform !== 'win32' || runtime.arch !== 'x64') throw new Error('需要 Windows x64 Node 运行环境')
  if (!fs.existsSync(nodeLicense)) throw new Error('缺少对应 Node 版本的官方 LICENSE；请用 --node-license 指定')
  // dist can contain ignored local notes copied from public by Vite.
  // Only ship these application resources, never the whole dist tree.
  // manifest/sw/icons 是 PWA 外壳（index.html 与 sw.js 都直接引用），缺一个就是 404。
  for (const file of ['index.html', 'assets', 'vditor', 'manifest.webmanifest', 'sw.js', 'icons']) {
    const source = path.join(root, 'dist', file)
    if (!fs.existsSync(source)) throw new Error(`dist 缺少 ${file}；先运行 npm run build`)
    copy(source, path.join(stage, 'dist', file))
  }
  copy(node, path.join(stage, 'runtime', 'node.exe'))
  copy(nodeLicense, path.join(stage, 'runtime', 'LICENSE'))
  // 服务端脚本要逐个列出（不是打包进来的）：新加模块时必须同步这里，否则包里的服务起不来
  for (const file of ['local-web.mjs', 'local-bridge.js', 'start-portable-web.mjs', 'vault-write-guard.mjs', 'pdf-match.mjs']) {
    copy(path.join(root, 'scripts', file), path.join(stage, 'scripts', file))
  }
  await build({
    absWorkingDir: root,
    entryPoints: ['electron/vaultFs.cjs', 'electron/attachmentFs.cjs', 'electron/zoteroFs.cjs', 'electron/zoteroLocalApi.cjs', 'electron/aiGateway.cjs'],
    bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['better-sqlite3'],
    outdir: path.join(stage, 'electron'), outExtension: { '.js': '.cjs' }, logLevel: 'warning',
  })
  const sqlite = path.join(root, 'node_modules', 'better-sqlite3')
  const target = path.join(stage, 'node_modules', 'better-sqlite3')
  for (const file of ['lib', 'package.json', 'LICENSE']) copy(path.join(sqlite, file), path.join(target, file))
  copy(path.join(sqlite, 'prebuilds', 'win32-x64.node'), path.join(target, 'prebuilds', 'win32-x64.node'))
  // .pyw 是默认无窗口入口（不经过 Windows Script Host），.cmd 是排查用的窗口版。
  // 停止入口暂时保留 .wsf；换行一律用 CRLF，避免 Windows 脚本宿主/编辑器误判。
  for (const launcher of ['启动知识图谱.cmd', '启动知识图谱.pyw', '停止知识图谱.wsf']) {
    const source = path.join(root, 'build', 'web-portable', launcher)
    const destination = path.join(stage, launcher)
    copy(source, destination)
    fs.writeFileSync(destination, fs.readFileSync(destination, 'utf8').replace(/\r?\n/g, '\r\n'))
  }
  copy(path.join(root, 'build', 'web-portable', '知识图谱.ico'), path.join(stage, '知识图谱.ico'))
  copy(path.join(root, 'build', 'web-portable', '配置.json'), path.join(stage, '配置.json'))
  copy(path.join(root, 'docs', 'WEB_PORTABLE.md'), path.join(stage, '使用说明.md'))
  copy(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'))
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: 'knowledge-graph-web-portable', version: pkg.version, private: true, type: 'module',
  }, null, 2) + '\n')
  // Preserve notices for production dependencies, including transitive browser libraries.
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  let notices = 'Third-party notices; Node and better-sqlite3 also include their own LICENSE files.\n'
  for (const [relative, entry] of Object.entries(lock.packages)) {
    if (!relative || entry.dev) continue
    const dir = path.join(root, relative)
    if (!fs.existsSync(dir)) continue
    for (const file of fs.readdirSync(dir).filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name))) {
      if (!fs.statSync(path.join(dir, file)).isFile()) continue
      notices += `\n\n=== ${relative} ${entry.version || ''} / ${file} ===\n${fs.readFileSync(path.join(dir, file), 'utf8')}\n`
    }
  }
  fs.writeFileSync(path.join(stage, 'THIRD_PARTY_NOTICES.txt'), notices)
  console.log(`已准备免安装目录：${stage}\nNode ${runtime.version}；SQLite 仅保留 win32-x64 原生模块。`)
}
if (!args.includes('--stage-only')) {
  if (fs.existsSync(path.join(stage, 'data'))) throw new Error('发布目录含有 data；拒绝将运行后产生的用户数据打包')
  const privateFiles = walk(stage).filter((file) => /(^|[\\/])notes\.json(?:$|[.-])|\.(?:sqlite(?:3)?(?:-wal|-shm)?|db|pdf)$|(^|[\\/])\.env(?:$|\.)/i.test(file))
  if (privateFiles.length) throw new Error('发布目录含笔记快照、数据库、PDF 或环境配置，拒绝生成 ZIP')
  const sourceCommit = option('--commit', execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim())
  const manifestPath = path.join(stage, 'MANIFEST.json')
  const files = walk(stage).filter((file) => file !== manifestPath).sort().map((file) => ({
    file: path.relative(stage, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size, sha256: sha256(file),
  }))
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: pkg.version, platform: 'windows-x64', sourceCommit, builtAt: new Date().toISOString(),
    nodeVersion: execFileSync(path.join(stage, 'runtime', 'node.exe'), ['--version'], { encoding: 'utf8' }).trim(), files,
  }, null, 2) + '\n')
  const archive = path.join(output, `${name}.zip`)
  if (fs.existsSync(archive)) {
    if (!replace) throw new Error(`ZIP 已存在，拒绝追加或覆盖：${archive}；重打包请加 --replace`)
    supersede(archive)
  }
  const tar = path.join(process.env.SystemRoot, 'System32', 'tar.exe')
  if (!fs.existsSync(tar)) throw new Error(`缺少 Windows 系统压缩工具：${tar}`)
  execFileSync(tar, ['-a', '-c', '-f', archive, path.basename(stage)], { cwd: output, stdio: 'inherit' })
  const hash = sha256(archive)
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), `${hash}  ${path.basename(archive)}\n`)
  console.log(`ZIP：${archive}\n大小：${(fs.statSync(archive).size / 1024 / 1024).toFixed(1)} MiB\nSHA256：${hash}`)
}
