/**
 * DOI / arXiv 导入弹窗：按输入形态自动判断走哪个源（arXiv 编号 → arXiv API，其余 → CrossRef/DOI）。
 * 元数据抓取走 `@/lib/literature`（动态 import，首屏不加载引文引擎）。
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ImportedLit } from '@/lib/literature'
import { looksLikeArxivId } from './importInput'

export function DoiImportDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean
  onClose: () => void
  onImport: (items: ImportedLit[]) => void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    const id = value.trim()
    if (!id || busy) return
    setBusy(true)
    try {
      const { importFromArxiv, importFromDoi } = await import('@/lib/literature')
      const lit = looksLikeArxivId(id) ? await importFromArxiv(id) : await importFromDoi(id)
      onImport([lit])
      setValue('')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>按 DOI / arXiv 导入</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>输入 DOI（如 10.1038/s41586-020-2649-2）或 arXiv 编号（如 2401.12345），自动抓取元数据并创建文献笔记。</p>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void run()}
            placeholder="10.xxxx/xxxx 或 2401.12345"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void run()} disabled={busy || !value.trim()}>
            {busy ? '导入中…' : '导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
