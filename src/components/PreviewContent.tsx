import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Note } from '@/types/note'
import { Markdown } from './Markdown'
import baseStyles from '@/index.css?inline'
import { previewCss } from '@/lib/previewTheme'
import type { PreviewTheme } from '@/lib/previewTheme'
import { prepareMathMarkdown } from '@/lib/mathMarkup'
import { scrollElementIntoView } from '@/lib/noteRelations'

export type { PreviewTheme }

/** 外部要求跳到第 N 个标题（nonce 变化即重新执行，同一标题连点也能滚过去） */
export interface HeadingJump {
  index: number
  nonce: number
}

interface Props {
  content: string
  notes: Note[]
  onOpenNote: (id: string) => void
  onCreateNote: (title: string) => void
  theme: PreviewTheme
  customCss: string
  /** true：跟随外层页面滚动（正文不再自己滚），用于单栏「笔记」视图 */
  flow?: boolean
  /** 大纲点击：滚到第 N 个标题（只影响阅读面板自己的 Shadow DOM） */
  headingJump?: HeadingJump | null
}

/**
 * 阅读面板：内容渲染在 Shadow DOM 里，避免应用界面样式与阅读主题互相污染。
 * 样式拼装（Markdown 基础排版 + 主题 + 手机覆盖）在 src/lib/previewTheme.ts 中，
 * 这样视觉检查脚本可以复用同一份 CSS。
 */
export function PreviewContent({ content, notes, onOpenNote, onCreateNote, theme, customCss, flow = false, headingJump = null }: Props) {
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

  useEffect(() => {
    if (!shadow || !headingJump) return
    // 阅读面板渲染在 Shadow DOM 里，标题只能从 shadowRoot 里取；滚动容器在影子树外面
    // （note-flow-scroll 或并列那张卡片），scrollElementIntoView 会一路往上找。
    const headings = shadow.querySelectorAll<HTMLElement>(
      '#write h1, #write h2, #write h3, #write h4, #write h5, #write h6',
    )
    scrollElementIntoView(headings[headingJump.index], 56)
  }, [shadow, headingJump])

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
