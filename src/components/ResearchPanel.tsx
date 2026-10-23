/**
 * 「研究追问」面板：笔记右侧的可收起面板。
 * 闭环：手动点「完成笔记 · 研究追问」→ 本地 Qwen 生成 3 个针对性问题 →
 * 回答（草稿）/ 收藏 / 跳过 / 稍后 → 用户确认后插入正文 → 收藏进题库逐步学习偏好。
 *
 * 边界：不自动改正文、不自动保存回答；生成只用本地 Ollama（失败明确报错，
 * 绝不静默切云端）；云端只在用户显式点「深入分析」时使用，且只发送用户授权的笔记。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CloudCog,
  Loader2,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react'
import type { Note } from '@/types/note'
import { uid } from '@/types/note'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Markdown } from '@/components/Markdown'
import { capability } from '@/lib/capabilities'
import { topicOf } from '@/lib/topics'
import {
  CATEGORY_LABEL,
  pickBankCandidates,
  touchQuestion,
  type ResearchBankFile,
} from '@/lib/research/bank'
import {
  appendRound,
  answeredSignatures,
  askedSignatures,
  contentHashOf,
  newSession,
  patchItem,
  roundItems,
  skippedSignatures,
  unresolvedItems,
  type ResearchSessionFile,
  type ResearchSessionItem,
} from '@/lib/research/session'
import { contentChanged, planQuestions } from '@/lib/research/plan'
import {
  buildDeepDivePrompt,
  buildGenerationPrompt,
  buildInsertSection,
  parseGenerationOutput,
} from '@/lib/research/prompts'
import {
  decideDeepDive,
  decideGenerate,
  deepDiveMaterialIds,
  type CloudProvider,
} from '@/lib/research/router'
import {
  ensureResearchBank,
  favoriteToQuestion,
  readCloudProvider,
  readOllamaSettings,
  readResearchSession,
  saveCloudProvider,
  saveOllamaSettings,
  saveResearchBank,
  saveResearchSession,
} from '@/lib/research/store'
import { ResearchBankDialog } from './ResearchBankDialog'

interface Props {
  note: Note
  allNotes: Note[]
  /** 写入门禁的只读笔记：可以看记录、写草稿，但不能插入正文 */
  readOnly?: boolean
  /** 用户确认后把段落插进正文（由 NoteEditor 走 onChange，仍是一次普通的手动保存） */
  onInsertSection: (section: string) => void
  onClose: () => void
}

type Status = { configured: boolean; error?: string; model?: string; models?: string[]; baseUrl?: string }

const STATUS_LABEL: Record<ResearchSessionItem['status'], string> = {
  pending: '未答',
  answered: '已答',
  skipped: '已跳过',
  later: '稍后',
}

