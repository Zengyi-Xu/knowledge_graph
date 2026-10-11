/**
 * 「AI 统筹」面板：任务模板 → 构造 prompt → 调本机 Kimi 网关 →
 * 校验 operations JSON → 逐条确认 → 交给调用方应用。
 * 模型只是提案者：校验失败整批拒绝并展示原因；解析不到目标的单条标记 ⚠ 不应用。
 */
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Sparkles, Stethoscope, Tags, FileText, RefreshCw } from 'lucide-react'
import type { Note } from '@/types/note'
import { Button } from '@/components/ui/button'
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
import { parseAiOperations, resolveOps, describeOp, type AiOperation } from '@/lib/aiOps'
import { buildTask, type AiTask } from '@/lib/aiPrompts'

type Phase =
  | { name: 'menu' }
  | { name: 'running'; label: string }
  | { name: 'confirm'; ops: AiOperation[]; lines: string[] }
  | { name: 'report'; markdown: string }
  | { name: 'error'; message: string; raw?: string }

interface Props {
  open: boolean
  onClose: () => void
  notes: Note[]
  /** 运行前快照（同步文件）；返回 false 则拒绝运行 */
  ensureSnapshot: () => Promise<boolean>
  /** 应用用户确认后的操作（create/update/retag） */
  onApply: (ops: AiOperation[]) => void
  /** 跳转到文献页（「同步 Zotero 分类」任务的入口在文献页工具栏） */
  onGoLiterature: () => void
  /** 外部指定的初始任务（如汇总笔记的「AI 更新」） */
  initialTask?: AiTask | null
}

const TASK_META = [
  { key: 'retag', icon: Tags, label: '整理文献标签 / 分类', desc: '按 Zotero 分类补全 方向:/期刊:/年份: 标签，修正错标（全库或按方向限定）' },
  { key: 'summary', icon: FileText, label: '生成方向汇总', desc: '选一个一级分类，产出「汇总」笔记：文献清单、趋势、Top-5' },
  { key: 'health', icon: Stethoscope, label: '图谱健康检查', desc: '孤儿文献、断链、疑似重复、缺汇总的方向（只读报告）' },
  { key: 'zotero', icon: RefreshCw, label: '同步 Zotero 分类', desc: '入口在文献页工具栏：读取本机 Zotero 库，为文献笔记同步分类' },
] as const

