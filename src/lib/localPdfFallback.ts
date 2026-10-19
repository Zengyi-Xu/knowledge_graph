/**
 * 本地 PDF 兜底（模块级小状态，不使用 Provider —— 与 inlinePdfPanel 同一套路子）。
 *
 * 背景：界面上「这一篇有没有 PDF」只看笔记的 `localPdf` 与 Zotero 的
 * `zoteroAvailablePdfCount`。这两处字段一旦缺失（2026-10-16 出过一次：旧客户端回写把它们抹掉），
 * 论文和 PDF 都还在本机，界面却一篇都点不开。
 *
 * 兜底做法：localPdf 与 Zotero key 都没命中的文献，把标题交给本机服务，由它在授权目录里
 * 按文件名做保守匹配（`scripts/pdf-match.mjs`）。结果只留在内存里，用于显示徽标与打开阅读；
 * 想固化到笔记里，由用户在详情页点「记到这篇笔记」写 `localPdf`。
 *
 * 只有本机网页端有这个方法（服务端持授权目录清单）；桌面端与纯浏览器直接跳过。
 */
import type { Note } from '@/types/note'
import { normalizeTitle } from '@/lib/zoteroMeta'

export interface LocalPdfMatch {
  path: string
  reason: string
}

/** 单次请求最多带多少条标题，避免一次 POST 过大（超出的下一轮再问） */
const MAX_TITLES_PER_REQUEST = 400
/** 标题没变就不重复问；标题变了要重新问 */
const asked = new Map<string, string>()
const matches = new Map<string, LocalPdfMatch>()
const listeners = new Set<() => void>()
let version = 0
let inFlight = false

function notify(): void {
  version++
  for (const listener of listeners) listener()
}

/** 订阅变更（配合 useSyncExternalStore；返回值用于触发重渲染，本身没有语义） */
export function subscribeLocalPdfFallback(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function localPdfFallbackVersion(): number {
  return version
}

/** 这一篇按标题兜底匹配到的本地 PDF（没有则 null） */
export function localPdfMatch(note: Note): LocalPdfMatch | null {
  if (!note.literature) return null
  if (note.literature.localPdf || (note.literature.zoteroAvailablePdfCount ?? 0) > 0) return null
  return matches.get(note.id) ?? null
}

/** 用户把匹配结果记进笔记之后调用：这篇不再算「兜底匹配」 */
export function clearLocalPdfMatch(noteId: string): void {
  if (matches.delete(noteId)) notify()
}

function needingFallback(notes: Note[]) {
  const out: { id: string; title: string }[] = []
  for (const note of notes) {
    if (note.type !== 'literature' || !note.literature) continue
    if (note.literature.localPdf || (note.literature.zoteroAvailablePdfCount ?? 0) > 0) continue
    if (!note.title.trim()) continue
    const key = normalizeTitle(note.title)
    if (asked.get(note.id) === key) continue
    out.push({ id: note.id, title: note.title })
  }
  return out
}

/**
 * 为缺少 PDF 的文献问一次本机服务（可反复调用：只会问「还没问过、标题也没变」的那些）。
 * 不返回 Promise 结果：调用方靠订阅拿更新，避免把异步状态塞进组件树。
 */
export function ensureLocalPdfMatches(notes: Note[]): void {
  if (typeof window === 'undefined') return
  const bridge = window.knowledgeGraphDesktop
  if (!bridge?.matchLocalPdf || inFlight) return
  const wanted = needingFallback(notes)
  if (!wanted.length) return
  const batch = wanted.slice(0, MAX_TITLES_PER_REQUEST)
  // 先记账再发请求：同一批不会因为连续两次渲染被重复提交
  for (const item of batch) asked.set(item.id, normalizeTitle(item.title))
  inFlight = true
  void bridge
    .matchLocalPdf(batch)
    .then((result) => {
      const found = result?.matches ?? {}
      let changed = false
      for (const item of batch) {
        const hit = found[item.id]
        if (!hit?.path) continue
        matches.set(item.id, { path: hit.path, reason: hit.reason })
        changed = true
      }
      if (changed) notify()
    })
    .catch(() => {
      // 服务端没有授权目录 / 旧版本没有这个方法：安静跳过，不打扰用户
      for (const item of batch) asked.delete(item.id)
    })
    .finally(() => { inFlight = false })
}
