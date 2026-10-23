/**
 * 问题库管理：搜索 / 新增 / 编辑 / 启停 / 删除。
 * 题库是「通用研究问题」的长期库 —— 只有用户主动收藏或手动新增的问题才会进来。
 */
import { useMemo, useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { uid } from '@/types/note'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  RESEARCH_CATEGORIES,
  CATEGORY_LABEL,
  researchQuestionSchema,
  type ResearchBankFile,
  type ResearchQuestion,
} from '@/lib/research/bank'

interface Props {
  open: boolean
  onClose: () => void
  bank: ResearchBankFile
  onChange: (next: ResearchBankFile) => void
}

const SOURCE_LABEL: Record<ResearchQuestion['source'], string> = {
  builtin: '内置',
  'ai-favorite': 'AI 收藏',
  manual: '手动',
}

const EMPTY_FORM = { text: '', why: '', category: 'concept' as ResearchQuestion['category'] }

export function ResearchBankDialog({ open, onClose, bank, onChange }: Props) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ResearchQuestion | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = [...bank.questions].sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.updatedAt - a.updatedAt)
    if (!q) return list
    return list.filter(
      (it) => it.text.toLowerCase().includes(q) || it.why.toLowerCase().includes(q) || CATEGORY_LABEL[it.category].includes(q),
    )
  }, [bank.questions, search])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setFormError('')
    setEditing(null)
    setCreating(true)
  }

  const openEdit = (q: ResearchQuestion) => {
    setForm({ text: q.text, why: q.why, category: q.category })
    setFormError('')
    setCreating(false)
    setEditing(q)
  }

  const saveForm = () => {
    const text = form.text.trim()
    if (text.length < 4) {
      setFormError('题干至少 4 个字')
      return
    }
    const now = Date.now()
    if (editing) {
      const parsed = researchQuestionSchema.safeParse({ ...editing, text, why: form.why.trim(), category: form.category, updatedAt: now })
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? '校验失败')
        return
      }
      onChange({ ...bank, questions: bank.questions.map((q) => (q.id === editing.id ? parsed.data : q)) })
    } else {
      const parsed = researchQuestionSchema.safeParse({
        id: uid(),
        text,
        why: form.why.trim(),
        category: form.category,
        noteTypes: null,
        topics: [],
        tags: [],
        source: 'manual',
        createdAt: now,
        updatedAt: now,
      })
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? '校验失败')
        return
      }
      onChange({ ...bank, questions: [...bank.questions, parsed.data] })
    }
    setCreating(false)
    setEditing(null)
  }

  const toggle = (q: ResearchQuestion, enabled: boolean) => {
    onChange({ ...bank, questions: bank.questions.map((it) => (it.id === q.id ? { ...it, enabled, updatedAt: Date.now() } : it)) })
  }

  const remove = (q: ResearchQuestion) => {
    onChange({ ...bank, questions: bank.questions.filter((it) => it.id !== q.id) })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>研究问题库（{bank.questions.length} 题）</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索题干 / 说明 / 类别" className="h-8 pl-7 text-xs" />
          </div>
          <Button size="sm" className="h-8 px-2 text-xs" onClick={openCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" /> 新增问题
          </Button>
        </div>

        {(creating || editing) && (
          <div className="space-y-2 rounded-lg border p-3">
            <Textarea
              value={form.text}
              onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
              rows={2}
              placeholder="题干（通用提问角度，生成时模型会结合笔记内容改写）"
              className="text-xs"
              aria-label="题干"
            />
            <Textarea
              value={form.why}
              onChange={(e) => setForm((f) => ({ ...f, why: e.target.value }))}
              rows={2}
              placeholder="为什么值得问（可选）"
              className="text-xs"
              aria-label="说明"
            />
            <div className="flex items-center gap-2">
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v as ResearchQuestion['category'] }))}>
                <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="类别">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESEARCH_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 px-2 text-xs" onClick={saveForm}>保存</Button>
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => { setCreating(false); setEditing(null) }}>
                取消
              </Button>
            </div>
            {formError && <p className="text-xs text-destructive">{formError}</p>}
          </div>
        )}

        <div className="max-h-[46vh] space-y-1.5 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {bank.questions.length ? '没有匹配的问题' : '题库是空的：在追问面板里收藏 AI 问题，或在这里手动新增。'}
            </p>
          )}
          {filtered.map((q) => (
            <div key={q.id} className={`rounded-lg border p-2 ${q.enabled ? '' : 'opacity-50'}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant="secondary" className="text-[10px]">{CATEGORY_LABEL[q.category]}</Badge>
                    <Badge variant="outline" className="text-[10px]">{SOURCE_LABEL[q.source]}</Badge>
                    <span className="text-[10px] text-muted-foreground">
                      用 {q.usedCount} · 答 {q.answeredCount} · 收藏 {q.favoriteCount} · 跳过 {q.skippedCount}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm leading-snug">{q.text}</p>
                  {q.why && <p className="mt-0.5 text-xs text-muted-foreground">{q.why}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch checked={q.enabled} onCheckedChange={(v) => toggle(q, v)} aria-label={`启用 ${q.text.slice(0, 12)}`} />
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openEdit(q)}>编辑</Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="删除" onClick={() => remove(q)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <p className="mr-auto text-left text-[11px] text-muted-foreground">
            停用后不再参与出题；计数（用/答/收藏/跳过）会让题库逐步学会你的偏好。
          </p>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
