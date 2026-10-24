/**
 * 「最近笔记」纯逻辑回归：解析容错、去重置顶、顺序保持、上限截断、
 * 已删笔记过滤、node 环境无 localStorage 时读空。不碰 vault；运行：npm run test:recent
 */
import type { Note } from '@/types/note'
import {
  RECENT_PREVIEW_COUNT,
  RECENT_STORAGE_CAP,
  loadRecent,
  parseRecent,
  resolveRecent,
  touchRecent,
} from '@/lib/recentNotes'

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

function note(id: string, title: string): Note {
  return { id, title, type: 'other', grade: '', tags: [], content: '', createdAt: 1, updatedAt: 2 }
}

// ---------- 解析容错 ----------
check('空值解析为空表', parseRecent(null).length === 0)
check('坏 JSON 解析为空表', parseRecent('{oops').length === 0)
check('非数组解析为空表', parseRecent('{"a":1}').length === 0)
check('跳过缺字段条目', parseRecent(JSON.stringify([{ id: 'a', at: 1 }, { id: 'b' }, { at: 3 }, null])).length === 1)

// ---------- touchRecent ----------
const e = (id: string, at: number) => ({ id, at })
const list = [e('a', 1), e('b', 2)]
const touched = touchRecent(list, 'c', 10)
check('新 id 置最前', touched[0].id === 'c' && touched.length === 3)
check('重复 id 去重置顶', (() => { const l = touchRecent([e('a', 1), e('b', 2)], 'a', 5); return l.length === 2 && l[0].id === 'a' && l[0].at === 5 && l[1].id === 'b' })())
check('空 id 不记录', touchRecent(list, '').length === 2)
const same = touchRecent([e('a', 5), e('b', 2)], 'a', 5)
check('同值内容不变', same.length === 2 && same[0].id === 'a' && same[0].at === 5)
const capped = Array.from({ length: RECENT_STORAGE_CAP + 50 }, (_, i) => e(`n${i}`, i)).reverse()
const cappedNext = touchRecent(capped, 'new', 999_999)
check(`超出 ${RECENT_STORAGE_CAP} 截断`, cappedNext.length === RECENT_STORAGE_CAP && cappedNext[0].id === 'new')
check('预览条数为 7', RECENT_PREVIEW_COUNT === 7)

// ---------- resolveRecent ----------
const notes = [note('a', '甲'), note('b', '乙'), note('c', '丙')]
const resolved = resolveRecent([e('gone', 9), e('b', 2), e('a', 1)], notes)
check('保持打开顺序', resolved.length === 2 && resolved[0].note.id === 'b' && resolved[1].note.id === 'a')
check('附带打开时间', resolved[0].at === 2)
check('全部已删返回空', resolveRecent([e('x', 1), e('y', 2)], notes).length === 0)

// ---------- node 环境 ----------
check('node 环境读空表', loadRecent().length === 0)

console.log(`\n最近笔记纯逻辑回归：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
