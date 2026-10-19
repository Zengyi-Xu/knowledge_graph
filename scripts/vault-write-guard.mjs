/**
 * 服务端写入门禁（最后一道防线）。
 *
 * 背景：2026-10-16 一个旧客户端（不认识 front matter 里的 zoteroKeys / localPdf /
 * formatVersion 等字段）连上本地服务后把整个笔记库重写了一遍，抹掉 1792 篇文献的
 * PDF 相关字段。客户端的门禁（src/lib/vaultGate.ts、electron/vaultFs.cjs 的
 * gateAllowsWrite）只判断「磁盘声明的版本/能力是否超出本写入方」——今天那份文件声明的
 * 是 minimumWriterVersion: 2 + requiredCapabilities: ["zoteroKeys"]，对写入方来说
 * 「认得」，于是照单写入了客户端递过来的、已经没有这些字段的文本。
 *
 * 这一层补的就是那个漏洞：磁盘声明了 requiredCapabilities 的笔记，新文本必须仍然带着
 * 这些字段（且非空），否则整批拒绝。它对任何写入方生效，包括旧页面、旧构建和将来的工具。
 * 契约见 docs/VAULT_WRITE_GATE.md。
 */

/** 声明行本身：老客户端连这几行一起丢，丢了笔记就失去下一轮的自我保护 */
const DECLARATION_FIELDS = ['formatversion', 'minimumwriterversion', 'requiredcapabilities']

/**
 * 读磁盘原文的声明。认不出来的值按「更高版本」处理（宁可只读，也不覆盖未知格式）。
 * @returns {{ declared: boolean, formatVersion: number, minimumWriterVersion: number, capabilities: string[] }}
 */
export function readGateDeclaration(text) {
  const empty = { declared: false, formatVersion: 1, minimumWriterVersion: 0, capabilities: [] }
  if (typeof text !== 'string') return empty
  const block = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text.replace(/\r\n/g, '\n'))
  if (!block) return empty
  const unquote = (raw) => raw.trim().replace(/^["']|["']$/g, '')
  const out = { ...empty, declared: true, capabilities: [] }
  for (const line of block[1].split('\n')) {
    const field = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (!field) continue
    const key = field[1].toLowerCase()
    const raw = field[2]
    if (key === 'formatversion' || key === 'minimumwriterversion') {
      const value = /^\d+$/.test(unquote(raw)) ? Number(unquote(raw)) : Number.POSITIVE_INFINITY
      out[key === 'formatversion' ? 'formatVersion' : 'minimumWriterVersion'] = value >= 1 ? value : Number.POSITIVE_INFINITY
    } else if (key === 'requiredcapabilities') {
      for (const cap of unquote(raw).replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean)) out.capabilities.push(cap.toLowerCase())
    }
  }
  return out
}

/** front matter 的字段与值（值只做「非空」判断，不解析语义） */
function frontMatterFields(text) {
  const fields = new Map()
  if (typeof text !== 'string') return fields
  const block = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text.replace(/\r\n/g, '\n'))
  if (!block) return fields
  for (const line of block[1].split('\n')) {
    const field = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (field) fields.set(field[1].toLowerCase(), field[2].trim())
  }
  return fields
}

/** 值算不算「有内容」：空串、空数组、null/undefined 都算没有 */
function hasContent(raw) {
  if (raw === undefined || raw === null) return false
  const value = String(raw).trim()
  if (!value) return false
  if (/^\[\s*\]$/.test(value)) return false
  if (/^(null|undefined)$/i.test(value)) return false
  return true
}

/**
 * 这次写入会丢掉哪些磁盘上声明过的字段。
 * @param {string|null} diskText 磁盘原文（null = 新文件）
 * @param {string} nextText 客户端要写的新文本
 * @returns {string[]} 丢失的字段名（空数组 = 允许写入）
 */
export function findLostDeclaredFields(diskText, nextText) {
  if (typeof diskText !== 'string') return []
  const decl = readGateDeclaration(diskText)
  if (!decl.capabilities.length) return []
  const next = frontMatterFields(nextText)
  const lost = []
  // 能力名就是字段名（vaultGate 的 CAPABILITY_FIELDS）：声明过的字段必须原样带着且非空
  for (const cap of decl.capabilities) {
    const value = next.get(cap)
    if (value === undefined) lost.push(cap)
    else if (!hasContent(value)) lost.push(`${cap}（被清空）`)
  }
  // 声明行必须一起复现，否则这篇笔记下一轮就没人保护了
  for (const field of DECLARATION_FIELDS) {
    if (!hasContent(next.get(field))) lost.push(field)
  }
  return lost
}

/**
 * 整批校验写入计划。任何一篇会丢掉声明字段就拒绝整批（与 electron/vaultFs.cjs 的
 * gateAllowsWrite 一致：宁可什么都不写，也不要写出一份半损坏的库）。
 * @param {{file: string, text: string}[]} writes
 * @param {(rel: string) => Promise<string|null>} readExisting 读磁盘原文；文件不存在返回 null
 * @returns {Promise<{file: string, lost: string[]}[]>}
 */
export async function findBlockedWrites(writes, readExisting) {
  const blocked = []
  for (const write of Array.isArray(writes) ? writes : []) {
    if (!write || typeof write.file !== 'string' || typeof write.text !== 'string') continue
    const disk = await readExisting(write.file).catch(() => undefined)
    if (disk === undefined) continue // 读不到（权限等）交给 vaultFs 自己报错
    const lost = findLostDeclaredFields(disk, write.text)
    if (lost.length) blocked.push({ file: write.file, lost })
  }
  return blocked
}

/** 拒绝时给用户看的说明（中文，带前几个文件名） */
export function describeBlockedWrites(blocked) {
  const head = blocked.slice(0, 3).map((b) => `${b.file}（缺 ${b.lost.join('/')}）`).join('；')
  const more = blocked.length > 3 ? ` 等 ${blocked.length} 篇` : ''
  return `拒绝写入：${head}${more}。这些笔记声明了字段能力（requiredCapabilities），本次写入的内容里却没有这些字段——写入方大概是旧版本，请强刷页面（Ctrl+F5）或换用当前入口。详见 docs/VAULT_WRITE_GATE.md`
}

/**
 * meta.json 的同一类保护：磁盘上的索引声明过的东西（`formatVersion` 与任何自定义顶层字段）
 * 不能被新索引悄悄降级或丢掉。`notes` 每次都是重建的，不参与比较。
 * @returns {string[]} 丢失/降级的东西（空数组 = 允许写入）
 */
export function findMetaLoss(diskMeta, nextMeta) {
  if (typeof diskMeta !== 'string' || typeof nextMeta !== 'string') return []
  let prev
  let next
  try { prev = JSON.parse(diskMeta) } catch { return [] } // 读不出来就别拦，交给调用方的门禁
  try { next = JSON.parse(nextMeta) } catch { return ['meta.json 不是合法 JSON'] }
  if (!prev || typeof prev !== 'object' || !next || typeof next !== 'object') return []
  const lost = []
  for (const key of Object.keys(prev)) {
    if (key === 'notes') continue
    if (!(key in next)) { lost.push(`meta.${key}`); continue }
    if (key === 'formatVersion' && typeof prev.formatVersion === 'number' && Number(next.formatVersion) < prev.formatVersion) {
      lost.push(`meta.formatVersion（${prev.formatVersion} → ${next.formatVersion}）`)
    }
  }
  return lost
}
