import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(fs.readFileSync(path.join(root, '配置.json'), 'utf8').replace(/^\uFEFF/, ''))
const resolve = (value) => path.resolve(root, value)
const cli = process.argv.slice(2)
const option = (name) => { const index = cli.indexOf(name); return index < 0 ? '' : cli[index + 1] }
const vault = resolve(option('--vault') || process.env.KG_VAULT_DIR || config.vaultDir || 'data/vault')
const zotero = option('--zotero-db') || process.env.KG_ZOTERO_DB || config.zoteroDb || [
  path.join(os.homedir(), 'Zotero', 'zotero.sqlite'),
  path.join(process.env.APPDATA || os.homedir(), 'Zotero', 'Zotero', 'zotero.sqlite'),
].find((file) => fs.existsSync(file)) || ''
fs.mkdirSync(vault, { recursive: true })
const temp = path.join(root, 'data', 'temp')
fs.mkdirSync(temp, { recursive: true })
const args = [path.join(root, 'scripts', 'local-web.mjs'), ...cli]
if (!option('--vault')) args.push('--vault', vault)
if (zotero && !option('--zotero-db')) args.push('--zotero-db', resolve(zotero))
if (!option('--port')) args.push('--port', String(config.port || 4173))
for (const dir of config.pdfRoots || []) args.push('--pdf-root', resolve(dir))
if (zotero) args.push('--pdf-root', path.join(path.dirname(resolve(zotero)), 'storage'))
if (config.openBrowser === false && !cli.includes('--no-open')) args.push('--no-open')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
console.log(`知识图谱 v${version} · 免安装网页端 · Node ${process.version}`)
console.log('保留此窗口以使用网页；按 Ctrl+C 或关闭窗口即可停止服务。')
const child = spawn(process.execPath, args, {
  cwd: root, stdio: 'inherit', env: { ...process.env, TEMP: temp, TMP: temp },
})
child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
