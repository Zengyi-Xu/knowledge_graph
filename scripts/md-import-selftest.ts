/**
 * .md 导入解析的回归：重点是 YAML 引号（导入后标题/标签被多包一层引号）。
 * 运行：npm run test:md-import
 */
import assert from 'node:assert/strict'
import { parseMdImport } from '@/lib/mdImport'

let passed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}`)
    throw err
  }
}

check('双引号标题与行内标签列表剥掉外层引号', () => {
  const md = [
    '---',
    'title: "啁啾管理激光与 LiDAR · 调研索引"',
    'type: other',
    'tags: ["啁啾管理激光","CML","LiDAR"]',
    '---',
    '',
    '# 正文',
  ].join('\n')
  const n = parseMdImport('fallback.md', md)
  assert.equal(n.title, '啁啾管理激光与 LiDAR · 调研索引')
  assert.deepEqual(n.tags, ['啁啾管理激光', 'CML', 'LiDAR'])
  assert.equal(n.content, '# 正文')
})

check('单引号与未加引号的值都正常', () => {
  const md = ["---", "title: 'A note'", 'type: summary', "tags: ['a, b', c]", '---', 'body'].join('\n')
  const n = parseMdImport('x.md', md)
  assert.equal(n.title, 'A note')
  assert.equal(n.type, 'summary')
  assert.deepEqual(n.tags, ['a, b', 'c'])
})

check('引号内的转义引号还原成正文，不多剥一层', () => {
  const md = ['---', 'title: "A \\"quoted\\" B"', '---', 'body'].join('\n')
  assert.equal(parseMdImport('x.md', md).title, 'A "quoted" B')
})

check('块状标签列表（Obsidian 写法）', () => {
  const md = ['---', 'title: 测试', 'tags:', '  - "文献"', '  - DOI', '---'].join('\n')
  assert.deepEqual(parseMdImport('x.md', md).tags, ['文献', 'DOI'])
})

check('引号包裹的 type / grade 能识别', () => {
  const md = ['---', 'title: "P"', 'type: "person"', 'grade: "phd"', '---'].join('\n')
  const n = parseMdImport('x.md', md)
  assert.equal(n.type, 'person')
  assert.equal(n.grade, 'phd')
})

check('CRLF + BOM 的 frontmatter 也能识别', () => {
  const md = '\uFEFF---\r\ntitle: "Windows"\r\ntags: ["a"]\r\n---\r\n\r\nbody'
  const n = parseMdImport('x.md', md)
  assert.equal(n.title, 'Windows')
  assert.deepEqual(n.tags, ['a'])
  assert.equal(n.content, 'body')
})

check('无 frontmatter 时用文件名做标题，正文原样保留', () => {
  const n = parseMdImport('我的笔记.md', '# hello\n\nworld')
  assert.equal(n.title, '我的笔记')
  assert.equal(n.type, 'other')
  assert.deepEqual(n.tags, [])
  assert.equal(n.content, '# hello\n\nworld')
})

check('title 为空时回退文件名', () => {
  const md = ['---', 'title: ""', 'tags: []', '---', 'body'].join('\n')
  const n = parseMdImport('fallback.md', md)
  assert.equal(n.title, 'fallback')
  assert.deepEqual(n.tags, [])
})

console.log(`\nmd-import: ${passed} 项全部通过`)
