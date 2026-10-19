import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const name = `knowledge-graph-web-${pkg.version}-windows-x64`
const archiveIndex = process.argv.indexOf('--zip')
const sandbox = fs.mkdtempSync(path.join(root, '.tmp-web-portable-'))
const testRoot = path.join(sandbox, '中文 分享测试')
fs.mkdirSync(testRoot)
const dir = path.join(testRoot, name)
if (archiveIndex >= 0) {
  const tar = path.join(process.env.SystemRoot, 'System32', 'tar.exe')
  const result = spawnSync(tar, ['-x', '-f', path.resolve(process.argv[archiveIndex + 1]), '-C', testRoot], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
} else {
  fs.cpSync(path.join(root, 'release', `web-v${pkg.version}`, name), dir, { recursive: true })
}
assert.equal(fs.existsSync(path.join(dir, 'dist', 'notes.json')), false, '禁止携带 public 中的本地笔记快照')
assert.deepEqual(fs.readdirSync(path.join(dir, 'dist')).sort(),
  ['assets', 'icons', 'index.html', 'manifest.webmanifest', 'sw.js', 'vditor'])
// 三个入口都在：双击 .wsf 是无窗口启动/停止，.cmd 是排查用的窗口版
for (const entry of ['启动知识图谱.wsf', '停止知识图谱.wsf', '启动知识图谱.cmd']) {
  assert.ok(fs.existsSync(path.join(dir, entry)), `缺少启动入口 ${entry}`)
}
const env = {
  ...process.env, NODE_PATH: '', KG_VAULT_DIR: '', KG_ZOTERO_DB: '',
  USERPROFILE: path.join(dir, 'test-profile'), APPDATA: path.join(dir, 'test-profile', 'AppData', 'Roaming'),
  PATH: [path.join(dir, 'runtime'), path.join(process.env.SystemRoot, 'System32'),
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0'), process.env.SystemRoot].join(';'),
}
const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', '.\\启动知识图谱.cmd --no-open --port 0'], {
  cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (text) => { output += text })
child.stderr.on('data', (text) => { output += text })
try {
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('启动超时：' + output)), 20000)
    const inspect = () => {
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/)
      if (match) { clearTimeout(timeout); resolve(match[0]) }
    }
    child.stdout.on('data', inspect)
    child.on('error', reject)
    child.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`启动退出 ${code}: ${output}`)) })
  })
  assert.equal((await (await fetch(origin + '/api/health')).json()).service, 'knowledge-graph-local')
  const html = await (await fetch(origin)).text()
  assert.ok(html.includes('/local-bridge.js'))
  const config = JSON.parse(html.match(/window\.__KG_LOCAL_CONFIG__=(.*?)<\/script>/)[1])
  assert.equal(path.resolve(config.vault), path.join(dir, 'data', 'vault'))
  assert.equal(config.zoteroDb, '', '隔离测试不得意外使用开发者 Zotero 库')
  const main = html.match(/src="([^"]+\/assets\/[^\"]+\.js)"/)?.[1] || html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1]
  assert.ok(main)
  assert.equal((await fetch(new URL(main, origin))).status, 200)
  const theme = fs.readdirSync(path.join(dir, 'dist/vditor/dist/css/content-theme')).find((file) => file.endsWith('.css'))
  assert.ok(theme)
  assert.equal((await fetch(origin + '/vditor/dist/css/content-theme/' + theme)).status, 200)
  // PWA 外壳：index.html 与 sw.js 都直接引用这三类资源，缺一个就是 404。
  for (const asset of ['manifest.webmanifest', 'sw.js', 'icons/icon-192.png', 'icons/apple-touch-icon-180.png']) {
    assert.equal((await fetch(origin + '/' + asset)).status, 200, asset)
  }
  assert.equal((await fetch(origin + '/manifest.webmanifest')).headers.get('content-type'), 'application/manifest+json; charset=utf-8')
  console.log('✓ 双击入口逻辑、中文/空格路径、隔离 PATH、默认独立笔记库、主资源、编辑器资源与 PWA 外壳')
} finally {
  // Only terminate the process tree created by this test.
  if (child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
}
// 无窗口启动器：双击 启动知识图谱.wsf 走的就是这条路径（wscript + 隐藏窗口的 .cmd）。
// 这里用 cscript 起同一个脚本，验证它真的把服务拉起来、并把输出写进 data/temp/web-server.log。
const hiddenLog = path.join(dir, 'data', 'temp', 'web-server.log')
const launcher = spawn('cscript.exe', ['//nologo', '启动知识图谱.wsf', '--no-open', '--port', '0'], {
  cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
})
try {
  const origin = await new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000
    const poll = () => {
      const log = fs.existsSync(hiddenLog) ? fs.readFileSync(hiddenLog, 'utf8') : ''
      const match = log.match(/http:\/\/127\.0\.0\.1:\d+/)
      if (match) return resolve(match[0])
      if (Date.now() > deadline) return reject(new Error('无窗口启动器未写出服务地址；日志：' + log))
      setTimeout(poll, 300)
    }
    launcher.on('exit', (code) => reject(new Error(`无窗口启动器提前退出 ${code}`)))
    poll()
  })
  assert.equal((await (await fetch(origin + '/api/health')).json()).service, 'knowledge-graph-local')
  const log = fs.readFileSync(hiddenLog, 'utf8')
  assert.ok(log.includes('=== kg-launch '), '无窗口启动器应写下启动分隔线')
  assert.ok(/知识图谱 v[\d.]+/.test(log) && log.includes('免安装网页端'), '日志应保留中文启动信息：' + log)
  console.log('✓ 无窗口启动器（启动知识图谱.wsf）真的起了服务：隐藏窗口、日志落 data/temp/web-server.log、中文不乱码')
} finally {
  if (launcher.pid) spawnSync('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
}
fs.copyFileSync(path.join(root, 'scripts/local-web-selftest.mjs'), path.join(dir, 'scripts/local-web-selftest.mjs'))
const regression = spawnSync(path.join(dir, 'runtime/node.exe'), ['scripts/local-web-selftest.mjs'], {
  cwd: dir, env, windowsHide: true, encoding: 'utf8', timeout: 30000,
})
assert.equal(regression.status, 0, regression.stdout + regression.stderr)
console.log(regression.stdout.trim().split(/\r?\n/).at(-1))
console.log('✓ 随包 SQLite 原生模块加载与全部本地服务回归，无 npm 或全局 Node 依赖')
console.log(`测试目录：${path.relative(root, dir)}`)
