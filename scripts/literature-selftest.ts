/**
 * 文献功能自测：CSL 转换 / citekey / 引文格式化（内嵌样式）/ BibTeX 自拼 / 导入解析。
 * CrossRef、arXiv 的网络请求全部打桩（fixture 字符串），断网可跑。
 *
 * 运行：npm run test:lit
 */
import assert from 'node:assert/strict'
import type { Note } from '@/types/note'
import { makeCitekey } from '@/lib/citekey'
import {
  buildBibtex,
  formatBibliography,
  formatCitation,
  importFromArxiv,
  importFromDoi,
  litToCSL,
  parseCitationText,
} from '@/lib/literature'

let passed = 0
const failures: string[] = []

function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++
      console.log(`  ✓ ${name}`)
    })
    .catch((error) => {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
      console.log(`  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
    })
}

function litNote(partial: Partial<Note['literature']> = {}): Note {
  return {
    id: 'n1',
    title: 'Silicon photonics for quantum computing',
    type: 'literature',
    grade: '',
    tags: [],
    content: '',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    literature: {
      authors: ['Zhang, San', 'Li, Si'],
      venue: 'Nature Photonics',
      year: 2024,
      doi: '10.1038/s41566-024-xxxx',
      citekey: 'zhang2024silicon',
      attachments: [],
      collections: [],
      ...partial,
    },
  }
}

/** 打桩 globalThis.fetch；返回恢复函数 */
function stubFetch(handler: (url: string) => { ok: boolean; status: number; json?: () => Promise<unknown>; text?: () => Promise<string> }) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    const res = handler(url)
    return {
      ok: res.ok,
      status: res.status,
      json: res.json ?? (async () => ({})),
      text: res.text ?? (async () => ''),
    } as Response
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

async function main() {
  console.log('A. CSL 转换')
  await check('“Family, Given” 作者按逗号切', () => {
    const csl = litToCSL(litNote())
    assert.equal(csl.id, 'zhang2024silicon')
    assert.deepEqual(csl.author, [
      { family: 'Zhang', given: 'San' },
      { family: 'Li', given: 'Si' },
    ])
    assert.equal(csl.title, 'Silicon photonics for quantum computing')
    assert.deepEqual(csl.issued, { 'date-parts': [[2024]] })
    assert.equal(csl['container-title'], 'Nature Photonics')
    assert.equal(csl.DOI, '10.1038/s41566-024-xxxx')
  })
  await check('“Family Given” 作者整个作为 family', () => {
    const csl = litToCSL(litNote({ authors: ['San Zhang'] }))
    assert.deepEqual(csl.author, [{ family: 'San Zhang', given: '' }])
  })
  await check('年份未知时不输出 issued', () => {
    const csl = litToCSL(litNote({ year: '' }))
    assert.equal('issued' in csl, false)
  })
  await check('Zotero key 作为 Word 域关联信息保留', () => {
    const csl = litToCSL(litNote({ zoteroKey: 'Q4DVYK39' }))
    assert.equal(csl._zoteroKey, 'Q4DVYK39')
  })

  console.log('\nB. 引文格式化（内嵌样式，离线）')
  await check('GB/T 7714 单条引文带 [1] 编号与题名', () => {
    const out = formatCitation(litToCSL(litNote()), 'gb')
    assert.ok(out.startsWith('[1]'), `实际：${out}`)
    assert.ok(out.includes('Silicon photonics for quantum computing'))
    assert.ok(out.includes('Nature Photonics'))
  })
  await check('APA 单条引文含作者与年份', () => {
    const out = formatCitation(litToCSL(litNote()), 'apa')
    assert.ok(out.includes('Zhang'))
    assert.ok(out.includes('(2024)'))
    assert.ok(out.includes('Nature Photonics'))
  })
  await check('多条文献表逐条编号', () => {
    const out = formatBibliography([litToCSL(litNote()), litToCSL({ ...litNote(), id: 'n2', title: 'Another paper', literature: { ...litNote().literature!, citekey: 'li2023another', year: 2023 } })], 'gb')
    const lines = out.split('\n').filter(Boolean)
    assert.equal(lines.length, 2)
    assert.ok(lines[0].startsWith('[1]'))
    assert.ok(lines[1].startsWith('[2]'))
  })

  console.log('\nC. BibTeX 自拼')
  await check('BibTeX 输出快照', () => {
    const out = buildBibtex({ ...litNote().literature!, title: litNote().title })
    assert.equal(
      out,
      [
        '@article{zhang2024silicon,',
        '  title = {Silicon photonics for quantum computing},',
        '  author = {Zhang, San and Li, Si},',
        '  year = {2024},',
        '  journal = {Nature Photonics},',
        '  doi = {10.1038/s41566-024-xxxx}',
        '}',
      ].join('\n'),
    )
  })
  await check('空字段不输出', () => {
    const out = buildBibtex({ title: 'T', authors: [], venue: '', year: '', doi: '', citekey: 'k' })
    assert.equal(out, '@article{k,\n  title = {T}\n}')
  })

  console.log('\nD. BibTeX / RIS 导入')
  const threeBib = [
    '@article{zhang2024silicon, title={Silicon photonics}, author={Zhang, San and Li, Si}, year={2024}, journal={Nature Photonics}}',
    '@article{li2023another, title={Another paper}, author={Li, Si}, year={2023}}',
    '@misc{wang2022misc, title={A misc entry}, author={Wang, Wu}, year={2022}, howpublished={arXiv}}',
  ].join('\n\n')
  await check('三条 BibTeX 逐条解析', () => {
    const all = parseCitationText(threeBib)
    assert.equal(all.length, 3)
    assert.equal(all[0].title, 'Silicon photonics')
    assert.deepEqual(all[0].authors, ['Zhang, San', 'Li, Si'])
    assert.equal(all[0].venue, 'Nature Photonics')
    assert.equal(all[0].year, 2024)
    assert.equal(all[2].title, 'A misc entry')
  })
  await check('RIS 导入', () => {
    const ris = 'TY  - JOUR\nTI  - Silicon photonics\nAU  - Zhang, San\nAU  - Li, Si\nPY  - 2024\nJO  - Nature Photonics\nER  - '
    const all = parseCitationText(ris)
    assert.equal(all.length, 1)
    assert.equal(all[0].title, 'Silicon photonics')
    assert.equal(all[0].year, 2024)
  })

  console.log('\nE. DOI 导入（打桩 CrossRef / DataCite）')
  const crossRefFixture = {
    message: {
      title: ['Silicon photonics for quantum computing'],
      'container-title': ['Nature Photonics'],
      issued: { 'date-parts': [[2024]] },
      author: [{ family: 'Zhang', given: 'San' }, { family: 'Li', given: 'Si' }],
    },
  }
  await check('CrossRef 正常返回', async () => {
    const restore = stubFetch((url) => ({
      ok: url.includes('api.crossref.org'),
      status: url.includes('api.crossref.org') ? 200 : 404,
      json: async () => crossRefFixture,
    }))
    try {
      const lit = await importFromDoi('10.1038/s41566-024-xxxx')
      assert.equal(lit.title, 'Silicon photonics for quantum computing')
      assert.deepEqual(lit.authors, ['Zhang, San', 'Li, Si'])
      assert.equal(lit.venue, 'Nature Photonics')
      assert.equal(lit.year, 2024)
      assert.equal(lit.doi, '10.1038/s41566-024-xxxx')
    } finally {
      restore()
    }
  })
  await check('CrossRef 失败回退 DataCite', async () => {
    const restore = stubFetch((url) =>
      url.includes('api.datacite.org')
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                attributes: {
                  titles: [{ title: 'A dataset paper' }],
                  creators: [{ familyName: 'Wang', givenName: 'Wu' }],
                  publisher: 'Zenodo',
                  publicationYear: 2022,
                },
              },
            }),
          }
        : { ok: false, status: 404, json: async () => ({}) },
    )
    try {
      const lit = await importFromDoi('10.5281/zenodo.1234')
      assert.equal(lit.title, 'A dataset paper')
      assert.deepEqual(lit.authors, ['Wang, Wu'])
      assert.equal(lit.venue, 'Zenodo')
      assert.equal(lit.year, 2022)
    } finally {
      restore()
    }
  })
  await check('两个源都失败时抛中文错误', async () => {
    const restore = stubFetch(() => ({ ok: false, status: 404, json: async () => ({}) }))
    try {
      await assert.rejects(() => importFromDoi('10.0/xxx'), /无法获取 DOI/)
    } finally {
      restore()
    }
  })

  console.log('\nF. arXiv 导入（打桩 Atom XML）')
  const arxivFixture = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <title>Silicon   photonics for quantum</title>
    <published>2024-01-15T00:00:00Z</published>
    <author><name>Zhang, San</name></author>
    <author><name>Li, Si</name></author>
    <summary>摘要</summary>
  </entry>
</feed>`
  await check('arXiv 条目解析（标题压空白、venue 带 id）', async () => {
    const restore = stubFetch((url) => ({
      ok: url.includes('export.arxiv.org'),
      status: 200,
      text: async () => arxivFixture,
    }))
    try {
      const lit = await importFromArxiv('2401.12345')
      assert.equal(lit.title, 'Silicon photonics for quantum')
      assert.deepEqual(lit.authors, ['Zhang, San', 'Li, Si'])
      assert.equal(lit.venue, 'arXiv:2401.12345')
      assert.equal(lit.year, 2024)
    } finally {
      restore()
    }
  })

  console.log('\nG. citekey 与导入联用（撞名自动追加）')
  await check('三条 BibTeX 生成互不冲突的 citekey', () => {
    const existing = new Set<string>()
    const keys = parseCitationText(threeBib).map((l) => {
      const k = makeCitekey({ authors: l.authors, year: l.year }, l.title, existing)
      existing.add(k)
      return k
    })
    assert.equal(new Set(keys).size, 3)
    assert.equal(keys[0], 'zhang2024silicon')
    assert.equal(keys[1], 'li2023another')
    assert.equal(keys[2], 'wang2022a') // 标题首词是 "A"
  })

  console.log('\nH. RTF 域代码（Word 真域，兼容 Zotero）')
  const { buildCitationFieldRtf, buildBibliographyRtf, buildClipboardParts, rtfEscape } = await import('@/lib/rtfField')
  const rtfItem = litToCSL(litNote())
  const rtfItem2 = litToCSL({ ...litNote(), id: 'n2', title: 'Another paper', literature: { ...litNote().literature!, citekey: 'li2023another', year: 2023 } })
  await check('rtfEscape：反斜杠/花括号/非 ASCII 按 RTF 规则转义', () => {
    assert.equal(rtfEscape('a\\b{c}'), 'a\\\\b\\{c\\}')
    assert.equal(rtfEscape('中'), '\\u20013?')
    assert.equal(rtfEscape('😀'), '\\u-10179?\\u-8704?') // U+1F600 → 代理对（D83D/DE00）
  })
  /** 从 RTF 域指令里取出 JSON payload（RTF 转义还原后 JSON.parse；测试辅助） */
  const extractPayload = (rtf: string) => {
    // 起点取「 ADDIN ZOTERO_ITEM 」之后（含被转义的 \{ 与 \}），整体反转义
    const marker = ' ADDIN ZOTERO_ITEM CSL_CITATION '
    const start = rtf.indexOf(marker) + marker.length
    const end = rtf.indexOf(' }{\\fldrslt', start)
    const body = rtf.slice(start, end).replace(/\\(.)/gs, '$1') // \{ → {、\} → }、\\ → \
    return JSON.parse(body)
  }
  await check('域指令含合法 JSON（citationItems/properties/schema）', () => {
    const rtf = buildCitationFieldRtf([rtfItem], 'apa')
    // 指令不能带花括号：{\*\fldinst{ … }} 在 Word 里会退化成字面文本（2026-10-13 实测）
    assert.ok(rtf.startsWith('{\\field{\\*\\fldinst ADDIN ZOTERO_ITEM CSL_CITATION '), rtf.slice(0, 80))
    assert.ok(!rtf.includes('\\fldinst{'), 'fldinst 指令不得用花括号包裹')
    const payload = extractPayload(rtf)
    assert.ok(payload.citationID.startsWith('kg-'))
    assert.equal(payload.citationItems.length, 1)
    assert.equal(payload.citationItems[0].id, 'zhang2024silicon')
    assert.equal(payload.citationItems[0].itemData.title, 'Silicon photonics for quantum computing')
    assert.equal(payload.properties.formattedCitation, '(Zhang & Li, 2024)')
    assert.equal(payload.properties.plainCitation, '(Zhang & Li, 2024)')
    assert.equal(payload.properties.noteIndex, 0)
    assert.equal(payload.schema, 'https://github.com/citation-style-language/schema/raw/master/csl-citation.json')
    assert.ok(rtf.includes('{\\fldrslt (Zhang & Li, 2024)}}'))
  })
  await check('GB 数字标记在 fldrslt 里用上标', () => {
    const rtf = buildCitationFieldRtf([rtfItem], 'gb')
    assert.ok(rtf.includes('{\\super [1]}}'), rtf)
  })
  await check('多条拼接：citationItems 按序排列', () => {
    const rtf = buildCitationFieldRtf([rtfItem, rtfItem2], 'gb')
    const payload = extractPayload(rtf)
    assert.deepEqual(payload.citationItems.map((c: { id: string }) => c.id), ['zhang2024silicon', 'li2023another'])
  })
  await check('已同步条目优先用真实 Zotero key，私有辅助字段不写入 itemData', () => {
    const rtf = buildCitationFieldRtf([litToCSL(litNote({ zoteroKey: 'Q4DVYK39' }))], 'gb')
    const payload = extractPayload(rtf)
    assert.equal(payload.citationItems[0].id, 'Q4DVYK39')
    assert.equal(payload.citationItems[0].itemData.id, 'Q4DVYK39')
    assert.equal(payload.citationItems[0].itemData._zoteroKey, undefined)
  })
  await check('特殊字符快照：中文标题与非 ASCII 作者正确转义', () => {
    const zhNote = {
      ...litNote(),
      title: '硅光集成 综述',
      literature: { ...litNote().literature!, authors: ['张三', 'Li, Si'] },
    }
    const rtf = buildCitationFieldRtf([litToCSL(zhNote)], 'gb')
    assert.ok(rtf.includes('\\u30789?\\u20809?')) // 硅光
    assert.ok(rtf.includes('\\u24352?')) // 张
  })
  await check('参考文献表 RTF：每条一段，GB 自带 [1] [2] 编号', () => {
    const rtf = buildBibliographyRtf([rtfItem, rtfItem2], 'gb')
    assert.ok(rtf.includes('\\par'))
    assert.ok(rtf.includes('[1]'))
    assert.ok(rtf.includes('[2]'))
  })
  await check('buildClipboardParts：citation 给域代码+标记，bibliography 给文献表', () => {
    const c = buildClipboardParts([rtfItem], 'apa', 'citation')
    assert.ok(c.rtf.includes('ADDIN ZOTERO_ITEM CSL_CITATION'))
    assert.equal(c.plain, '(Zhang & Li, 2024)')
    const b = buildClipboardParts([rtfItem], 'apa', 'bibliography')
    assert.ok(!b.rtf.includes('ZOTERO_ITEM'))
    assert.ok(b.plain.includes('Zhang'))
  })

  console.log('\nI. Zotero 分类同步计划（planZoteroSync）')
  const { planZoteroSync, normalizeTitle } = await import('@/lib/zoteroSync')
  type ZItem = import('@/lib/zoteroSync').ZoteroItem
  const zItem = (partial: Partial<ZItem>): ZItem => ({
    zoteroKey: 'AAAA0001',
    itemType: 'journalArticle',
    title: '',
    doi: '',
    year: null,
    venue: '',
    authors: [],
    collectionPaths: [],
    pdfCount: 0,
    availablePdfCount: 0,
    ...partial,
  })
  await check('normalizeTitle 忽略大小写 / 标点 / 空格', () => {
    assert.equal(normalizeTitle('Silicon Photonics: A Review!'), normalizeTitle('silicon photonics a review'))
  })
  await check('DOI 小写一致优先匹配，产出并集 collections', () => {
    const note = litNote({
      doi: '10.1038/S41566-024-XXXX',
      collections: ['已有分类'],
    })
    const plan = planZoteroSync(
      [zItem({ zoteroKey: 'AAAA0001', doi: '10.1038/s41566-024-xxxx', title: '别的题目', collectionPaths: ['硅光/调制器'] })],
      [note],
    )
    assert.equal(plan.matchedCount, 1)
    assert.deepEqual(plan.updates[0].collections, ['已有分类', '硅光/调制器'])
  })
  await check('Zotero key 匹配优先于 DOI / 标题', () => {
    const note = litNote({ doi: '10.1/别处', collections: [] })
    const withKey: Note = { ...note, literature: { ...note.literature!, zoteroKey: 'Q4DVYK39' } }
    const plan = planZoteroSync([zItem({ zoteroKey: 'Q4DVYK39', doi: '10.1/另一篇', title: '标题不同', collectionPaths: ['方向A'] })], [withKey])
    assert.equal(plan.matchedCount, 1)
    assert.equal(plan.updates[0].zoteroKey, 'Q4DVYK39')
    assert.deepEqual(plan.updates[0].collections, ['方向A'])
  })
  await check('标题归一化匹配兜底（无 DOI 时）', () => {
    const note = litNote({ doi: '' })
    const plan = planZoteroSync(
      [zItem({ zoteroKey: 'BBBB0002', title: 'Silicon Photonics for Quantum Computing!' })],
      [note],
    )
    assert.equal(plan.matchedCount, 1)
    assert.equal(plan.unmatchedZotero.length, 0)
  })
  await check('自动标签：方向首段 / 期刊 / 年份，且不重复已有标签', () => {
    const note = litNote()
    const withTags: Note = { ...note, tags: ['方向:硅光', '期刊:Nature Photonics'] }
    const plan = planZoteroSync(
      [zItem({ zoteroKey: 'CCCC0003', title: note.title, venue: 'Nature Photonics', year: 2024, collectionPaths: ['硅光/调制器', '硅光/探测器'] })],
      [withTags],
    )
    assert.deepEqual(plan.updates[0].tagsToAdd, ['年份:2024'])
    const fresh = planZoteroSync([zItem({ zoteroKey: 'DDDD0004', title: note.title, venue: 'Nature Photonics', year: 2024, collectionPaths: ['硅光/调制器'] })], [note])
    assert.deepEqual(fresh.updates[0].tagsToAdd.sort(), ['期刊:Nature Photonics', '年份:2024', '方向:硅光'].sort())
  })
  await check('Zotero 里没有分类 → collections 为空（界面动态显示「未分类」），不写占位', () => {
    const note = litNote({ doi: '' })
    note.tags = ['方向:未分类', '我的标签']
    const plan = planZoteroSync([zItem({ zoteroKey: 'EEEE0005', title: note.title, collectionPaths: [] })], [note])
    assert.deepEqual(plan.updates[0].collections, [])
    assert.ok(!plan.updates[0].tagsToAdd.includes('方向:未分类'))
    // 历史占位「方向:未分类」标签要被清掉，其它标签保留
    assert.ok(plan.updates[0].tagsToRemove.includes('方向:未分类'))
    assert.ok(!plan.updates[0].tagsToRemove.includes('我的标签'))
    // 之后 Zotero 补了分类 → 真实分类写入
    const after: Note = {
      ...note,
      tags: [...note.tags, ...plan.updates[0].tagsToAdd].filter((t) => t !== '方向:未分类'),
      literature: { ...note.literature!, collections: plan.updates[0].collections, zoteroKey: 'EEEE0005', zoteroKeys: ['EEEE0005'], zoteroPdfCount: 0, zoteroAvailablePdfCount: 0 },
    }
    const next = planZoteroSync([zItem({ zoteroKey: 'EEEE0005', title: note.title, collectionPaths: ['硅光'] })], [after])
    assert.deepEqual(next.updates[0].collections, ['硅光'])
  })
  await check('同步更新 Zotero key 与 PDF 计数（字符串 key）', () => {
    const note = litNote({ doi: '' })
    const plan = planZoteroSync([zItem({ zoteroKey: 'FFFF0006', title: note.title, pdfCount: 2, availablePdfCount: 1 })], [note])
    const update = plan.updates[0]
    assert.equal(update.zoteroKey, 'FFFF0006')
    assert.equal(update.zoteroPdfCount, 2)
    assert.equal(update.zoteroAvailablePdfCount, 1)
  })
  await check('无变化时不产出更新；未匹配条目进入 unmatchedZotero', () => {
    const base = litNote({ collections: ['硅光/调制器'] })
    const note: Note = {
      ...base,
      tags: ['方向:硅光', '期刊:Nature Photonics', '年份:2024'],
      literature: { ...base.literature!, zoteroKey: 'GGGG0007', zoteroKeys: ['GGGG0007'], zoteroPdfCount: 1, zoteroAvailablePdfCount: 1 },
    }
    const same = zItem({ zoteroKey: 'GGGG0007', title: note.title, venue: 'Nature Photonics', year: 2024, collectionPaths: ['硅光/调制器'], pdfCount: 1, availablePdfCount: 1 })
    const plan = planZoteroSync([same, zItem({ zoteroKey: 'HHHH0008', title: '库里没有的论文' })], [note])
    assert.equal(plan.updates.length, 0)
    assert.equal(plan.matchedCount, 1)
    assert.equal(plan.unmatchedZotero.length, 1)
    assert.equal(plan.unmatchedZotero[0].zoteroKey, 'HHHH0008')
  })

  console.log('\nJ. AI operations 校验（parseAiOperations / resolveOps）')
  const { parseAiOperations, resolveOps } = await import('@/lib/aiOps')
  await check('纯 JSON 与 ```json 代码块都能解析', () => {
    const bare = parseAiOperations('{"operations":[{"type":"create","noteType":"summary","title":"T","tags":[],"content":"c"}]}')
    assert.equal(bare.ok, true)
    const fenced = parseAiOperations('说明文字\n```json\n{"operations":[]}\n```\n尾巴')
    assert.equal(fenced.ok, true)
    if (fenced.ok) assert.equal(fenced.ops.length, 0)
  })
  await check('非法 JSON 拒绝并附原始输出预览', () => {
    const r = parseAiOperations('operations: [create]')
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.rawPreview.length > 0)
  })
  await check('schema 校验失败给出字段级原因（缺 title / 未知 noteType / 未知操作）', () => {
    const noTitle = parseAiOperations('{"operations":[{"type":"create","noteType":"summary"}]}')
    assert.equal(noTitle.ok, false)
    const badType = parseAiOperations('{"operations":[{"type":"create","noteType":"wizard","title":"x"}]}')
    assert.equal(badType.ok, false)
    const badOp = parseAiOperations('{"operations":[{"type":"delete","id":"x"}]}')
    assert.equal(badOp.ok, false)
    const badField = parseAiOperations('{"operations":[{"type":"retag","id":"x","addTags":["ok"],"bogus":1}]}')
    // zod 默认 strip 未知键，retag 结构合法即通过
    assert.equal(badField.ok, true)
  })
  await check('resolveOps：id 精确匹配、标题匹配、找不到目标记 error', () => {
    const note = litNote({ doi: '' })
    const ops = [
      { type: 'retag', id: note.id, addTags: ['a'], removeTags: [] },
      { type: 'update', title: note.title, content: '新正文' },
      { type: 'retag', id: 'ghost', addTags: ['b'], removeTags: [] },
    ] as import('@/lib/aiOps').AiOperation[]
    const planned = resolveOps(ops, [note])
    assert.equal(planned[0].kind, 'update')
    assert.equal(planned[1].kind, 'update')
    assert.equal(planned[2].kind, 'error')
  })
  await check('超上限的操作数（>500）被拒绝', () => {
    const many = { operations: Array.from({ length: 501 }, () => ({ type: 'retag', id: 'x', addTags: [], removeTags: [] })) }
    const r = parseAiOperations(JSON.stringify(many))
    assert.equal(r.ok, false)
  })

  console.log('\nK. 话题相关边（tokenize / buildTopicEdges）')
  const { tokenize, buildTopicEdges } = await import('@/lib/topicLinks')
  const lit = (id: string, title: string, collections: string[]): Note => ({
    ...litNote(),
    id,
    title,
    literature: { ...litNote().literature!, collections },
  })
  await check('tokenize：英文按词、中文按字、停用词剔除', () => {
    const t = tokenize('Silicon Photonics: A Review of the State of the Art 硅光研究')
    assert.ok(t.includes('silicon') && t.includes('photonics'))
    assert.ok(!t.includes('a') && !t.includes('the') && !t.includes('of'))
    assert.ok(t.includes('硅') && t.includes('光'))
  })
  await check('共享分类 → 共现边，权重 = Jaccard；同集合成员相连', () => {
    const edges = buildTopicEdges([
      lit('a', 'Alpha waves', ['硅光/调制器']),
      lit('b', 'Beta particles', ['硅光/调制器']),
      lit('c', 'Gamma rays', ['量子计算']),
    ])
    const ab = edges.find((e) => (e.a === 'a' && e.b === 'b') || (e.a === 'b' && e.b === 'a'))
    assert.ok(ab, '同分类的两篇应有共现边')
    assert.equal(ab!.kind, 'collection')
    assert.ok(Math.abs(ab!.weight - 1) < 1e-6)
    assert.ok(!edges.some((e) => e.a === 'a' && e.b === 'c' || e.a === 'c' && e.b === 'a'))
  })
  await check('标题相似（无共享分类）→ 文本边，需共享 ≥2 词', () => {
    const edges = buildTopicEdges([
      lit('a', 'On-chip lithium niobate modulators', []),
      lit('b', 'On-chip lithium niobate photonics', []),
      lit('c', 'Completely different topic here', []),
    ])
    const ab = edges.find((e) => (e.a === 'a' && e.b === 'b') || (e.a === 'b' && e.b === 'a'))
    assert.ok(ab, '标题高度相似应有文本边')
    assert.equal(ab!.kind, 'title')
    assert.ok(!edges.some((e) => (e.a === 'a' && e.b === 'c') || (e.a === 'c' && e.b === 'a')))
  })
  await check('maxPerNode 截断：hub 不会连出超过上限的边', () => {
    const all = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      lit(id, `Shared collection paper ${i}`, ['大方向/共同'])
    )
    const edges = buildTopicEdges(all, { maxPerNode: 2 })
    const deg = new Map<string, number>()
    for (const e of edges) {
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1)
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1)
    }
    for (const [, d] of deg) assert.ok(d <= 2, `度数 ${d} 超过 maxPerNode=2`)
  })

  console.log('\nL. 图谱档位准入（graphModel：与笔记无关联的文献不进入图谱）')
  const {
    buildTitleIndex: buildTI,
    buildWikilinkEdges: buildWE,
    computeNoteDegrees: computeND,
    computeDegreeById: computeFD,
    selectTopicLiterature: selectTL,
  } = await import('@/lib/graphModel')

  // 复现现场：1 篇普通项目笔记，正文只引用 [[Paper 0]]；另有 900 篇同分类（已发表文章）文献
  const GROUP = 900
  const groupLit = Array.from({ length: GROUP }, (_, i) => lit(`L${i}`, `Paper ${i}`, ['已发表文章']))
  const projectNote: Note = {
    id: 'proj',
    title: '项目 某课题',
    type: 'task',
    grade: '',
    tags: [],
    content: '参考了 [[Paper 0]] 这一篇。',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  }
  const allNotes = [projectNote, ...groupLit]
  const tIdx = buildTI(allNotes)

  // 真实组件流程：先算与笔记的双链度数 → linked 档只选「会显示的文献」→ 只为它们建话题边
  const degNote = computeND(allNotes, tIdx)
  const linkedLit = selectTL(groupLit, degNote, 'linked', 1)
  const s0 = performance.now()
  const linkedTopicEdges = buildTopicEdges(linkedLit)
  const linkedTopicMs = performance.now() - s0
  const degLinked = computeFD(allNotes, tIdx, linkedTopicEdges)
  const wlEdges = buildWE(allNotes, tIdx)

  // 对照：旧逻辑对全部 900 篇（含隐藏文献）建话题边，用于展示浪费与误显示来源
  const f0 = performance.now()
  const fullTopicEdges = buildTopicEdges(groupLit)
  const fullTopicMs = performance.now() - f0
  const degFull = computeFD(allNotes, tIdx, fullTopicEdges)

  await check('被普通笔记引用的文献 noteDegree=1，其余 899 篇同组文献 noteDegree=0', () => {
    assert.equal(degNote.get('L0'), 1)
    for (let i = 1; i < GROUP; i++) {
      assert.equal(degNote.get(`L${i}`) ?? 0, 0, `Paper ${i} 不应与普通笔记有关联`)
    }
  })
  await check('linked 档只选 Paper 0；旧逻辑下 L1 全量度数>0（话题边误显示来源）', () => {
    assert.equal(linkedLit.length, 1)
    assert.equal(linkedLit[0].id, 'L0')
    assert.ok((degFull.get('L1') ?? 0) > 0, 'L1 与同组文献有话题边——旧逻辑会把它误带进图谱')
    assert.equal(degLinked.get('L1') ?? 0, 0, '新流程不为 L1 建边，度数应为 0')
  })
  await check('双链边只有 项目→Paper 0；linked 话题边为空（仅 1 篇文献无法成边）', () => {
    assert.equal(wlEdges.length, 1)
    assert.equal(linkedTopicEdges.length, 0)
  })

  console.log(
    `      [规模] 总节点 ${allNotes.length}；旧逻辑全量话题边 ${fullTopicEdges.length} 条 / ${fullTopicMs.toFixed(
      0,
    )} ms，linked 仅 ${linkedTopicEdges.length} 条 / ${linkedTopicMs.toFixed(1)} ms`,
  )
  console.log(
    `      [linked 档] 进入图谱 ${1 + linkedLit.length} 个节点（1 普通笔记 + ${linkedLit.length} 关联文献），其余 ${
      GROUP - linkedLit.length
    } 篇已移出图谱`,
  )

  await check('显示用标题清洗：解 HTML 实体 / 去内联标签 / 去站点尾缀 / 去 $ 定界符', async () => {
    const { cleanLiteratureTitle } = await import('@/lib/literature')
    assert.equal(cleanLiteratureTitle('Crystal <sub>1/2</sub> phase transitions'), 'Crystal 1/2 phase transitions')
    assert.equal(cleanLiteratureTitle('Silicon&#x2013;photonics &amp; chips'), 'Silicon–photonics & chips')
    assert.equal(cleanLiteratureTitle('Deep learning for optics | ScienceDirect.com'), 'Deep learning for optics')
    assert.equal(cleanLiteratureTitle('Quantum dots - Nature'), 'Quantum dots')
    assert.equal(cleanLiteratureTitle('Room-temperature $x^2$ nonlinearity'), 'Room-temperature x^2 nonlinearity')
    // 含反斜杠的 LaTeX 命令保持原样，不做危险的“清洗”
    assert.equal(cleanLiteratureTitle('Study of $\\alpha$-Si'), 'Study of $\\alpha$-Si')
    assert.equal(cleanLiteratureTitle('  多余   空白  '), '多余 空白')
  })

  await check('标题匹配：完全相同 / 前缀包含 / 通用短语不误配', async () => {
    const { matchScore, stripZoteroPrefix, normalizeForMatch } = await import('@/lib/pdfMatch')
    assert.equal(matchScore('Silicon Photonics Technology and Platform Development', 'Silicon Photonics Technology and Platform Development.pdf').score, 1)
    // Zotero 文件名前缀（作者 等 - 年份 - ）要被剥掉；剥掉后与标题完全相同 → 1.0
    assert.equal(stripZoteroPrefix('Siew 等 - 2021 - Review of Silicon Photonics.pdf'), 'Review of Silicon Photonics.pdf')
    assert.equal(matchScore('Review of Silicon Photonics', 'Siew 等 - 2021 - Review of Silicon Photonics.pdf').score, 1)
    // 前缀包含（较短的是较长者开头）→ 0.95
    assert.equal(matchScore('Review of Silicon Photonics', 'Review of Silicon Photonics Technology and Platform Development.pdf').score, 0.95)
    // 下划线/空格/大小写差异
    assert.equal(normalizeForMatch('6G_Wireless Communication Systems'), '6gwirelesscommunicationsystems')
    assert.equal(matchScore('12.14Gb/s Si-substrated GaN/InGaN-based Micro-Photodetector Array', '12.14Gb_s_Si-substrated_GaN_InGaN-based_Micro-Photodetector_Array_With_V-pit_Structure.pdf').score, 0.95)
    // 通用短语（Kaushal 综述）不能靠“包含”蹭上具体论文：低于默认接受阈值 0.92
    assert.ok(matchScore('34.5 m underwater optical wireless communication with 2.70 Gbps data rate', 'Kaushal和Kaddoum - 2016 - Underwater Optical Wireless Communication.pdf').score < 0.92)
    assert.ok(matchScore('An Empirical Comparison of Modulation Schemes', 'Kaushal和Kaddoum - 2016 - Underwater Optical Wireless Communication.pdf').score < 0.92)
  })

  await check('真实分类过滤：只有「未分类」占位的笔记在界面上算作未分类', async () => {
    const { realCollectionsOf } = await import('@/lib/zoteroMeta')
    assert.deepEqual(realCollectionsOf(['未分类']), [])
    assert.deepEqual(realCollectionsOf(['未分类', '硅光/调制器']), ['硅光/调制器'])
    assert.deepEqual(realCollectionsOf([]), [])
    assert.deepEqual(realCollectionsOf(undefined), [])
  })

  console.log(`\n结果：${passed} 通过，${failures.length} 失败`)
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
