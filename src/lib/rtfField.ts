/**
 * 剪贴板 RTF 域代码（真域，兼容 Zotero 的 ADDIN ZOTERO_ITEM CSL_CITATION 格式）。
 * 粘进 Word 得到可更新的真实域；Zotero 装插件的机器可识别刷新。
 *
 * 纯函数部分（rtfEscape / buildCitationFieldRtf / bibliographyRtfFromText）不碰剪贴板、
 * 也不依赖 citation-js，便于单测；需要排版的 buildClipboardParts 是异步的，
 * 写剪贴板走 writeCitationClipboard / writeBibliographyClipboard（浏览器版与桌面版均可用）。
 *
 * 排版（citation-js）是异步且按需的：纯函数只接收已经排好的文本，等文本的那一步在
 * buildClipboardParts / write*Clipboard 里 await（见 docs/BUNDLE_BUDGET.md 的加载时机预算）。
 */
import { toast } from 'sonner'
import { capability } from '@/lib/capabilities'
import {
  formatBibliography,
  formatCitationMarker,
  type CitationStyleId,
  type CslItem,
} from '@/lib/literature'

/** RTF 文本转义：反斜杠/花括号加反斜杠；非 ASCII 用 \uN?（代理对拆成两个） */
export function rtfEscape(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '\\') out += '\\\\'
    else if (ch === '{') out += '\\{'
    else if (ch === '}') out += '\\}'
    else if (code < 0x80) out += ch
    else if (code <= 0xffff) {
      out += `\\u${code > 0x7fff ? code - 0x10000 : code}?`
    } else {
      // 增补平面字符 → UTF-16 代理对（每半都是带符号 16 位）
      const v = code - 0x10000
      const hi = 0xd800 + (v >> 10)
      const lo = 0xdc00 + (v & 0x3ff)
      const signed = (n: number) => (n > 0x7fff ? n - 0x10000 : n)
      out += `\\u${signed(hi)}?\\u${signed(lo)}?`
    }
  }
  return out
}

/** GB/T 7714 这类 [1] 数字标记在 RTF 里用上标 */
function displayToRtf(displayText: string, styleId: CitationStyleId): string {
  if (styleId === 'gb' && /^\[\d+(,\d+)*\]$/.test(displayText.trim())) {
    return `{\\super ${rtfEscape(displayText.trim())}}`
  }
  return rtfEscape(displayText)
}

/**
 * 生成单条引用的 RTF 域代码：
 *   {\field{\*\fldinst ADDIN ZOTERO_ITEM CSL_CITATION {json}}{\fldrslt displayText}}
 * citationItems 的 id 优先用 Zotero key，itemData 是完整 CSL-JSON。
 * 注意：`\fldinst` 后的指令必须是**不带花括号**的空格分隔文本
 * （`{\*\fldinst{ … }}` 在 Word 里会退化成字面文本，实测 2026-10-13）。
 *
 * 每条 citationItem 必带 `uris`（与 `itemData.URI` 一致）：Zotero 插件解析文档时
 * 靠 uris 把引用映射回本机库条目（users/local/ 段不校验，按 key 解析），
 * 条目不在库里时 embedded 兜底分支也会无条件遍历 uris —— 缺失会直接导致
 * 「Add/Edit Bibliography」抛错出不来文献表（2026-10-23 对照 Zotero 7 源码修复）。
 */
export function buildCitationFieldRtf(
  cslItems: CslItem[],
  styleId: CitationStyleId,
  displayText: string,
): string {
  const display = displayText
  const citationId = `kg-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
  const itemURI = (id: string) => `http://zotero.org/users/local/kg/items/${encodeURIComponent(id)}`
  const payload = {
    citationID: citationId,
    properties: { formattedCitation: display, plainCitation: display, noteIndex: 0 },
    citationItems: cslItems.map((it) => {
      const { _zoteroKey, ...itemData } = it
      const id = typeof _zoteroKey === 'string' && _zoteroKey ? _zoteroKey : String(it.id ?? '')
      const uri = itemURI(id)
      return { id, uris: [uri], itemData: { ...itemData, id, URI: uri } }
    }),
    schema: 'https://github.com/citation-style-language/schema/raw/master/csl-citation.json',
  }
  const json = JSON.stringify(payload)
  return `{\\field{\\*\\fldinst ADDIN ZOTERO_ITEM CSL_CITATION ${rtfEscape(json)} }{\\fldrslt ${displayToRtf(display, styleId)}}}`
}

