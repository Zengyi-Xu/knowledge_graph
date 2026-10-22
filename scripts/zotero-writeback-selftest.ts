/**
 * Zotero 回写纯逻辑自测：坐标/排序键、挑选与跳过原因、请求体、结果落地、合并去重、文案。
 * 不碰 HTTP（本地 API 收发在 test:zotero-writeback-server 里用假服务器跑）。
 */
import assert from 'node:assert/strict'
import type { PdfAnnotation, PdfAnnotationsFile } from '@/lib/attachments'
import { mergeViewerAnnotations } from '@/lib/zoteroMarkup'
import {
  applyZoteroWriteback,
  buildZoteroSortIndex,
  countedCharOffset,
  planZoteroWriteback,
  writebackSkipLabel,
  writebackSkipReason,
  writebackSummary,
  zoteroWriteAnnotation,
  zoteroWritebackBlockReason,
  type WritebackSkipReason,
} from '@/lib/zoteroWriteback'

let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  assert.ok(ok, detail ? `${name} — ${detail}` : name)
  checks++
  console.log('✓ ' + name)
}

function annotation(patch: Partial<PdfAnnotation> = {}): PdfAnnotation {
  return {
    id: 'a1',
    page: 3,
    color: '#ffd54a',
    anchor: { exact: 'the quick brown fox', prefix: 'a ', suffix: ' jumps' },
    comment: '',
    createdAt: 1,
    position: { pageIndex: 2, rects: [[10.123456, 20, 30.987654, 40]] },
    pageLabel: '3',
    sortIndex: '00002|000012|00401',
    ...patch,
  }
}

// ---- 排序键 ----
check('排序键 = 页|字符偏移|距页顶，各段补零', buildZoteroSortIndex({ pageIndex: 37, charOffset: 221, top: 449.8 }) === '00037|000221|00449')
check('排序键缺偏移时给 0', buildZoteroSortIndex({ pageIndex: 0, top: 12.9 }) === '00000|000000|00012')
check('排序键不吃负数', buildZoteroSortIndex({ pageIndex: -3, top: -8 }) === '00000|000000|00000')
check('字符偏移只数非空白字符', countedCharOffset('ab cd\nef\tgh', 11) === 8)
check('字符偏移不越过文本长度', countedCharOffset('ab', 99) === 2 && countedCharOffset('', 3) === 0)

// ---- 跳过原因 ----
check('正常本地高亮可以回写', writebackSkipReason(annotation()) === '')
check('Zotero 来源的标注不回写', writebackSkipReason(annotation({
  origin: { provider: 'zotero', key: 'ABCD2345', parentKey: 'PARENT01', attachmentKey: 'ATTACH01', attachmentPath: 'C:/x.pdf', dateModified: '', readOnly: true },
})) === 'zotero-origin')
check('已经回写过的跳过', writebackSkipReason(annotation({ zotero: { key: 'ABCD2345', attachmentKey: 'ATTACH01', syncedAt: 1 } })) === 'already-pushed')
check('没有坐标的老标注跳过', writebackSkipReason(annotation({ position: undefined })) === 'no-position')
check('空 rects 跳过', writebackSkipReason(annotation({ position: { pageIndex: 0, rects: [] } })) === 'no-position')
check('没有选中文字跳过', writebackSkipReason(annotation({ anchor: { exact: '  ', prefix: '', suffix: '' } })) === 'empty-text')

// ---- 请求体 ----
const payload = zoteroWriteAnnotation(annotation())!
check('请求体带本地 id 用于回传', payload?.id === 'a1')
check('请求体用高亮原文', payload?.text === 'the quick brown fox')
check('请求体坐标是 Zotero 的 JSON 字符串', payload?.position === '{"pageIndex":2,"rects":[[10.1235,20,30.9877,40]]}', payload?.position)
check('请求体页码标签用创建时记的', payload?.pageLabel === '3')
check('请求体排序键用创建时记的', payload?.sortIndex === '00002|000012|00401')
const fallback = zoteroWriteAnnotation(annotation({ pageLabel: '', sortIndex: undefined, page: 7 }))!
check('缺页码标签时回退成页码数字', fallback.pageLabel === '7')
check('缺排序键时给出合法格式', /^\d{5}\|\d{6}\|\d{5}$/.test(fallback.sortIndex), fallback.sortIndex)
check('颜色原样带上', zoteroWriteAnnotation(annotation({ color: '#90caf9' }))?.color === '#90caf9')
check('批注一起带上', zoteroWriteAnnotation(annotation({ comment: '重点' }))?.comment === '重点')

