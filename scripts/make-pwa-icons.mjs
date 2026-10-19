/**
 * 生成 PWA 图标（无第三方依赖，纯 Node：自己画 + deflate + 写 PNG）。
 *
 *   node scripts/make-pwa-icons.mjs
 *
 * 图案：深色圆角方块上的一枚知识图谱节点（4 个节点 + 3 条边）。
 * 用 4 倍超采样再降采样做抗锯齿，避免引入任何图形库。
 * 产物（public/icons/，会随 public/ 一起进 dist）：
 *   icon-192.png、icon-512.png（普通图标）、icon-maskable-512.png（安卓自适应，留足安全区）、
 *   apple-touch-icon-180.png（iOS 主屏）。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public', 'icons')
const SS = 4

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** rgba: Uint8Array(w*h*4) → PNG buffer */
function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const BG = [17, 24, 39] // #111827
const NODE = [147, 197, 253] // #93c5fd
const HUB = [248, 250, 252] // #f8fafc
const EDGE = [96, 165, 250] // #60a5fa

/** 布局：中心枢纽 + 3 个外围节点（比例坐标，0..1） */
const LAYOUT = {
  hub: { x: 0.5, y: 0.5, r: 0.115 },
  nodes: [
    { x: 0.255, y: 0.245, r: 0.085 },
    { x: 0.775, y: 0.315, r: 0.075 },
    { x: 0.46, y: 0.785, r: 0.08 },
  ],
}

const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

function drawIcon(size, { maskable = false } = {}) {
  const full = size * SS
  const buffer = new Uint8Array(full * full * 4)
  // maskable 图标：底色铺满，图案缩到中心 72%（安卓会按形状裁切）
  const inset = maskable ? 0.14 : 0
  const radius = full * (maskable ? 0 : 0.22)

  const shapes = [LAYOUT.hub, ...LAYOUT.nodes]
  const scale = 1 - inset * 2
  const mapX = (x) => (inset + x * scale) * full
  const mapY = (y) => (inset + y * scale) * full

  for (let y = 0; y < full; y++) {
    for (let x = 0; x < full; x++) {
      const i = (y * full + x) * 4
      const insideBox = maskable || inRoundedRect(x, y, full, radius)
      if (!insideBox) continue
      let color = BG
      const px = x + 0.5
      const py = y + 0.5
      // 边（先画，节点后画会盖住端点）
      for (const node of LAYOUT.nodes) {
        const d = distToSegment(px, py, mapX(LAYOUT.hub.x), mapY(LAYOUT.hub.y), mapX(node.x), mapY(node.y))
        if (d < full * 0.014) color = EDGE
      }
      for (const node of shapes) {
        const isHub = node === LAYOUT.hub
        const r = node.r * scale * full
        const d = Math.hypot(px - mapX(node.x), py - mapY(node.y))
        if (d < r - full * 0.006) color = isHub ? HUB : NODE
      }
      buffer[i] = color[0]
      buffer[i + 1] = color[1]
      buffer[i + 2] = color[2]
      buffer[i + 3] = 255
    }
  }
  return downsample(buffer, full, size)
}

function inRoundedRect(x, y, size, radius) {
  const r = radius
  const cx = Math.min(Math.max(x + 0.5, r), size - r)
  const cy = Math.min(Math.max(y + 0.5, r), size - r)
  return Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r
}

/** 盒式降采样：SS×SS 取平均，得到抗锯齿边缘 */
function downsample(src, full, size) {
  const out = new Uint8Array(size * size * 4)
  const unit = SS * SS
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * full + (x * SS + sx)) * 4
          const alpha = src[i + 3]
          r += src[i] * alpha
          g += src[i + 1] * alpha
          b += src[i + 2] * alpha
          a += alpha
        }
      }
      const o = (y * size + x) * 4
      if (a === 0) continue
      out[o] = Math.round(r / a)
      out[o + 1] = Math.round(g / a)
      out[o + 2] = Math.round(b / a)
      out[o + 3] = Math.round(a / unit)
    }
  }
  return out
}

fs.mkdirSync(OUT, { recursive: true })
const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon-180.png', 180, {}],
]
for (const [name, size, options] of targets) {
  const png = encodePng(size, size, drawIcon(size, options))
  fs.writeFileSync(path.join(OUT, name), png)
  console.log(`${name}  ${size}x${size}  ${png.length} B`)
}
console.log(`图标已写入 ${OUT}`)
