/**
 * 剪贴板 RTF 域代码（真域，兼容 Zotero 的 ADDIN ZOTERO_ITEM 格式）。
 * 粘进 Word 得到可更新的真实域；Zotero 装插件的机器可识别刷新。
 *
 * 纯函数部分（rtfEscape / buildCitationFieldRtf / buildBibliographyRtf /
 * buildClipboardParts）不碰剪贴板，便于单测；写剪贴板走 writeCitationClipboard /
 * writeBibliographyClipboard（浏览器版与桌面版均可用）。
 */
import { toast } from 'sonner'
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
 *   {\field{\*\fldinst{ ADDIN ZOTERO_ITEM {json} }{\fldrslt displayText}}}
 * citationItems 的 id 用 citekey，itemData 是完整 CSL-JSON。
 */
export function buildCitationFieldRtf(
  cslItems: CslItem[],
  styleId: CitationStyleId,
  displayText?: string,
): string {
  const display = displayText ?? formatCitationMarker(cslItems, styleId)
  const payload = {
    citationItems: cslItems.map((it) => ({ id: it.id, itemData: it })),
    properties: { formattedCitation: display },
    schema: 'https://github.com/zotero/zotero/schema/citation.json# 0.1',
  }
  const json = JSON.stringify(payload)
  return `{\\field{\\*\\fldinst{ ADDIN ZOTERO_ITEM ${rtfEscape(json)} }{\\fldrslt ${displayToRtf(display, styleId)}}}}`
}

/** 参考文献表的 RTF（每条一段；GB/T 7714 的 [1] [2] 编号由样式本身输出） */
export function buildBibliographyRtf(items: CslItem[], styleId: CitationStyleId): string {
  const text = formatBibliography(items, styleId)
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

/** citation = 单条域代码；bibliography = 文献表富文本。纯函数，便于单测与打桩。 */
export function buildClipboardParts(
  cslItems: CslItem[],
  styleId: CitationStyleId,
  mode: 'citation' | 'bibliography',
): ClipboardParts {
  if (mode === 'citation') {
    return { rtf: buildCitationFieldRtf(cslItems, styleId), plain: formatCitationMarker(cslItems, styleId) }
  }
  return { rtf: buildBibliographyRtf(cslItems, styleId), plain: formatBibliography(cslItems, styleId) }
}

async function writeRtfClipboard(parts: ClipboardParts, successMsg: string): Promise<void> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/rtf': new Blob([parts.rtf], { type: 'text/rtf' }),
        'text/plain': new Blob([parts.plain], { type: 'text/plain' }),
      }),
    ])
    toast.success(successMsg)
  } catch {
    // 权限不足 / 浏览器不支持富文本剪贴板 → 回退纯文本
    await navigator.clipboard.writeText(parts.plain)
    toast.info('当前为纯文本引用（当前环境不支持富文本剪贴板）')
  }
}

/** 「插入 Word 引用」：复制 RTF 域代码 + 纯文本双格式 */
export async function writeCitationClipboard(cslItems: CslItem[], styleId: CitationStyleId): Promise<void> {
  await writeRtfClipboard(buildClipboardParts(cslItems, styleId, 'citation'), '已复制 Word 引用（含域代码）')
}

/** 「复制参考文献表」：按所选样式排成完整文献表（GB/T 7714 带编号）双格式复制 */
export async function writeBibliographyClipboard(cslItems: CslItem[], styleId: CitationStyleId): Promise<void> {
  await writeRtfClipboard(buildClipboardParts(cslItems, styleId, 'bibliography'), '已复制参考文献表')
}
