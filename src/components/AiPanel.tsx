/**
 * 「AI 统筹」面板：
 * - 自由提问：多轮对话，可选附带当前笔记 / 关联笔记；只读，不改笔记。
 * - 任务模板：构造 prompt → 调本机网关 → 校验 operations JSON → 逐条确认 → 交给调用方应用。
 * 模型只是提案者：校验失败整批拒绝并展示原因；解析不到目标的单条标记 ⚠ 不应用。
 *
 * 网关支持 Kimi（anthropic-messages）与 DeepSeek（OpenAI 兼容）两个提供方；
 * key 与端点都在本机进程里解析，界面只显示脱敏预览。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Sparkles,
  Stethoscope,
  Tags,
  FileText,
  RefreshCw,
  Send,
  MessageSquare,
  Loader2,
  ArrowLeft,
} from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { Markdown } from '@/components/Markdown'
import { parseAiOperations, resolveOps, describeOp, type AiOperation } from '@/lib/aiOps'
import { buildTask, type AiTask } from '@/lib/aiPrompts'
import { capability } from '@/lib/capabilities'
import {
  CHAT_SYSTEM_PROMPT,
  CONTEXT_SCOPE_LABEL,
  PROVIDER_LABEL,
  noteContextFor,
  trimChatHistory,
  withNoteContext,
  type AiChatMessage,
  type AiProviderId,
  type ContextScope,
} from '@/lib/aiChat'

type Phase =
  | { name: 'menu' }
  | { name: 'chat' }
  | { name: 'running'; label: string }
  | { name: 'confirm'; ops: AiOperation[]; lines: string[] }
  | { name: 'report'; markdown: string }
  | { name: 'error'; message: string; raw?: string }

type ChatEntry = AiChatMessage & { error?: boolean }

type ProviderStatus =
  | {
      configured: true
      provider?: AiProviderId
      baseUrl?: string
      model?: string
      models?: string[]
      keyPreview?: string
      error?: string
    }
  | { configured: false; provider?: AiProviderId; error?: string }

interface Props {
  open: boolean
  onClose: () => void
  notes: Note[]
  /** 当前打开的笔记（自由提问可附带它作为上下文） */
  activeNote?: Note | null
  /** 点击 AI 回答里的 [[双链]] 时打开对应笔记 */
  onOpenNote?: (id: string) => void
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
  { key: 'retag', icon: Tags, label: '整理文献标签 / 分类', desc: '按 Zotero 分类补全 期刊:/年份: 标签、清掉与分类不符的旧标签（全库或按方向限定）' },
  { key: 'summary', icon: FileText, label: '生成方向汇总', desc: '选一个一级分类，产出「汇总」笔记：文献清单、趋势、Top-5' },
  { key: 'health', icon: Stethoscope, label: '图谱健康检查', desc: '孤儿文献、断链、疑似重复、缺汇总的方向（只读报告）' },
  { key: 'zotero', icon: RefreshCw, label: '同步 Zotero 分类', desc: '入口在文献页工具栏：读取本机 Zotero 库，为文献笔记同步分类' },
] as const

const PROVIDERS: AiProviderId[] = ['deepseek', 'kimi']
const PROVIDER_HINT: Record<AiProviderId, string> = {
  deepseek: 'DeepSeek 官方接口（key 来自本机 ZCode / DSH 配置）',
  kimi: 'Kimi Code 模型网关（key 来自本机 Kimi Code 配置）',
}

