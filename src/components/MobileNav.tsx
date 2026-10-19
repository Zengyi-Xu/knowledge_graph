/**
 * 手机端（<768px）底部主导航。
 *
 * 桌面/平板（≥768px）不渲染它 —— 那两端继续用顶部的 Tabs 与左侧列表栏。
 * 每个标签都是 ≥44px 的触摸目标；`data-testid` 供响应式验证脚本断言。
 */
import { BookOpen, Network, NotebookText, Settings2 } from 'lucide-react'

export type MobileTab = 'notes' | 'graph' | 'literature' | 'settings'

const ITEMS: { tab: MobileTab; label: string; Icon: typeof NotebookText }[] = [
  { tab: 'notes', label: '笔记', Icon: NotebookText },
  { tab: 'graph', label: '图谱', Icon: Network },
  { tab: 'literature', label: '文献', Icon: BookOpen },
  { tab: 'settings', label: '存储', Icon: Settings2 },
]

interface Props {
  active: MobileTab
  onSelect: (tab: MobileTab) => void
}

export function MobileTabBar({ active, onSelect }: Props) {
  return (
    <nav
      aria-label="主导航"
      data-testid="mobile-tabbar"
      className="kg-safe-bottom flex shrink-0 items-stretch border-t bg-card md:hidden"
    >
      {ITEMS.map(({ tab, label, Icon }) => {
        const isActive = tab === active
        return (
          <button
            key={tab}
            type="button"
            data-testid={`mobile-tab-${tab}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(tab)}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors ${
              isActive ? 'text-primary' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            {label}
          </button>
        )
      })}
    </nav>
  )
}