export function ResearchPanel({ note, allNotes, readOnly = false, onInsertSection, onClose }: Props) {
  const desktop = typeof window !== 'undefined' ? window.knowledgeGraphDesktop : undefined
  const topic = topicOf(note)

  const [bank, setBank] = useState<ResearchBankFile | null>(null)
  const [session, setSession] = useState<ResearchSessionFile | null>(null)
  const [settings, setSettings] = useState(readOllamaSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ollamaStatus, setOllamaStatus] = useState<Status | undefined>()
  const [cloudStatus, setCloudStatus] = useState<Partial<Record<CloudProvider, Status>>>({})
  const [cloudProvider, setCloudProvider] = useState<CloudProvider>(readCloudProvider())
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState<null | 'generate' | 'deepdive' | 'status'>(null)
  const [error, setError] = useState<string | null>(null)
  const [rawPreview, setRawPreview] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showEarlier, setShowEarlier] = useState(false)
  const [bankOpen, setBankOpen] = useState(false)
  const [confirmInsert, setConfirmInsert] = useState<ResearchSessionItem | null>(null)
  const [deepDive, setDeepDive] = useState<{ task: string; report: string } | null>(null)
  const [deepOpen, setDeepOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const refreshOllamaStatus = useCallback(async () => {
    if (!desktop?.aiStatus) return undefined
    try {
      const s = (await desktop.aiStatus({ provider: 'ollama', baseUrl: settings.baseUrl })) as Status
      setOllamaStatus(s)
      // 首次使用：本机模型探测成功后自动填入第一个模型，别再让用户空着手报错
      if (s.configured && s.models?.length) {
        setSettings((prev) => (prev.model ? prev : { ...prev, model: s.models![0] }))
      }
      return s
    } catch (e) {
      const s: Status = { configured: false, error: e instanceof Error ? e.message : String(e) }
      setOllamaStatus(s)
      return s
    }
  }, [desktop, settings.baseUrl])

  // 装载：题库（没有就落种子库）、本篇记录、三个提供方的状态
  useEffect(() => {
    let cancelled = false
    setReady(false)
    setError(null)
    setRawPreview('')
    setExpandedId(null)
    setDeepDive(null)
    setDeepOpen(false)
    setSelectedIds(new Set())
    void (async () => {
      if (!desktop?.readAttachment) {
        setError(capability('vaultAttachments').reason)
        setReady(true)
        return
      }
      const [bankFile, sess] = await Promise.all([
        ensureResearchBank().catch(() => null),
        readResearchSession(note.id),
      ])
      if (cancelled) return
      setBank(bankFile)
      setSession(sess)
      // 打开面板时默认展开最新一轮最值得思考的一道
      if (sess && sess.items.length) {
        setExpandedId(roundItems(sess, sess.roundCount)[0]?.id ?? null)
      }
      await refreshOllamaStatus()
      const clouds: Partial<Record<CloudProvider, Status>> = {}
      for (const p of ['deepseek', 'kimi'] as const) {
        try {
          clouds[p] = (await desktop.aiStatus!({ provider: p })) as Status
        } catch (e) {
          clouds[p] = { configured: false, error: e instanceof Error ? e.message : String(e) }
        }
      }
      if (cancelled) return
      setCloudStatus(clouds)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, desktop])

  const latestRound = session ? roundItems(session, session.roundCount) : []
  const earlier = useMemo(
    () => (session ? unresolvedItems(session).filter((it) => it.round < session.roundCount) : []),
    [session],
  )
  const answeredItems = useMemo(
    () => (session ? session.items.filter((it) => it.status === 'answered') : []),
    [session],
  )

  /** 该问题是否已收藏（AI 题入库后按文本查得到；题库题按 id） */
  const isFavorited = (item: ResearchSessionItem): boolean => {
    if (!bank) return false
    if (item.source === 'bank' && item.bankId) return bank.questions.some((q) => q.id === item.bankId)
    return bank.questions.some((q) => q.text === item.question)
  }

  /** 会话的「最新快照」ref：blur 保存与按钮动作可能在同一次点击里先后触发，
   *  两个闭包会拿到同一个旧 state —— 所有读写都经 sessionRef 串行化 */
  const sessionRef = useRef<ResearchSessionFile | null>(null)
  useEffect(() => {
    sessionRef.current = session
  }, [session])

  /** 持久化一篇会话（state 里的 session 为准） */
  const persistSession = async (next: ResearchSessionFile) => {
    sessionRef.current = next
    setSession(next)
    await saveResearchSession(next)
  }

  const generate = async () => {
    if (busy) return
    setError(null)
    setRawPreview('')
    setDeepDive(null)
    if (!desktop?.aiComplete) {
      setError(capability('localAi').reason)
      return
    }
    if (!bank) {
      setError('问题库不可用（附件写盘不可用），无法生成追问。')
      return
    }
    const status = ollamaStatus ?? (await refreshOllamaStatus())
    const decision = decideGenerate(settings, status)
    if (!decision.ok) {
      setError(decision.error)
      setSettingsOpen(true)
      return
    }
    saveOllamaSettings(settings)
    const now = Date.now()
    const sess = sessionRef.current ?? newSession(note.id, note.content, now)
    const changed = contentChanged(sess, note.content)
    const exclude = new Set([...answeredSignatures(sess), ...askedSignatures(sess)])
    if (!changed) for (const s of skippedSignatures(sess)) exclude.add(s)
    const excludeTexts = sess.items.filter((it) => exclude.has(it.signature)).map((it) => it.question)
    const candidates = pickBankCandidates(
      bank.questions,
      { noteType: note.type, topic, tags: note.tags, now },
      8,
      exclude,
    )
    setBusy('generate')
    const { system, prompt } = buildGenerationPrompt({ note, topic, bankCandidates: candidates, excludeTexts })
    const res = await desktop.aiComplete({
      provider: 'ollama',
      baseUrl: decision.baseUrl,
      model: decision.model,
      system,
      prompt,
      maxTokens: 2048,
    })
    if (!res.ok) {
      setBusy(null)
      setError(res.error)
      return
    }
    const parsed = parseGenerationOutput(res.text)
    if (!parsed.ok) {
      setBusy(null)
      setError(parsed.error)
      setRawPreview(parsed.rawPreview)
      return
    }
    const planned = planQuestions(parsed.questions, candidates, sess, { limit: 3, excludeSkipped: !changed })
    if (!planned.length) {
      setBusy(null)
      setError('没有新的问题可问：已答与问过的问题都不会重复出现。正文有重大修改后可以再问一轮。')
      return
    }
    let next = appendRound(sess, planned.map((p) => ({ ...p, model: `${decision.model} · 本地` })), now, uid)
    next = { ...next, contentHash: contentHashOf(note.content) }
    let nextBank: ResearchBankFile = bank
    for (const p of planned) {
      if (p.source === 'bank' && p.bankId) {
        nextBank = { ...nextBank, questions: touchQuestion(nextBank.questions, p.bankId, 'used', now) }
      }
    }
    try {
      await saveResearchSession(next)
      if (nextBank !== bank) await saveResearchBank(nextBank)
    } catch (e) {
      setBusy(null)
      setError(`追问记录保存失败：${e instanceof Error ? e.message : String(e)}`)
      return
    }
    setBusy(null)
    setSession(next)
    setBank(nextBank)
    const first = roundItems(next, next.roundCount)[0]
    setExpandedId(first?.id ?? null)
  }

  const saveDraft = async (item: ResearchSessionItem, draft: string) => {
    const current = sessionRef.current
    if (!current) return
    const now = Date.now()
    const next = patchItem(current, item.id, {
      draft,
      status: item.status === 'pending' || item.status === 'later' ? 'answered' : undefined,
    }, now)
    await persistSession(next)
    if (item.bankId && bank) {
      const nb = { ...bank, questions: touchQuestion(bank.questions, item.bankId, 'answered', now) }
      setBank(nb)
      await saveResearchBank(nb).catch(() => undefined)
    }
  }

  /** 只改状态；草稿由 textarea 的 blur 单独保存（避免两件事抢同一个旧 session 快照） */
  const markAnswered = async (item: ResearchSessionItem) => {
    const current = sessionRef.current
    if (!current) return
    const now = Date.now()
    try {
      await persistSession(patchItem(current, item.id, { status: 'answered' }, now))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      return
    }
    if (item.bankId && bank) {
      const nb = { ...bank, questions: touchQuestion(bank.questions, item.bankId, 'answered', now) }
      setBank(nb)
      await saveResearchBank(nb).catch(() => undefined)
    }
  }

  const setStatus = async (item: ResearchSessionItem, status: 'skipped' | 'later') => {
    const current = sessionRef.current
    if (!current) return
    try {
      await persistSession(patchItem(current, item.id, { status }, Date.now()))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      return
    }
    if (status === 'skipped' && item.bankId && bank) {
      const nb = { ...bank, questions: touchQuestion(bank.questions, item.bankId, 'skipped', Date.now()) }
      setBank(nb)
      await saveResearchBank(nb).catch(() => undefined)
    }
  }

  const favorite = async (item: ResearchSessionItem) => {
    if (!bank) return
    const now = Date.now()
    let nb: ResearchBankFile
    if (item.source === 'bank' && item.bankId) {
      nb = { ...bank, questions: touchQuestion(bank.questions, item.bankId, 'favorite', now) }
    } else if (isFavorited(item)) {
      toast.info('这道题已经在问题库里了')
      return
    } else {
      nb = {
        ...bank,
        questions: [
          ...bank.questions,
          favoriteToQuestion({
            id: uid(),
            question: item.question,
            why: item.why,
            category: item.category,
            noteType: null,
            topic,
            now,
          }),
        ],
      }
    }
    setBank(nb)
    await saveResearchBank(nb)
    toast.success('已收藏到问题库')
  }

  const confirmAndInsert = async () => {
    const item = confirmInsert
    const current = sessionRef.current
    if (!item || !current) return
    onInsertSection(buildInsertSection([item]))
    setConfirmInsert(null)
    await persistSession(patchItem(current, item.id, { inserted: true }, Date.now()))
    toast.success('已插入正文（保存后落盘）')
  }

  const relatedCandidates = useMemo(() => {
    const linkedTitles = new Set(
      Array.from(note.content.matchAll(/\[\[([^[\]|]+)(?:\|[^[\]]*)?\]\]/g)).map((m) => m[1].trim().toLowerCase()),
    )
    return allNotes.filter((n) => n.id !== note.id && linkedTitles.has(n.title.trim().toLowerCase())).slice(0, 8)
  }, [allNotes, note])

  const runDeepDive = async () => {
    if (busy) return
    setError(null)
    const decision = decideDeepDive(cloudProvider, cloudStatus)
    if (!decision.ok) {
      setError(decision.error)
      return
    }
    const ids = deepDiveMaterialIds(note.id, selectedIds)
    const materials = ids.map((id) => allNotes.find((n) => n.id === id)).filter((n): n is Note => Boolean(n))
    const related = materials.filter((n) => n.id !== note.id)
    const items = answeredItems.length ? answeredItems : (session?.items ?? []).filter((it) => it.draft.trim())
    const task = deepDive?.task.trim() || '基于以上材料做深入分析：论证漏洞、跨材料矛盾、值得深挖的方向。'
    setBusy('deepdive')
    const { system, prompt } = buildDeepDivePrompt({ note, items, relatedNotes: related, task })
    const res = await desktop!.aiComplete!({ provider: decision.provider, system, prompt, maxTokens: 8192 })
    setBusy(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setDeepDive({ task, report: res.text })
  }

  const testConnection = async () => {
    setBusy('status')
    saveOllamaSettings(settings)
    const s = await refreshOllamaStatus()
    setBusy(null)
    if (s?.configured) toast.success(`已连接 ${settings.baseUrl}（${s.models?.length ?? 0} 个模型）`)
    else toast.error(s?.error ?? '连接失败')
  }

  const modelOptions = ollamaStatus?.configured && ollamaStatus.models?.length ? ollamaStatus.models : []

  const questionCard = (item: ResearchSessionItem, isFocus: boolean) => {
    const expanded = expandedId === item.id
    return (
      <div key={item.id} className={`rounded-lg border p-2 ${isFocus ? 'border-amber-500/50 bg-amber-500/5' : ''}`}>
        <button
          type="button"
          className="flex w-full items-start gap-1.5 text-left"
          onClick={() => setExpandedId(expanded ? null : item.id)}
        >
          {expanded ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1">
              <Badge variant="secondary" className="text-[10px]">{CATEGORY_LABEL[item.category]}</Badge>
              <Badge
                variant="outline"
                className={`text-[10px] ${item.status === 'answered' ? 'border-emerald-500/50 text-emerald-600' : item.status === 'skipped' ? 'text-muted-foreground' : ''}`}
              >
                {STATUS_LABEL[item.status]}{item.inserted ? ' · 已插入' : ''}
              </Badge>
            </span>
            <span className="mt-0.5 block text-sm leading-snug">{item.question}</span>
          </span>
        </button>
        {expanded && (
          <div className="mt-2 space-y-2 pl-5">
            {item.why && (
              <p className="border-l-2 border-amber-500/40 pl-2 text-xs text-muted-foreground">{item.why}</p>
            )}
            <p className="text-[10px] text-muted-foreground">模型来源：{item.model || '未知'}</p>
            {item.status !== 'skipped' && (
              <Textarea
                defaultValue={item.draft}
                key={`${item.id}:${item.updatedAt}`}
                rows={3}
                placeholder="回答草稿（不会自动改正文，确认插入前只是草稿）"
                className="text-xs"
                disabled={item.inserted}
                onBlur={(e) => {
                  if (e.target.value !== item.draft) void saveDraft(item, e.target.value)
                }}
              />
            )}
            <div className="flex flex-wrap gap-1.5">
              {item.status !== 'answered' && item.status !== 'skipped' && (
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void markAnswered(item)}>
                  标记已答
                </Button>
              )}
              {item.status === 'answered' && !item.inserted && (
                readOnly ? (
                  <span className="self-center text-[10px] text-amber-600">写入门禁：只读笔记不能插入正文</span>
                ) : (
                  <Button size="sm" className="h-7 px-2 text-xs" onClick={() => setConfirmInsert(item)}>
                    插入笔记…
                  </Button>
                )
              )}
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void favorite(item)} title="收藏到问题库">
                <Bookmark className={`mr-1 h-3 w-3 ${isFavorited(item) ? 'fill-amber-500 text-amber-500' : ''}`} />
                {isFavorited(item) ? '已收藏' : '收藏'}
              </Button>
              {item.status !== 'skipped' && item.status !== 'answered' && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void setStatus(item, 'skipped')}>
                  跳过
                </Button>
              )}
              {item.status === 'pending' && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void setStatus(item, 'later')}>
                  稍后
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="flex h-full w-full min-h-0 flex-col border-t bg-card md:w-[340px] md:shrink-0 md:border-l md:border-t-0" data-testid="research-panel">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <CircleHelp className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium">研究追问</span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground" title="生成追问使用的模型">
          {ollamaStatus?.configured ? `${settings.model || ollamaStatus.model} · 本地` : '本地模型未就绪'}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="问题库管理" onClick={() => setBankOpen(true)}>
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="收起研究追问">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!ready ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在装载追问记录…
          </p>
        ) : (
          <>
            <Button className="w-full" onClick={() => void generate()} disabled={busy !== null}>
              {busy === 'generate' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
              完成笔记 · 研究追问
            </Button>
            <p className="text-[11px] text-muted-foreground">
              手动触发：用本地模型针对当前笔记生成 3 个问题；回答只是草稿，确认插入前不会改正文。
            </p>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
                {rawPreview && <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap text-[10px] opacity-80">{rawPreview}</pre>}
              </div>
            )}

            {latestRound.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  第 {session?.roundCount} 轮 · 最值得先思考的一道已展开
                </p>
                {latestRound.map((it, i) => questionCard(it, i === 0))}
              </div>
            )}

            {earlier.length > 0 && (
              <div>
                <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground" onClick={() => setShowEarlier((v) => !v)}>
                  {showEarlier ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}更早的追问（{earlier.length}）
                </button>
                {showEarlier && <div className="mt-2 space-y-2">{earlier.map((it) => questionCard(it, false))}</div>}
              </div>
            )}

            {/* 云端深入分析：显式手动触发 */}
            <div className="rounded-lg border p-2">
              <button type="button" className="flex w-full items-center gap-1.5 text-sm font-medium" onClick={() => setDeepOpen((v) => !v)}>
                {deepOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <CloudCog className="h-4 w-4 text-muted-foreground" /> 深入分析（云端，手动触发）
              </button>
              {deepOpen && (
                <div className="mt-2 space-y-2">
                  <Textarea
                    value={deepDive?.task ?? ''}
                    onChange={(e) => setDeepDive((d) => ({ task: e.target.value, report: d?.report ?? '' }))}
                    rows={2}
                    placeholder="分析任务（默认：论证漏洞、跨材料矛盾、值得深挖的方向）"
                    className="text-xs"
                  />
                  {relatedCandidates.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">只发送勾选的笔记（默认仅当前笔记）：</p>
                      {relatedCandidates.map((n) => (
                        <label key={n.id} className="flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={selectedIds.has(n.id)}
                            onCheckedChange={(v) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev)
                                if (v) next.add(n.id)
                                else next.delete(n.id)
                                return next
                              })
                            }}
                          />
                          <span className="min-w-0 truncate">{n.title}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Select
                      value={cloudProvider}
                      onValueChange={(v) => {
                        setCloudProvider(v as CloudProvider)
                        saveCloudProvider(v as CloudProvider)
                      }}
                    >
                      <SelectTrigger className="h-7 flex-1 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="deepseek">DeepSeek</SelectItem>
                        <SelectItem value="kimi">Kimi</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-7 px-2 text-xs" onClick={() => void runDeepDive()} disabled={busy !== null}>
                      {busy === 'deepdive' ? <Loader2 className="h-3 w-3 animate-spin" /> : '运行'}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    发送内容：当前笔记 + 已答追问与草稿 + 勾选笔记。不会发送整个笔记库或问题库。
                  </p>
                  {deepDive?.report && (
                    <div className="max-h-72 overflow-y-auto rounded border bg-muted/20 p-2 text-xs">
                      <Markdown content={deepDive.report} notes={allNotes} />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 本地模型设置 */}
            <div className="rounded-lg border p-2">
              <button type="button" className="flex w-full items-center gap-1.5 text-sm font-medium" onClick={() => setSettingsOpen((v) => !v)}>
                {settingsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                本地模型设置（Ollama）
              </button>
              {settingsOpen && (
                <div className="mt-2 space-y-2">
                  <Input
                    value={settings.baseUrl}
                    onChange={(e) => setSettings((s) => ({ ...s, baseUrl: e.target.value }))}
                    placeholder="http://127.0.0.1:11434"
                    className="h-8 text-xs"
                    aria-label="Ollama 地址"
                  />
                  <div className="flex gap-2">
                    {modelOptions.length > 0 ? (
                      <Select value={settings.model} onValueChange={(v) => setSettings((s) => ({ ...s, model: v }))}>
                        <SelectTrigger className="h-8 flex-1 text-xs" aria-label="本地模型">
                          <SelectValue placeholder="选模型" />
                        </SelectTrigger>
                        <SelectContent>
                          {modelOptions.map((m) => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={settings.model}
                        onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
                        placeholder="模型名（如 qwen3.5:4b）"
                        className="h-8 flex-1 text-xs"
                        aria-label="本地模型名"
                      />
                    )}
                    <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => void testConnection()} disabled={busy !== null}>
                      {busy === 'status' ? <Loader2 className="h-3 w-3 animate-spin" /> : '连接测试'}
                    </Button>
                  </div>
                  {ollamaStatus && !ollamaStatus.configured && (
                    <p className="text-[11px] text-destructive">{ollamaStatus.error}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    设置只存在本机浏览器里；生成追问只走本地模型，不出本机。
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {bank && (
        <ResearchBankDialog
          open={bankOpen}
          onClose={() => setBankOpen(false)}
          bank={bank}
          onChange={(next) => {
            setBank(next)
            void saveResearchBank(next).catch((e) => toast.error(String(e)))
          }}
        />
      )}

      <AlertDialog open={confirmInsert !== null} onOpenChange={(v) => !v && setConfirmInsert(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>把这条问答插入正文？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2 text-sm text-muted-foreground">将在正文末尾追加以下段落（保存后落盘，可随时手动修改）：</p>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border bg-muted/30 p-2 text-xs">
                  {confirmInsert ? buildInsertSection([confirmInsert]) : ''}
                </pre>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button onClick={() => void confirmAndInsert()}>确认插入</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
