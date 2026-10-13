import type { Note, NoteType } from '@/types/note'
import { NOTE_TYPE_META } from '@/types/note'
import { TYPE_FOLDERS } from '@/lib/vaultFormat'
import { Button } from '@/components/ui/button'

interface Props {
  note: Note
  to: NoteType
  onCancel: () => void
  onConfirm: () => void
}

/** 改类型时的确认弹窗：确认后笔记连同文件一起迁移到新类型的文件夹 */
export function FolderMoveDialog({ note, to, onCancel, onConfirm }: Props) {
  const from = note.type
  const fromFolder = TYPE_FOLDERS[from] ?? ''
  const toFolder = TYPE_FOLDERS[to] ?? ''
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-5 shadow-lg">
        <h2 className="mb-2 text-base font-semibold">迁移笔记</h2>
        <p className="text-sm text-muted-foreground">
          类型：{NOTE_TYPE_META[from].label} → {NOTE_TYPE_META[to].label}
        </p>
        <p className="mt-3 text-sm">
          将把 <code className="rounded bg-muted px-1 py-0.5">{`${fromFolder}\\${note.title}.md`}</code> 迁移到{' '}
          <code className="rounded bg-muted px-1 py-0.5">{`${toFolder}\\${note.title}.md`}</code>。
        </p>
        <p className="mt-2 text-xs text-muted-foreground">取消则保持原类型、原位置不变。</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={onConfirm}>
            迁移
          </Button>
        </div>
      </div>
    </div>
  )
}
