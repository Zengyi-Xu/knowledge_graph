#!/usr/bin/env node
/**
 * 冻结单元校验（黑箱锁）—— 契约见 docs/FROZEN.md，定义见 frozen.json。
 *
 *   node scripts/frozen-check.mjs                 校验锁定内容与磁盘是否一致（秒级）
 *   node scripts/frozen-check.mjs --run-guards    校验后顺序跑各单元的守护测试
 *   node scripts/frozen-check.mjs --update "理由"  以当前磁盘状态重新锁定（= 解冻）
 *
 * 两种级别（frozen.json 的 tier 字段）：
 *   tier 1 全冻结：文件内容按 sha256 锁死。内部实现是黑箱，不要读也不要改。
 *   tier 2 契约冻结：公开导出名 / 接口清单锁死；内部实现可改，但改完要跑守护测试。
 *
 * 不论哪一级，只要改了被锁定的内容而没 `--update`，本脚本就失败退出（码 1）。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(ROOT, 'frozen.json')

/* --------------------------------------------------------------- 基础工具 */

const readManifest = () => JSON.parse(readFileSync(MANIFEST, 'utf8'))
const writeManifest = (m) => writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n')

const abs = (rel) => path.join(ROOT, rel)
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(target, out)
    else if (entry.isFile()) out.push(target)
  }
  return out
}

/** 支持的形态：精确文件路径，或 `目录/**`（递归全部文件） */
function expand(pattern) {
  if (pattern.endsWith('/**')) {
    const dir = abs(pattern.slice(0, -3))
    return existsSync(dir) ? walk(dir).map(rel) : []
  }
  return existsSync(abs(pattern)) ? [pattern] : []
}

/**
 * 内容哈希。行尾（CRLF / LF）会随 checkout 环境变化、不是内容的一部分，
 * 所以先归一化再算 —— 换行符差异不会误报，真正的改动照样能发现。
 */
function sha256(file) {
  const bytes = readFileSync(abs(file)).toString('binary').replace(/\r\n/g, '\n')
  return createHash('sha256').update(bytes, 'binary').digest('hex')
}

/* --------------------------------------------------------- 契约内容提取 */

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm
const REEXPORT_RE = /^export\s*(?:type\s*)?\{([^}]*)\}/gm

/** 模块对外的名字集合（写盘时被锁定的就是它） */
function extractExports(file) {
  const text = readFileSync(abs(file), 'utf8')
  const names = new Set()
  for (const m of text.matchAll(EXPORT_RE)) names.add(m[1])
  for (const m of text.matchAll(REEXPORT_RE)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
    }
  }
  return [...names].sort()
}

