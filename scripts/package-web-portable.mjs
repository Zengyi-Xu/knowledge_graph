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
  if (fs.existsSync(stage)) throw new Error(`输出目录已存在：${stage}；为避免覆盖用户 data，请使用新的输出目录或版本号。`)
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('先运行 npm run build')
  const runtime = JSON.parse(execFileSync(node, ['-p', 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'], { encoding: 'utf8' }))
  if (runtime.platform !== 'win32' || runtime.arch !== 'x64') throw new Error('需要 Windows x64 Node 运行环境')
  if (!fs.existsSync(nodeLicense)) throw new Error('缺少对应 Node 版本的官方 LICENSE；请用 --node-license 指定')
  copy(path.join(root, 'dist'), path.join(stage, 'dist'))
  copy(node, path.join(stage, 'runtime', 'node.exe'))
  copy(nodeLicense, path.join(stage, 'runtime', 'LICENSE'))
  for (const file of ['local-web.mjs', 'local-bridge.js', 'start-portable-web.mjs']) {
    copy(path.join(root, 'scripts', file), path.join(stage, 'scripts', file))
  }
  await build({
    absWorkingDir: root,
    entryPoints: ['electron/vaultFs.cjs', 'electron/attachmentFs.cjs', 'electron/zoteroFs.cjs', 'electron/aiGateway.cjs'],
    bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['better-sqlite3'],
    outdir: path.join(stage, 'electron'), outExtension: { '.js': '.cjs' }, logLevel: 'warning',
  })
  const sqlite = path.join(root, 'node_modules', 'better-sqlite3')
  const target = path.join(stage, 'node_modules', 'better-sqlite3')
  for (const file of ['lib', 'package.json', 'LICENSE']) copy(path.join(sqlite, file), path.join(target, file))
  copy(path.join(sqlite, 'prebuilds', 'win32-x64.node'), path.join(target, 'prebuilds', 'win32-x64.node'))
  copy(path.join(root, 'build', 'web-portable', '启动知识图谱.cmd'), path.join(stage, '启动知识图谱.cmd'))
  // Batch files must use Windows CRLF even when the source checkout uses LF.
  const launcher = path.join(stage, '启动知识图谱.cmd')
  fs.writeFileSync(launcher, fs.readFileSync(launcher, 'utf8').replace(/\r?\n/g, '\r\n'))
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
  if (fs.existsSync(archive)) throw new Error(`ZIP 已存在，拒绝追加或覆盖：${archive}`)
  execFileSync(path.join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'), [
    'a', '-tzip', '-mx=5', '-mcu=on', '-bso0', '-bsp0', archive, name,
  ], { cwd: output, stdio: 'inherit' })
  const hash = sha256(archive)
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), `${hash}  ${path.basename(archive)}\n`)
  console.log(`ZIP：${archive}\n大小：${(fs.statSync(archive).size / 1024 / 1024).toFixed(1)} MiB\nSHA256：${hash}`)
}
