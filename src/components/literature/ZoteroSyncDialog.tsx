/**
 * Zotero 分类同步弹窗：选库 → 只读读取 → 预览计划 → 确认应用（调用方负责写库）。
 * 读取与门槛判定在 `zoteroSyncFlow`（纯函数，可单测）；匹配规则来自冻结的 zotero-rules。
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Note } from '@/types/note'
import type { ZoteroSyncPlan, ZoteroSyncUpdate } from '@/lib/zoteroSync'
import { applyAction, hasHiddenUpdates, previewUpdates, readAction, readSyncPlan } from './zoteroSyncFlow'

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
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<ZoteroSyncPlan | null>(null)

  const desktop = typeof window !== 'undefined' ? window.knowledgeGraphDesktop : undefined
  /** 本地网页端：库路径由服务端启动参数固定，页面改不了 */
  const fixedByServer = Boolean(desktop?.isLocalWeb)

  const run = async () => {
    if (busy) return
    setBusy(true)
    setPlan(null)
    try {
      setPlan(await readSyncPlan(desktop, dbPath, notes))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '读取 Zotero 失败')
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setPlan(null)
    onClose()
  }

  const read = readAction(busy, dbPath)
  const apply = plan ? applyAction(plan) : null

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>同步 Zotero 分类</DialogTitle>
        </DialogHeader>
        {!desktop ? (
          <p className="text-sm text-muted-foreground">仅桌面版可用：请在 Electron 应用内使用。</p>
        ) : !plan ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              只读打开本机 Zotero 数据库，按 Zotero key / DOI / 标题匹配文献笔记，同步 Zotero 分类（与已有分类取并集，历史占位「未分类」会被清掉，没有真实分类时界面动态显示「未分类」）并自动补充「期刊:」「年份:」标签、清掉旧版「方向:」标签，同时刷新 Zotero key 与 PDF 状态。
              <strong className="text-foreground">请先把 Zotero 完全退出</strong>，否则会因数据库锁定而失败。
            </p>
            {fixedByServer ? (
              <p className="rounded border bg-muted/40 p-2 font-mono text-xs break-all">{dbPath || '（未配置）'}</p>
            ) : (
              <Input
                value={dbPath}
                onChange={(e) => onDbPathChange(e.target.value)}
                placeholder="zotero.sqlite 的完整路径"
                className="font-mono text-xs"
              />
            )}
          </div>
        ) : (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              匹配到 {plan.matchedCount} 篇文献笔记；其中 {plan.updates.length} 篇需要更新分类或标签。
            </p>
            <p>Zotero 中有 {plan.unmatchedZotero.length} 条带题名的条目在本库没有对应笔记（忽略即可，不会创建）。</p>
            {plan.updates.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-auto rounded border p-2 text-xs">
                {previewUpdates(plan).map((u) => {
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
                {hasHiddenUpdates(plan) && <li>…… 共 {plan.updates.length} 条，其余从略</li>}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            取消
          </Button>
          {!plan ? (
            <Button onClick={() => void run()} disabled={read.disabled}>
              {read.label}
            </Button>
          ) : (
            <Button onClick={() => onApply(plan.updates)} disabled={apply?.disabled}>
              {apply?.label}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