export function AiPanel({
  open,
  onClose,
  notes,
  activeNote,
  onOpenNote,
  ensureSnapshot,
  onApply,
  onGoLiterature,
  initialTask,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ name: 'menu' })
  const [direction, setDirection] = useState('')
  const [provider, setProvider] = useState<AiProviderId>('deepseek')
  const [model, setModel] = useState('')
  const [statuses, setStatuses] = useState<Partial<Record<AiProviderId, ProviderStatus>>>({})
  const [statusReady, setStatusReady] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const [contextScope, setContextScope] = useState<ContextScope>('none')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const initialTaskRef = useRef<AiTask | null>(null)

  const desktop = typeof window !== 'undefined' ? window.knowledgeGraphDesktop : undefined
  // 「方向」选项 = 一级分类（collections 首段）：分类只存在 collections 里，不由标签派生
  const directions = useMemo(
    () => [
      ...new Set(
        notes
          .filter((n) => n.type === 'literature')
          .flatMap((n) => n.literature?.collections ?? [])
          .map((c) => c.split('/')[0].trim())
          .filter(Boolean),
      ),
    ].sort(),
    [notes],
  )

  const activeStatus = statuses[provider]
  const activeConfigured = activeStatus?.configured === true
  const configuredProviders = PROVIDERS.filter((p) => statuses[p]?.configured)
  const modelOptions = activeStatus?.configured
    ? activeStatus.models?.length
      ? activeStatus.models
      : activeStatus.model
        ? [activeStatus.model]
        : []
    : []
  const contextInfo = useMemo(
    () => noteContextFor(notes, activeNote ?? null, contextScope),
    [notes, activeNote, contextScope],
  )

  // 打开时：重置阶段与对话，查询两个提供方的网关状态（脱敏）
  useEffect(() => {
    if (!open) {
      initialTaskRef.current = null
      return
    }
    setPhase({ name: 'menu' })
    setDirection('')
    setChatMessages([])
    setChatInput('')
    setChatBusy(false)
    setContextScope(activeNote ? 'note' : 'none')
    if (!desktop?.aiStatus) {
      // 明确降级：本机 AI 网关（连同配置文件与 key）只在运行服务的那台电脑上
      const reason = capability('localAi').reason
      setStatuses({
        deepseek: { configured: false, error: reason },
        kimi: { configured: false, error: reason },
      })
      setStatusReady(true)
      return
    }
    let cancelled = false
    setStatusReady(false)
    void Promise.all(
      PROVIDERS.map(async (p) => {
        try {
          const status = await desktop.aiStatus!({ provider: p })
          return [p, status] as const
        } catch (error) {
          return [p, { configured: false, error: error instanceof Error ? error.message : String(error) }] as const
        }
      }),
    ).then((entries) => {
      if (cancelled) return
      const next = Object.fromEntries(entries) as Partial<Record<AiProviderId, ProviderStatus>>
      setStatuses(next)
      setStatusReady(true)
      const preferred: AiProviderId = next.deepseek?.configured ? 'deepseek' : next.kimi?.configured ? 'kimi' : 'deepseek'
      setProvider(preferred)
      const status = next[preferred]
      setModel(status?.configured ? (status.models?.[0] ?? status.model ?? '') : '')
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, desktop])

  // 外部指定任务：等网关状态就绪后只跑一次
  useEffect(() => {
    if (!open || !initialTask || !statusReady || !configuredProviders.length) return
    if (initialTaskRef.current === initialTask) return
    initialTaskRef.current = initialTask
    void run(initialTask)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTask, statusReady])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' })
  }, [chatMessages, chatBusy, phase.name])

  function chooseProvider(next: AiProviderId) {
    setProvider(next)
    const status = statuses[next]
    if (status?.configured) setModel(status.models?.[0] ?? status.model ?? '')
  }

  async function run(task: AiTask) {
    if (!desktop?.aiComplete) {
      setPhase({ name: 'error', message: capability('localAi').reason })
      return
    }
    if (!activeConfigured) {
      setPhase({ name: 'error', message: activeStatus?.error ?? '所选模型提供方不可用' })
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
    const res = await desktop.aiComplete({
      provider,
      model: model || undefined,
      prompt: built.prompt,
      system: built.system,
      maxTokens: 16384,
    })
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

  /** 自由提问：多轮、只读；上下文只附在第一条 user 消息前 */
  async function sendChat(question?: string) {
    const text = (question ?? chatInput).trim()
    if (!text || chatBusy) return
    if (!desktop?.aiComplete) {
      toast.error(capability('localAi').reason)
      return
    }
    if (!activeConfigured) {
      toast.error(activeStatus?.error ?? '所选模型提供方不可用')
      return
    }
    const nextHistory: ChatEntry[] = [...chatMessages, { role: 'user', content: text }]
    setChatMessages(nextHistory)
    setChatInput('')
    setPhase({ name: 'chat' })
    setChatBusy(true)
    const context = noteContextFor(notes, activeNote ?? null, contextScope)
    const usable = nextHistory.filter((m) => !m.error).map(({ role, content }) => ({ role, content }))
    const requestMessages = withNoteContext(trimChatHistory(usable, 20), context.text)
    const res = await desktop.aiComplete({
      provider,
      model: model || undefined,
      system: CHAT_SYSTEM_PROMPT,
      messages: requestMessages,
      maxTokens: 8192,
    })
    setChatBusy(false)
    if (!res.ok) {
      setChatMessages([...nextHistory, { role: 'assistant', content: res.error, error: true }])
      return
    }
    setChatMessages([...nextHistory, { role: 'assistant', content: res.text }])
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

  const runTaskCard = (key: (typeof TASK_META)[number]['key']) => {
    if (key === 'zotero') {
      onGoLiterature()
      onClose()
      return
    }
    if (key === 'summary') {
      if (!direction) {
        toast.info('先在下方选一个方向，再生成汇总')
        return
      }
      void run({ kind: 'generate-summary', direction })
      return
    }
    if (key === 'retag') {
      void run({ kind: 'retag-literature', scope: direction || undefined })
      return
    }
    void run({ kind: 'health-check' })
  }

  const openLinkedNote = (id: string) => {
    onOpenNote?.(id)
    onClose()
  }

  const modelLabel = model || (activeStatus?.configured ? activeStatus.model : '') || ''

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" /> AI 统筹
          </DialogTitle>
        </DialogHeader>

        {!statusReady ? (
          <p className="flex items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在检查本机 AI 配置…
          </p>
        ) : configuredProviders.length === 0 ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              本机 AI 网关不可用：{statuses[provider]?.error ?? '未知原因'}。
              当前环境不会运行 AI 统筹（不会给出任何「成功」提示）；笔记内容不会被发送出去。
            </p>
            {PROVIDERS.filter((p) => statuses[p] && !statuses[p]?.configured).map((p) => (
              <p key={p} className="text-xs">
                {PROVIDER_LABEL[p]}：{statuses[p]?.error ?? '不可用'}
              </p>
            ))}
            <p className="text-xs">
              支持的环境里，key 只留在本机（DeepSeek 读 ZCode/DSH 配置，Kimi 读 Kimi Code 配置），界面只显示脱敏预览。
            </p>
          </div>
        ) : phase.name === 'menu' ? (
          <div className="space-y-3">
            {/* 提供方 / 模型 */}
            <div className="flex flex-wrap items-center gap-2">
              {PROVIDERS.map((p) => {
                const status = statuses[p]
                const available = status?.configured === true
                return (
                  <Button
                    key={p}
                    type="button"
                    size="sm"
                    variant={provider === p ? 'default' : 'outline'}
                    className="h-7 px-2 text-xs"
                    disabled={!available}
                    title={available ? PROVIDER_HINT[p] : status?.error ?? '不可用'}
                    onClick={() => chooseProvider(p)}
                  >
                    {PROVIDER_LABEL[p]}
                    {!available && <span className="ml-1 opacity-60">（不可用）</span>}
                  </Button>
                )
              })}
              {modelOptions.length > 1 ? (
                <Select value={modelLabel} onValueChange={setModel}>
                  <SelectTrigger className="h-7 w-[190px] text-xs">
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : modelLabel ? (
                <span className="text-xs text-muted-foreground">{modelLabel}</span>
              ) : null}
              {activeStatus?.configured && (
                <span className="text-xs text-muted-foreground">key {activeStatus.keyPreview}</span>
              )}
            </div>

            {/* 自由提问 */}
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <MessageSquare className="h-4 w-4 text-muted-foreground" /> 自由提问
                <span className="text-xs font-normal text-muted-foreground">只读，不会修改笔记</span>
              </div>
              {chatMessages.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mb-2 h-7 px-2 text-xs"
                  onClick={() => setPhase({ name: 'chat' })}
                >
                  <ArrowLeft className="mr-1 h-3.5 w-3.5 rotate-180" /> 继续上次对话（{chatMessages.length} 条）
                </Button>
              )}
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void sendChat()
                  }
                }}
                rows={3}
                placeholder="例如：帮我梳理这篇笔记的论证结构 / 这几篇文献的方法差异是什么？"
                className="text-sm"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select value={contextScope} onValueChange={(v) => setContextScope(v as ContextScope)}>
                  <SelectTrigger className="h-7 w-[170px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CONTEXT_SCOPE_LABEL) as ContextScope[]).map((scope) => (
                      <SelectItem key={scope} value={scope} disabled={scope !== 'none' && !activeNote}>
                        {CONTEXT_SCOPE_LABEL[scope]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {contextScope === 'none'
                    ? '不附带笔记内容'
                    : contextInfo.titles.length
                      ? `将附带：${contextInfo.titles.join('、')}${contextInfo.truncated ? '（已截断）' : ''}`
                      : '当前没有打开的笔记'}
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={chatBusy || !chatInput.trim() || !activeConfigured}
                  onClick={() => void sendChat()}
                >
                  <Send className="mr-1 h-3.5 w-3.5" /> 发送
                </Button>
              </div>
            </div>

            {/* 任务模板 */}
            <div className="grid gap-2 md:grid-cols-2">
              {TASK_META.map((t) => {
                const needsDirection = t.key === 'summary' && !direction
                return (
                  <button
                    key={t.key}
                    type="button"
                    className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-accent ${
                      needsDirection ? 'opacity-60' : ''
                    }`}
                    title={needsDirection ? '先在下方选一个方向' : undefined}
                    onClick={() => runTaskCard(t.key)}
                  >
                    <t.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="block text-sm font-medium">{t.label}</span>
                      <span className="block text-xs text-muted-foreground">{t.desc}</span>
                    </span>
                  </button>
                )
              })}
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
            <p className="text-xs text-muted-foreground">
              任务运行前会自动把笔记快照到同步文件；AI 的改动经你确认后才落盘。自由提问不写盘。
            </p>
          </div>
        ) : phase.name === 'chat' ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{PROVIDER_LABEL[provider]} · {modelLabel || '默认模型'}</span>
              <span>
                上下文：{CONTEXT_SCOPE_LABEL[contextScope]}
                {contextInfo.titles.length ? `（${contextInfo.titles.length} 篇）` : ''}
              </span>
            </div>
            <div className="max-h-[52vh] min-h-[180px] space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-3">
              {chatMessages.map((m, i) =>
                m.error ? (
                  <div
                    key={i}
                    className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    ⚠ {m.content}
                  </div>
                ) : m.role === 'user' ? (
                  <div key={i} className="ml-10 rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
                    {m.content}
                  </div>
                ) : (
                  <div key={i} className="rounded-lg border bg-card px-3 py-2 text-sm">
                    <Markdown content={m.content} notes={notes} onOpenNote={openLinkedNote} />
                  </div>
                ),
              )}
              {chatBusy && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> 正在回答（首次调用可能要几十秒）…
                </p>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="flex items-end gap-2">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void sendChat()
                  }
                }}
                rows={2}
                placeholder="继续追问…（Enter 发送，Shift+Enter 换行）"
                className="text-sm"
                disabled={chatBusy}
              />
              <Button type="button" onClick={() => void sendChat()} disabled={chatBusy || !chatInput.trim()}>
                {chatBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              自由提问只读取你允许附带的笔记，不会写盘；要修改笔记请返回任务或直接在编辑器里改。
            </p>
          </div>
        ) : phase.name === 'running' ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {phase.label}（首次调用可能要一两分钟）
          </p>
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
          {phase.name === 'chat' && (
            <Button variant="outline" onClick={() => setPhase({ name: 'menu' })}>
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 返回任务
            </Button>
          )}
          {phase.name === 'confirm' && <Button onClick={confirmApply}>确认应用 {phase.ops.length} 条</Button>}
          {(phase.name === 'error' || phase.name === 'report') && configuredProviders.length > 0 && (
            <Button variant="outline" onClick={() => setPhase({ name: 'menu' })}>返回任务</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
