/**
 * BibTeX / RIS 粘贴导入弹窗：支持多条，逐条创建（citekey 撞名由调用方补后缀）。
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ImportedLit } from '@/lib/literature'

export function BibImportDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean
  onClose: () => void
  onImport: (items: ImportedLit[]) => void
}) {
  const [text, setText] = useState('')

  const run = async () => {
    try {
      const { parseCitationText } = await import('@/lib/literature')
      const items = await parseCitationText(text)
      if (!items.length) {
        toast.error('没有解析到文献条目，请检查 BibTeX / RIS 文本')
        return
      }
      onImport(items)
      setText('')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入 BibTeX / RIS</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>粘贴 BibTeX 或 RIS 文本，支持多条，逐条创建文献笔记（重复 citekey 自动追加后缀）。</p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'@article{zhang2024silicon,\n  title={...},\n  author={...},\n  year={2024}\n}'}
            className="min-h-48 font-mono text-xs"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void run()} disabled={!text.trim()}>
            导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
