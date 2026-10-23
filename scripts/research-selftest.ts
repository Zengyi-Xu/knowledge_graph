/**
 * 研究追问的纯逻辑回归：
 * 题库评分/选题、签名去重、状态迁移、内容版本、模型输出校验、路由（本地失败绝不回退云端）、
 * 深入分析材料边界、插入段落格式。不触网、不碰 vault；运行：npm run test:research
 */
import type { Note } from '@/types/note'
import {
  CATEGORY_LABEL,
  RESEARCH_CATEGORIES,
  bankScore,
  defaultBank,
  pickBankCandidates,
  questionSignature,
  touchQuestion,
  type ResearchQuestion,
} from '@/lib/research/bank'
import {
  appendRound,
  answeredSignatures,
  contentHashOf,
  newSession,
  patchItem,
  roundItems,
  skippedSignatures,
  unresolvedItems,
  type ResearchSessionFile,
} from '@/lib/research/session'
import { contentChanged, planQuestions, type PlannedQuestion } from '@/lib/research/plan'
import {
  appendToContent,
  buildDeepDivePrompt,
  buildGenerationPrompt,
  buildInsertSection,
  parseGenerationOutput,
  truncateNoteContent,
} from '@/lib/research/prompts'
import { decideDeepDive, decideGenerate, deepDiveMaterialIds } from '@/lib/research/router'

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

function note(id: string, title: string, content: string, tags: string[] = [], type: Note['type'] = 'other'): Note {
  return { id, title, type, grade: '', tags, content, createdAt: 1, updatedAt: 2 }
}

const NOW = 1_760_000_000_000
let seq = 0
const rid = () => `t${++seq}`

// ---------- 题库 ----------

console.log('题库：签名与评分')
check('签名忽略空白/标点/大小写', questionSignature('Abc： def？') === questionSignature('abc def'))
check('签名保留中日韩字符', questionSignature('信道 建模') === '信道建模')
check('默认题库六个类别各至少一道', RESEARCH_CATEGORIES.every((c) => defaultBank().questions.some((q) => q.category === c)))

const bank = defaultBank()
const ctx = { noteType: 'literature' as const, topic: '可见光通信', tags: ['ofdm'], now: NOW }
const qConcept = bank.questions.find((q) => q.category === 'concept')!
check('启用题有有限分数', Number.isFinite(bankScore(qConcept, ctx)))
const disabledQ: ResearchQuestion = { ...qConcept, id: 'x1', enabled: false }
check('停用题分数为 -Infinity', bankScore(disabledQ, ctx) === Number.NEGATIVE_INFINITY)
const favQ: ResearchQuestion = { ...qConcept, id: 'x2', favoriteCount: 5 }
const skipQ: ResearchQuestion = { ...bank.questions.find((q) => q.category === 'action')!, id: 'x3', skippedCount: 9 }
check('收藏加权高于跳过减分', bankScore(favQ, ctx) > bankScore(skipQ, ctx))
const usedRecently: ResearchQuestion = { ...qConcept, id: 'x4', lastUsedAt: NOW - 86_400_000 }
const usedLongAgo: ResearchQuestion = { ...qConcept, id: 'x5', lastUsedAt: NOW - 30 * 86_400_000 }
check('最近用过的降权', bankScore(usedLongAgo, ctx) > bankScore(usedRecently, ctx))
const typedMatch: ResearchQuestion = { ...qConcept, id: 'x6', noteTypes: ['literature'] }
const typedMiss: ResearchQuestion = { ...qConcept, id: 'x7', noteTypes: ['person'] }
check('类型匹配加权', bankScore(typedMatch, ctx) > bankScore(typedMiss, ctx))
const touched = touchQuestion(bank.questions, qConcept.id, 'used', NOW)
check('used 事件计数+记时间', touched.find((q) => q.id === qConcept.id)!.usedCount === qConcept.usedCount + 1 && touched.find((q) => q.id === qConcept.id)!.lastUsedAt === NOW)
check('其它题不受影响', touched.filter((q) => q.id !== qConcept.id).every((q, i) => q === bank.questions.filter((x) => x.id !== qConcept.id)[i]))
check('停用题不进候选', !pickBankCandidates([disabledQ], ctx, 5).some((q) => q.id === 'x1'))
check('排除签名不进候选', !pickBankCandidates(bank.questions, ctx, 10, new Set([questionSignature(qConcept.text)])).some((q) => q.id === qConcept.id))

// ---------- 会话与状态迁移 ----------

console.log('会话：轮次与状态迁移')
const n1 = note('n1', '测试笔记', '正文 v1')
let session: ResearchSessionFile = newSession('n1', n1.content, NOW)
check('新会话没有题目', session.items.length === 0 && session.roundCount === 0)
check('内容哈希稳定', contentHashOf('abc') === contentHashOf('abc') && contentHashOf('abc') !== contentHashOf('abd'))
check('新会话内容版本未变', !contentChanged(session, n1.content))
check('正文一改就算重大修改', contentChanged(session, '正文 v2'))