// ---- 回写计划 ----
const plan = planZoteroWriteback({
  attachmentKey: 'ATTACH01',
  annotations: [
    annotation({ id: 'ok1' }),
    annotation({ id: 'ok2', position: { pageIndex: 1, rects: [[1, 2, 3, 4]] } }),
    annotation({ id: 'no-pos', position: undefined }),
    annotation({ id: 'pushed', zotero: { key: 'ABCD2345', attachmentKey: 'ATTACH01', syncedAt: 1 } }),
    annotation({ id: 'from-zotero', origin: { provider: 'zotero', key: 'EFGH6789', parentKey: 'PARENT01', attachmentKey: 'ATTACH01', attachmentPath: 'C:/x.pdf', dateModified: '', readOnly: true } }),
  ],
})
check('计划只收可回写的两条', plan.items.length === 2 && plan.items.map((item) => item.id).join(',') === 'ok1,ok2')
check('跳过项带原因与文字', plan.skipped.length === 3 && plan.skipped.some((skip) => skip.reason === 'no-position') && plan.skipped.every((skip) => typeof skip.text === 'string'))
check('计划总数 = 全部本地标注', plan.total === 5)
check('附件 key 不合法时整篇阻塞且不提交', planZoteroWriteback({ attachmentKey: '', annotations: [annotation()] }).blockReason.includes('不是 Zotero 里的那份'))
check('合法附件 key 没有阻塞原因', plan.blockReason === '')

// ---- 前置条件 ----
check('没有桥时给出环境原因', zoteroWritebackBlockReason({ attachment: null, pending: 1, bridge: false }).includes('接口'))
check('附件对不上时给出附件原因', zoteroWritebackBlockReason({ attachment: null, pending: 1, bridge: true }).includes('不是 Zotero 里的那份'))
check('没有待回写时给出数量原因', zoteroWritebackBlockReason({
  attachment: { key: 'ATTACH01', parentKey: 'PARENT01', path: 'C:/x.pdf', fileName: 'x.pdf', exists: true, primary: true },
  pending: 0,
  bridge: true,
}).includes('没有需要回写'))
check('条件齐全时没有阻塞原因', zoteroWritebackBlockReason({
  attachment: { key: 'ATTACH01', parentKey: 'PARENT01', path: 'C:/x.pdf', fileName: 'x.pdf', exists: true, primary: true },
  pending: 1,
  bridge: true,
}) === '')

// ---- 结果落地 ----
const file: PdfAnnotationsFile = {
  format: 'kaust-kg-pdf-annotations',
  version: 1,
  fileName: 'x.pdf',
  items: [annotation({ id: 'a1' }), annotation({ id: 'a2' }), annotation({ id: 'a3' })],
}
const applied = applyZoteroWriteback(file, {
  saved: [{ index: 0, id: 'a1', key: 'KEYAAAA1' }, { index: 1, id: 'a3', key: 'KEYBBBB2' }],
  attachmentKey: 'ATTACH01',
  syncedAt: 1234,
})
check('回写结果只标命中的标注', applied.items[0].zotero?.key === 'KEYAAAA1' && applied.items[1].zotero === undefined && applied.items[2].zotero?.key === 'KEYBBBB2')
check('回写结果记下附件与时间', applied.items[0].zotero?.attachmentKey === 'ATTACH01' && applied.items[0].zotero?.syncedAt === 1234)
check('回写结果不改原对象', file.items[0].zotero === undefined)
check('没有 saved 时原文件原样返回', applyZoteroWriteback(file, { saved: [], attachmentKey: 'ATTACH01' }) === file)

// ---- 重新同步时按 key 去重 ----
const pushedLocal = [annotation({ id: 'a1', zotero: { key: 'KEYAAAA1', attachmentKey: 'ATTACH01', syncedAt: 1 } })]
const importedAgain = [annotation({ id: 'zotero-KEYAAAA1', origin: { provider: 'zotero', key: 'KEYAAAA1', parentKey: 'P1', attachmentKey: 'ATTACH01', attachmentPath: 'C:/x.pdf', dateModified: '', readOnly: true } })]
check('刚回写的那条重新同步后不再叠一份', mergeViewerAnnotations(pushedLocal, importedAgain).length === 1)
const otherImported = [annotation({ id: 'zotero-KEYZZZZZ', origin: { provider: 'zotero', key: 'KEYZZZZZ', parentKey: 'P1', attachmentKey: 'ATTACH01', attachmentPath: 'C:/x.pdf', dateModified: '', readOnly: true } })]
check('别的 Zotero 标注照常合并', mergeViewerAnnotations(pushedLocal, otherImported).length === 2)

// ---- 文案 ----
check('全部成功给出条数', writebackSummary({ saved: 3, failed: 0, skipped: 0 }) === '已回写 3 条高亮到 Zotero')
check('有跳过时补充跳过数', writebackSummary({ saved: 2, failed: 0, skipped: 1 }) === '已回写 2 条高亮到 Zotero，跳过 1 条')
check('部分失败带上第一条原因', writebackSummary({ saved: 1, failed: 1, skipped: 0, firstError: 'bad' }) === '已回写 1 条，1 条失败：bad')
check('全部失败也能说清楚', writebackSummary({ saved: 0, failed: 2, skipped: 0, firstError: 'Zotero 拒绝了这条高亮' }).startsWith('回写失败：'))
check('没有可回写时不冒充成功', writebackSummary({ saved: 0, failed: 0, skipped: 2 }) === '没有需要回写的高亮，跳过 2 条')
check('跳过原因有中文说明', ['zotero-origin', 'no-position', 'empty-text', 'already-pushed'].every((reason) => writebackSkipLabel(reason as WritebackSkipReason).length > 2))

console.log(`\nZotero 回写纯逻辑：${checks}/${checks} 通过`)
