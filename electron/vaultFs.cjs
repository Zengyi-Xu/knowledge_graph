/**
 * vault 目录的读写实现（纯 Node，可脱离 Electron 直接被 node 单测）。
 * 只做「读目录 / 读文件 / 批量写+删」三件事，格式语义全部在 src/lib/vaultFormat.ts。
 *
 * vault 是**有层级的**：笔记按类型放在子文件夹里（技能 / 项目 / 学习 / KAUST团队 …），
 * meta.json 放在 vault 根目录。所有路径都必须是 vault 内的相对路径，
 * 因此本模块永远不会写到 vault 目录之外。
 */
const fs = require('node:fs/promises')
const path = require('node:path')

const MD_RE = /\.md$/i
const META_NAME = 'meta.json'
/** 递归扫描时跳过的目录（工具目录 / 依赖 / 版本库） */
const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash'])

/** 有界并发，限制同步盘/杀软同时打开的文件数，且保持输入顺序。 */
async function mapConcurrent(items, fn, concurrency = 32) {
  const out = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }))
  return out
}

/** Windows 上杀软/编辑器可能短暂占用文件，重试几次 */
async function withRetry(fn, attempts = 4) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      const code = error && error.code
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOENT') throw error
      await new Promise((r) => setTimeout(r, 40 * (i + 1)))
    }
  }
  throw lastError
}

/** 统一成 / 分隔的相对路径；拒绝绝对路径、盘符与 ..，防止越出 vault */
function normalizeRel(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('非法文件名')
  if (input.includes('\0')) throw new Error(`文件名非法：${input}`)
  const norm = input.replace(/\\/g, '/')
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) throw new Error(`不允许绝对路径：${input}`)
  const parts = norm.split('/').filter((p) => p !== '' && p !== '.')
  if (parts.length === 0) throw new Error('非法文件名')
  for (const p of parts) {
    if (p === '..') throw new Error(`路径不能超出 vault：${input}`)
  }
  return parts.join('/')
}

/** 目标文件的绝对路径（已确认落在 vault 内） */
function resolveInside(dir, rel) {
  const abs = path.resolve(dir)
  const full = path.resolve(abs, rel)
  if (full !== abs && !full.startsWith(abs + path.sep)) throw new Error(`路径不能超出 vault：${rel}`)
  return full
}

async function writeFileAtomic(absDir, rel, text) {
  const target = resolveInside(absDir, rel)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = path.join(
    path.dirname(target),
    `.kg-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  try {
    await withRetry(() => fs.writeFile(tmp, text, 'utf8'))
    await withRetry(() => fs.rename(tmp, target))
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

/** 自底向上删掉变空的父目录（不会越过 vault 根） */
async function pruneEmptyDirs(absDir, rel) {
  let current = path.dirname(resolveInside(absDir, rel))
  while (current !== absDir && current.startsWith(absDir + path.sep)) {
    try {
      const entries = await fs.readdir(current)
      if (entries.length > 0) return
      await fs.rmdir(current)
    } catch {
      return
    }
    current = path.dirname(current)
  }
}

/**
 * 递归列出 vault：meta.json 内容（只认根目录的那个）+ 所有 .md 的相对路径与元信息。
 * 不读正文，避免误扫一个巨大的知识库。目录不存在时返回 { exists: false }。
 */
async function listVault(dir) {
  const abs = path.resolve(dir)
  let rootEntries
  try {
    rootEntries = await fs.readdir(abs, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return { exists: false, meta: null, md: [] }
    throw error
  }

  const meta = await fs.readFile(path.join(abs, META_NAME), 'utf8').catch((error) => {
    if (error && error.code === 'ENOENT') return null
    throw error
  })
  const names = []

  const walk = async (relDir) => {
    const currentAbs = relDir ? path.join(abs, relDir) : abs
    const entries = relDir ? await fs.readdir(currentAbs, { withFileTypes: true }) : rootEntries
    for (const entry of entries) {
      const name = entry.name
      if (name.startsWith('.')) continue
      const rel = relDir ? `${relDir}/${name}` : name
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name.toLowerCase())) continue
        await walk(rel)
        continue
      }
      if (!entry.isFile()) continue
      if (!MD_RE.test(name)) continue
      names.push(rel)
    }
  }

  await walk('')
  const stats = await mapConcurrent(names, async (name) => {
    const stat = await fs.stat(path.join(abs, name)).catch((error) => {
      if (error && error.code === 'ENOENT') return null
      throw error
    })
    return stat ? { name, mtimeMs: stat.mtimeMs, size: stat.size } : null
  })
  const md = stats.filter(Boolean)
  md.sort((a, b) => a.name.localeCompare(b.name))
  return { exists: true, meta, md }
}

/** 读取指定 md 的正文（相对路径）；文件不存在返回 text: null */
async function readVaultFiles(dir, names) {
  const abs = path.resolve(dir)
  // 先验证所有路径，再开始 I/O，拒绝批次里夹带的越界路径。
  const rels = (names || []).map(normalizeRel)
  return mapConcurrent(rels, async (rel) => {
    const text = await fs.readFile(resolveInside(abs, rel), 'utf8').catch((error) => {
      if (error && error.code === 'ENOENT') return null
      throw error
    })
    return { name: rel, text }
  })
}

/**
 * 批量写盘：先写 md（原子替换），再删旧文件，最后写 meta.json。
 * 顺序保证：即使中途失败，meta 也不会指向尚未落盘的笔记。
 */
async function writeVault(dir, payload) {
  const abs = path.resolve(dir)
  const writes = Array.isArray(payload && payload.writes) ? payload.writes : []
  const deletes = Array.isArray(payload && payload.deletes) ? payload.deletes : []
  const meta = payload && typeof payload.meta === 'string' ? payload.meta : null

  await fs.mkdir(abs, { recursive: true })

  let written = 0
  for (const w of writes) {
    if (!w || typeof w.file !== 'string' || typeof w.text !== 'string') throw new Error('非法的写入项')
    await writeFileAtomic(abs, normalizeRel(w.file), w.text)
    written++
  }

  let deleted = 0
  for (const name of deletes) {
    const rel = normalizeRel(name)
    await withRetry(() => fs.rm(resolveInside(abs, rel), { force: true }))
    await pruneEmptyDirs(abs, rel).catch(() => {})
    deleted++
  }

  if (meta !== null) await writeFileAtomic(abs, META_NAME, meta)

  return { written, deleted, filePath: abs }
}

module.exports = { listVault, readVaultFiles, writeVault, META_NAME, normalizeRel, resolveInside, withRetry, mapConcurrent }
