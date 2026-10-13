#!/usr/bin/env node
/**
 * 打一个「免安装 exe」并留档。
 *
 * 目的：每次改动都能留下一个可以直接运行的 exe，历史版本不会被覆盖。
 * 产物：
 *   release/v<版本>/知识图谱-Portable-<版本>-x64.exe
 *   release/v<版本>/MANIFEST.json   版本、git commit、构建时间、exe 的 SHA-256
 *   release/CHANGELOG.md            追加一行构建记录
 *
 * 如果同一个版本号已经打过包，旧 exe 会被改名成
 * `...-<yyyyMMdd-HHmm>.exe` 保留在同一目录，而不是被覆盖。
 * 用法：npm run release:portable
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = String(pkg.version)
const productName = String(pkg.build?.productName ?? '知识图谱')
const artifactBase = `${productName}-Portable-${version}-x64.exe`
const outDir = path.join(root, 'release', `v${version}`)
const target = path.join(outDir, artifactBase)

const stamp = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' })

/** 在目录里递归找某个文件名（electron-builder 会按 artifactName 放进子目录） */
function findFile(dir, name) {
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name === name) return full
    }
  }
  return null
}

const git = (args) => {
  try {
    return execSync(`git ${args}`, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

// 1) 同版本重打时先给旧 exe 留档，保证「每次编辑」都有一个独立文件
fs.mkdirSync(outDir, { recursive: true })
if (fs.existsSync(target)) {
  const keep = path.join(outDir, artifactBase.replace(/\.exe$/i, `-${stamp()}.exe`))
  if (fs.existsSync(keep)) fs.rmSync(keep, { force: true })
  fs.renameSync(target, keep)
  console.log(`[留档] 旧 exe 已保留为 ${path.relative(root, keep)}`)
}

// 2) 类型检查 + 生产构建 + 打免安装包
run('npm run build')

// electron-builder 默认把中间产物（win-unpacked，含 app.asar）放在 output 根目录，
// 而 app.asar 经常被杀软/索引服务短时间占用，重打时覆盖会 EBUSY。
// 这里改成「每次构建用一个一次性的输出目录」，再把最终 exe 收进 release/v<版本>/，
// 既不会互相锁住，也不会在 release/ 里留下半成品。
const staging = path.join(os.tmpdir(), `kg-portable-${Date.now()}`)
try {
  run(`npx electron-builder --win portable --publish never --config.directories.output="${staging}"`)

  const staged = findFile(staging, artifactBase)
  if (!staged) {
    console.error(`未在 ${staging} 找到产物 ${artifactBase}，请检查 electron-builder 输出。`)
    process.exit(1)
  }
  fs.copyFileSync(staged, target)
} finally {
  // 清理失败不影响结果（临时目录里的残留由系统回收）
  try {
    fs.rmSync(staging, { recursive: true, force: true, maxRetries: 2, retryDelay: 500 })
  } catch {
    console.warn(`（提示）临时目录未清理干净：${staging}`)
  }
}

// 3) 记录版本信息（含本目录下所有 exe 的校验值）
const artifacts = fs
  .readdirSync(outDir)
  .filter((f) => f.toLowerCase().endsWith('.exe'))
  .sort()
  .map((f) => ({
    file: f,
    bytes: fs.statSync(path.join(outDir, f)).size,
    sha256: sha256(path.join(outDir, f)),
  }))

const manifest = {
  productName,
  version,
  builtAt: new Date().toISOString(),
  gitCommit: git('rev-parse HEAD'),
  gitCommitShort: git('rev-parse --short HEAD'),
  gitBranch: git('rev-parse --abbrev-ref HEAD'),
  gitDirty: git('status --porcelain').length > 0,
  electron: pkg.devDependencies?.electron ?? '',
  artifacts,
}
fs.writeFileSync(path.join(outDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

// 4) 追加到 release/CHANGELOG.md
const changelog = path.join(root, 'release', 'CHANGELOG.md')
const line = `- ${manifest.builtAt} · v${version} · ${manifest.gitCommitShort || 'no-git'}${
  manifest.gitDirty ? ' (dirty)' : ''
} · ${artifactBase} · sha256 ${sha256(target).slice(0, 16)}…\n`
if (!fs.existsSync(changelog)) {
  fs.writeFileSync(changelog, `# 免安装 exe 构建记录\n\n${line}`, 'utf8')
} else {
  fs.appendFileSync(changelog, line, 'utf8')
}

console.log(`\n完成：${path.relative(root, target)}`)
console.log(`清单：${path.relative(root, path.join(outDir, 'MANIFEST.json'))}`)
console.log(`sha256 ${sha256(target)}`)