export function AiPanel({ open, onClose, notes, ensureSnapshot, onApply, onGoLiterature, initialTask }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: 'menu' })
  const [direction, setDirection] = useState('')
  const [status, setStatus] = useState<{ configured: boolean; model?: string; keyPreview?: string; error?: string }>({
    configured: false,
  })

  const desktop = typeof window !== 'undefined' ? window.knowledgeGraphDesktop : undefined
  const directions = useMemo(
    () => [...new Set(notes.filter((n) => n.type === 'literature').flatMap((n) => n.tags.filter((t) => t.startsWith('方向:'))))].sort(),
    [notes],
  )

  // 打开时：重置阶段、查询网关状态（脱敏）、外部指定任务直接跑
  useEffect(() => {
    if (!open) return
    setPhase({ name: 'menu' })
    setDirection('')
    if (!desktop?.aiStatus) {
      setStatus({ configured: false, error: '仅桌面版可用' })
      return
    }
    void desktop.aiStatus().then((s) => {
      setStatus(s.configured ? { configured: true, model: s.model, keyPreview: s.keyPreview } : { configured: false, error: s.error })
    })
  }, [open, desktop])

  useEffect(() => {
    if (open && initialTask) void run(initialTask)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTask])

  async function run(task: AiTask) {
    if (!desktop?.aiComplete) {
      setPhase({ name: 'error', message: '仅桌面版可用：请在 Electron 应用内使用' })
      return
    }
    if (!(await ensureSnapshot())) {
      setPhase({ name: 'menu' })
      return
    }
    let built: ReturnType<typeof buildTask>
    try {
      built = buildTask(task, notes)
    } catch (e) {
      setPhase({ name: 'error', message: e instanceof Error ? e.message : String(e) })
      return
    }
    setPhase({ name: 'running', label: task.kind === 'health-check' ? '健康检查中…' : 'AI 规划中…' })
    const res = await desktop.aiComplete({ prompt: built.prompt, system: built.system, maxTokens: 16384 })
    if (!res.ok) {
      setPhase({ name: 'error', message: res.error })
      return
    }
    if (!built.needsOps) {
      setPhase({ name: 'report', markdown: res.text })
      return
    }
    const parsed = parseAiOperations(res.text)
    if (!parsed.ok) {
      setPhase({ name: 'error', message: parsed.error, raw: parsed.rawPreview })
      return
    }
    if (parsed.ops.length === 0) {
      setPhase({ name: 'error', message: 'AI 没有提出任何改动' })
      return
    }
    const planned = resolveOps(parsed.ops, notes)
    setPhase({ name: 'confirm', ops: parsed.ops, lines: planned.map(describeOp) })
  }

  const confirmApply = () => {
    if (phase.name !== 'confirm') return
    const usable = phase.ops.filter((op) => {
      if (op.type === 'create') return true
      return notes.some((n) => n.id === op.id || (op.title && n.title.trim() === op.title.trim()))
    })
    onApply(usable)
    toast.success(`已应用 ${usable.length} 条 AI 提议`)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" /> AI 统筹
          </DialogTitle>
        </DialogHeader>

        {!status.configured ? (
          <p className="text-sm text-muted-foreground">
            本机 Kimi 网关未就绪：{status.error ?? '未知原因'}。AI 统筹复用 Kimi Code 的模型网关（key 只留在本机，界面只显示脱敏预览）。
          </p>
        ) : phase.name === 'menu' ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              模型 {status.model} · key {status.keyPreview}。运行前会自动把笔记快照到同步文件；AI 的改动经你确认后才落盘。
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {TASK_META.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="flex items-start gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-accent"
                  onClick={() => (t.key === 'zotero' ? (onGoLiterature(), onClose()) : undefined)}
                >
                  <t.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="block text-sm font-medium">{t.label}</span>
                    <span className="block text-xs text-muted-foreground">{t.desc}</span>
                  </span>
                </button>
              ))}
            </div>
            {directions.length > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="shrink-0 text-muted-foreground">限定方向</span>
                <Select value={direction} onValueChange={setDirection}>
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue placeholder="不限（全库）" />
                  </SelectTrigger>
                  <SelectContent>
                    {directions.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void run({ kind: 'retag-literature', scope: direction || undefined })}>
                <Tags className="mr-1 h-3.5 w-3.5" /> 整理标签
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!direction}
                title={direction ? '' : '先在上方选一个方向'}
                onClick={() => void run({ kind: 'generate-summary', direction: direction.replace(/^方向:/, '') })}
              >
                <FileText className="mr-1 h-3.5 w-3.5" /> 生成「{direction || '未选方向'}」汇总
              </Button>
              <Button variant="outline" size="sm" onClick={() => void run({ kind: 'health-check' })}>
                <Stethoscope className="mr-1 h-3.5 w-3.5" /> 健康检查
              </Button>
            </div>
          </div>
        ) : phase.name === 'running' ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{phase.label}（首次调用可能要一两分钟）</p>
        ) : phase.name === 'confirm' ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">AI 提议 {phase.ops.length} 条改动，确认后才会落盘：</p>
            <ul className="max-h-72 space-y-1 overflow-auto rounded border p-2 text-xs">
              {phase.lines.map((line, i) => (
                <li key={i} className={line.startsWith('⚠') ? 'text-destructive' : ''}>{line}</li>
              ))}
            </ul>
          </div>
        ) : phase.name === 'report' ? (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border bg-muted/40 p-3 text-xs">{phase.markdown}</pre>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-destructive">{phase.message}</p>
            {phase.raw && (
              <pre className="max-h-40 overflow-auto rounded border bg-muted/40 p-2 text-[11px] text-muted-foreground">{phase.raw}</pre>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
          {phase.name === 'confirm' && <Button onClick={confirmApply}>确认应用 {phase.ops.length} 条</Button>}
          {(phase.name === 'error' || phase.name === 'report') && status.configured && (
            <Button variant="outline" onClick={() => setPhase({ name: 'menu' })}>返回任务</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
