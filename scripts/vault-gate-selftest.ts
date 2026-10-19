/**
 * vault 安全写入门禁自测（npm run test:vault-gate）。
 *
 * 验收线（对应 docs/VAULT_WRITE_GATE.md）：
 *   1. formatVersion / minimumWriterVersion / requiredCapabilities 声明能读、能判，认不出来就按只读处理；
 *   2. 不满足条件的写入方一律只读 —— 复现 2026-10-13：旧客户端必须拒绝回写带 zoteroKeys / localPdf 的笔记；
 *   3. 未知 front matter 字段保留、删除数为 0、未纳管 md 不动、索引里读不到的文件直接中止。
 *
 * 标 ○ 的验收项要等 vault-format / desktop-bridge 解冻接线才会生效：
 * 它们照跑并打印当前失败原因，接线完成后自动变成 ★（通过）。
 *
 * 2026-10-15：vault-format / desktop-bridge 已按 docs/VAULT_WRITE_GATE.md 接线（策略 B），
 * 下面的 F / G 段就是当时那批「待解冻」验收项，现在都是硬断言。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Note } from '@/types/note'
import { emptyLiterature } from '@/types/note'
import { buildMeta, planVaultWrite, toMarkdown, type VaultIndexEntry, type WrittenNote } from '@/lib/vaultFormat'
import {
  CURRENT_WRITER,
  checkWriteGate,
  decideVaultGate,
  declarationLines,
  gateKey,
  gateWritePlan,
  mergeFrontMatter,
  readDeclaration,
  readMetaDeclaration,
  requiredCapabilitiesFor,
  unknownKeys,
  type WriterProfile,
} from '@/lib/vaultGate'
import * as vaultFs from '../electron/vaultFs.cjs'

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

const BASE = 1_700_000_000_000

function mk(title: string, extra: Partial<Note> = {}): Note {
  const createdAt = extra.createdAt ?? BASE
  return {
    id: extra.id ?? `id-${title}`,
    title,
    type: extra.type ?? 'person',
    grade: extra.grade ?? 'phd',
    tags: extra.tags ?? ['功能:测试'],
    content: extra.content ?? '正文',
    createdAt,
    updatedAt: extra.updatedAt ?? createdAt + 1000,
    ...(extra.literature ? { literature: extra.literature } : {}),
  }
}

function litNote(): Note {
  return mk('Silicon photonics', {
    id: 'lit-1',
    type: 'literature',
    grade: '',
    literature: {
      ...emptyLiterature(),
      citekey: 'zhang2024silicon',
      zoteroKey: 'ABCD1234',
      zoteroKeys: ['ABCD1234', 'EFGH5678'],
      localPdf: 'D:\\pdfs\\silicon.pdf',
      zoteroPdfCount: 2,
      zoteroAvailablePdfCount: 1,
    },
  })
}

/** 2026-10-13 那个旧客户端的能力画像：认识 zoteroKey / 计数，不认识 zoteroKeys / localPdf */
const OLD_WRITER: WriterProfile = {
  formatVersion: 1,
  version: 1,
  fields: [
    'format', 'id', 'title', 'type', 'grade',
    'authors', 'venue', 'year', 'doi', 'citekey', 'attachments', 'collections',
    'zoterokey', 'zoteropdfcount', 'zoteroavailablepdfcount',
    'tags', 'created', 'updated',
  ],
}

/** 在 front matter 里塞进「别家客户端写的」未知字段（注释 + 标量 + 块状列表） */
function withUnknownFields(text: string): string {
  return text.replace('\n---\n', '\n# 下面是别家插件写的\ncssclass: wide\naliases:\n  - 硅光综述\n  - 光量子\n---\n')
}

const DECLARED = (fields: string) => readDeclaration(`---\n${fields}\nid: "x"\n---\n\n正文`)

const textsOf = (entries: [string, string][]) => new Map(entries)

