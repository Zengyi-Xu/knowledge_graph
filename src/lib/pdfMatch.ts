/**
 * 本地 PDF 匹配（纯函数）：把文献标题 / Zotero 附件文件名与磁盘上的 PDF 文件名对上。
 * 归一化后按 完全相同 → 互相包含 → 词集 Jaccard 打分，返回 0~1 的置信度。
 */

/** 归一化：NFKC + 小写 + 去掉所有非字母/数字/汉字字符 */
export function normalizeForMatch(value: string): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '')
}

/** 去掉 Zotero 常见文件名前缀「Author 等 - 2021 - 」「Author 和 Author - 2020 - 」 */
export function stripZoteroPrefix(fileName: string): string {
  return (fileName ?? '').replace(
    /^\s*[^\-–—]{0,60}?(?:\s*(?:等|和|&|,|、|et al\.?)\s*[^\-–—]{0,40})?\s*[-–—]\s*(?:19|20)\d{2}[a-z]?\s*[-–—]\s*/i,
    '',
  )
}

const WORD = /[\p{L}\p{N}]{3,}/gu

/** 词集（长度 ≥3 的词），用于 Jaccard */
export function wordSet(value: string): Set<string> {
  const out = new Set<string>()
  for (const match of (value ?? '').normalize('NFKC').toLowerCase().matchAll(WORD)) out.add(match[0])
  return out
}

export interface MatchResult {
  score: number
  /** 命中方式：exact=完全相同；contains=互相包含；jaccard=词集相似 */
  via: 'exact' | 'contains' | 'jaccard'
}

/**
 * 标题与 PDF 文件名（不含目录）的匹配评分。
 * - 归一化后完全相同 → 1.0
 * - 较长的一侧以较短的一侧**开头**（前缀关系，避免“通用短语”误配不同论文）→ 0.95
 * - 词集 Jaccard ≥ 0.4 → 0.5 + jaccard×0.45（0.68~0.95）
 * - 其余 → 0
 */
export function matchScore(title: string, fileName: string): MatchResult {
  const candidates = [fileName, stripZoteroPrefix(fileName)].filter(Boolean)
  let best: MatchResult = { score: 0, via: 'jaccard' }
  const nt = normalizeForMatch(title)
  const titleWords = wordSet(stripZoteroPrefix(title))
  for (const candidate of candidates) {
    const nc = normalizeForMatch(candidate)
    if (!nc) continue
    if (nc === nt && nt.length >= 8) return { score: 1, via: 'exact' }
    const [longer, shorter] = nt.length >= nc.length ? [nt, nc] : [nc, nt]
    if (shorter.length >= 12 && longer.startsWith(shorter)) {
      if (best.score < 0.95) best = { score: 0.95, via: 'contains' }
      continue
    }
    const cw = wordSet(candidate)
    if (titleWords.size >= 3 && cw.size >= 3) {
      let inter = 0
      for (const w of titleWords) if (cw.has(w)) inter++
      const jaccard = inter / (titleWords.size + cw.size - inter)
      if (jaccard >= 0.4) {
        const score = 0.5 + jaccard * 0.45
        if (score > best.score) best = { score, via: 'jaccard' }
      }
    }
  }
  return best
}

/** 文件名 → 归一化索引键（含去前缀版本），便于快速查表 */
export function indexKeysFor(fileName: string): string[] {
  const keys = new Set<string>()
  const plain = normalizeForMatch(fileName)
  if (plain) keys.add(plain)
  const stripped = normalizeForMatch(stripZoteroPrefix(fileName))
  if (stripped && stripped !== plain) keys.add(stripped)
  return [...keys]
}
