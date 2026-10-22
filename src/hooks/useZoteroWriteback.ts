/**
 * Zotero 回写（只增）的 React 侧编排：挑出可回写的高亮 → 探测本地 API →
 * （需要时）让 Zotero 弹窗授权 → 批量创建 annotation → 把新 key 记回本地标注。
 *
 * 这个 hook 不发 toast、不写盘：成功后把 saved 交给 `onSaved`，由调用方更新
 * `.annotations.json` 并决定提示文案，避免「写盘失败但界面显示已回写」。
 */
import { useCallback, useMemo, useState } from 'react'
import type { PdfAnnotation } from '@/lib/attachments'
import type { ZoteroAttachmentInfo } from '@/lib/zoteroMarkup'
import {
  planZoteroWriteback,
  writebackSummary,
  zoteroWritebackBlockReason,
  type WritebackPlan,
  type ZoteroLocalApiAuthorize,
  type ZoteroLocalApiStatus,
  type ZoteroLocalApiWrite,
  type ZoteroWriteAnnotation,
} from '@/lib/zoteroWriteback'

export interface PushedAnnotation {
  id: string
  key: string
}

export interface WritebackOutcome {
  plan: WritebackPlan
  saved: PushedAnnotation[]
  failed: number
  failedMessages: string[]
  summary: string
}

export interface ZoteroWritebackView {
  plan: WritebackPlan
  pushing: boolean
  /** 最近一次失败原因（空串=没有错误） */
  error: string
  canPush: boolean
  blockReason: string
  push: () => Promise<WritebackOutcome | null>
}

function bridge() {
  if (typeof window === 'undefined') return null
  return window.knowledgeGraphDesktop?.zoteroLocalApi ?? null
}

export function useZoteroWriteback(input: {
  /** 本地标注（不含 Zotero 只读标注） */
  annotations: PdfAnnotation[]
  /** 当前 PDF 在 Zotero 里的附件；null = 这份 PDF 不在 Zotero 里 */
  attachment: ZoteroAttachmentInfo | null
  /** 回写成功后把新 key 交给外层写进 .annotations.json */
  onSaved?: (saved: PushedAnnotation[], attachmentKey: string) => void
}): ZoteroWritebackView {
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState('')
  const { onSaved } = input
  const attachmentKey = input.attachment?.key ?? ''
  const plan = useMemo(
    () => planZoteroWriteback({ annotations: input.annotations, attachmentKey }),
    [input.annotations, attachmentKey],
  )
  const available = Boolean(bridge())
  const blockReason = plan.blockReason || zoteroWritebackBlockReason({
    attachment: input.attachment,
    pending: plan.items.length,
    bridge: available,
  })
  const canPush = !pushing && !blockReason

  const push = useCallback(async (): Promise<WritebackOutcome | null> => {
    if (pushing) return null
    const api = bridge()
    if (!api) throw new Error('当前环境没有 Zotero 写入接口（请用桌面版或本机网页端）')
    if (plan.blockReason) throw new Error(plan.blockReason)
    if (plan.items.length === 0) {
      return {
        plan,
        saved: [],
        failed: 0,
        failedMessages: [],
        summary: writebackSummary({ saved: 0, failed: 0, skipped: plan.skipped.length }),
      }
    }
    const annotations: ZoteroWriteAnnotation[] = plan.items.map((item) => item.payload)
    setPushing(true)
    setError('')
    try {
      const status = (await api({ action: 'status' })) as ZoteroLocalApiStatus
      if (!status.available) throw new Error(status.error || 'Zotero 本地 API 不可用')
      if (!status.writeSupported) throw new Error(status.error || 'Zotero 版本过低（回写需要 Zotero 10+）')

      const request = () => api({ action: 'write', attachmentKey, annotations }) as Promise<ZoteroLocalApiWrite>
      let result = await request()
      if (result.code === 'unauthorized') {
        // 单次密钥在上一次写入后失效是常态：让 Zotero 再弹一次授权，然后重试一次
        const auth = (await api({ action: 'authorize' })) as ZoteroLocalApiAuthorize
        if (!auth.ok) throw new Error(auth.error || '没有获得 Zotero 写入授权')
        result = await request()
      }
      if (result.code) throw new Error(result.error || '回写 Zotero 失败')

      const saved = result.saved.map((entry) => ({ id: entry.id, key: entry.key }))
      if (saved.length) onSaved?.(saved, attachmentKey)
      const summary = writebackSummary({
        saved: saved.length,
        failed: result.failed.length,
        skipped: plan.skipped.length,
        firstError: result.failed[0]?.message,
      })
      if (result.failed.length) setError(result.failed[0].message)
      return {
        plan,
        saved,
        failed: result.failed.length,
        failedMessages: result.failed.map((entry) => entry.message),
        summary,
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '回写 Zotero 失败'
      setError(message)
      throw e instanceof Error ? e : new Error(message)
    } finally {
      setPushing(false)
    }
  }, [attachmentKey, onSaved, plan, pushing])

  return { plan, pushing, error, canPush, blockReason, push }
}