async function main() {
  console.log('A. 声明扫描（formatVersion / minimumWriterVersion / requiredCapabilities）')
  const oldNote = [
    '---',
    'format: kaust-kg-note',
    'id: "a"',
    'title: "旧笔记"',
    'type: person',
    'tags: []',
    'created: 2026-10-06T07:01:57.417Z',
    'updated: 2026-10-06T07:01:57.417Z',
    '---',
    '',
    '正文',
  ].join('\n')
  await check('没有声明的老 md 按基线处理（1 / 0 / 无能力要求）', () => {
    const d = readDeclaration(oldNote)
    assert.equal(d.formatVersion, 1)
    assert.equal(d.minimumWriterVersion, 0)
    assert.deepEqual(d.requiredCapabilities, [])
    assert.equal(d.declared, false)
  })
  await check('声明按原样读出（含引号与 JSON 数组）', () => {
    const d = DECLARED('formatVersion: 3\nminimumWriterVersion: 4\nrequiredCapabilities: ["zoteroKeys", "localPdf"]')
    assert.equal(d.formatVersion, 3)
    assert.equal(d.minimumWriterVersion, 4)
    assert.deepEqual(d.requiredCapabilities, ['zoteroKeys', 'localPdf'])
    assert.equal(d.declared, true)
  })
  await check('逗号写法与单值写法也能读', () => {
    assert.deepEqual(DECLARED('requiredCapabilities: [zoteroKeys, localPdf]').requiredCapabilities, ['zoteroKeys', 'localPdf'])
    assert.deepEqual(DECLARED('requiredCapabilities: localPdf').requiredCapabilities, ['localPdf'])
    assert.deepEqual(DECLARED('requiredCapabilities: []').requiredCapabilities, [])
  })
  await check('认不出来的版本号按「更高版本」处理（宁可只读）', () => {
    assert.equal(DECLARED('formatVersion: 2.5').formatVersion, Number.POSITIVE_INFINITY)
    assert.equal(DECLARED('formatVersion: 高').formatVersion, Number.POSITIVE_INFINITY)
    assert.equal(DECLARED('formatVersion: 0').formatVersion, Number.POSITIVE_INFINITY)
    assert.equal(readDeclaration(oldNote).formatVersion, 1)
  })
  await check('认不出来的能力名照样当成要求（当作缺失）', () => {
    assert.deepEqual(DECLARED('requiredCapabilities: 未来能力').requiredCapabilities, ['未来能力'])
    assert.equal(checkWriteGate(DECLARED('requiredCapabilities: 未来能力')).writable, false)
  })
  await check('重复声明取最严的一份（重复不能把门禁放松）', () => {
    const d = DECLARED('formatVersion: 1\nformatVersion: 9\nrequiredCapabilities: [localPdf]\nrequiredCapabilities: [未来能力]')
    assert.equal(d.formatVersion, 9)
    assert.deepEqual(d.requiredCapabilities, ['localPdf', '未来能力'])
    assert.equal(checkWriteGate(d).writable, false)
  })
  await check('没有 front matter 的手写 md / 空 front matter 都是基线', () => {
    assert.equal(readDeclaration('# 手写笔记\n\n正文').formatVersion, 1)
    assert.equal(readDeclaration('---\n\n---\n正文').formatVersion, 1)
  })
  await check('CRLF 的 md 也能读出声明', () => {
    assert.equal(readDeclaration('---\r\nformatVersion: 2\r\nrequiredCapabilities: [localPdf]\r\n---\r\n\r\n正文').formatVersion, 2)
  })
  await check('meta.json 的声明（缺失 / 垃圾 / 正常）', () => {
    assert.equal(readMetaDeclaration(null).formatVersion, 1)
    assert.equal(readMetaDeclaration('{"format":"kaust-kg-vault","version":1}').formatVersion, 1)
    assert.equal(readMetaDeclaration('不是 JSON').formatVersion, 1)
    const d = readMetaDeclaration('{"formatVersion":2,"minimumWriterVersion":2,"requiredCapabilities":["localPdf"]}')
    assert.equal(d.formatVersion, 2)
    assert.equal(d.minimumWriterVersion, 2)
    assert.deepEqual(d.requiredCapabilities, ['localPdf'])
    assert.equal(readMetaDeclaration('{"formatVersion":"??"}').formatVersion, Number.POSITIVE_INFINITY)
  })

  console.log('\nB. 写入方判定（不满足条件就只读）')
  const declared = DECLARED('formatVersion: 2\nminimumWriterVersion: 2\nrequiredCapabilities: ["zoteroKeys"]')
  await check('同代次、有全部能力 → 可写', () => {
    const v = checkWriteGate(declared)
    assert.equal(v.writable, true)
    assert.deepEqual(v.reasons, [])
  })
  await check('磁盘格式更高 → 只读，理由里写清版本号', () => {
    const v = checkWriteGate(DECLARED('formatVersion: 3'))
    assert.equal(v.writable, false)
    assert.match(v.reasons.join('\n'), /formatVersion 3 高于本客户端支持的 2/)
  })
  await check('要求写入方版本更高 → 只读', () => {
    const v = checkWriteGate(DECLARED('minimumWriterVersion: 9'))
    assert.equal(v.writable, false)
    assert.match(v.reasons.join('\n'), /要求写入方版本 ≥ 9/)
  })
  await check('缺字段能力 → 只读，并列出缺的能力', () => {
    const text = DECLARED('requiredCapabilities: ["localPdf","未来能力"]')
    assert.deepEqual(checkWriteGate(text).missingCapabilities, ['未来能力'])
    const old = checkWriteGate(text, OLD_WRITER)
    assert.equal(old.writable, false)
    assert.deepEqual(old.missingCapabilities, ['localPdf', '未来能力'])
    assert.match(old.reasons.join('\n'), /缺少字段能力：localPdf、未来能力/)
  })
  await check('多条不满足 → 每条理由都在', () => {
    const v = checkWriteGate(DECLARED('formatVersion: 3\nminimumWriterVersion: 3\nrequiredCapabilities: [未来能力]'))
    assert.equal(v.reasons.length, 3)
  })
  await check('复现 2026-10-13：旧客户端拒绝回写带 zoteroKeys / localPdf 的笔记', () => {
    const lines = declarationLines(litNote())
    assert.deepEqual(lines, ['formatVersion: 2', 'minimumWriterVersion: 2', 'requiredCapabilities: ["zoteroKeys","localPdf"]'])
    const onDisk = `---\nformat: kaust-kg-note\n${lines.join('\n')}\nid: "lit-1"\n---\n\n正文`
    const oldVerdict = checkWriteGate(readDeclaration(onDisk), OLD_WRITER)
    assert.equal(oldVerdict.writable, false)
    assert.deepEqual(oldVerdict.missingCapabilities, ['zoteroKeys', 'localPdf'])
    // 本客户端自己可以写
    assert.equal(checkWriteGate(readDeclaration(onDisk), CURRENT_WRITER).writable, true)
    // 旧笔记（没有声明）对旧客户端仍然可写：不做迁移，也不因门禁把老库锁死
    assert.equal(checkWriteGate(readDeclaration(oldNote), OLD_WRITER).writable, true)
  })
  await check('策略 B：普通笔记不加声明，带能力数据的笔记才打标（升级零重写）', () => {
    assert.deepEqual(declarationLines(mk('普通笔记')), [])
    assert.equal(readDeclaration(toMarkdown(mk('普通笔记'))).declared, false)
    assert.deepEqual(declarationLines(litNote()), [
      'formatVersion: 2',
      'minimumWriterVersion: 2',
      'requiredCapabilities: ["zoteroKeys","localPdf"]',
    ])
    assert.deepEqual(requiredCapabilitiesFor(mk('普通笔记')), [])
    assert.deepEqual(requiredCapabilitiesFor(litNote()), ['zoteroKeys', 'localPdf'])
  })
  await check('声明能自己读回来（往返）', () => {
    const text = `---\nformat: kaust-kg-note\n${declarationLines(litNote()).join('\n')}\nid: "lit-1"\n---\n\n正文`
    const d = readDeclaration(text)
    assert.equal(d.declared, true)
    assert.equal(d.formatVersion, 2)
    assert.equal(d.minimumWriterVersion, 2)
    assert.deepEqual(d.requiredCapabilities, ['zoteroKeys', 'localPdf'])
  })

  console.log('\nC. 全库判定（只读打开的范围）')
  const plainText = toMarkdown(mk('普通', { id: 'plain' }))
  await check('没有任何声明 → 整库可写（老 vault 不被门禁锁死）', () => {
    const d = decideVaultGate([{ file: '人物/普通.md', text: plainText }], '{"format":"kaust-kg-vault","version":1}')
    assert.equal(d.vaultReadOnly, false)
    assert.equal(d.readOnlyFiles.size, 0)
  })
  await check('meta.json 声明超限 → 整库只读', () => {
    const d = decideVaultGate([{ file: '人物/普通.md', text: plainText }], '{"formatVersion":3}')
    assert.equal(d.vaultReadOnly, true)
    assert.match(d.vaultReasons.join('\n'), /formatVersion 3/)
  })
  await check('只有某一篇超限 → 那一篇只读，其余照常可写', () => {
    const future = '---\nformat: kaust-kg-note\nformatVersion: 9\nid: "f"\ntitle: "未来"\ntype: person\n---\n\n正文'
    const d = decideVaultGate(
      [
        { file: '人物/普通.md', text: plainText },
        { file: '人物/未来.md', text: future },
      ],
      null,
    )
    assert.equal(d.vaultReadOnly, false)
    assert.deepEqual([...d.readOnlyFiles], [gateKey('人物/未来.md')])
    assert.equal(d.blocked[0].file, '人物/未来.md')
    assert.match(d.blocked[0].reasons.join('\n'), /formatVersion 9/)
  })
  await check('大小写 / 反斜杠不同的路径算同一篇', () => {
    const d = decideVaultGate([{ file: '人物\\未来.md', text: '---\nformatVersion: 9\n---\n' }], null)
    assert.equal(d.readOnlyFiles.has(gateKey('人物/未来.md')), true)
  })

  console.log('\nD. 未知字段保留（回写不能丢别家的字段）')
  const diskWithUnknown = withUnknownFields(toMarkdown(litNote()))
  await check('别家的字段、注释、块状列表原样带回，本应用字段用新值', () => {
    const merged = mergeFrontMatter(diskWithUnknown, toMarkdown(litNote()))
    assert.match(merged, /^# 下面是别家插件写的$/m)
    assert.match(merged, /^cssclass: wide$/m)
    assert.match(merged, /^aliases:\n {2}- 硅光综述\n {2}- 光量子$/m)
    assert.equal(merged.split('zoteroKeys:').length - 1, 1, '已知字段不能重复出现')
    assert.match(merged, /zoteroKeys: \["ABCD1234","EFGH5678"\]/)
    assert.ok(merged.endsWith('正文'))
  })
  await check('旧客户端回写时，它不认识的 zoteroKeys / localPdf 被完整带回来', () => {
    const oldNext = toMarkdown(
      mk('Silicon photonics', {
        id: 'lit-1',
        type: 'literature',
        grade: '',
        literature: { ...emptyLiterature(), citekey: 'zhang2024silicon' },
      }),
    )
    assert.ok(!oldNext.includes('zoteroKeys'), '前提：旧客户端的序列化结果里没有这两个字段')
    assert.ok(!oldNext.includes('localPdf'))
    const merged = mergeFrontMatter(diskWithUnknown, oldNext, OLD_WRITER)
    assert.match(merged, /^zoteroKeys: \["ABCD1234","EFGH5678"\]$/m)
    assert.match(merged, /^localPdf: "D:\\\\pdfs\\\\silicon\.pdf"$/m)
    assert.match(merged, /^cssclass: wide$/m)
    // 旧客户端连门禁声明也不认识 → 声明本身也会被原样带回来（文件继续保持受保护状态）
    assert.deepEqual(unknownKeys(diskWithUnknown, OLD_WRITER), [
      'formatVersion',
      'minimumWriterVersion',
      'requiredCapabilities',
      'zoteroKeys',
      'localPdf',
      'cssclass',
      'aliases',
    ])
    assert.deepEqual(unknownKeys(diskWithUnknown, CURRENT_WRITER), ['cssclass', 'aliases'])
  })
  await check('结尾找不到归属的注释也保住', () => {
    const withTail = '---\nformat: kaust-kg-note\nid: "x"\n# 尾巴注释\n---\n\n正文'
    assert.deepEqual(unknownKeys(withTail, CURRENT_WRITER), ['(注释)'])
    const merged = mergeFrontMatter(withTail, toMarkdown(mk('X', { id: 'x' })))
    assert.match(merged, /^# 尾巴注释$/m)
    assert.ok(merged.endsWith('正文'))
  })
  await check('合并幂等：再合并一次结果一字不变', () => {
    const next = toMarkdown(litNote())
    const once = mergeFrontMatter(diskWithUnknown, next)
    assert.equal(mergeFrontMatter(once, next), once)
  })
  await check('没有要抢救的字段时逐字节返回新文本', () => {
    const next = toMarkdown(mk('普通', { id: 'plain' }))
    assert.equal(mergeFrontMatter(next, next), next)
    assert.equal(mergeFrontMatter('', next), next)
    assert.equal(mergeFrontMatter('---\nformat: kaust-kg-note\nid: "x"\n---\n\n正文', next), next)
  })
  await check('CRLF 的旧文件不会把 \\r 带进新文本', () => {
    const merged = mergeFrontMatter(diskWithUnknown.replace(/\n/g, '\r\n'), toMarkdown(mk('普通', { id: 'plain' })))
    assert.ok(!merged.includes('\r'))
  })
  await check('写入方认识某个字段之后，旧值不再重复保留', () => {
    const next = toMarkdown(litNote())
    const once = mergeFrontMatter(diskWithUnknown, next)
    assert.equal(mergeFrontMatter(once, next).split('zoteroKeys:').length - 1, 1)
  })

  console.log('\nE. 写盘计划门禁（四条红线）')
  const a = mk('A', { id: 'a' })
  const b = mk('B', { id: 'b' })
  const twoIndex: VaultIndexEntry[] = [
    { id: 'a', file: '人物/A.md', title: 'A' },
    { id: 'b', file: '人物/B.md', title: 'B' },
  ]
  const twoDisk = ['人物/A.md', '人物/B.md']
  const bothOnDisk = textsOf([
    ['人物/A.md', toMarkdown(a)],
    ['人物/B.md', toMarkdown(b)],
  ])
  await check('删除数恒为 0：默认门禁不做任何删除', () => {
    const plan = planVaultWrite([a], twoIndex, twoDisk, new Map(), '')
    assert.deepEqual(plan.deletes, ['人物/B.md'], '前提：计划里本来要删 B')
    const gated = gateWritePlan({ plan, index: twoIndex, diskFiles: twoDisk, diskText: bothOnDisk })
    assert.deepEqual(gated.plan.deletes, [])
    assert.equal(gated.skippedDeletes.length, 1)
    assert.match(gated.skippedDeletes[0].reason, /门禁不做删除/)
  })
  await check('显式放行删除时，未纳管的 md 仍然不动', () => {
    const plan = planVaultWrite([a, b], twoIndex, twoDisk, new Map(), '')
    const gated = gateWritePlan({
      plan: { ...plan, deletes: ['Inbox/别人的笔记.md'] },
      index: twoIndex,
      diskFiles: [...twoDisk, 'Inbox/别人的笔记.md'],
      diskText: textsOf([...bothOnDisk, ['Inbox/别人的笔记.md', '# 别人的笔记\n\n正文']]),
      allowDeletes: true,
    })
    assert.deepEqual(gated.plan.deletes, [])
    assert.match(gated.skippedDeletes[0].reason, /未纳管/)
  })
  await check('只读笔记：两层门禁都不写新文件、不删它的旧文件（改名场景）', () => {
    const renamed = { ...a, title: 'A 改过名' }
    const futureText = [
      '---',
      'format: kaust-kg-note',
      'formatVersion: 9',
      'id: "a"',
      'title: "A"',
      'type: person',
      '---',
      '',
      '正文',
    ].join('\n')
    // 第一层：计划器自己就不写、不删、不改名
    const planned = planVaultWrite(
      [renamed],
      [twoIndex[0]],
      ['人物/A.md'],
      new Map([['a', { file: '人物/A.md', text: futureText }]]) as Map<string, WrittenNote>,
      '',
    )
    assert.deepEqual(planned.writes, [])
    assert.deepEqual(planned.deletes, [])
    assert.equal(planned.names.get('a'), '人物/A.md')
    // 第二层：就算有人绕过计划器塞进一个改名计划，gateWritePlan 也挡得住
    const plan = {
      writes: [{ id: 'a', file: '人物/A 改过名.md', text: toMarkdown(renamed) }],
      deletes: ['人物/A.md'],
      index: [twoIndex[0]],
      meta: '',
      metaSkipped: true,
      names: new Map([['a', '人物/A 改过名.md']]),
    }
    const gated = gateWritePlan({
      plan,
      index: [twoIndex[0]],
      diskFiles: ['人物/A.md'],
      diskText: textsOf([['人物/A.md', futureText]]),
      allowDeletes: true,
    })
    assert.deepEqual(gated.plan.writes, [])
    assert.deepEqual(gated.plan.deletes, [])
    assert.match(gated.readOnly[0].reasons.join('\n'), /formatVersion 9/)
    assert.match(gated.skippedDeletes[0].reason, /只读/)
  })
  await check('未纳管的同名 md 绝不覆盖', () => {
    const plan = planVaultWrite([a], null, [], new Map(), '')
    const gated = gateWritePlan({
      plan,
      index: [],
      diskFiles: ['人物/A.md'],
      diskText: textsOf([['人物/A.md', '# 别人的 A\n\n正文']]),
    })
    assert.deepEqual(gated.plan.writes, [])
    assert.match(gated.readOnly[0].reasons.join('\n'), /未纳管/)
  })
  const quietPlan = planVaultWrite(
    [a, b],
    twoIndex,
    twoDisk,
    new Map([
      ['a', { file: '人物/A.md', text: toMarkdown(a) }],
      ['b', { file: '人物/B.md', text: toMarkdown(b) }],
    ]),
    '',
  )
  await check('索引里登记、磁盘上读不到 → 直接中止（同步盘离线）', () => {
    assert.equal(quietPlan.writes.length, 0, '前提：这次计划里没有写入')
    assert.throws(
      () =>
        gateWritePlan({
          plan: quietPlan,
          index: twoIndex,
          diskFiles: twoDisk, // 列目录来自缓存：文件「在」，读却失败
          diskText: textsOf([['人物/A.md', toMarkdown(a)]]),
        }),
      /读不到[\s\S]*人物\/B\.md/,
    )
  })
  await check('显式放行后，离线条目只进 missing 列表，不静默丢索引', () => {
    const gated = gateWritePlan({
      plan: quietPlan,
      index: twoIndex,
      diskFiles: twoDisk,
      diskText: textsOf([['人物/A.md', toMarkdown(a)]]),
      allowMissing: true,
    })
    assert.deepEqual(gated.missing, ['人物/B.md'])
    assert.deepEqual(gated.plan.deletes, [])
  })
  await check('新建笔记（磁盘上没有）照常写', () => {
    const note = mk('C', { id: 'c' })
    const plan = planVaultWrite([note], [], [], new Map(), '')
    const gated = gateWritePlan({ plan, index: [], diskFiles: [], diskText: new Map() })
    assert.deepEqual(gated.plan.writes.map((w) => w.file), ['人物/C.md'])
    assert.deepEqual(gated.missing, [])
  })
  await check('写回文本自动补回未知字段，并记录补了什么', () => {
    const note = mk('A', { id: 'a', content: '改过的正文' })
    const plan = planVaultWrite([note], [twoIndex[0]], ['人物/A.md'], new Map(), '')
    const gated = gateWritePlan({
      plan,
      index: [twoIndex[0]],
      diskFiles: ['人物/A.md'],
      diskText: textsOf([['人物/A.md', withUnknownFields(toMarkdown(a))]]),
    })
    assert.equal(gated.plan.writes.length, 1)
    assert.match(gated.plan.writes[0].text, /^cssclass: wide$/m)
    assert.deepEqual(gated.preserved, [{ file: '人物/A.md', keys: ['cssclass', 'aliases'] }])
  })
  await check('本应用自己的文件（上次写盘中断在 meta 之前）可以继续写', () => {
    const note = mk('A', { id: 'a', content: '中断后重写' })
    const plan = planVaultWrite([note], [], [], new Map(), '')
    const gated = gateWritePlan({
      plan,
      index: [],
      diskFiles: ['人物/A.md'],
      diskText: textsOf([['人物/A.md', toMarkdown(a)]]),
    })
    assert.equal(gated.plan.writes.length, 1)
  })

  console.log('\nF. 门禁接线（vault-format / desktop-bridge）')
  await check('toMarkdown 只给带能力数据的笔记写声明', () => {
    const d = readDeclaration(toMarkdown(litNote()))
    assert.equal(d.formatVersion, 2)
    assert.equal(d.minimumWriterVersion, 2)
    assert.deepEqual(d.requiredCapabilities, ['zoteroKeys', 'localPdf'])
  })
  await check('planVaultWrite 的写回文本保留磁盘上的未知字段', () => {
    const note = mk('A', { id: 'a', content: '改过的正文' })
    const plan = planVaultWrite(
      [note],
      [twoIndex[0]],
      ['人物/A.md'],
      new Map([['a', { file: '人物/A.md', text: withUnknownFields(toMarkdown(a)) }]]),
      '',
    )
    assert.match(plan.writes[0].text, /^cssclass: wide$/m)
    assert.match(plan.writes[0].text, /^aliases:$/m)
  })
  await check('planVaultWrite 对只读笔记不写、不删、不改名，meta 仍指向原文件', () => {
    const renamed = { ...a, title: 'A 改名了' }
    const futureText = [
      '---',
      'format: kaust-kg-note',
      'formatVersion: 9',
      'id: "a"',
      'title: "A"',
      'type: person',
      '---',
      '',
      '正文',
    ].join('\n')
    const plan = planVaultWrite(
      [renamed],
      [twoIndex[0]],
      ['人物/A.md'],
      new Map([['a', { file: '人物/A.md', text: futureText }]]),
      '',
    )
    assert.deepEqual(plan.writes, [])
    assert.deepEqual(plan.deletes, [])
    assert.equal(plan.names.get('a'), '人物/A.md')
    assert.deepEqual(plan.index.map((e) => e.file), ['人物/A.md'])
  })
  await check('meta.json 声明超限 → 整库只读：不写 md、不重建索引', () => {
    const lastMeta = JSON.stringify({ format: 'kaust-kg-vault', version: 1, formatVersion: 9, notes: [] })
    const plan = planVaultWrite([mk('A', { id: 'a', content: '改了' })], [twoIndex[0]], ['人物/A.md'], new Map(), lastMeta)
    assert.deepEqual(plan.writes, [])
    assert.deepEqual(plan.deletes, [])
    assert.equal(plan.metaSkipped, true)
    assert.equal(plan.meta, lastMeta)
  })
  await check('planVaultWrite 写出的 meta.json 带声明，且保留未知顶层字段', () => {
    const lastMeta = JSON.stringify(
      { format: 'kaust-kg-vault', version: 1, notes: [], futureIndexField: { keep: true } },
      null,
      2,
    )
    const plan = planVaultWrite([a], [twoIndex[0]], ['人物/A.md'], new Map(), lastMeta)
    const meta = JSON.parse(plan.meta) as Record<string, unknown>
    assert.equal(meta.formatVersion, 2)
    assert.deepEqual(meta.futureIndexField, { keep: true })
    assert.equal((JSON.parse(buildMeta([a], new Map([['a', '人物/A.md']]))) as Record<string, unknown>).formatVersion, 2)
  })
  await check('主进程写盘最后一道防线：拒绝覆盖声明更高的文件', async () => {
    const dir = path.resolve(process.cwd(), '.tmp-vault-test', 'gate-data')
    await fs.rm(dir, { recursive: true, force: true })
    const futureText = '---\nformat: kaust-kg-note\nformatVersion: 9\nid: "f"\ntitle: "未来"\ntype: person\n---\n\n正文'
    await vaultFs.writeVault(dir, { writes: [{ file: '人物/未来.md', text: futureText }], deletes: [], meta: null })
    await assert.rejects(() =>
      vaultFs.writeVault(dir, {
        writes: [{ file: '人物/未来.md', text: toMarkdown(mk('未来', { id: 'f', content: '旧客户端改的' })) }],
        deletes: [],
        meta: null,
      }),
    )
    assert.equal((await vaultFs.readVaultFiles(dir, ['人物/未来.md']))[0].text, futureText)
    // 普通文件照常写：防线只挡声明超限的那些
    await vaultFs.writeVault(dir, {
      writes: [{ file: '人物/普通.md', text: toMarkdown(mk('普通', { id: 'p' })) }],
      deletes: [],
      meta: null,
    })
    assert.ok((await vaultFs.readVaultFiles(dir, ['人物/普通.md']))[0].text.includes('普通'))
    await fs.rm(dir, { recursive: true, force: true })
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
