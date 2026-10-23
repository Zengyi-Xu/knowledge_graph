/**
 * 「笔记组织」纯逻辑回归：主题标签（topics）与关系抽屉的纯函数（反链 / 大纲 / 片段）。
 * 不读真实 vault、不碰 DOM 滚动；运行：npm run test:organize
 */
import type { Note } from '@/types/note'
import {
  NO_TOPIC,
  TOPIC_PREFIX,
  groupByTopic,
  isTopicTag,
  normalizeTopic,
  topicCounts,
  topicOf,
  withTopic,
} from '@/lib/topics'
import {
  backlinksOf,
  brokenLinksOf,
  linksIn,
  outlineOf,
  searchSnippet,
} from '@/lib/noteRelations'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.log(`  ✗ ${name}${detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`)
  }
}

function note(id: string, title: string, content: string, tags: string[] = [], updatedAt = 2): Note {
  return { id, title, type: 'other', grade: '', tags, content, createdAt: 1, updatedAt }
}

console.log('topics：主题标签约定')
check('半角冒号识别', isTopicTag('主题:光学'))
check('全角冒号也识别', isTopicTag('主题：光学'))
check('普通标签不算主题', !isTopicTag('年份:2024') && !isTopicTag('#主题'))
check('normalize 去前缀/井号/空白', normalizeTopic('  #主题:  光 学 ') === '光 学')
check('normalize 去方括号', normalizeTopic('主题:[光学]') === '光学')
check('normalize 截到 40 字', normalizeTopic('主题:' + '甲'.repeat(60)).length === 40)
check('topicOf 取第一个主题', topicOf(note('a', '甲', '', [TOPIC_PREFIX + '光学', TOPIC_PREFIX + '激光'])) === '光学')
check('topicOf 无主题返回空串', topicOf(note('a', '甲', '', ['tag'])) === '')
const replaced = withTopic(['tag-a', TOPIC_PREFIX + '旧', 'tag-b'], '新主题')
check('withTopic 换掉旧主题且只留一个', replaced.filter(isTopicTag).length === 1 && topicOf({ tags: replaced }) === '新主题')
check('withTopic 其余标签顺序不变', replaced[0] === 'tag-a' && replaced[1] === 'tag-b', replaced)
check('withTopic 空串 = 去主题', withTopic(['tag', TOPIC_PREFIX + '旧'], '').every((t) => !isTopicTag(t)))

console.log('topics：分组与计数')
const n1 = note('1', '甲', '', [TOPIC_PREFIX + '光学'])
const n2 = note('2', '乙', '', [TOPIC_PREFIX + '光学'])
const n3 = note('3', '丙', '', [TOPIC_PREFIX + '激光'])
const n4 = note('4', '丁', '', [])
const counts = topicCounts([n1, n2, n3, n4])
check('计数按篇数降序', counts[0].topic === '光学' && counts[0].count === 2, counts)
check('无主题不进计数', counts.every((entry) => entry.topic !== NO_TOPIC) && counts.length === 2)
const groups = groupByTopic([n4, n1, n2, n3])
check('未归主题排最后', groups[groups.length - 1].key === NO_TOPIC, groups.map((g) => g.key))
check('组内篇数正确', groups[0].notes.length === 2, groups.map((g) => [g.key, g.notes.length]))

console.log('noteRelations：大纲')
const md = [
  '# 一级标题',
  '',
  '正文',
  '## 二级标题',
  '```',
  '## 围栏里的不是标题',
  '```',
  '### 三级 #',
].join('\n')
const outline = outlineOf(md)
check('只收真标题（跳过围栏）', outline.length === 3, outline)
check('层级正确', outline.map((e) => e.level).join(',') === '1,2,3')
check('去掉行尾 #', outline[2].text === '三级', outline[2])
check('index 指向标题行起点', md.slice(outline[1].index).startsWith('## 二级标题'), outline[1])

console.log('noteRelations：双链与反链')
const target = note('t', '目标笔记', '我是被引用的那篇。')
const linker = note('l', '引用者', '先看 [[目标笔记|那篇]]，再看 [[别的笔记]]。', [], 5)
const upper = note('u', '大写引用', '再看 [[目标笔记#小节]]。', [], 4)
const self = note('t', '目标笔记', '我自己 [[目标笔记]] 自己')
const pool = [target, linker, upper, self]
const backlinks = backlinksOf(pool, target)
check('按标题匹配、忽略大小写与别名', backlinks.length === 2, backlinks.map((b) => b.note.id))
check('按更新时间倒序', backlinks[0].note.id === 'l', backlinks.map((b) => b.note.id))
check('片段含命中上下文', backlinks[0].snippet.includes('先看') && backlinks[0].snippet.includes('目标笔记'), backlinks[0].snippet)
check('自己引用自己不算反链', backlinks.every((b) => b.note.id !== target.id))
check('linksIn 去别名与 #小节', linksIn('[[甲|别名]] [[乙#节]]').map((l) => l.title).join(',') === '甲,乙')
check('linksIn 跳过围栏', linksIn('```\n[[假]]\n```\n[[真]]').map((l) => l.title).join(',') === '真')

console.log('noteRelations：缺失链接与搜索片段')
const withBroken = note('b1', '有断链', '[[存在]] [[不存在]] [[不存在]] [[也不存在]]')
check('缺失链接去重且保序', brokenLinksOf(withBroken, [note('e', '存在', '')]).join(',') === '不存在,也不存在', brokenLinksOf(withBroken, [note('e', '存在', '')]))
const snippet = searchSnippet('第一段\n\n这里提到了 FMCW 雷达，后面还有内容。', 'fmcw')
check('搜索片段大小写不敏感', snippet !== null && snippet.match === 'FMCW', snippet)
check('片段前有上下文', snippet !== null && snippet.before.includes('这里提到了'), snippet)
check('无命中返回 null', searchSnippet('没有这个词', 'FMCW') === null)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exitCode = 1
