/**
 * 把 src/lib/csl/ 下的 .csl / locale 文件打成 TS 模块（esbuild 单测与 Vite 都能用）。
 * 生成方式：node scripts/gen-csl-ts.mjs（XML 里的反引号、反斜杠与 ${ 已转义）。
 * 来源与许可证见各 .csl 文件头注释（CC BY-SA 3.0）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const cslDir = path.resolve(here, '../src/lib/csl')

const FILES = [
  ['GB_CSL_XML', 'gb-t-7714-2015-numeric-bilan.csl'],
  ['APA_CSL_XML', 'apa.csl'],
  ['ZH_CN_LOCALE_XML', 'locales-zh-CN.xml'],
]

function asTemplateLiteral(xml) {
  return xml.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

let out = '/** 本文件由 scripts/gen-csl-ts.mjs 生成，请勿手改；改 .csl 后重新运行生成脚本。 */\n\n'
for (const [name, file] of FILES) {
  const xml = fs.readFileSync(path.join(cslDir, file), 'utf8')
  out += `export const ${name} = \`\n${asTemplateLiteral(xml)}\`\n\n`
}
fs.writeFileSync(path.join(cslDir, 'styles.ts'), out)
console.log(`已生成 ${path.join(cslDir, 'styles.ts')}（${out.length} 字节）`)
