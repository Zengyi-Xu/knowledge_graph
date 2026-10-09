import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Note } from '@/types/note'
import { Markdown } from './Markdown'
import baseStyles from '@/index.css?inline'
import vueLightStyles from '@/themes/vue-light.css?inline'
import vueNightStyles from '@/themes/vue-night.css?inline'

export type PreviewTheme = 'default' | 'paper' | 'night' | 'vue-light' | 'vue-night' | 'custom'

const themeStyles: Record<Exclude<PreviewTheme, 'custom'>, string> = {
  default: `
    #write { background: #fff; color: #202428; font-family: system-ui, sans-serif; }
    #write a, #write button { color: #087e84; }
  `,
  paper: `
    #write { background: #fcfaf5; color: #273430; font-family: Georgia, "Noto Serif CJK SC", serif; line-height: 1.8; }
    #write h1, #write h2, #write h3 { color: #146b69; }
    #write a, #write button { color: #ad503a; }
    #write pre, #write code { background: #f0ede5; }
    #write blockquote { border-color: #d67c5e; color: #52605b; }
  `,
  night: `
    #write { background: #202827; color: #e4e9e5; font-family: system-ui, sans-serif; }
    #write h1, #write h2, #write h3 { color: #a8d8c6; }
    #write a, #write button { color: #9bd5cb; }
    #write pre, #write code, #write th { background: #303d3a; color: #e4e9e5; }
    #write blockquote { color: #b2c4ba; }
    #write td, #write th, #write img { border-color: #53635c; }
  `,
  'vue-light': vueLightStyles,
  'vue-night': vueNightStyles,
}

interface Props {
  content: string
  notes: Note[]
  onOpenNote: (id: string) => void
  onCreateNote: (title: string) => void
  theme: PreviewTheme
  customCss: string
}

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
          <style>{baseStyles}</style>
          <style>{`
            :host { display: block; min-height: 100%; }
            #write { box-sizing: border-box; min-height: 100%; margin: 0 auto; padding: 28px clamp(20px, 5%, 64px) 64px; }
            #write > div { max-width: 820px; margin: 0 auto; font-size: 15px; line-height: 1.7; }
            #write button { cursor: pointer; font: inherit; }
            /* 代码块底色按阅读主题给出（正文里的 pre 带 Tailwind 的 bg-muted，
               它不随阅读主题变化；在夜读/Vue 深色下会变成浅灰底 + 主题的浅色字，几乎不可读）。
               变量只放在正文样式边界内，自定义主题可用同名变量覆盖。 */
            #write {
              --write-code-bg: #f8f8f8;
              --write-code-color: inherit;
              --write-inline-code-color: #e96900;
            }
            ${theme === 'night' ? '#write { --write-code-bg: #303d3a; --write-code-color: #e4e9e5; }' : ''}
            ${theme === 'vue-night' ? '#write { --write-code-bg: hsl(0, 0%, 10%); --write-code-color: hsl(0, 0%, 85%); --write-inline-code-color: #f3b37f; }' : ''}
            ${theme === 'paper' ? '#write { --write-code-bg: #f0ede5; --write-code-color: #273430; --write-inline-code-color: #ad503a; }' : ''}
            ${theme === 'custom' ? '#write { --write-code-color: #e96900; }' : ''}
            ${theme === 'custom' ? themeStyles.default : themeStyles[theme]}
          `}</style>
          {theme === 'custom' && <style>{customCss}</style>}
          {/* 手机端覆盖：必须放在主题 CSS 之后，否则同优先级下会被主题覆盖。
              正文位于 Shadow DOM 内，全局 CSS 不作用于这里，因此移动规则写在样式边界内。 */}
          <style>{`
            @media (max-width: 767px) {
              #write {
                /* 手机留白：主题自带 20px 30px 100px / clamp(20px,5%,64px)，手机上过宽 */
                padding: 14px 14px 56px;
                /* vue-light/vue-night 自带 overflow-x: hidden，这里改为 clip：
                   保持“不出现正文横向滚动条”，同时不以 hidden 掩盖布局溢出 */
                overflow-x: clip;
                max-width: none;
              }
              #write > div {
                max-width: 100%;
                font-size: 16px;
                line-height: 1.75;
              }
              /* 长链接、长连续英文单词不得撑宽正文；pre/code 不参与断行（见下） */
              #write p, #write h1, #write h2, #write h3, #write h4, #write h5, #write h6,
              #write li, #write blockquote, #write dd, #write dt, #write figcaption {
                overflow-wrap: anywhere;
                word-break: break-word;
              }
              /* 代码块局部横向滚动，而不是撑宽或截断 */
              #write pre {
                overflow-x: auto;
                max-width: 100%;
                -webkit-overflow-scrolling: touch;
                background-color: var(--write-code-bg) !important;
                color: var(--write-code-color) !important;
                border-radius: 6px;
              }
              #write pre code {
                white-space: pre;
                background-color: transparent !important;
                color: inherit !important;
              }
              /* 行内 code 里的长单词也必须能断行：只给外层 p/li 设 overflow-wrap
                 不会让 inline 元素内部产生断行机会（实测仍会溢出 12px） */
              #write code {
                overflow-wrap: anywhere;
                word-break: break-word;
                color: var(--write-inline-code-color);
              }
              /* 表格在自身容器内横向滚动；单元格内的超长链接/长单词允许断行，
                 否则一个超长 URL 会把表格和整页撑宽（平板宽度下也会发生） */
              #write table { min-width: max-content; max-width: none; }
              #write table :is(th, td) {
                padding: 6px 8px;
                overflow-wrap: anywhere;
                word-break: break-word;
              }
              #write img, #write video {
                max-width: 100% !important;
                max-height: none !important;
                height: auto !important;
                box-sizing: border-box;
              }
              /* 标题按手机可读字号重排，不用视口宽度缩放字体 */
              #write h1 { font-size: 1.45rem; line-height: 1.35; }
              #write h2 { font-size: 1.25rem; line-height: 1.4; }
              #write h3 { font-size: 1.1rem; line-height: 1.45; }
              /* 引用与列表左右缩进收敛 */
              #write blockquote { margin-left: 0; margin-right: 0; padding: 8px 12px; }
              #write ul, #write ol { padding-left: 22px; }
              /* 上下标：Tailwind preflight 把所有元素重置为 vertical-align: baseline，
                 这里在正文样式边界内恢复上下标语义（不影响正文以外的界面） */
              #write sub { vertical-align: sub; font-size: 0.78em; }
              #write sup { vertical-align: super; font-size: 0.78em; }
            }
          `}</style>
          <div id="write">
            <Markdown content={content} notes={notes} onOpenNote={onOpenNote} onCreateNote={onCreateNote} />
          </div>
        </>,
        shadow,
      )}
    </div>
  )
}
