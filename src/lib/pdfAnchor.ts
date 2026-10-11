/**
 * PDF 划词标注的锚定逻辑（纯函数，便于单测）。
 *
 * 锚定策略：记录页码 + exact + prefix/suffix；重新打开时先按 exact 匹配，
 * 匹配不到再 prefix+suffix 模糊找回；找不到标记 missing（不丢数据）。
 */

export interface TextAnchor {
  /** 选中的原文 */
  exact: string
  /** 前文 ≤40 字 */
  prefix: string
  /** 后文 ≤40 字 */
  suffix: string
}

export type AnchorStatus = 'exact' | 'fuzzy' | 'missing'

export interface AnchorMatch {
  status: AnchorStatus
  /** 命中的起点（在页文本中的字符偏移） */
  index: number
  /** 命中长度（fuzzy 时为估算区间） */
  length: number
}

const CONTEXT_LEN = 40

/** 从整页文本与选区构造锚（前后文各取 ≤40 字） */
export function buildAnchor(pageText: string, start: number, end: number): TextAnchor {
  const exact = pageText.slice(start, end)
  return {
    exact,
    prefix: pageText.slice(Math.max(0, start - CONTEXT_LEN), start),
    suffix: pageText.slice(end, end + CONTEXT_LEN),
  }
}

/**
 * 在一页文本里定位锚：
 * - exact 直接命中 → exact
 * - prefix 与 suffix 都能在同一窗口内找到 → fuzzy（index/length 为估算区间）
 * - 都找不到 → missing
 */
export function locateAnchor(pageText: string, anchor: TextAnchor): AnchorMatch {
  if (!anchor.exact) return { status: 'missing', index: -1, length: 0 }
  const direct = pageText.indexOf(anchor.exact)
  if (direct >= 0) return { status: 'exact', index: direct, length: anchor.exact.length }

  if (anchor.prefix || anchor.suffix) {
    // 以 prefix 的出现位置为基准，在其后找 suffix；命中则选区在两者之间
    const prefixHits: number[] = []
    if (anchor.prefix) {
      let from = 0
      while (from <= pageText.length) {
        const i = pageText.indexOf(anchor.prefix, from)
        if (i < 0) break
        prefixHits.push(i)
        from = i + 1
      }
    }
    const suffixHits: number[] = []
    if (anchor.suffix) {
      let from = 0
      while (from <= pageText.length) {
        const i = pageText.indexOf(anchor.suffix, from)
        if (i < 0) break
        suffixHits.push(i)
        from = i + 1
      }
    }

    // 前缀尾与后缀头最接近的一对，且方向正确（suffix 在 prefix 之后）
    let best: { start: number; end: number } | null = null
    for (const p of prefixHits) {
      const after = p + anchor.prefix.length
      for (const s of suffixHits) {
        if (s < after) continue
        if (!best || s - after < best.end - best.start) best = { start: after, end: s }
      }
    }
    // 只有一边有上下文时：用单边定界，长度按 exact 估算
    if (!best && prefixHits.length && !anchor.suffix) {
      const p = prefixHits[0]
      best = { start: p + anchor.prefix.length, end: p + anchor.prefix.length + anchor.exact.length }
    }
    if (!best && suffixHits.length && !anchor.prefix) {
      const s = suffixHits[0]
      best = { start: Math.max(0, s - anchor.exact.length), end: s }
    }
    if (best) {
      return { status: 'fuzzy', index: best.start, length: Math.max(1, best.end - best.start) }
    }
  }
  return { status: 'missing', index: -1, length: 0 }
}
