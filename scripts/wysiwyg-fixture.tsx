import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NoteEditor } from '../src/components/NoteEditor'
import type { Note } from '../src/types/note'

const sample = '# 中文标题\n\n**粗体** *斜体* ~~删除线~~ `行内代码`\n\n行内公式 $E=mc^2$；数字起始 $10\\log_{10}(64)=18$ dB。\n\n$$\n\\mathrm{TBP}_{\\mathrm{eff}}=T\\,B_{\\mathrm{det}}\n$$\n\n- [ ] 待办任务\n- [x] 已完成\n\n1. 有序列表第一项\n2. 有序列表第二项\n\n> 引用文本\n\n| A | B |\n| --- | --- |\n| 文本 | 123 |\n\n```ts\nconst value = "[[保留]]"\n\n// 空行保留\n```\n\n---\n\n[[已有笔记]] [[尚未存在]]\n\n[外部链接](https://example.com) ![小图](/tiny.svg)\n'
const base = { id: 'self', title: '编辑器验收', content: sample, type: 'other', grade: '', tags: [], createdAt: 1, updatedAt: 1 } as Note
const notes = [
  base,
  { ...base, id: 'existing', title: '已有笔记', tags: ['量子点激光器', '论文'] },
  { ...base, id: 'cn', title: '中文候选', tags: ['Laser', '量子点激光器'] },
]
const events: string[] = []
function Fixture() {
  const [note, setNote] = useState(base)
  const [mount, setMount] = useState(true)
  // flow = 真应用的单栏「笔记」视图：外层容器滚，头部/工具条/正文一起动
  const [flow, setFlow] = useState(false)
  Object.assign(window, {
    fixture: {
      sample, note, events,
      setContent: (content: string) => setNote((n) => ({ ...n, content })),
      remount: () => { setMount(false); setTimeout(() => setMount(true), 0) },
      setFlow,
      isFlow: () => flow,
    },
  })
  const editor = mount && <NoteEditor note={note} allNotes={notes} onChange={(patch) => setNote((n) => ({ ...n, ...patch }))} onDelete={() => {}} onOpenNote={(id) => events.push(`open:${id}`)} onCreateNote={(title) => events.push(`create:${title}`)} flow={flow} />
  return flow
    ? <div data-testid="flow-scroll" style={{ height: '100vh', overflowY: 'auto' }}>{editor}</div>
    : editor
}
createRoot(document.getElementById('root')!).render(<Fixture />)