session = appendRound(
  session,
  [
    { question: '信道模型的假设条件是什么？', why: '假设不清模型不可用', category: 'method', source: 'ai', model: 'qwen · 本地' },
    { question: '结论有实验数据支撑吗？', why: '区分观点与证据', category: 'evidence', source: 'bank', bankId: qConcept.id, model: 'qwen · 本地' },
    { question: '下一步最值得做的实验是什么？', why: '推动研究前进', category: 'action', source: 'ai', model: 'qwen · 本地' },
  ],
  NOW,
  rid,
)
check('一轮 3 题、轮次 +1', session.roundCount === 1 && roundItems(session, 1).length === 3)
const [it1, it2, it3] = roundItems(session, 1)
check('未解决列表按轮次取全部', unresolvedItems(session).length === 3)

const answered = patchItem(session, it2.id, { status: 'answered', draft: '有三组对照实验。' }, NOW + 1)
check('pending → answered 合法', answered.items.find((i) => i.id === it2.id)!.status === 'answered')
check('已答签名入库', answeredSignatures(answered).has(questionSignature(it2.question)))
const skipped = patchItem(answered, it3.id, { status: 'skipped' }, NOW + 2)
check('pending → skipped 合法', skippedSignatures(skipped).has(questionSignature(it3.question)))
const latered = patchItem(answered, it1.id, { status: 'later' }, NOW + 3)
check('pending → later 合法', latered.items.find((i) => i.id === it1.id)!.status === 'later')
const reopened = patchItem(latered, it1.id, { status: 'answered', draft: '答' }, NOW + 4)
check('later → answered 合法', reopened.items.find((i) => i.id === it1.id)!.status === 'answered')
let threw = false
try {
  patchItem(answered, it2.id, { status: 'skipped' }, NOW)
} catch {
  threw = true
}
check('已答是终态：answered → skipped 拒绝', threw)
threw = false
try {
  patchItem(skipped, it3.id, { status: 'answered' }, NOW)
} catch {
  threw = true
}
check('skipped → answered 必须经 later', threw)
check('插入标记落库', patchItem(answered, it2.id, { inserted: true }, NOW).items.find((i) => i.id === it2.id)!.inserted === true)

// ---------- 规划与去重 ----------

console.log('规划：连续生成不重复、已解决不再问')
const plannedAi: PlannedQuestion[] = [
  { question: '信道模型的假设条件是什么？', why: 'a', category: 'method', source: 'ai' },
  { question: '模型在不同水质下还成立吗？', why: 'b', category: 'boundary', source: 'ai' },
  { question: '结论有实验数据支撑吗？', why: 'c', category: 'evidence', source: 'ai' },
  { question: '下一步最值得做的实验是什么？', why: 'd', category: 'action', source: 'ai' },
]
// answered 会话里：it2（证据）已答、it3（下一步）跳过、it1 问过未答
const plan1 = planQuestions(plannedAi, [], answered, { limit: 3, excludeSkipped: true })
check('同轮去重：已答的「证据」题被排除', !plan1.some((p) => questionSignature(p.question) === questionSignature(it2.question)))
check('同轮去重：问过的「假设」题被排除', !plan1.some((p) => questionSignature(p.question) === questionSignature(it1.question)))
check('保留新问题', plan1.some((p) => p.question.includes('水质')))
const plan2 = planQuestions(plannedAi, [], skipped, { limit: 3, excludeSkipped: false })
check('正文大改后跳过的题允许重出', plan2.some((p) => questionSignature(p.question) === questionSignature(it3.question)))
const plan3 = planQuestions(plannedAi, [], answered, { limit: 3, excludeSkipped: false })
check('无论正文怎么改已答的题都不重出', !plan3.some((p) => questionSignature(p.question) === questionSignature(it2.question)))
// 模型一道不给 → 题库兜底
const bankPlan = planQuestions(null, defaultBank().questions, newSession('n2', 'x', NOW), { limit: 3, excludeSkipped: true })
check('模型无产出时题库兜底 3 题', bankPlan.length === 3 && bankPlan.every((p) => p.source === 'bank' && p.bankId))
check('兜底题签名互不相同', new Set(bankPlan.map((p) => questionSignature(p.question))).size === 3)
const reworded: PlannedQuestion = { question: '结论 有实验数据 支撑吗？？', why: 'c', category: 'evidence', source: 'ai' }
check('换措辞重复已答题仍被排除', !planQuestions([reworded], [], answered, { limit: 3, excludeSkipped: true }).length)

// ---------- 模型输出校验 ----------

