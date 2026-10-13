import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NoteEditor } from '../src/components/NoteEditor'
import type { Note } from '../src/types/note'

const sample = '# 中文标题\n\n**粗体** *斜体* ~~删除线~~ `行内代码`\n\n- [ ] 待办任务\n- [x] 已完成\n\n> 引用文本\n\n| A | B |\n| --- | --- |\n| 文本 | 123 |\n\n```ts\nconst value = "[[保留]]"\n\n// 空行保留\n```\n\n---\n\n[[已有笔记]] [[尚未存在]]\n\n[外部链接](https://example.com) ![小图](/tiny.svg)\n'
const base = { id: 'self', title: '编辑器验收', content: sample, type: 'other', grade: '', tags: [], createdAt: 1, updatedAt: 1 } as Note
const notes = [base, { ...base, id: 'existing', title: '已有笔记' }, { ...base, id: 'cn', title: '中文候选' }]
const events: string[] = []
function Fixture() {
  const [note, setNote] = useState(base)
  const [mount, setMount] = useState(true)
  Object.assign(window, { fixture: { sample, note, events, setContent: (content: string) => setNote((n) => ({ ...n, content })), remount: () => { setMount(false); setTimeout(() => setMount(true), 0) } } })
  return mount && <NoteEditor note={note} allNotes={notes} onChange={(patch) => setNote((n) => ({ ...n, ...patch }))} onDelete={() => {}} onOpenNote={(id) => events.push(`open:${id}`)} onCreateNote={(title) => events.push(`create:${title}`)} />
}
createRoot(document.getElementById('root')!).render(<Fixture />)