/** 桌面桥：preload 暴露给页面的方法名 + 用到的 ipc 通道名 */
function extractPreload() {
  const text = readFileSync(abs('electron/preload.cjs'), 'utf8')
  const start = text.indexOf('exposeInMainWorld(')
  const body = start < 0 ? text : text.slice(start)
  const channels = [...text.matchAll(/invoke\(\s*'([^']+)'/g)].map((m) => m[1])
  const api = [...body.matchAll(/^ {2}([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1])
  return { channels: [...new Set(channels)].sort(), api: [...new Set(api)].sort() }
}

/** 桌面桥契约文件（src/types/desktop.d.ts）声明的方法名；optional 表示带 `?` */
function extractDtsApi() {
  const text = readFileSync(abs('src/types/desktop.d.ts'), 'utf8')
  const start = text.indexOf('knowledgeGraphDesktop')
  const body = start < 0 ? text : text.slice(start)
  return [...body.matchAll(/^ {6}([A-Za-z_$][\w$]*)(\?)?\s*:/gm)].map((m) => ({
    name: m[1],
    optional: Boolean(m[2]),
  }))
}

/** 锁定内容是否为空（多半意味着 files 模式或 check 类型写错了） */
function lockIsEmpty(next) {
  if (next.files) return Object.keys(next.files).length === 0
  if (next.exports) return !Object.values(next.exports).some((names) => names.length)
  return !(next.api ?? []).length
}

/* ------------------------------------------------------------- 单元锁定 */

function lockUnit(unit) {
  if (unit.tier === 1) {
    const files = {}
    for (const pattern of unit.files) for (const f of expand(pattern)) files[f] = sha256(f)
    return { files }
  }
  if (unit.check === 'desktop-api') return { ...extractPreload() }
  const exports = {}
  for (const file of unit.files) if (existsSync(abs(file))) exports[file] = extractExports(file)
  return { exports }
}

function diffSets(expected, actual) {
  const e = new Set(expected)
  const a = new Set(actual)
  return {
    missing: [...e].filter((x) => !a.has(x)).sort(),
    extra: [...a].filter((x) => !e.has(x)).sort(),
  }
}

/** 返回该单元的问题列表（空 = 一致） */
function verifyUnit(unit) {
  const problems = []
  const locked = unit.locked ?? {}

  if (unit.tier === 1) {
    const current = {}
    const empty = []
    for (const pattern of unit.files) {
      const matched = expand(pattern)
      if (!matched.length) empty.push(pattern)
      for (const f of matched) current[f] = sha256(f)
    }
    for (const pattern of empty) problems.push(`模式没匹配到任何文件（定义写错了）：${pattern}`)
    if (!Object.keys(locked.files ?? {}).length) {
      problems.push('锁定内容为空，先跑 npm run frozen:update')
      return problems
    }
    for (const f of Object.keys(locked.files)) {
      if (!(f in current)) problems.push(`已被删除：${f}`)
      else if (current[f] !== locked.files[f]) problems.push(`内容已改：${f}`)
    }
    for (const f of Object.keys(current)) {
      if (!(f in locked.files)) problems.push(`目录里多出未登记文件：${f}`)
    }
    return problems
  }

  if (unit.check === 'desktop-api') {
    const current = extractPreload()
    const { missing, extra } = diffSets(locked.api ?? [], current.api)
    if (missing.length) problems.push(`preload 不再暴露：${missing.join(', ')}`)
    if (extra.length) problems.push(`preload 新增未登记方法：${extra.join(', ')}`)
    const ch = diffSets(locked.channels ?? [], current.channels)
    if (ch.missing.length) problems.push(`ipc 通道消失：${ch.missing.join(', ')}`)
    if (ch.extra.length) problems.push(`ipc 通道新增未登记：${ch.extra.join(', ')}`)

    // 契约文件与实现必须互相对得上：d.ts 声明的必选方法要真在 preload 里；
    // preload 暴露的方法也要在 d.ts 里有类型（否则调用方看不见）。
    const dts = extractDtsApi()
    const dtsNames = new Set(dts.map((d) => d.name))
    const required = dts.filter((d) => !d.optional).map((d) => d.name)
    const absent = required.filter((name) => !current.api.includes(name))
    if (absent.length) problems.push(`desktop.d.ts 声明了但 preload 没有：${absent.join(', ')}`)
    const undeclared = current.api.filter((name) => !dtsNames.has(name))
    if (undeclared.length) problems.push(`preload 暴露了但 desktop.d.ts 没声明：${undeclared.join(', ')}`)
    return problems
  }

  for (const [file, names] of Object.entries(locked.exports ?? {})) {
    if (!existsSync(abs(file))) {
      problems.push(`文件不存在：${file}`)
      continue
    }
    if (!names.length) {
      problems.push(`${file} 锁定内容为空（定义写错了）`)
      continue
    }
    const { missing, extra } = diffSets(names, extractExports(file))
    if (missing.length) problems.push(`${file} 少了导出：${missing.join(', ')}`)
    if (extra.length) problems.push(`${file} 多了导出：${extra.join(', ')}`)
  }
  if (!Object.keys(locked.exports ?? {}).length) problems.push('锁定内容为空，先跑 npm run frozen:update')
  for (const file of unit.files) if (!existsSync(abs(file))) problems.push(`文件不存在：${file}`)
  return problems
}

/* ------------------------------------------------------------------ 报告 */

const TIER_LABEL = { 1: '全冻结', 2: '契约冻结' }

function printReport(units, checked) {
  console.log('冻结单元校验（定义：frozen.json，契约：docs/FROZEN.md）\n')
  for (const unit of units) {
    const problems = checked.get(unit.id)
    const lock = unit.locked?.baselineAt ? ` [锁于 ${unit.locked.baselineAt}]` : ' [未锁定]'
    if (!problems.length) {
      console.log(`  ok     ${unit.id.padEnd(15)} ${TIER_LABEL[unit.tier]}${lock}`)
      continue
    }
    console.log(`  CHANGED ${unit.id.padEnd(15)} ${TIER_LABEL[unit.tier]}${lock}  —— ${unit.title}`)
    for (const p of problems) console.log(`            · ${p}`)
  }
}

function printThawHint() {
  console.log(
    [
      '',
      '这些单元是冻结的黑箱。可以走的两条路：',
      '  1) 把改动还原（推荐）——冻结单元不该为了顺手重构而动；',
      '  2) 确实需要改：改完跑 `npm run test:frozen` 确认守护测试全绿，再显式解冻：',
      '       npm run frozen:update -- "<哪个单元> <为什么改>"',
      '     并在 docs/FROZEN.md 对应单元里补一句说明（必要时同步契约文档）。',
    ].join('\n'),
  )
}

/* ------------------------------------------------------------------ 主流程 */

const argv = process.argv.slice(2)
const update = argv.includes('--update')
const runGuards = argv.includes('--run-guards')
const reason = argv.filter((a) => !a.startsWith('--')).join(' ').trim()

const manifest = readManifest()
const checked = new Map()
let failed = 0

if (update) {
  const now = new Date()
  const at = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
  const touched = []
  const broken = []
  for (const unit of manifest.units) {
    const next = lockUnit(unit)
    if (lockIsEmpty(next)) {
      broken.push(`${unit.id}: 没锁定到任何内容 —— files 模式写错了？`)
    }
    if (unit.tier === 1) {
      for (const pattern of unit.files) {
        if (!expand(pattern).length) broken.push(`${unit.id}: 模式没匹配到文件 ${pattern}`)
      }
    }
    if (unit.tier === 2) {
      for (const [file, names] of Object.entries(next.exports ?? {})) {
        if (!names.length) broken.push(`${unit.id}: ${file} 没有任何导出，锁定它没意义`)
      }
    }
    if (verifyUnit(unit).length || !unit.locked) touched.push(unit.id)
    unit.locked = { ...next, baselineAt: at }
  }
  if (broken.length) {
    console.error('拒绝锁定：单元定义有问题，先修 frozen.json')
    for (const b of broken) console.error(`  · ${b}`)
    process.exit(2)
  }
  manifest.history = [
    ...(manifest.history ?? []),
    { at, units: touched, reason: reason || '未说明' },
  ].slice(-50)
  writeManifest(manifest)
  console.log(`已重新锁定：${touched.join(', ') || '（无变化）'}`)
  console.log(`理由：${reason || '未说明'}`)
  process.exit(0)
}

for (const unit of manifest.units) {
  const problems = unit.locked ? verifyUnit(unit) : ['未锁定（先跑 npm run frozen:update）']
  checked.set(unit.id, problems)
  if (problems.length) failed++
}

printReport(manifest.units, checked)

if (failed) {
  console.log(`\n${failed} 个冻结单元与锁定内容不一致。`)
  printThawHint()
  process.exit(1)
}

console.log(`\n${manifest.units.length} 个冻结单元全部与锁定内容一致。`)

if (!runGuards) {
  const guards = [...new Set(manifest.units.flatMap((u) => u.guards ?? []))]
  if (guards.length) {
    console.log(`守护测试（黑箱行为验证，不改冻结内容也应常年全绿）：npm run test:frozen`)
    console.log(`  ${guards.join('  ')}`)
  }
  process.exit(0)
}

const guards = [...new Set(manifest.units.flatMap((u) => u.guards ?? []))]
const results = []
for (const guard of guards) {
  console.log(`\n──── 守护测试 ${guard} ────`)
  const r = spawnSync(`npm run ${guard}`, { cwd: ROOT, stdio: 'inherit', shell: true })
  results.push({ guard, code: r.status ?? 1 })
}

console.log('\n守护测试汇总：')
for (const { guard, code } of results) console.log(`  ${code === 0 ? 'ok    ' : 'FAILED'} ${guard}`)
const bad = results.filter((r) => r.code !== 0)
if (bad.length) {
  console.log(`\n${bad.length} 个守护测试失败：冻结单元的行为已经变了，先修它。`)
  process.exit(1)
}
console.log(`\n冻结校验全部通过（${manifest.units.length} 个单元 + ${results.length} 个守护测试）。`)
