/**
 * ZoteroNotesPanel 的 SSR 行为自测（无头、不开浏览器）：
 * 同步按钮的禁用原因、数量摘要、只读提示、导出幂等、Zotero 笔记 HTML 不进 DOM。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { ZoteroNotesPanel } from '@/components/ZoteroNotesPanel'
import type { ZoteroMarkupView } from '@/hooks/useZoteroMarkup'
import type { ZoteroAnnotationRecord, ZoteroNoteRecord } from '@/lib/zoteroMarkup'
import { zoteroNoteMarker } from '@/lib/zoteroMarkup'

let checks = 0
function check(name: string, ok: boolean): void {
  assert.ok(ok, name)
  checks++
  console.log('✓ ' + name)
}

function view(overrides: Partial<ZoteroMarkupView> = {}): ZoteroMarkupView {
  return {
    file: null,
    loading: false,
    syncing: false,
    error: '',
    attachment: null,
    drawable: [],
    otherAttachment: 0,
    warning: '',
    canSync: true,
    blockReason: '',
    sync: async () => { throw new Error('SSR 里不应该真的同步') },
    refresh: () => {},
    ...overrides,
  }
}

const render = (props: Parameters<typeof ZoteroNotesPanel>[0]) => renderToStaticMarkup(ZoteroNotesPanel(props))
const noop = () => {}

// ---- 没有 key：按钮禁用并说明原因 ----
const blocked = render({
  view: view({ canSync: false, blockReason: '这篇笔记没有 Zotero 条目 key' }),
  content: '',
  onExportNote: noop,
  onExportAnnotation: noop,
})
check('面板标题固定为 Zotero 标注', blocked.includes('Zotero 标注'))
check('没有 Zotero key 时同步按钮禁用并给出原因', blocked.includes('这篇笔记没有 Zotero 条目 key') && blocked.includes('disabled'))
check('未同步时显示「未同步」', blocked.includes('未同步'))

// ---- 有数据：数量、标注列表、只读、导出 ----
const annOk: ZoteroAnnotationRecord = {
  key: 'ANNKEY01', parentKey: 'PARENT01', attachmentKey: 'ATTACH01', attachmentPath: 'D:/z/a.pdf',
  type: 'highlight', text: '被高亮的句子', comment: '一条批注', color: '#ffd400',
  pageIndex: 0, pageLabel: '1', rects: [], status: 'ok',
  dateAdded: '2025-02-10T11:28:35Z', dateModified: '2025-02-11T00:00:00Z',
}
const annInk: ZoteroAnnotationRecord = {
  ...annOk, key: 'ANNKEY02', type: 'ink', text: '', comment: '', status: 'unsupported-type', pageIndex: null,
}
const note: ZoteroNoteRecord = {
  key: 'NOTEKEY1', parentKey: 'PARENT01',
  html: '<div class="zotero-note"><p>子笔记内容</p><img src=x onerror=alert(1)></div>',
  dateAdded: '2025-02-10T11:28:35Z', dateModified: '2025-02-11T00:00:00Z',
}
const file = {
  format: 'kaust-kg-zotero-markup' as const,
  version: 1 as const,
  noteId: 'note-1',
  parentKeys: ['PARENT01'],
  attachmentKey: 'ATTACH01',
  attachmentPath: 'D:/z/a.pdf',
  attachments: [{ key: 'ATTACH01', parentKey: 'PARENT01', path: 'D:/z/a.pdf', fileName: 'a.pdf', exists: true, primary: true }],
  annotations: [annOk, annInk],
  notes: [note],
  skipped: { unsupportedType: 1, missingText: 0, invalidPosition: 0, otherAttachment: 0 },
  syncedAt: Date.parse('2025-02-12T08:00:00Z'),
}
const withData = render({ view: view({ file }), content: '', onExportNote: noop, onExportAnnotation: noop })
check('显示可画高亮与笔记数量', withData.includes('1 条高亮 · 1 条笔记'))
check('标注文本与批注都显示', withData.includes('被高亮的句子') && withData.includes('一条批注'))
check('不可画标注显示原因而不是被丢掉', withData.includes('墨迹标注（不支持在 PDF 上绘制）'))
check('Zotero 笔记转纯文本显示', withData.includes('子笔记内容'))
check('Zotero 笔记里的标签不会进 DOM', !withData.includes('<img') && !withData.includes('onerror'))
check('可画标注提供导出按钮', withData.includes('>导出<'))
check('笔记提供导出与在 Zotero 中打开', withData.includes('导出到当前笔记') && withData.includes('在 Zotero 中打开'))
check('面板自身没有删除/保存（Zotero 只读）', !withData.includes('>删除<') && !withData.includes('>保存<'))

// ---- 已导出过的笔记：按钮禁用并改文案 ----
const exported = render({
  view: view({ file }),
  content: `已有内容\n\n${zoteroNoteMarker(note.key)}`,
  onExportNote: noop,
  onExportAnnotation: noop,
})
check('已经导出过的 Zotero 笔记显示「已导出」且禁用', exported.includes('已导出') && exported.includes('disabled'))

// ---- 附件对不上 / 同步失败：都要有可见提示 ----
const warning = render({
  view: view({ file, warning: '这些标注属于另一份 Zotero PDF，不在当前 PDF 上绘制；文字列表仍可查看和导出。' }),
  content: '',
  onExportNote: noop,
  onExportAnnotation: noop,
})
check('附件对不上时有明确警告', warning.includes('属于另一份 Zotero PDF'))
const failed = render({
  view: view({ file, error: 'Zotero 数据库被占用：请先完全退出 Zotero 再同步' }),
  content: '',
  onExportNote: noop,
  onExportAnnotation: noop,
})
check('同步失败保留旧数据并显示错误', failed.includes('数据库被占用') && failed.includes('被高亮的句子'))
const syncing = render({ view: view({ syncing: true }), content: '', onExportNote: noop, onExportAnnotation: noop })
check('同步中按钮禁用并显示「同步中…」', syncing.includes('同步中…') && syncing.includes('disabled'))

// ---- 源码纪律：组件里不允许 innerHTML ----
const source = fs.readFileSync(path.resolve('src/components/ZoteroNotesPanel.tsx'), 'utf8')
check('面板不使用 dangerouslySetInnerHTML', !/dangerouslySetInnerHTML\s*=/.test(source))
check('面板不拼接 HTML 字符串（无 innerHTML 赋值）', !/\.innerHTML\s*=/.test(source))

console.log(`\nZotero 面板 SSR：${checks}/${checks} 通过`)
