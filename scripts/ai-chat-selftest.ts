/**
 * AI 自由提问的纯逻辑回归：上下文范围、截断、消息前缀、历史裁剪。
 * 不触网；运行：npm run test:ai-chat
 */
import type { Note } from '@/types/note'
import { noteContextFor, trimChatHistory, withNoteContext } from '@/lib/aiChat'

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

function note(id: string, title: string, content: string, tags: string[] = []): Note {
  return {
    id,
    title,
    type: 'other',
    grade: '',
    tags,
    content,
    createdAt: 1,
    updatedAt: 2,
  }
}

const a = note('a', '甲笔记', '正文甲，链接 [[乙笔记]] 和 [[丙笔记|别名]]。', ['tag-a'])
const b = note('b', '乙笔记', '正文乙。')
const c = note('c', '丙笔记', '正文丙，反链 [[甲笔记]]。')
const d = note('d', '丁笔记', '无关内容。')
const notes = [a, b, c, d]

console.log('noteContextFor：范围')
check('none 返回空', noteContextFor(notes, a, 'none').text === '')
check('没有当前笔记返回空', noteContextFor(notes, null, 'note').text === '')
const only = noteContextFor(notes, a, 'note')
check('note 只带当前笔记', only.titles.length === 1 && only.titles[0] === '甲笔记', only.titles)
check('正文与标签都进入上下文', only.text.includes('正文甲') && only.text.includes('#tag-a'))
check('note 不包含其它笔记', !only.text.includes('正文乙'))

const linked = noteContextFor(notes, a, 'links')
check(
  'links 带双链目标与反向链接',
  ['甲笔记', '乙笔记', '丙笔记'].every((t) => linked.titles.includes(t)) && !linked.titles.includes('丁笔记'),
  linked.titles,
)
check('别名双链也能解析到目标', linked.titles.includes('丙笔记'))

console.log('noteContextFor：截断')
const long = note('long', '长笔记', 'x'.repeat(5000))
const truncated = noteContextFor([long], long, 'note', { maxChars: 1200 })
check('超出上限会标记截断', truncated.truncated)
check('截断后长度不失控', truncated.text.length <= 1250, truncated.text.length)

console.log('withNoteContext：消息前缀')
const history = [
  { role: 'user' as const, content: '第一个问题' },
  { role: 'assistant' as const, content: '回答' },
  { role: 'user' as const, content: '第二个问题' },
]
const withCtx = withNoteContext(history, '笔记上下文')
check('上下文只加到第一条 user 消息', withCtx[0].content.includes('笔记上下文') && withCtx[2].content === '第二个问题')
check('不修改原数组', history[0].content === '第一个问题')
check('空上下文保持原样', withNoteContext(history, '   ')[0].content === '第一个问题')

console.log('trimChatHistory：历史裁剪')
const many = Array.from({ length: 25 }, (_, i) => ({
  role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
  content: String(i),
}))
check('只保留最近 20 条', trimChatHistory(many, 20).length === 20)
check('保留的是尾部', trimChatHistory(many, 20)[0].content === '5')

console.log(`\nAI 自由提问纯逻辑：${passed}/${passed + failed} 通过`)
if (failed) process.exitCode = 1
