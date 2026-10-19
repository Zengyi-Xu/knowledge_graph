/**
 * 显示/匹配用的标题清洗（轻量模块，不依赖 citation-js）：
 * 解 HTML 实体、去 <sub>/<sup> 等内联标签、去不含量命令的 `$…$` 定界符、
 * 去常见网页/数据库标题尾缀（“ - Nature”“ | ScienceDirect”“ | IEEE Xplore”），压平空白。
 * 界面显示与本地 PDF 匹配都用它；不写回笔记数据。
 */
const TITLE_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', times: '×', deg: '°', plusmn: '±', laquo: '«', raquo: '»', middot: '·',
}

const SITE_SUFFIX = /\s*[|\-–—]\s*(nature|sciencedirect|springer(link)?|wiley online library|pubmed( central)?|arxiv(\.org)?|ieee xplore|ieee journals?\s*&?\s*magazine|mdpi|semantic scholar|researchgate|jstor|tandfonline|acs publications|aps physics|iop science|oxford academic|cambridge core|google scholar|web of science|biorxiv|ssrn)\b.*$/i

export function cleanLiteratureTitle(raw: string): string {
  let text = (raw ?? '').replace(/\p{Cc}/gu, ' ')
  text = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return TITLE_ENTITIES[body.toLowerCase()] ?? match
  })
  text = text.replace(/<\/?(sub|sup|i|b|em|strong|span|small|u)[^>]*>/gi, '')
  text = text.replace(/\$([^$\\]{1,60})\$/g, '$1')
  text = text.replace(SITE_SUFFIX, '')
  return text.replace(/\s+/g, ' ').trim()
}
