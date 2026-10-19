/**
 * 打包体积的「模块级归属」报告：用 Vite 的 Node API 跑一次 production 构建（不写盘），
 * 借 Rollup 的 chunk.modules[].renderedLength 得到每个 chunk 里每个模块的真实字节数。
 *
 * 用途：预算超了以后定位「是谁胖」——比如「入口 680KB 里 120KB 是 NoteEditor 那条链」。
 *   node scripts/bundle-modules.mjs            # 打印每个 chunk 的 Top 模块 + node_modules 分组
 *   node scripts/bundle-modules.mjs --top 40   # 调整每个 chunk 打印的条数
 *   node scripts/bundle-modules.mjs --json .tmp-bundle/modules.json
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'vite'

const root = process.cwd()
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf(name)
  return at === -1 ? fallback : argv[at + 1]
}
const top = Number(flag('--top', '15'))
const jsonOut = flag('--json', '')

/** node_modules 里的模块归到「包名」，自己的代码按 src/ 相对路径 */
function owner(id) {
  const normalized = id.replace(/\\/g, '/')
  const at = normalized.lastIndexOf('/node_modules/')
  if (at !== -1) {
    const rest = normalized.slice(at + '/node_modules/'.length).split('/')
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]
  }
  const rel = path.relative(root, normalized).replace(/\\/g, '/')
  return rel.startsWith('..') ? normalized : rel
}

const chunks = new Map()
await build({
  configFile: path.resolve(root, 'vite.config.ts'),
  logLevel: 'warn',
  build: { write: false },
  plugins: [
    {
      name: 'kg:module-stats',
      generateBundle(_options, bundle) {
        for (const [file, item] of Object.entries(bundle)) {
          if (item.type !== 'chunk') continue
          const modules = Object.entries(item.modules)
            .map(([id, info]) => ({ id: owner(id), bytes: info.renderedLength }))
            .filter((entry) => entry.bytes > 0)
            .sort((a, b) => b.bytes - a.bytes)
          const byOwner = new Map()
          for (const entry of modules) byOwner.set(entry.id, (byOwner.get(entry.id) ?? 0) + entry.bytes)
          chunks.set(file, {
            bytes: Buffer.byteLength(item.code),
            imports: item.imports,
            importers: item.importers,
            dynamicImports: item.dynamicImports,
            modules,
            byOwner: [...byOwner].map(([name, bytes]) => ({ name, bytes })).sort((a, b) => b.bytes - a.bytes),
          })
        }
      },
    },
  ],
})

const kb = (bytes) => (bytes / 1024).toFixed(1).padStart(8)
for (const [file, info] of [...chunks].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`\n### ${file}  ${kb(info.bytes)} KB`)
  if (info.dynamicImports.length) console.log(`    ↳ 动态: ${info.dynamicImports.join(', ')}`)
  for (const group of info.byOwner.slice(0, top)) console.log(`  ${kb(group.bytes)} KB  ${group.name}`)
  const ownerTotal = info.byOwner.reduce((sum, group) => sum + group.bytes, 0)
  if (info.byOwner.length > top) {
    const rest = ownerTotal - info.byOwner.slice(0, top).reduce((sum, group) => sum + group.bytes, 0)
    console.log(`  ${kb(rest)} KB  …其余 ${info.byOwner.length - top} 个模块`)
  }
}

if (jsonOut) {
  const file = path.resolve(root, jsonOut)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(Object.fromEntries(chunks), null, 2) + '\n', 'utf8')
  console.log(`\n模块明细已写入 ${file}`)
}
