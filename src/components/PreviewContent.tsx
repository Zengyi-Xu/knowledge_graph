import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Note } from '@/types/note'
import { Markdown } from './Markdown'
import baseStyles from '@/index.css?inline'
import { previewCss } from '@/lib/previewTheme'
import type { PreviewTheme } from '@/lib/previewTheme'

export type { PreviewTheme }

interface Props {
  content: string
  notes: Note[]
  onOpenNote: (id: string) => void
  onCreateNote: (title: string) => void
  theme: PreviewTheme
  customCss: string
}

/**
 * 阅读面板：内容渲染在 Shadow DOM 里，避免应用界面样式与阅读主题互相污染。
 * 样式拼装（Markdown 基础排版 + 主题 + 手机覆盖）在 src/lib/previewTheme.ts 中，
 * 这样视觉检查脚本可以复用同一份 CSS。
 */
export function PreviewContent({ content, notes, onOpenNote, onCreateNote, theme, customCss }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [shadow, setShadow] = useState<ShadowRoot | null>(null)

  useEffect(() => {
    if (hostRef.current && !hostRef.current.shadowRoot) {
      setShadow(hostRef.current.attachShadow({ mode: 'open' }))
    }
  }, [])

  return (
    <div ref={hostRef} className="h-full overflow-y-auto">
      {shadow && createPortal(
        <>
          {/* Tailwind（含 preflight 与主题变量）：必须在最前，后面的任何规则都能覆盖它 */}
          <style>{baseStyles}</style>
          <style>{previewCss(theme, customCss)}</style>
          <div id="write">
            <Markdown content={content} notes={notes} onOpenNote={onOpenNote} onCreateNote={onCreateNote} />
          </div>
        </>,
        shadow,
      )}
    </div>
  )
}
