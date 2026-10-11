import { useEffect, useMemo, useState } from 'react'
import { NOTE_TYPE_META, GRADE_META } from '@/types/note'
import type { Note } from '@/types/note'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'
import { readSetting, writeSetting } from '@/lib/env'

interface Props {
  notes: Note[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}

const COLLAPSE_KEY = 'collapsed-types-v1'

export function NoteList({ notes, activeId, onSelect, onCreate }: Props) {
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = readSetting(COLLAPSE_KEY)
      if (raw) return new Set(JSON.parse(raw) as string[])
    } catch {
      /* ignore */
    }
    return new Set()
  })

  useEffect(() => {
    writeSetting(COLLAPSE_KEY, JSON.stringify([...collapsed]))
  }, [collapsed])

  const toggleGroup = (type: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    const list = query
      ? notes.filter((n) => (n.title + n.content + n.tags.join(' ')).toLowerCase().includes(query))
      : notes
    // 按类型分组，组内按更新时间倒序
    const groups = new Map<string, Note[]>()
    for (const n of list) {
      const g = groups.get(n.type) ?? []
      g.push(n)
      groups.set(n.type, g)
    }
    for (const g of groups.values()) g.sort((a, b) => b.updatedAt - a.updatedAt)
    return [...groups.entries()].sort(
      (a, b) =>
        Object.keys(NOTE_TYPE_META).indexOf(a[0]) - Object.keys(NOTE_TYPE_META).indexOf(b[0]),
    )
  }, [notes, q])

  // 搜索时强制展开，避免结果藏在折叠分组里
  const searching = q.trim().length > 0

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索笔记…"
            className="h-11 pl-9 text-base md:h-9 md:pl-8 md:text-sm"
          />
        </div>
        <Button onClick={onCreate} className="h-11 w-full md:h-8" size="sm">
          <Plus className="mr-1 h-4 w-4" /> 新建笔记
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filtered.map(([type, items]) => {
          const meta = NOTE_TYPE_META[type as keyof typeof NOTE_TYPE_META]
          const isCollapsed = !searching && collapsed.has(type)
          return (
            <div key={type} className="mb-3">
              <button
                type="button"
                onClick={() => toggleGroup(type)}
                title={isCollapsed ? '展开该分组' : '收起该分组'}
                className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                )}
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.color }} />
                {meta.label}
                <span className="text-muted-foreground/60">({items.length})</span>
              </button>
              {!isCollapsed &&
                items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => onSelect(n.id)}
                    className={`note-item mb-0.5 block w-full min-w-0 rounded-md px-2.5 py-2 text-left text-sm transition-colors md:px-2 md:py-1.5 ${
                      n.id === activeId ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    <div className="note-item-title min-w-0">{n.title}</div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-muted-foreground md:truncate">
                      {n.type === 'person' && n.grade && (
                        <span className="shrink-0">[{GRADE_META[n.grade as keyof typeof GRADE_META]}]</span>
                      )}
                      {n.tags.slice(0, 3).map((t, i) => (
                        <span key={t} className={`truncate ${i > 0 ? 'hidden md:inline' : ''}`}>
                          #{t}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">没有匹配的笔记</p>
        )}
      </div>
    </div>
  )
}
