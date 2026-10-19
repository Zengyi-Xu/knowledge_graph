/**
 * 「不靠 Zotero key，直接按标题认回本地 PDF」的匹配内核（纯函数，可单测）。
 *
 * 用途：笔记的 `localPdf` 与 Zotero `zoteroKeys` 都没命中的时候，用这一层兜底——
 * 把文献标题和授权目录里的 PDF 文件名做保守匹配，命中就在界面上给出可用 PDF。
 * 只做「提名」，不写盘；要不要记进笔记由用户点「记到这篇笔记」决定。
 *
 * 保守原则：宁可漏，不可错。文件名与标题精确相等才给满分；前缀/词覆盖要求足够长，
 * 且同一份 PDF 只能归一篇（分数最高者）。
 */

/** 归一化：小写、去变音符、非字母数字（保留中日韩）转空格、压缩空白 */
export function normalizePdfKey(raw) {
  return String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** 文件名去掉扩展名后的键（Zotero 附件名常带作者/年份前后缀，这里只做归一化） */
export function pdfKeyOfPath(filePath) {
  const base = String(filePath).replace(/\\/g, '/').split('/').pop() ?? ''
  return normalizePdfKey(base.replace(/\.pdf$/i, ''))
}

const STOP_TOKENS = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'on', 'in', 'to', 'with', 'by', 'from', 'at', 'via', 'using'])

/** 常用词以外的最稀有 token（用于把候选 PDF 缩到很小一撮） */
function rarestToken(tokens, documentFrequency) {
  let best = ''
  let bestCount = Number.POSITIVE_INFINITY
  for (const token of tokens) {
    if (STOP_TOKENS.has(token) || token.length < 2) continue
    const count = documentFrequency.get(token) ?? 0
    if (count > 0 && count < bestCount) { best = token; bestCount = count }
  }
  return bestCount < Number.POSITIVE_INFINITY ? best : ''
}

/** 覆盖度：short 的 token 有多少出现在 long 里（按集合算） */
function coverage(short, long) {
  if (!short.length) return 0
  const pool = new Set(long)
  let hit = 0
  for (const token of new Set(short)) if (pool.has(token)) hit++
  return hit / new Set(short).size
}

/**
 * 给一组标题找候选 PDF。
 * @param {{id: string, title: string}[]} titles
 * @param {string[]} files 授权目录下递归找到的 PDF 绝对路径
 * @param {{minScore?: number, extraKeys?: Map<string, string[]>}} [options]
 *   extraKeys：笔记 id → 额外参与匹配的字符串（如 DOI、citekey），可选
 * @returns {{matches: Record<string, {path: string, score: number, reason: string}>, stats: object}}
 */
export function matchLocalPdfTitles(titles, files, options = {}) {
  const minScore = options.minScore ?? 0.85
  const entries = []
  const documentFrequency = new Map()
  const byToken = new Map()
  for (const file of Array.isArray(files) ? files : []) {
    const key = pdfKeyOfPath(file)
    if (!key) continue
    const index = entries.length
    entries.push({ file, key, tokens: key.split(' ') })
    for (const token of new Set(key.split(' '))) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
      const bucket = byToken.get(token)
      if (bucket) bucket.push(index)
      else byToken.set(token, [index])
    }
  }

  const proposals = []
  let considered = 0
  for (const item of Array.isArray(titles) ? titles : []) {
    if (!item || typeof item.id !== 'string') continue
    const extra = options.extraKeys?.get(item.id) ?? []
    const keys = [item.title, ...extra].map(normalizePdfKey).filter((k) => k.length >= 12)
    if (!keys.length) continue
    const candidates = new Set()
    for (const key of keys) {
      const tokens = key.split(' ')
      const rarest = rarestToken(tokens, documentFrequency)
      const bucket = rarest ? byToken.get(rarest) : null
      if (bucket) for (const index of bucket) candidates.add(index)
      else for (let index = 0; index < entries.length; index++) candidates.add(index) // 标题全是很常见的词：老实全扫
    }
    let best = null
    for (const index of candidates) {
      const entry = entries[index]
      considered++
      for (const key of keys) {
        let score = 0
        let reason = ''
        if (entry.key === key) { score = 1; reason = '文件名与标题完全一致' }
        else if (entry.key.startsWith(key) && key.length >= 20) { score = 0.93; reason = '文件名以标题开头' }
        else if (key.startsWith(entry.key) && entry.key.length >= 20) { score = 0.9; reason = '标题以文件名开头' }
        else {
          const short = key.length <= entry.key.length ? key : entry.key
          const long = key.length <= entry.key.length ? entry.key : key
          const shortTokens = short.split(' ')
          const longTokens = long.split(' ')
          const cov = coverage(shortTokens, longTokens)
          if (shortTokens.length >= 6 && cov >= 0.85) { score = 0.86; reason = `标题与文件名用词重合 ${Math.round(cov * 100)}%` }
        }
        if (score > (best?.score ?? 0)) best = { id: item.id, path: entry.file, score, reason }
      }
    }
    if (best && best.score >= minScore) proposals.push(best)
  }

  // 同一份 PDF 只归一篇：分数最高者胜；并列（多篇争一份 / 一篇有多份同分）则都不给
  proposals.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  const byPath = new Map()
  for (const proposal of proposals) {
    const list = byPath.get(proposal.path)
    if (list) list.push(proposal)
    else byPath.set(proposal.path, [proposal])
  }
  const winnerById = new Map()
  for (const [path, list] of byPath) {
    list.sort((a, b) => b.score - a.score)
    const tied = list.filter((item) => item.score === list[0].score)
    if (tied.length !== 1) continue
    if (winnerById.has(tied[0].id)) continue
    winnerById.set(tied[0].id, { path, score: tied[0].score, reason: tied[0].reason })
  }
  const matches = {}
  const scored = [...winnerById.entries()].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
  for (const [id, best] of scored) {
    if (matches[id]) continue
    matches[id] = best
  }

  return { matches, stats: { titles: (titles ?? []).length, files: entries.length, compared: considered, matched: Object.keys(matches).length } }
}
