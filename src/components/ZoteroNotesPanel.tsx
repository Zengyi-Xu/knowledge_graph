/**
 * Zotero 标注与子笔记面板（详情页附件区 + 全屏阅读工作台共用）。
 *
 * 设计约束：
 * - 只展示纯文本：Zotero 笔记 HTML 经 plainTextFromZoteroNote 转文本，绝不进 dangerouslySetInnerHTML；
 * - Zotero 标注只读：这里没有删除/改批注，只有「导出到笔记」与「在 Zotero 中打开」；
 * - 同步是手动动作：按钮自己处理 loading 与结果提示，失败保留上一次数据。
 */
import { Highlighter, Loader2, RefreshCw, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { ZoteroMarkupView, ZoteroSyncOutcome } from '@/hooks/useZoteroMarkup'
import { openZoteroItem } from '@/hooks/useZoteroMarkup'
import {
  formatZoteroTime,
  hasExportedZoteroNote,
  mapZoteroAnnotation,
  pageForZoteroAnnotation,
  plainTextFromZoteroNote,
  zoteroAnnotationStatusLabel,
  zoteroColor,
  zoteroMarkupStats,
  zoteroSyncSummary,
  type ZoteroAnnotationRecord,
  type ZoteroNoteRecord,
} from '@/lib/zoteroMarkup'

interface Props {
  view: ZoteroMarkupView
  /** 当前笔记正文：判断某条 Zotero 笔记是否已经导出过 */
  content: string
  onExportNote: (note: ZoteroNoteRecord) => void
  onExportAnnotation: (record: ZoteroAnnotationRecord) => void
  /** 窄栏（阅读工作台右侧）用小字号、限制高度 */
  compact?: boolean
  className?: string
}

const TYPE_LABEL: Record<string, string> = {
  highlight: '高亮',
  underline: '下划线',
  note: '便签',
  image: '图片',
  ink: '墨迹',
  text: '文本',
  unknown: '未知类型',
}

export function ZoteroNotesPanel({ view, content, onExportNote, onExportAnnotation, compact, className }: Props) {
  const { file, loading, syncing, error, warning, canSync, blockReason } = view

  const runSync = async () => {
    try {
      const result: ZoteroSyncOutcome = await view.sync()
      toast.success(zoteroSyncSummary(result.file))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '同步 Zotero 标注失败')
    }
  }

  const openInZotero = async (key: string) => {
    try {
      await openZoteroItem(key)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '无法在 Zotero 中定位该条目')
    }
  }

  const stats = file ? zoteroMarkupStats(file) : null
  const annotations = file?.annotations ?? []
  const notes = file?.notes ?? []
  const syncedAt = file ? formatZoteroTime(new Date(file.syncedAt).toISOString()) : ''

  return (
    <div className={`min-h-0 border-b bg-card ${className ?? ''}`} data-testid="zotero-markup">
      <div className={`flex flex-wrap items-center gap-1.5 px-2 ${compact ? 'py-1' : 'py-1.5'}`}>
        <Highlighter className="h-3.5 w-3.5 text-muted-foreground" />
        <span className={`font-medium ${compact ? 'text-[11px]' : 'text-xs'}`}>Zotero 标注</span>
        <span className="text-[11px] text-muted-foreground">
          {loading
            ? '读取中…'
            : stats
              ? `${stats.imported} 条高亮 · ${stats.notes} 条笔记`
              : '未同步'}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-6 gap-1 px-2 text-[11px]"
          disabled={syncing || !canSync}
          title={canSync ? '只读 Zotero：导入高亮与子笔记，不改 Zotero、不改笔记正文' : blockReason}
          onClick={() => void runSync()}
        >
          {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {syncing ? '同步中…' : '同步 Zotero 标注'}
        </Button>
      </div>

      {!canSync && <p className="px-2 pb-1 text-[11px] text-muted-foreground">{blockReason}</p>}
      {error && <p className="px-2 pb-1 text-[11px] text-destructive">{error}</p>}
      {warning && <p className="px-2 pb-1 text-[11px] text-amber-700 dark:text-amber-400">{warning}</p>}
      {file && syncedAt && (
        <p className="px-2 pb-1 text-[10px] text-muted-foreground">
          上次同步：{syncedAt}
          {file.skipped.unsupportedType + file.skipped.missingText + file.skipped.invalidPosition > 0 &&
            ` · 跳过 ${file.skipped.unsupportedType + file.skipped.missingText + file.skipped.invalidPosition} 条`}
        </p>
      )}

      {(annotations.length > 0 || notes.length > 0) && (
        <div className={`overflow-y-auto px-1 pb-1 ${compact ? 'max-h-56' : 'max-h-80'}`}>
          {annotations.length > 0 && (
            <section>
              <div className="flex items-center gap-1 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <Highlighter className="h-3 w-3" /> 标注（{annotations.length}）
              </div>
              <ul>
                {annotations.map((record) => {
                  const page = pageForZoteroAnnotation(record)
                  const reason = zoteroAnnotationStatusLabel(record.status, record.type)
                  const drawable = Boolean(mapZoteroAnnotation(record))
                  return (
                    <li key={record.key} className="flex gap-1.5 rounded px-1 py-1 text-[11px] hover:bg-accent/40">
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10"
                        style={{ background: zoteroColor(record.color) }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span>{page ? `第 ${page} 页` : record.pageLabel ? `页码 ${record.pageLabel}` : '页码未知'}</span>
                          <span>·</span>
                          <span>{TYPE_LABEL[record.type] ?? record.type}</span>
                        </div>
                        <div className="line-clamp-3 whitespace-pre-wrap break-words">
                          {record.text || <span className="text-muted-foreground">（无文字）</span>}
                        </div>
                        {record.comment && (
                          <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words rounded bg-muted/60 px-1 py-0.5">
                            {record.comment}
                          </div>
                        )}
                        {reason && <div className="text-[10px] text-amber-600 dark:text-amber-400">{reason}</div>}
                      </div>
                      {drawable && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 shrink-0 px-1 text-[10px]"
                          onClick={() => onExportAnnotation(record)}
                        >
                          导出
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {notes.length > 0 && (
            <section>
              <div className="flex items-center gap-1 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <StickyNote className="h-3 w-3" /> Zotero 笔记（{notes.length}）
              </div>
              <ul>
                {notes.map((note) => {
                  const text = plainTextFromZoteroNote(note.html)
                  const exported = hasExportedZoteroNote(content, note.key)
                  return (
                    <li key={note.key} className="rounded px-1 py-1 text-[11px] hover:bg-accent/40">
                      <div className="text-[10px] text-muted-foreground">
                        {formatZoteroTime(note.dateModified || note.dateAdded) || '时间未知'}
                      </div>
                      <div className="line-clamp-3 whitespace-pre-wrap break-words">
                        {text || <span className="text-muted-foreground">（这条笔记没有文字内容）</span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1 text-[10px]"
                          disabled={exported}
                          title={exported ? '这条 Zotero 笔记已经导出过' : '追加到当前笔记正文（只导出一次）'}
                          onClick={() => onExportNote(note)}
                        >
                          {exported ? '已导出' : '导出到当前笔记'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1 text-[10px]"
                          onClick={() => void openInZotero(note.parentKey || note.key)}
                        >
                          在 Zotero 中打开
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
