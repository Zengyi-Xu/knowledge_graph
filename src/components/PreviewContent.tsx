import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Note } from '@/types/note'
import { Markdown } from './Markdown'
import baseStyles from '@/index.css?inline'
import { previewCss } from '@/lib/previewTheme'
import type { PreviewTheme } from '@/lib/previewTheme'
import { prepareMathMarkdown } from '@/lib/mathMarkup'

export type { PreviewTheme }

interface Props {
  content: string
  notes: Note[]
  onOpenNote: (id: string) => void
  onCreateNote: (title: string) => void
  theme: PreviewTheme
  customCss: string
  /** true：跟随外层页面滚动（正文不再自己滚），用于单栏「笔记」视图 */
  flow?: boolean
}

/**
 * 阅读面板：内容渲染在 Shadow DOM 里，避免应用界面样式与阅读主题互相污染。
 * 样式拼装（Markdown 基础排版 + 主题 + 手机覆盖）在 src/lib/previewTheme.ts 中，
 * 这样视觉检查脚本可以复用同一份 CSS。
 */
export function PreviewContent({ content, notes, onOpenNote, onCreateNote, theme, customCss, flow = false }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [shadow, setShadow] = useState<ShadowRoot | null>(null)
  const prepared = useMemo(() => prepareMathMarkdown(content), [content])

  useEffect(() => {
    if (hostRef.current && !hostRef.current.shadowRoot) {
      setShadow(hostRef.current.attachShadow({ mode: 'open' }))
    }
  }, [])

  useEffect(() => {
    if (!shadow || prepared.expressions.length === 0) return
    let cancelled = false
    void import('@/lib/katexRuntime').then(({ hydrateMath, installKatexStyles }) => {
      if (cancelled) return
      const write = shadow.querySelector<HTMLElement>('#write')
      if (!write) return
      installKatexStyles(shadow)
      hydrateMath(write, prepared.expressions)
    })
    return () => { cancelled = true }
  }, [prepared, shadow])

  return (
    <div ref={hostRef} className={flow ? 'overflow-visible' : 'h-full overflow-y-auto'}>
      {shadow && createPortal(
        <>
          {/* Tailwind（含 preflight 与主题变量）：必须在最前，后面的任何规则都能覆盖它 */}
          <style>{baseStyles}</style>
          <style>{previewCss(theme, customCss)}</style>
          <div id="write" key={content} data-math-engine={prepared.expressions.length ? 'katex' : undefined}>
            <Markdown content={prepared.markdown} notes={notes} onOpenNote={onOpenNote} onCreateNote={onCreateNote} />
          </div>
        </>,
        shadow,
      )}
    </div>
  )
}
