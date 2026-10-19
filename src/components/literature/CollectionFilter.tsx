/**
 * 分类筛选：折叠树下拉。
 *
 * radix `Select` 只能放平铺列表，分类深达三级时几十项挤在一起看不出层级；这里改成
 * 「默认只显示一级分类，按 ▸ 逐级展开子目录」，点名字才筛选。
 * 筛选值 = 完整路径，选中某个分类会连带它的整棵子树（`matchesCollectionFilter`）。
 */
import { useState } from 'react'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ALL_COLLECTIONS, NO_COLLECTION, type CollectionNode } from './collectionTree'

export interface CollectionFilterProps {
  value: string
  /** 分类折叠树（一级节点；子节点按需展开） */
  tree: CollectionNode[]
  /** 「未分类」篇数（动态状态，不进树） */
  none: number
  /** 当前选中分类的子树篇数 */
  selectedCount?: number
  onChange: (path: string) => void
}

/** 折叠缩进：一级 4px，每层 +14px（与树的层级对应） */
const indentOf = (depth: number) => ({ paddingLeft: `${4 + depth * 14}px` })

export function CollectionFilter({ value, tree, none, selectedCount, onChange }: CollectionFilterProps) {
  const [open, setOpen] = useState(false)
  /** 展开的路径集合（默认全折叠：一屏几十个分类反而看不清） */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const label =
    value === ALL_COLLECTIONS
      ? '全部分类'
      : value === NO_COLLECTION
        ? `未分类（${none}）`
        : `${value}${selectedCount === undefined ? '' : `（${selectedCount}）`}`

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const pick = (path: string) => {
    onChange(path)
    setOpen(false)
    setExpanded(new Set())
  }

  const mark = (v: string) => (value === v ? <Check className="h-3.5 w-3.5 shrink-0" /> : null)

  /** 「全部分类」「未分类」：没有子目录，也就没有展开箭头 */
  const plainRow = (v: string, text: string) => (
    <button
      key={v}
      type="button"
      data-collection={v}
      onClick={() => pick(v)}
      className={`flex w-full min-w-0 items-center gap-1 rounded-sm px-2 py-1 text-left text-xs hover:bg-accent ${
        value === v ? 'font-medium' : ''
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {mark(v)}
    </button>
  )

  const renderNode = (node: CollectionNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0
    const isOpen = expanded.has(node.path)
    return (
      <div key={node.path}>
        <div className="flex min-w-0 items-center gap-0.5 rounded-sm hover:bg-accent" style={indentOf(depth)}>
          {hasChildren ? (
            <button
              type="button"
              data-expand={node.path}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? '收起' : '展开'} ${node.name}`}
              onClick={() => toggle(node.path)}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted"
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" aria-hidden />
          )}
          <button
            type="button"
            data-collection={node.path}
            onClick={() => pick(node.path)}
            className={`flex min-w-0 flex-1 items-center gap-1 px-1 py-1 text-left text-xs ${
              value === node.path ? 'font-medium' : ''
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            <span className="shrink-0 text-muted-foreground/70">（{node.count}）</span>
            {mark(node.path)}
          </button>
        </div>
        {hasChildren && isOpen && <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>}
      </div>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setExpanded(new Set())
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="按分类筛选"
          title="按分类筛选（逐级展开子目录）"
          className="flex h-7 w-[210px] items-center justify-between gap-1 rounded-md border border-input bg-transparent px-3 text-xs shadow-xs hover:bg-accent"
        >
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-1">
        <div className="max-h-72 overflow-y-auto">
          {plainRow(ALL_COLLECTIONS, '全部分类')}
          {plainRow(NO_COLLECTION, `未分类（${none}）`)}
          {tree.map((node) => renderNode(node, 0))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
