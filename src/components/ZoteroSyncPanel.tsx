/**
 * Zotero 分类同步：选库 → 只读读取 → 预览计划 → 确认应用。
 * ZoteroSyncPanel 是纯内容+操作区（可嵌入任意容器，如「高级」对话框）；
 * ZoteroSyncDialog 是它的弹窗包装（文献视图工具栏入口使用）。
 * 只读打开本机 Zotero 数据库，按 key / DOI / 标题匹配文献笔记，取分类并集、
 * 清历史占位「未分类」、补「方向:」「期刊:」「年份:」标签、刷新 key 与 PDF 状态。
 */
import { useState } from 'react'
import { toast } from 'sonner'
import type { Note } from '@/types/note'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { planZoteroSync, type ZoteroSyncPlan, type ZoteroSyncUpdate } from '@/lib/zoteroSync'

export function ZoteroSyncPanel({
  notes,
  dbPath,
  onDbPathChange,
  onApply,
  onCancel,
}: {
  notes: Note[]
  dbPath: string
  onDbPathChange: (value: string) => void
  onApply: (updates: ZoteroSyncUpdate[]) => void
  onCancel?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<ZoteroSyncPlan | null>(null)

  const desktop = typeof window !== 'undefined' ? window.knowledgeGraphDesktop : undefined
  /** 本地网页端：库路径由服务端启动参数固定，页面改不了 */
  const fixedByServer = Boolean(desktop?.isLocalWeb)

  const run = async () => {
    if (!desktop || busy) return
    setBusy(true)
    setPlan(null)
    try {
      const data = await desktop.readZotero(dbPath.trim())
      setPlan(planZoteroSync(data.items, notes))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '读取 Zotero 失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {!desktop ? (
        <p className="text-sm text-muted-foreground">仅桌面版可用：请在 Electron 应用内使用。</p>
      ) : !plan ? (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>只读打开本机 Zotero 数据库，按 Zotero key / DOI / 标题匹配文献笔记，同步 Zotero 分类（与已有分类取并集，历史占位「未分类」会被清掉，没有真实分类时界面动态显示「未分类」）并自动补充「期刊:」「年份:」标签、清掉旧版「方向:」标签，同时刷新 Zotero key 与 PDF 状态。<strong className="text-foreground">请先把 Zotero 完全退出</strong>，否则会因数据库锁定而失败。</p>
          {fixedByServer ? (
            <p className="rounded border bg-muted/40 p-2 font-mono text-xs break-all">{dbPath || '（未配置）'}</p>
          ) : (
            <Input
              value={dbPath}
              onChange={(e) => onDbPathChange(e.target.value)}
              placeholder="Zotero 数据库（zotero.sqlite）的完整路径"
              className="font-mono text-xs"
            />
          )}
        </div>
      ) : (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>匹配到 {plan.matchedCount} 篇文献笔记；其中 {plan.updates.length} 篇需要更新分类或标签。</p>
          <p>Zotero 中有 {plan.unmatchedZotero.length} 条带题名的条目在本库没有对应笔记（忽略即可，不会创建）。</p>
          {plan.updates.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-auto rounded border p-2 text-xs">
              {plan.updates.slice(0, 50).map((u) => {
                const note = notes.find((n) => n.id === u.noteId)
                return (
                  <li key={u.noteId}>
                    <span className="font-medium text-foreground">{note?.title ?? u.noteId}</span>
                    {u.collections.length > 0 && <span>{' · 分类 → '}{u.collections.join('；')}</span>}
                    {u.tagsToAdd.length > 0 && <span>{' · +标签 '}{u.tagsToAdd.map((t) => `#${t}`).join(' ')}</span>}
                    {u.tagsToRemove.length > 0 && <span>{' · −标签 '}{u.tagsToRemove.map((t) => `#${t}`).join(' ')}</span>}
                  </li>
                )
              })}
              {plan.updates.length > 50 && <li>…… 共 {plan.updates.length} 条，其余从略</li>}
            </ul>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="outline" onClick={onCancel}>取消</Button>}
        {!plan ? (
          <Button onClick={() => void run()} disabled={busy || !dbPath.trim()}>
            {busy ? '读取中…' : '读取并预览'}
          </Button>
        ) : (
          <Button onClick={() => onApply(plan.updates)} disabled={plan.updates.length === 0}>
            应用 {plan.updates.length} 条更新
          </Button>
        )}
      </div>
    </div>
  )
}

export function ZoteroSyncDialog({
  open,
  notes,
  dbPath,
  onDbPathChange,
  onClose,
  onApply,
}: {
  open: boolean
  notes: Note[]
  dbPath: string
  onDbPathChange: (value: string) => void
  onClose: () => void
  onApply: (updates: ZoteroSyncUpdate[]) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>同步 Zotero 分类</DialogTitle>
        </DialogHeader>
        <ZoteroSyncPanel
          notes={notes}
          dbPath={dbPath}
          onDbPathChange={onDbPathChange}
          onApply={onApply}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  )
}
