import { useEffect, useMemo, useRef, useState } from 'react'
import { NOTE_TYPE_META, GRADE_META } from '@/types/note'
import type { Note } from '@/types/note'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'
import { readSetting, writeSetting } from '@/lib/env'
import { groupByTopic, isTopicTag, NO_TOPIC, topicOf } from '@/lib/topics'
import { searchSnippet } from '@/lib/noteRelations'

interface Props {
  notes: Note[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}

const COLLAPSE_KEY = 'collapsed-types-v1'
const TOPIC_COLLAPSE_KEY = 'collapsed-topics-v1'
const GROUPING_KEY = 'note-grouping-v1'

type Grouping = 'type' | 'topic'

function readSet(key: string): Set<string> {
  try {
    const raw = readSetting(key)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {
    /* 坏数据按空集合处理 */
  }
  return new Set()
}

/**
 * 侧栏笔记列表：只列**非文献**笔记，可按「类型」或「主题」分组。
 *
 * 主题 = `主题:<名称>` 标签（约定见 src/lib/topics.ts）。文献（1896 篇）在这栏里
 * 一概不出现 —— 既不列条目，也不列分类树：一千多篇文献和左边几十条笔记混在一起
 * 抢版面，字号也对不齐。文献的分类只看一级，统一由「文献」视图的分类筛选承担
 * （`src/components/literature/collectionTree.ts`）。
 */
export function NoteList({ notes, activeId, onSelect, onCreate }: Props) {
  const [q, setQ] = useState('')
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  const [grouping, setGrouping] = useState<Grouping>(() =>
    readSetting(GROUPING_KEY) === 'topic' ? 'topic' : 'type',
  )
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readSet(COLLAPSE_KEY))
  const [collapsedTopics, setCollapsedTopics] = useState<Set<string>>(() => readSet(TOPIC_COLLAPSE_KEY))

  useEffect(() => {
    writeSetting(GROUPING_KEY, grouping)
  }, [grouping])

  useEffect(() => {
    writeSetting(COLLAPSE_KEY, JSON.stringify([...collapsed]))
  }, [collapsed])

  useEffect(() => {
    writeSetting(TOPIC_COLLAPSE_KEY, JSON.stringify([...collapsedTopics]))
  }, [collapsedTopics])

  // 图谱里点中节点 → 侧栏把对应笔记滚进视野（列表很长时只高亮看不见等于没做）。
  // 分组折叠 / 搜索把当前项过滤掉时没有可滚的节点，静默跳过。
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeId, grouping])

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleTopic = (key: string) => {
    setCollapsedTopics((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const searching = q.trim().length > 0
  const query = q.trim()

  /** 侧栏只关心非文献笔记；搜索覆盖标题 / 正文 / 标签 */
  const matched = useMemo(() => {
    const list = notes.filter((n) => n.type !== 'literature')
    if (!query) return list
    const lower = query.toLowerCase()
    return list.filter((n) => (n.title + n.content + n.tags.join(' ')).toLowerCase().includes(lower))
  }, [notes, query])

  /** 按类型分组，组内按更新时间倒序 */
  const typeGroups = useMemo(() => {
    const groups = new Map<string, Note[]>()
    for (const n of matched) {
      const g = groups.get(n.type) ?? []
      g.push(n)
      groups.set(n.type, g)
    }
    for (const g of groups.values()) g.sort((a, b) => b.updatedAt - a.updatedAt)
    return [...groups.entries()].sort(
      (a, b) =>
        Object.keys(NOTE_TYPE_META).indexOf(a[0]) - Object.keys(NOTE_TYPE_META).indexOf(b[0]),
    )
  }, [matched])

  /** 按主题分组（有主题在前，未归主题在最后），组内同样按更新时间倒序 */
  const topicGroups = useMemo(() => (grouping === 'topic' ? groupByTopic(matched) : []), [matched, grouping])

  const renderNoteItem = (n: Note) => {
    const snippet = searching ? searchSnippet(n.content, query) : null
    const topic = topicOf(n)
    return (
      <button
        key={n.id}
        ref={n.id === activeId ? activeItemRef : undefined}
        onClick={() => onSelect(n.id)}
        className={`note-item mb-0.5 block w-full min-w-0 rounded-md px-2.5 py-2 text-left text-sm transition-colors md:px-2 md:py-1.5 ${
          n.id === activeId ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-muted'
        }`}
      >
        <div className="note-item-title min-w-0">{n.title}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-muted-foreground md:truncate">
          {grouping === 'topic' && (
            <span className="shrink-0">
              [{NOTE_TYPE_META[n.type as keyof typeof NOTE_TYPE_META]?.label ?? '其他'}]
            </span>
          )}
          {grouping === 'type' && topic && <span className="shrink-0 text-primary/80">{topic}</span>}
          {n.type === 'person' && n.grade && (
            <span className="shrink-0">[{GRADE_META[n.grade as keyof typeof GRADE_META]}]</span>
          )}
          {n.tags
            .filter((t) => !isTopicTag(t))
            .slice(0, 3)
            .map((t, i) => (
              <span key={t} className={`truncate ${i > 0 ? 'hidden md:inline' : ''}`}>
                #{t}
              </span>
            ))}
        </div>
        {snippet && (
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground/90">
            {snippet.before}
            <mark className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-500/30">
              {snippet.match}
            </mark>
            {snippet.after}
          </div>
        )}
      </button>
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
        <div className="flex items-center gap-1 text-xs">
          <span className="mr-0.5 text-muted-foreground">分组</span>
          {(
            [
              ['type', '类型'],
              ['topic', '主题'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={grouping === key}
              onClick={() => setGrouping(key)}
              title={key === 'topic' ? '按主题（主题:标签）分组' : '按笔记类型分组'}
              className={`min-h-11 rounded-md border px-2 py-0.5 transition-colors md:min-h-0 md:py-1 ${
                grouping === key ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Button onClick={onCreate} className="h-11 w-full md:h-8" size="sm">
          <Plus className="mr-1 h-4 w-4" /> 新建笔记
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {searching ? (
          matched.length > 0 ? (
            <div className="mb-3">{[...matched].sort((a, b) => b.updatedAt - a.updatedAt).map(renderNoteItem)}</div>
          ) : (
            <p className="p-4 text-center text-sm text-muted-foreground">没有匹配的笔记</p>
          )
        ) : grouping === 'type' ? (
          typeGroups.map(([type, items]) => {
            // 未知 type（坏数据 / 旧版本写入）不能让整个列表白屏：退回「其他」
            const meta = NOTE_TYPE_META[type as keyof typeof NOTE_TYPE_META] ?? NOTE_TYPE_META.other
            const isCollapsed = collapsed.has(type)
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
                {!isCollapsed && items.map(renderNoteItem)}
              </div>
            )
          })
        ) : (
          topicGroups.map((group) => {
            const isCollapsed = collapsedTopics.has(group.key)
            const loose = group.key === NO_TOPIC
            return (
              <div key={group.key} className="mb-3">
                <button
                  type="button"
                  onClick={() => toggleTopic(group.key)}
                  title={isCollapsed ? '展开该主题' : '收起该主题'}
                  className="mb-1 flex min-h-11 w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted md:min-h-0"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  )}
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${loose ? 'bg-muted-foreground/40' : 'bg-primary/70'}`}
                  />
                  <span className={loose ? 'text-muted-foreground/70' : ''}>{group.label}</span>
                  <span className="text-muted-foreground/60">({group.notes.length})</span>
                </button>
                {!isCollapsed && group.notes.map(renderNoteItem)}
              </div>
            )
          })
        )}
        {!searching && matched.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">还没有笔记</p>
        )}
      </div>
    </div>
  )
}