/** 把域代码/正文包成完整 RTF 文档（剪贴板 CF_RTF 需要完整文档头） */
export function wrapRtfDocument(body: string): string {
  return `{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil Arial;}}\\f0\\fs24 ${body}\\par}`
}

/** 参考文献表的 RTF（每条一段；GB/T 7714 的 [1] [2] 编号由样式本身输出）。入参是排好版的文本。 */
export function bibliographyRtfFromText(text: string): string {
  if (!text) return ''
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map(rtfEscape)
    .join('\\par\n')
}

export interface ClipboardParts {
  rtf: string
  plain: string
}

/** citation = 单条域代码；bibliography = 文献表富文本。排版那一步会拉起 citation-js chunk。 */
export async function buildClipboardParts(
  cslItems: CslItem[],
  styleId: CitationStyleId,
  mode: 'citation' | 'bibliography',
): Promise<ClipboardParts> {
  if (mode === 'citation') {
    const display = await formatCitationMarker(cslItems, styleId)
    return { rtf: buildCitationFieldRtf(cslItems, styleId, display), plain: display }
  }
  const text = await formatBibliography(cslItems, styleId)
  return { rtf: bibliographyRtfFromText(text), plain: text }
}

async function writeRtfClipboard(parts: ClipboardParts, successMsg: string): Promise<void> {
  const rtf = wrapRtfDocument(parts.rtf)

  // 1) 桌面版走 Electron 原生剪贴板、本地网页端走本机服务代写：两者都是同一个桥接方法
  //    （浏览器自身写不了 text/rtf，只有这两条通道能产出 Word 真域）
  const desk = window.knowledgeGraphDesktop
  if (desk?.writeClipboardRtf) {
    try {
      const result = await desk.writeClipboardRtf(rtf, parts.plain)
      if (!result?.error) {
        toast.success(successMsg)
        return
      }
    } catch {
      /* 落到下一通道 */
    }
  }

  // 2) 浏览器原生富文本（Safari 等支持 text/rtf 的环境）
  try {
    if (typeof ClipboardItem !== 'undefined' && ClipboardItem.supports?.('text/rtf')) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/rtf': new Blob([rtf], { type: 'text/rtf' }),
          'text/plain': new Blob([parts.plain], { type: 'text/plain' }),
        }),
      ])
      toast.success(successMsg)
      return
    }
  } catch {
    /* 落到纯文本兜底 */
  }

  // 3) 纯文本兜底：**明确降级**，说清「没有拿到 Word 域」，不能提示成功
  const state = capability('rtfClipboard')
  const why = state.reason || '当前环境的剪贴板写不了 CF_RTF'
  try {
    await navigator.clipboard.writeText(parts.plain)
    toast.warning(`已复制纯文本引用，但没有 Word 域：${why}\n粘进 Word 只会得到普通文本，Zotero 不会识别为可刷新域。`)
  } catch {
    toast.error(`复制失败：${why}；浏览器同时也拒绝了纯文本剪贴板写入，请手动选中文本复制。`)
  }
}

/** 「插入 Word 引用」：复制 RTF 域代码 + 纯文本双格式 */
export async function writeCitationClipboard(cslItems: CslItem[], styleId: CitationStyleId): Promise<void> {
  await writeRtfClipboard(await buildClipboardParts(cslItems, styleId, 'citation'), '已复制 Zotero Word 引用域')
}

/** 「复制参考文献表」：按所选样式排成完整文献表（GB/T 7714 带编号）双格式复制 */
export async function writeBibliographyClipboard(cslItems: CslItem[], styleId: CitationStyleId): Promise<void> {
  await writeRtfClipboard(await buildClipboardParts(cslItems, styleId, 'bibliography'), '已复制参考文献表')
}
