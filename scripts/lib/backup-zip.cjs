/**
 * 备份压缩包（纯 Node，无第三方依赖；CommonJS，.ts 脚本经 esbuild 打包后可直接 require，.mjs 测试可具名 import）。
 *
 * 背景：vault 在百度同步盘上，`.backups/` 里一次全量备份就是上万个 md 小文件，
 * 同步盘逐文件上传极慢。所以备份统一写成「同名压缩包」：
 *   <vault>/.backups/zotero-import-<时间戳>.zip
 * 包内条目保留原来的相对目录结构（含 meta.json / report.json）。
 *
 * 用法：
 *   const { writeBackupZip, readBackupZip, freshZipPath } = require('./lib/backup-zip.cjs')
 *   const zip = freshZipPath(path.join(vault, '.backups', `dedupe-${stamp}.zip`))
 *   writeBackupZip(zip, [{ name: 'meta.json', data: fs.readFileSync(metaFile) }, ...])
 *   const entries = readBackupZip(zip)   // [{ name, data: Buffer }]
 */
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * 写 zip。entries: [{ name: 'a/b.md'（用 / 分隔）, data: Buffer }]
 * 已是压缩态的内容（压完反而更大）自动退回 store。
 * 先写临时文件再 rename：同步盘不会在半途看到一个不完整的 zip。
 */
function writeBackupZip(filePath, entries) {
  if (entries.length > 65535) throw new Error(`备份条目过多（${entries.length}），超过 zip 上限 65535`)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const { time, date } = dosDateTime(new Date())
  const chunks = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const name = String(entry.name).replace(/\\/g, '/')
    const nameBuf = Buffer.from(name, 'utf8')
    const data = entry.data
    const deflated = zlib.deflateRawSync(data, { level: 6 })
    const store = deflated.length >= data.length
    const payload = store ? data : deflated
    const method = store ? 0 : 8
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // bit 11：文件名 UTF-8
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBuf, payload)

    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4) // version made by
    cen.writeUInt16LE(20, 6) // version needed
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(method, 10)
    cen.writeUInt16LE(time, 12)
    cen.writeUInt16LE(date, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(payload.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt32LE(offset, 42) // local header offset
    central.push(cen, nameBuf)
    offset += 30 + nameBuf.length + payload.length
  }
  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  const tmp = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(tmp, Buffer.concat([...chunks, centralBuf, eocd]))
  fs.renameSync(tmp, filePath)
}

/** 读回 zip：返回 [{ name, data: Buffer }]，顺序同写入。 */
function readBackupZip(filePath) {
  const buf = fs.readFileSync(filePath)
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error(`不是有效的 zip：${filePath}`)
  const count = buf.readUInt16LE(eocd + 10)
  let pos = buf.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('zip 中央目录损坏')
    const method = buf.readUInt16LE(pos + 10)
    const compSize = buf.readUInt32LE(pos + 20)
    const nameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const localOffset = buf.readUInt32LE(pos + 42)
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen)
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip 本地头损坏')
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28)
    const payload = buf.subarray(dataStart, dataStart + compSize)
    const data = method === 8 ? zlib.inflateRawSync(payload) : Buffer.from(payload)
    entries.push({ name, data })
    pos += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 取一个尚未占用的备份 zip 路径（同一秒重复运行时加 -2/-3 后缀）。base 须以 .zip 结尾 */
function freshZipPath(base) {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : base.replace(/\.zip$/, `-${i + 1}.zip`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error(`无法创建备份文件：${base}`)
}

module.exports = { writeBackupZip, readBackupZip, freshZipPath }
