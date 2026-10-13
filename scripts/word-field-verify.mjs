/**
 * Word 域代码真机验证（Windows + 本机 Word）：
 *   1) 用真实 buildCitationFieldRtf 生成 RTF；
 *   2) 按生产通道（CF_RTF 剪贴板）写入；
 *   3) 用 Word COM 粘贴，断言得到的域数量与域代码。
 * 用法：node scripts/word-field-verify.mjs
 * 背景：CF_HTML + mso-element 在 Word 粘贴时不生成域（6 种变体实测全失败）；
 *       只有 CF_RTF 有效，且 `\fldinst` 指令不能带花括号（2026-10-13 实测）。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import esbuild from 'esbuild'

const root = process.cwd()
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kg-word-verify-'))

// 1) 打包真实实现，生成 RTF 载荷
const bundle = path.join(tmp, 'gen.cjs')
await esbuild.build({
  entryPoints: ['scripts/gen-rtf-sample.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  alias: { '@': path.join(root, 'src') },
  outfile: bundle,
  logLevel: 'error',
})
const rtf = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [bundle], { windowsHide: true })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve(out) : reject(new Error(`生成 RTF 失败（${code}）`)))
})
if (!rtf.startsWith('{\\rtf1')) throw new Error(`RTF 载荷异常：${rtf.slice(0, 40)}`)

// 2) 走生产通道写剪贴板（与 local-web 的 clipboard:write-rtf 同一套逻辑）
const rtfFile = path.join(tmp, 'payload.rtf')
await fs.writeFile(rtfFile, rtf, 'utf8')
const quote = (p) => `'${p.replace(/'/g, "''")}'`
const psFile = path.join(tmp, 'verify.ps1')
await fs.writeFile(psFile, [
  'Add-Type -AssemblyName System.Windows.Forms',
  `$rtf = [System.IO.File]::ReadAllText(${quote(rtfFile)}, [System.Text.Encoding]::UTF8)`,
  '$do = New-Object System.Windows.Forms.DataObject',
  '$bytes = [System.Text.Encoding]::ASCII.GetBytes($rtf)',
  '$ms = New-Object System.IO.MemoryStream',
  '$ms.Write($bytes, 0, $bytes.Length); $ms.Position = 0',
  "$do.SetData('Rich Text Format', $false, $ms)",
  "$do.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $true, '[1]')",
  '[System.Windows.Forms.Clipboard]::SetDataObject($do, $true)',
  '$word = New-Object -ComObject Word.Application',
  '$word.Visible = $false',
  '$doc = $word.Documents.Add()',
  '$doc.Content.Paste() | Out-Null',
  'Start-Sleep -Milliseconds 300',
  'Write-Output ("fields=" + $doc.Fields.Count)',
  'foreach ($f in $doc.Fields) { Write-Output ("code=" + $f.Code.Text.Trim()) }',
  '$doc.Close($false) | Out-Null',
  '$word.Quit()',
].join('\n'), 'utf8')

const output = await new Promise((resolve, reject) => {
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', psFile], { windowsHide: true })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  child.on('error', reject)
  child.on('exit', () => resolve(out))
}).finally(() => { fs.rm(tmp, { recursive: true, force: true }).catch(() => {}) })

const fields = Number(output.match(/fields=(\d+)/)?.[1] ?? 0)
const code = output.match(/code=(.+)/)?.[1]?.trim() ?? ''
console.log(output.trim())
if (fields !== 1) throw new Error('Word 粘贴未生成域（期望 fields=1）')
if (!code.startsWith('ADDIN ZOTERO_ITEM ')) throw new Error(`域代码不是 Zotero 兼容格式：${code.slice(0, 60)}`)
if (!code.includes('"citationItems"')) throw new Error('域代码缺少 citationItems payload')
console.log('\n✅ Word 真域验证通过（fields=1，ADDIN ZOTERO_ITEM + citationItems）')
