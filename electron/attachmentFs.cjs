/**
 * 附件读写实现（纯 Node，可脱离 Electron 直接被 node 单测）。
 *
 * 只允许访问 vault 内 `attachments/` 目录下的**一层**文件：
 *   - PDF 二进制：<附件id>.pdf（文件名即 id，保持原扩展名）
 *   - 标注 JSON：  <附件id>.annotations.json
 *
 * 路径校验复用 vaultFs.cjs 的 normalizeRel/resolveInside，再额外限制必须是
 * `attachments/` 内的一层文件名（正则 ^attachments/[^/]+$），双层防线。
 */
const fs = require('node:fs/promises')
const path = require('node:path')
const { normalizeRel, resolveInside, withRetry } = require('./vaultFs.cjs')

const ATTACHMENTS_DIR = 'attachments'
const ONE_LEVEL_RE = /^attachments\/[^/]+$/

/** 校验并规范化附件相对路径；不合法直接抛错 */
function normalizeAttachmentRel(rel) {
  const norm = normalizeRel(rel)
  if (!ONE_LEVEL_RE.test(norm)) {
    throw new Error(`附件路径必须是 attachments/ 内的一层文件名：${rel}`)
  }
  return norm
}

/** 列出 attachments/ 下全部文件的相对名与 mtime/size；目录不存在返回空数组 */
async function list(dir) {
  const abs = path.resolve(dir)
  const target = path.join(abs, ATTACHMENTS_DIR)
  let entries
  try {
    entries = await fs.readdir(target, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const stat = await fs.stat(path.join(target, entry.name)).catch(() => null)
    if (!stat) continue
    out.push({ name: `${ATTACHMENTS_DIR}/${entry.name}`, mtimeMs: stat.mtimeMs, size: stat.size })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/** 读取二进制；文件不存在返回 null（IPC 传 Buffer，preload 侧收到 Uint8Array） */
async function read(dir, rel) {
  const abs = path.resolve(dir)
  const norm = normalizeAttachmentRel(rel)
  const data = await fs.readFile(resolveInside(abs, norm)).catch((error) => {
    if (error && error.code === 'ENOENT') return null
    throw error
  })
  return data
}

/** 原子写：临时文件 + rename（与 vaultFs 的 writeFileAtomic 同款思路） */
async function write(dir, rel, data) {
  const abs = path.resolve(dir)
  const norm = normalizeAttachmentRel(rel)
  const target = resolveInside(abs, norm)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = path.join(
    path.dirname(target),
    `.kg-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  try {
    await withRetry(() => fs.writeFile(tmp, data))
    await withRetry(() => fs.rename(tmp, target))
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw error
  }
  return { name: norm }
}

/** 删除附件文件；不存在也算成功 */
async function remove(dir, rel) {
  const abs = path.resolve(dir)
  const norm = normalizeAttachmentRel(rel)
  await withRetry(() => fs.rm(resolveInside(abs, norm), { force: true }))
  return { name: norm }
}

module.exports = { list, read, write, remove, normalizeAttachmentRel, ATTACHMENTS_DIR }
