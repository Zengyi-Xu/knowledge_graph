/**
 * zoteroMarkup 纯逻辑自测：映射、合并、同步计划、HTML→纯文本、PDF 附件匹配、导出幂等。
 * 不碰真实文件/数据库（那部分在 test:zotero / test:web 里）。
 */
import assert from 'node:assert/strict'
import type { PdfAnnotation } from '@/lib/attachments'
import {
  appendZoteroNoteMarkdown,
  formatZoteroTime,
  hasExportedZoteroNote,
  mapZoteroAnnotation,
  mergeViewerAnnotations,
  normalizePdfPath,
  pageForZoteroAnnotation,
  planZoteroMarkupSync,
  plainTextFromZoteroNote,
  samePdfPath,
  zoteroAnnotationId,
  zoteroAnnotationStatusLabel,
  zoteroAnnotationsForAttachment,
  zoteroAttachmentForSource,
  zoteroColor,
  zoteroMarkupStats,
  zoteroNoteMarkdown,
  zoteroOtherAttachmentCount,
  zoteroSyncSummary,
  type ZoteroAnnotationRecord,
  type ZoteroAnnotationStatus,
  type ZoteroAnnotationType,
  type ZoteroAttachmentInfo,
  type ZoteroMarkupBundle,
  type ZoteroNoteRecord,
} from '@/lib/zoteroMarkup'

let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  assert.ok(ok, detail ? `${name} — ${detail}` : name)
  checks++
  console.log('✓ ' + name)
}

const primary: ZoteroAttachmentInfo = {
  key: 'ATTACH01',
  parentKey: 'PARENT01',
  path: 'D:\\Zotero\\storage\\ATTACH01\\论文.pdf',
  fileName: '论文.pdf',
  exists: true,
  primary: true,
}
const secondary: ZoteroAttachmentInfo = {
  key: 'ATTACH02',
  parentKey: 'PARENT01',
  path: 'D:/Zotero/storage/ATTACH02/另一份.pdf',
  fileName: '另一份.pdf',
  exists: false,
  primary: false,
}

function record(overrides: Partial<ZoteroAnnotationRecord> = {}): ZoteroAnnotationRecord {
  return {
    key: 'ANNKEY01',
    parentKey: 'PARENT01',
    attachmentKey: primary.key,
    attachmentPath: primary.path,
    type: 'highlight' as ZoteroAnnotationType,
    text: '被高亮的句子',
    comment: '批注',
    color: '#FFD400',
    pageIndex: 0,
    pageLabel: '1',
    rects: [[0, 0, 10, 10]],
    status: 'ok' as ZoteroAnnotationStatus,
    dateAdded: '2025-02-10T11:28:35Z',
    dateModified: '2025-02-11T00:00:00Z',
    ...overrides,
  }
}

const note: ZoteroNoteRecord = {
  key: 'NOTEKEY1',
  parentKey: 'PARENT01',
  html: '<div class="zotero-note"><h1>标题</h1><p>第一段 &amp; 内容&nbsp;结束</p><ul><li>要点一</li><li>要点二</li></ul><script>alert(1)</script></div>',
  dateAdded: '2025-02-10T11:28:35Z',
  dateModified: '2025-02-11T00:00:00Z',
}

const bundle: ZoteroMarkupBundle = {
  parentKeys: ['PARENT01', 'PARENT01'],
  attachment: primary,
  attachments: [primary, secondary],
  annotations: [
    record(),
    record({ key: 'ANNKEY02', type: 'underline', pageIndex: 1, color: '#5FB236', comment: '' }),
    record({ key: 'ANNKEY03', type: 'image', status: 'unsupported-type', text: '' }),
  ],
  notes: [note],
  skipped: { unsupportedType: 1, missingText: 0, invalidPosition: 0, otherAttachment: 0 },
}

// ---- 页码 / 身份 ----
check('pageIndex 0 起 → 本软件页码 1 起', pageForZoteroAnnotation(record()) === 1)
check('没有 pageIndex 时不猜页码', pageForZoteroAnnotation(record({ pageIndex: null })) === null)
check('稳定 ID 用 zotero-<key>', zoteroAnnotationId('ANNKEY01') === 'zotero-ANNKEY01')
check('ID 能通过 PDF 引用链接的字符白名单', /^[a-zA-Z0-9_-]+$/.test(zoteroAnnotationId('ANNKEY01')))

// ---- 颜色 ----
check('Zotero 色号统一成小写 hex', zoteroColor('#FFD400') === '#ffd400')
check('三位 hex 补齐成六位', zoteroColor('#abc') === '#aabbcc')
check('认不出的颜色用黄色兜底', zoteroColor('red') === '#ffd54a' && zoteroColor('') === '#ffd54a')

