import { useEffect, useMemo, useState } from 'react'
import { NOTE_TYPE_META, GRADE_META } from '@/types/note'
import type { Note } from '@/types/note'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, FolderOpen, Plus, Search } from 'lucide-react'
import { readSetting, writeSetting } from '@/lib/env'

interface Props {
  notes: Note[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}

const COLLAPSE_KEY = 'collapsed-types-v1'
/** 文献分类树的展开状态（默认折叠，避免 2000+ 条目一屏刷出） */
const LIT_EXPAND_KEY = 'expanded-lit-collections-v1'
const UNCATEGORIZED = '未分类'

/** Zotero 分类树：collections 是 "父/子/…" 路径；一篇文献可属于多个分类 */
interface LitTree {
  name: string
  children: Map<string, LitTree>
  notes: Note[]
  /** 子树内唯一笔记数（同一篇出现在多个子分类时只算一次） */
  count: number
}

function buildLitTree(items: Note[]): LitTree {
  const root: LitTree = { name: '', children: new Map(), notes: [], count: 0 }
  const insert = (paths: string[], note: Note) => {
    const seen = new Set<string>()
    for (const raw of paths) {
      const segs = raw.split('/').map((s) => s.trim()).filter(Boolean)
      const key = segs.join('/') || UNCATEGORIZED
      if (seen.has(key)) continue
      seen.add(key)
      let node = root
      for (const seg of segs.length ? segs : [UNCATEGORIZED]) {
        let child = node.children.get(seg)
        if (!child) {
          child = { name: seg, children: new Map(), notes: [], count: 0 }
          node.children.set(seg, child)
        }
        node = child
      }
      node.notes.push(note)
    }
  }
  for (const n of items) {
    const paths = n.literature?.collections ?? []
    insert(paths.length ? paths : [UNCATEGORIZED], n)
  }
  // 计数 = 子树内唯一笔记数（Set 去重后再写回，避免多分类重复计数）
  const recount = (node: LitTree): Set<string> => {
    const ids = new Set(node.notes.map((n) => n.id))
    node.children.forEach((child) => recount(child).forEach((id) => ids.add(id)))
    node.count = ids.size
    return ids
  }
  recount(root)
  // 组内按更新时间倒序
  const sortDeep = (node: LitTree) => {
    node.notes.sort((a, b) => b.updatedAt - a.updatedAt)
    node.children.forEach(sortDeep)
  }
  sortDeep(root)
  return root
}

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
  const [litExpanded, setLitExpanded] = useState<Set<string>>(() => {
    try {
      const raw = readSetting(LIT_EXPAND_KEY)
      if (raw) return new Set(JSON.parse(raw) as string[])
    } catch {
      /* ignore */
    }
    return new Set()
  })

  useEffect(() => {
    writeSetting(COLLAPSE_KEY, JSON.stringify([...collapsed]))
  }, [collapsed])

  useEffect(() => {
    writeSetting(LIT_EXPAND_KEY, JSON.stringify([...litExpanded]))
  }, [litExpanded])

  const toggleGroup = (type: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const toggleLit = (key: string) => {
    setLitExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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

  // 文献分类树按（过滤后）条目集缓存，避免每次渲染重建
  const litTrees = useMemo(() => {
    const map = new Map<string, LitTree>()
    for (const [type, items] of filtered) {
      if (type === 'literature') map.set(type, buildLitTree(items))
    }
    return map
  }, [filtered])

  const renderNoteItem = (n: Note) => (
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
  )

  /** 渲染分类树（跳过树根：树根没有名字，只渲染它的子分类与直属条目） */
  const renderLitTree = (root: LitTree): React.ReactNode => (
    <div key="literature/tree">
      {[...root.children.values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
        .map((child) => renderLitNode(child, [child.name], 0))}
      {root.notes.map(renderNoteItem)}
    </div>
  )

  /** 递归渲染文献分类树；搜索时无视折叠全部展开 */
  const renderLitNode = (node: LitTree, path: string[], depth: number): React.ReactNode => {
    const key = `literature/${path.join('/')}`
    const expanded = searching || litExpanded.has(key)
    return (
      <div key={key}>
        <button
          type="button"
          onClick={() => toggleLit(key)}
          title={expanded ? '收起该分类' : '展开该分类'}
          className="mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <FolderOpen className="h-3 w-3 shrink-0" />
          <span className="min-w-0 truncate">{node.name}</span>
          <span className="text-muted-foreground/60">({node.count})</span>
        </button>
        {expanded && (
          <div>
            {[...node.children.values()]
              .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
              .map((child) => renderLitNode(child, [...path, child.name], depth + 1))}
            {node.notes.map(renderNoteItem)}
          </div>
        )}
      </div>
    )
  }

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
                className="mb-1 flex min-h-11 w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted md:min-h-0"
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
                (type === 'literature' && litTrees.has(type)
                  ? renderLitTree(litTrees.get(type)!)
                  : items.map(renderNoteItem))}
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