console.log('模型输出：校验与容错')
const goodJson = JSON.stringify({
  questions: [
    { category: 'concept', question: '笔记中「信道冲激响应」的定义是否与所用模型一致？', why: '术语一致是复现的前提' },
    { category: 'contribution', question: '这道题类别不存在应被丢弃', why: '容错测试' },
    { category: 'method', question: '对照组的参数设置记录完整吗？', why: '方法完整性' },
  ],
})
const parsedGood = parseGenerationOutput(goodJson)
check('合法项保留、非法类别逐项丢弃', parsedGood.ok && parsedGood.questions.length === 2, parsedGood)
const parsedFence = parseGenerationOutput('```json\n' + goodJson + '\n```')
check('支持 markdown 代码块包裹', parsedFence.ok && parsedFence.questions.length === 2)
check('纯文本报错并给预览', !parseGenerationOutput('我没有输出JSON').ok)
check('缺 questions 数组报错', !parseGenerationOutput('{"foo":1}').ok)
check('全非法整批失败', !parseGenerationOutput('{"questions":[{"category":"bad","question":"短","why":"x"}]}').ok)

// ---------- prompt 构造与隐私边界 ----------

console.log('prompt：材料边界与截断')
const longNote = note('n3', '长文', '字'.repeat(20_000))
const gen = buildGenerationPrompt({
  note: longNote,
  topic: '',
  bankCandidates: defaultBank().questions.slice(0, 3),
  excludeTexts: ['已问过的问题A？'],
})
check('生成 prompt 不含超长正文', gen.prompt.length < 11_000 && gen.prompt.includes('（中间省略'))
check('排除清单进入 prompt', gen.prompt.includes('已问过的问题A？'))
check('题库候选进入 prompt', gen.prompt.includes('题库候选'))
check('类别说明进入 prompt', gen.prompt.includes(CATEGORY_LABEL.concept))
const trunc = truncateNoteContent(longNote.content)
check('截断标记省略字数', trunc.truncated && trunc.text.includes('省略'))

const active = note('n4', '当前', '正文')
const rel = note('n5', '相关', '相关正文')
const other = note('n6', '无关', '绝密内容')
const dd = buildDeepDivePrompt({
  note: active,
  items: [
    {
      id: 'i1', round: 1, question: 'Q1？', why: '', category: 'concept', source: 'ai', signature: 'q1',
      status: 'answered', draft: '草稿回答', inserted: false, model: '', createdAt: 1, updatedAt: 2,
    },
  ],
  relatedNotes: [rel],
  task: '比较两篇的矛盾',
})
check('深入分析只含当前+勾选笔记', dd.prompt.includes('当前') && dd.prompt.includes('相关正文') && !dd.prompt.includes(other.title) && !dd.prompt.includes(other.content))
check('深入分析含问答草稿', dd.prompt.includes('草稿回答'))
check('材料 id 去重且只含授权', deepDiveMaterialIds('n4', new Set(['n5', 'n4'])) .join(',') === 'n4,n5')

// ---------- 路由 ----------

console.log('路由：本地失败绝不回退云端')
const okDecision = decideGenerate({ baseUrl: 'http://127.0.0.1:11434/', model: 'qwen3.5:4b' }, { configured: true, models: ['qwen3.5:4b'] })
check('本地就绪 → 走 ollama', okDecision.ok && okDecision.provider === 'ollama' && okDecision.baseUrl === 'http://127.0.0.1:11434')
check('baseUrl 剥尾部斜杠、空串回默认', decideGenerate({ baseUrl: '', model: 'm' }, { configured: true }).ok === true)
const noModel = decideGenerate({ baseUrl: '', model: '  ' }, { configured: true })
check('未配置模型名 → 明确报错', !noModel.ok && noModel.error.includes('未配置'))
const localDown = decideGenerate({ baseUrl: '', model: 'm' }, { configured: false, error: 'Ollama 不可达' })
check('本地不可达 → 明确报错', !localDown.ok && localDown.error.includes('Ollama 不可达'))
check('报错信息声明不切云端', !localDown.ok && localDown.error.includes('不会改用云端'))
check('网关不存在 → 报错', !decideGenerate({ baseUrl: '', model: 'm' }, undefined).ok)
const ddOk = decideDeepDive('deepseek', { deepseek: { configured: true }, kimi: { configured: false } })
check('深入分析用选定云端提供方', ddOk.ok && ddOk.provider === 'deepseek')
check('云端未配置 → 报错', !decideDeepDive('kimi', { kimi: { configured: false, error: '无 key' } }).ok)

// ---------- 插入段落 ----------

console.log('插入：段落格式')
const insertMd = buildInsertSection([
  {
    id: 'i1', round: 1, question: '信道假设是什么？', why: '假设决定适用范围', category: 'method', source: 'ai', signature: 's',
    status: 'answered', draft: '准静态假设。', inserted: false, model: '', createdAt: 1, updatedAt: 2,
  },
])
check('段落含标题/问题/价值/回答', insertMd.includes('## 研究追问') && insertMd.includes('信道假设是什么？') && insertMd.includes('假设决定适用范围') && insertMd.includes('准静态假设'))
check('追加到正文末尾', appendToContent('第一段。\n\n', insertMd).endsWith('准静态假设。\n'))
check('空正文也能插入', appendToContent('', insertMd) === insertMd + '\n')

console.log(`\n研究追问纯逻辑回归：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
