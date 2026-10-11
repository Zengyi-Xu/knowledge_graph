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