// ---- 映射 ----
const mapped = mapZoteroAnnotation(record())
check('可画标注映射成 PdfAnnotation', Boolean(mapped) && mapped!.page === 1 && mapped!.anchor.exact === '被高亮的句子')
check('颜色/批注/创建时间跟 Zotero 走', mapped!.color === '#ffd400' && mapped!.comment === '批注' && mapped!.createdAt === Date.parse('2025-02-10T11:28:35Z'))
check('来源信息带附件归属且只读', mapped!.origin?.provider === 'zotero' && mapped!.origin?.readOnly === true &&
  mapped!.origin?.attachmentKey === 'ATTACH01' && mapped!.origin?.dateModified === '2025-02-11T00:00:00Z')
check('不支持的标注不映射', mapZoteroAnnotation(record({ status: 'unsupported-type', type: 'image' })) === null)
check('缺文字/坏位置/无页码都不映射', mapZoteroAnnotation(record({ status: 'missing-text', text: '' })) === null &&
  mapZoteroAnnotation(record({ status: 'invalid-position' })) === null &&
  mapZoteroAnnotation(record({ pageIndex: null })) === null)
check('空文本即使 status=ok 也不画', mapZoteroAnnotation(record({ text: '   ' })) === null)

// ---- 合并 ----
const local: PdfAnnotation = {
  id: 'local-1', page: 1, color: '#ffd54a', anchor: { exact: '本地高亮', prefix: '', suffix: '' }, comment: '', createdAt: 1,
}
const merged = mergeViewerAnnotations([local], [mapped!, mapZoteroAnnotation(record({ key: 'ANNKEY02', pageIndex: 1 }))!])
check('本地标注永远在前且保留', merged[0].id === 'local-1' && merged.length === 3)
check('同一 Zotero 标注只出现一次（重复输入去重）', mergeViewerAnnotations([local], [mapped!, mapped!]).length === 2)
check('没有 Zotero 标注时原样返回本地数组', (() => { const only = mergeViewerAnnotations([local], []); return only.length === 1 && only[0] === local })())

// ---- 同步计划 ----
const plan = planZoteroMarkupSync({ noteId: 'note-1', bundle, now: 1790000000000 })
check('计划统计：2 条可画高亮、1 条笔记、1 条跳过', plan.stats.imported === 2 && plan.stats.notes === 1 && plan.stats.skipped === 1)
check('sidecar 记下主附件与 noteId', plan.file.attachmentKey === 'ATTACH01' && plan.file.noteId === 'note-1' && plan.file.syncedAt === 1790000000000)
check('parentKeys 去重', plan.file.parentKeys.length === 1)
check('不可画的标注仍留在 sidecar（列表要显示）', plan.file.annotations.length === 3)

const again = planZoteroMarkupSync({ noteId: 'note-1', bundle, now: 1790000000001 })
check('重复同步完全幂等（只有 syncedAt 变）', (() => {
  const a = { ...plan.file, syncedAt: 0 }
  const b = { ...again.file, syncedAt: 0 }
  return assert.deepEqual(a, b) === undefined
})())

const withoutSecond = planZoteroMarkupSync({
  noteId: 'note-1',
  bundle: { ...bundle, annotations: bundle.annotations.filter((item) => item.key !== 'ANNKEY02') },
  now: 1,
})
check('Zotero 里删掉的标注在下次同步后消失', !withoutSecond.file.annotations.some((item) => item.key === 'ANNKEY02'))

const updated = planZoteroMarkupSync({
  noteId: 'note-1',
  bundle: { ...bundle, annotations: [record({ color: '#FF6666', comment: '改过的批注' })] },
  now: 1,
})
check('Zotero 里改颜色/批注后同步会更新', (() => {
  const only = updated.file.annotations[0]
  return only.color === '#FF6666' && only.comment === '改过的批注'
})())

const duplicated = planZoteroMarkupSync({
  noteId: 'note-1',
  bundle: { ...bundle, annotations: [record(), record()], notes: [note, note] },
  now: 1,
})
check('多 key 返回同一标注时只保留一份', duplicated.file.annotations.length === 1 && duplicated.file.notes.length === 1)

check('本地标注不会进 Zotero sidecar', !plan.file.annotations.some((item) => item.key === 'local-1'))

// ---- 提示文案 ----
check('同步结果文案带数量与跳过数', zoteroSyncSummary(plan.file) === '已同步：2 条高亮、1 条 Zotero 笔记；跳过 1 条无法定位或不支持的标注')
check('没有跳过时不写跳过段', !zoteroSyncSummary({ ...plan.file, skipped: { unsupportedType: 0, missingText: 0, invalidPosition: 0, otherAttachment: 0 } }).includes('跳过'))
check('统计函数把不可画标注排除在 imported 之外', zoteroMarkupStats(plan.file).imported === 2)

