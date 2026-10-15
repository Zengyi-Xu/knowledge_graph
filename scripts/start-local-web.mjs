import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bibliotx = 'D:\\BaiduSyncdisk\\Bibliotx'
const firstExisting = (paths) => paths.find((file) => fs.existsSync(file)) || ''
const vault = process.env.KG_VAULT_DIR || firstExisting([
  path.join(bibliotx, 'Vault'), path.join(os.homedir(), 'Documents', '知识图谱'),
])
const zotero = process.env.KG_ZOTERO_DB || firstExisting([
  path.join(bibliotx, 'Zotero', 'zotero.sqlite'),
  path.join(process.env.APPDATA || '', 'Zotero', 'Zotero', 'zotero.sqlite'),
])
const args = [path.join(root, 'scripts', 'local-web.mjs')]
if (vault) args.push('--vault', vault)
if (zotero) args.push('--zotero-db', zotero)
for (const dir of [
  path.join(bibliotx, 'Literature'), path.join(bibliotx, 'Archive'),
  path.join(bibliotx, 'Inform'), path.join(bibliotx, 'Zotero', 'storage'),
  path.join(os.homedir(), 'Zotero', 'storage'),
]) {
  if (fs.existsSync(dir)) args.push('--pdf-root', dir)
}
args.push(...process.argv.slice(2))
// Start the service directly, without a shell or installation step.
const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' })
child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