// ---- 笔记 HTML → 纯文本 ----
const text = plainTextFromZoteroNote(note.html)
check('保留标题与段落文字', text.includes('标题') && text.includes('第一段 & 内容 结束'))
check('列表转成 • 行', text.includes('• 要点一') && text.includes('• 要点二'))
check('不残留标签或脚本', !/[<>]/.test(text) && !text.includes('alert'))
check('实体解码（&amp; / &nbsp;）', text.includes('&') && !text.includes('&nbsp;'))
check('空 HTML 返回空串', plainTextFromZoteroNote('') === '')

const markdown = zoteroNoteMarkdown(note)
check('导出块用「## Zotero 笔记」标题', markdown.startsWith('## Zotero 笔记\n'))
check('更新时间写进引用块', markdown.includes('导入自 Zotero，更新时间：') && /导入自 Zotero，更新时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(markdown))
check('正文逐行引用', markdown.includes('> 标题') && markdown.includes('> 第一段 & 内容 结束'))
check('带不可见的幂等标记', hasExportedZoteroNote(markdown, note.key) && markdown.includes(`<!-- zotero-note:${note.key} -->`))

const appended = appendZoteroNoteMarkdown('# 我的笔记\n\n已有内容', note)
check('追加导出保留原正文', appended.startsWith('# 我的笔记\n\n已有内容') && hasExportedZoteroNote(appended, note.key))
check('同一 note 的标记只出现一次', appended.split(`<!-- zotero-note:${note.key} -->`).length === 2)
check('别的 note 不会被误判成已导出', !hasExportedZoteroNote(appended, 'OTHERKEY'))
check('时间格式化：有效/无效', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(formatZoteroTime('2025-02-11T00:00:00Z')) && formatZoteroTime('nope') === '')

// ---- PDF 附件匹配 ----
check('规范化分隔符', normalizePdfPath('D:\\a\\b.pdf') === 'd:/a/b.pdf')
check('Windows 盘符路径大小写不敏感', samePdfPath('D:\\Zotero\\a\\论文.pdf', 'd:/zotero/A/论文.pdf'))
check('不同文件不相等', !samePdfPath('D:/a/1.pdf', 'D:/a/2.pdf'))
check('非 Windows 路径按原样比较', !samePdfPath('/Users/x/a.pdf', '/Users/x/A.pdf'))
check('空路径不相等', !samePdfPath('', ''))

const zoteroSource = { kind: 'zotero' as const, dbPath: 'D:/z.db', key: 'PARENT01', keys: [] }
check('Zotero 来源对应同步时记下的主附件', zoteroAttachmentForSource(zoteroSource, plan.file)?.key === 'ATTACH01')
const localMatch = zoteroAttachmentForSource({ kind: 'local', path: 'D:/Zotero/storage/ATTACH02/另一份.pdf' }, plan.file)
check('localPdf 按绝对路径匹配到对应附件', localMatch?.key === 'ATTACH02')
check('localPdf 路径对不上时返回 null（不猜）', zoteroAttachmentForSource({ kind: 'local', path: 'D:/别的/论文.pdf' }, plan.file) === null)
check('vault 内附件（副本）不算 Zotero PDF', zoteroAttachmentForSource({ kind: 'attachment', attachmentId: 'x' }, plan.file) === null)

check('只取当前附件上的可画标注', zoteroAnnotationsForAttachment(plan.file, 'ATTACH01').length === 2)
check('别的附件上没有可画标注', zoteroAnnotationsForAttachment(plan.file, 'ATTACH02').length === 0)

const crossBundle = planZoteroMarkupSync({
  noteId: 'note-1',
  bundle: {
    ...bundle,
    annotations: [record(), record({ key: 'ANNKEY09', attachmentKey: 'ATTACH02', attachmentPath: secondary.path })],
    skipped: { ...bundle.skipped, otherAttachment: 1 },
  },
  now: 1,
})
check('统计「属于另一份 PDF」的标注', zoteroOtherAttachmentCount(crossBundle.file, 'ATTACH01') === 1)
check('多份 PDF 时同步文案只数当前附件，并说明另一份', (() => {
  const text = zoteroSyncSummary(crossBundle.file)
  return text.includes('1 条高亮') && text.includes('另有 1 条属于另一份 PDF')
})())
check('未同步/无附件时计数为 0', zoteroOtherAttachmentCount(null, 'ATTACH01') === 0)

// ---- 状态标签 ----
check('不支持类型给出可读原因', zoteroAnnotationStatusLabel('unsupported-type', 'image').includes('图片'))
check('墨迹标注给出可读原因', zoteroAnnotationStatusLabel('unsupported-type', 'ink').includes('墨迹'))
check('缺文字/坏位置各有说明', zoteroAnnotationStatusLabel('missing-text', 'highlight').includes('没有文字') &&
  zoteroAnnotationStatusLabel('invalid-position', 'highlight').includes('位置'))
check('正常标注没有提示', zoteroAnnotationStatusLabel('ok', 'highlight') === '')

console.log(`\nzoteroMarkup 纯逻辑：${checks}/${checks} 通过`)
