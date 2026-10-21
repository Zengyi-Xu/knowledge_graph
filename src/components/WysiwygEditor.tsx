import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import Vditor from 'vditor'
import type { Note } from '@/types/note'
import type { PreviewTheme } from '@/lib/previewTheme'
import vditorStyles from 'vditor/dist/index.css?inline'
import liveStyles from './WysiwygEditor.css?inline'

// Vditor 官方样式 + 本组件覆写，全局只注入一次（编辑器按需加载，样式随之注入）
let stylesInjected = false
function ensureStyles() {
  if (stylesInjected) return
  stylesInjected = true
  const style = document.createElement('style')
  style.dataset.kgVditor = ''
  style.textContent = `${vditorStyles}\n${liveStyles}`
  document.head.appendChild(style)
}

interface Props {
  value: string
  noteId: string
  notes: Note[]
  onChange: (content: string) => void
  onOpenNote: (id: string) => void
  onCreateNote: (title: string) => void
  theme: PreviewTheme
  customCss: string
  /** true：编辑器随内容长高、滚动交给外层容器（单栏「笔记」视图的流式布局） */
  flow?: boolean
}

const WIKI_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 2.5 3 8l2.5 5.5M10.5 2.5 13 8l-2.5 5.5"/></svg>'

const TOOLBAR_BASE: string[] = [
  'headings', 'bold', 'italic', 'strike', '|',
  'list', 'ordered-list', 'check', 'quote', '|',
  'code', 'inline-code', 'table', 'link',
  '|', 'undo', 'redo',
]

/** 阅读主题 → Vditor 内容主题（public/vditor/dist/css/content-theme/ 下的文件）。
 *  每个主题都有真实对应的内容主题；「默认」跟随应用暗黑模式，其余按选择恒定的深浅 */
function contentThemeFor(theme: PreviewTheme, dark: boolean): string {
  switch (theme) {
    case 'default': return dark ? 'dark' : 'light'
    case 'paper': return 'paper'
    case 'night': return 'dark'
    case 'vue-light': return 'vue-light'
    case 'vue-night': return 'vue-night'
    case 'custom': return 'light'
  }
}

/** 给一段 CSS 的所有选择器加作用域前缀（@media 内选择器同样加；@keyframes 内部不动） */
function scopeCss(css: string, scope: string): string {
  let out = ''
  let depth = 0
  let buf = ''
  const stack: string[] = []
  for (const ch of css) {
    if (ch === '{') {
      const head = buf.trim()
      buf = ''
      const isAt = head.startsWith('@')
      const kind = isAt ? (head.startsWith('@keyframes') ? 'kf' : 'at') : 'sel'
      stack.push(kind)
      const needScope = !isAt && (depth === 0 || stack[stack.length - 2] !== 'kf')
      if (needScope) {
        out += head.split(',').map((s) => `${scope} ${s.trim()}`).join(', ') + ' '
      } else {
        out += head + ' '
      }
      depth += 1
      out += '{'
    } else if (ch === '}') {
      out += buf + '}'
      buf = ''
      depth -= 1
      stack.pop()
    } else {
      buf += ch
    }
  }
  return out + buf
}

const WIKI_RE = /\[\[([^[\]]+)\]\]/

/** 正在输入的「半条双链」：光标前最近的一段 `[[查询词`（与经典模式的补全触发规则一致） */
const WIKI_OPEN_RE = /\[\[([^[\]]*)$/

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * 把正文里的 [[双链]] 文本包成样式化 span，与经典预览的视觉一致：
 * 隐藏 `[[ ]]` 括号、按笔记是否存在决定配色、不存在的补一个「?」。
 * 跳过代码块（`.vditor-wysiwyg__pre` / `[data-type=code-block]` 是 Vditor 保存的源码）与预览块；
 * 注意不能连普通 `<pre>` 一起排除：Vditor 的渲染块整体就装在 `pre.vditor-reset` 里。
 * 只包纯文本节点，不改动任何 Markdown 语义（括号仍是 DOM 文本，序列化不受影响）。 */
function decorateWikilinks(root: HTMLElement, notes: Note[]) {
  const titles = new Set(notes.map((n) => n.title.toLowerCase()))
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  let node = walker.nextNode()
  while (node) {
    const text = node as Text
    const el = text.parentElement
    const value = text.nodeValue ?? ''
    if (
      el && !el.closest('code, .vditor-wysiwyg__pre, [data-type=code-block], .vditor-wysiwyg__preview') &&
      !el.closest('.kg-wiki') &&
      value.includes('[[') && WIKI_RE.test(value)
    ) {
      targets.push(text)
    }
    node = walker.nextNode()
  }
  for (const text of targets) {
    const value = text.nodeValue ?? ''
    const frag = document.createDocumentFragment()
    let rest = value
    for (;;) {
      const m = rest.match(WIKI_RE)
      if (!m || m.index === undefined) break
      if (m.index > 0) frag.appendChild(document.createTextNode(rest.slice(0, m.index)))
      const title = m[1]
      const found = titles.has(title.toLowerCase())
      const span = document.createElement('span')
      span.className = 'kg-wiki'
      span.dataset.title = title
      span.dataset.found = String(found)
      span.title = found ? '打开笔记' : '点击创建这篇笔记'
      const open = document.createElement('span')
      open.className = 'kg-wiki-bracket'
      open.textContent = '[['
      const label = document.createTextNode(title)
      const close = document.createElement('span')
      close.className = 'kg-wiki-bracket'
      close.textContent = ']]'
      span.append(open, label, close)
      if (!found) {
        const missing = document.createElement('span')
        missing.className = 'kg-wiki-missing'
        missing.textContent = '?'
        span.appendChild(missing)
      }
      frag.appendChild(span)
      rest = rest.slice(m.index + m[0].length)
    }
    if (rest) frag.appendChild(document.createTextNode(rest))
    text.parentNode?.replaceChild(frag, text)
  }
}

/** Word/OneNote 式所见即所得：正文始终可直接输入，格式随打随排版。
 * Markdown 字符串进 / 字符串出，不经 DOM 反序列化；与经典模式共用同一存储管道。 */
export default function WysiwygEditor({ value, onChange, onOpenNote, onCreateNote, noteId, notes, theme, customCss, flow = false }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const vditorRef = useRef<Vditor | null>(null)
  const [ready, setReady] = useState(false)
  const lastEmittedRef = useRef(value)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const navRef = useRef({ onOpenNote, onCreateNote, noteId, notes })
  navRef.current = { onOpenNote, onCreateNote, noteId, notes }
  const { resolvedTheme } = useTheme()

  // ---- [[ 双链补全：输入 [[ 后按标题过滤，下拉选择（与经典模式同一套规则） ----
  const rootRef = useRef<HTMLDivElement>(null)
  const [suggest, setSuggest] = useState<{ query: string; x: number; y: number } | null>(null)
  const [suggestIndex, setSuggestIndex] = useState(0)
  const suggestCandidates = useMemo(() => {
    if (!suggest) return []
    const q = suggest.query.toLowerCase()
    return notes.filter((n) => n.id !== noteId && n.title.toLowerCase().includes(q)).slice(0, 6)
  }, [suggest, notes, noteId])

  /** 读当前光标：前面是不是一段没闭合的 `[[查询词`；是就按光标坐标展开下拉 */
  const refreshSuggest = () => {
    const host = hostRef.current
    const root = rootRef.current
    const sel = window.getSelection()
    if (!host || !root || !sel || sel.rangeCount === 0 || !sel.isCollapsed) {
      setSuggest(null)
      return
    }
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE || !host.contains(node)) {
      setSuggest(null)
      return
    }
    // 代码块里不补全
    const el = (node as Text).parentElement
    if (el?.closest('code, .vditor-wysiwyg__pre, [data-type=code-block]')) {
      setSuggest(null)
      return
    }
    const upto = (node.nodeValue ?? '').slice(0, range.startOffset)
    const m = upto.match(WIKI_OPEN_RE)
    if (!m) {
      setSuggest(null)
      return
    }
    const probe = range.cloneRange()
    probe.collapse(true)
    let rect = probe.getBoundingClientRect()
    if (!rect || (rect.x === 0 && rect.y === 0)) rect = el?.getBoundingClientRect() ?? rect
    const rootRect = root.getBoundingClientRect()
    const x = clampNum(rect.left - rootRect.left, 4, Math.max(4, rootRect.width - 268))
    const y = rect.bottom - rootRect.top + 4
    setSuggest((prev) => {
      if (prev && prev.query === m[1] && Math.abs(prev.x - x) < 2 && Math.abs(prev.y - y) < 2) return prev
      if (!prev || prev.query !== m[1]) setSuggestIndex(0)
      return { query: m[1], x, y }
    })
  }

  /** 采纳候选：把光标前的 `[[查询词` 整段换成 `[[标题]]`，再让 Vditor 感知这次 DOM 改动 */
  const pickSuggestion = (title: string) => {
    const host = hostRef.current
    const sel = window.getSelection()
    setSuggest(null)
    if (!host || !sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE || !host.contains(node)) return
    const upto = (node.nodeValue ?? '').slice(0, range.startOffset)
    const m = upto.match(WIKI_OPEN_RE)
    if (!m) return
    const r = document.createRange()
    r.setStart(node, range.startOffset - m[0].length)
    r.setEnd(node, range.startOffset)
    r.deleteContents()
    const tn = document.createTextNode(`[[${title}]]`)
    r.insertNode(tn)
    const after = document.createRange()
    after.setStartAfter(tn)
    after.collapse(true)
    sel.removeAllRanges()
    sel.addRange(after)
    // 通知 Vditor 重新序列化（它监听的是 contenteditable 上的 input 事件）
    host.querySelector('.vditor-reset')?.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const decorate = () => {
    const root = hostRef.current?.querySelector('.vditor-wysiwyg')
    if (!root) return
    decorateWikilinks(root as HTMLElement, navRef.current.notes)
    if (root.querySelector('.vditor-wysiwyg__block[data-type^="math-"]')) {
      void import('@/lib/katexRuntime').then(({ hydrateVditorMath }) => {
        if (hostRef.current?.contains(root)) hydrateVditorMath(root as HTMLElement)
      })
    }
  }

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    ensureStyles()
    let disposed = false
    const wikiItem: IMenuItem = {
      name: 'wiki', tip: '双链', icon: WIKI_ICON,
      click: () => vditor.insertValue('[[笔记标题]]'),
    }
    const vditor = new Vditor(el, {
      mode: 'wysiwyg',
      value,
      cdn: 'vditor',
      lang: 'zh_CN',
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'classic',
      cache: { enable: false },
      // 关掉 Vditor 自带的「内容列居中」排版（它会把工具栏推到中间），改由 CSS 做 Word 式左对齐
      preview: {
        maxWidth: 10000,
        // 允许 `$10\\log…$` 这类以数字开头的行内公式；渲染由本应用内置的
        // KaTeX 完成，不依赖 Vditor 的外部 CDN 脚本。
        math: { engine: 'KaTeX', inlineDigit: true },
      },
      toolbar: [...TOOLBAR_BASE.slice(0, 12), wikiItem, ...TOOLBAR_BASE.slice(12)],
      link: {
        // 外部链接交给系统浏览器；编辑区内不做应用内跳转
        click: (bom) => {
          const href = bom.getAttribute('href')
          if (href && /^https?:\/\//.test(href)) window.open(href, '_blank', 'noopener')
        },
      },
      input: (v) => {
        lastEmittedRef.current = v
        onChangeRef.current(v)
      },
      after: () => {
        if (disposed) return
        setReady(true)
      },
    })
    vditorRef.current = vditor
    return () => {
      disposed = true
      setReady(false)
      vditorRef.current = null
      vditor.destroy()
    }
    // 组件以 key={note.id} 按笔记重挂载，这里只初始化一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部写入（同步/AI 更新等）才回写编辑器，避免打字中被自己的 onChange 回写打断光标
  useEffect(() => {
    if (!ready) return
    if (value === lastEmittedRef.current) return
    lastEmittedRef.current = value
    vditorRef.current?.setValue(value)
  }, [value, ready])

  // Vditor 的渲染/重排全是异步多阶段的（输入、代码高亮、setValue 都会改写 DOM）。
  // 用 MutationObserver 在任意改写后补双链装饰；装饰本身幂等，不会死循环。
  useEffect(() => {
    if (!ready) return
    const root = hostRef.current?.querySelector('.vditor-wysiwyg')
    if (!root) return
    let scheduled = false
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        decorate()
      })
    })
    observer.observe(root, { childList: true, subtree: true })
    decorate()
    return () => observer.disconnect()
  }, [ready])

  // 阅读主题 → Vditor 内容主题；夜读类主题或应用暗黑模式下整个编辑器（外壳+内容）转深色
  useEffect(() => {
    if (!ready) return
    const dark = resolvedTheme === 'dark' || theme === 'night' || theme === 'vue-night'
    vditorRef.current?.setTheme(dark ? 'dark' : 'classic', contentThemeFor(theme, resolvedTheme === 'dark'))
  }, [theme, resolvedTheme, ready])

  // 自定义 Typora CSS：选择器加作用域前缀后注入，仅影响编辑器内容区
  useEffect(() => {
    if (theme !== 'custom' || !customCss.trim()) return
    const style = document.createElement('style')
    style.dataset.kgVditorCustom = ''
    style.textContent = scopeCss(customCss, '.kg-vditor .vditor-wysiwyg .vditor-reset')
    document.head.appendChild(style)
    return () => style.remove()
  }, [theme, customCss])

  // [[ 补全：输入/点击/按键后重查光标；滚动时直接收起（位置会漂）
  useEffect(() => {
    if (!ready) return
    const el = hostRef.current
    if (!el) return
    let scheduled = false
    const onEditEvent = () => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        refreshSuggest()
      })
    }
    const onScroll = () => setSuggest(null)
    el.addEventListener('input', onEditEvent)
    el.addEventListener('keyup', onEditEvent)
    el.addEventListener('click', onEditEvent)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      el.removeEventListener('input', onEditEvent)
      el.removeEventListener('keyup', onEditEvent)
      el.removeEventListener('click', onEditEvent)
      window.removeEventListener('scroll', onScroll, true)
    }
    // refreshSuggest 只读 ref/state setter，闭包稳定
  }, [ready])

  // 下拉展开时的键盘导航：↑↓ 选、Enter/Tab 采纳、Esc 收起（捕获阶段拦截，别让 Vditor 当成换行）
  useEffect(() => {
    if (!ready || !suggest || suggestCandidates.length === 0) return
    const el = hostRef.current
    if (!el) return
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setSuggestIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestCandidates.length - 1)) % suggestCandidates.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        pickSuggestion((suggestCandidates[suggestIndex] ?? suggestCandidates[0]).title)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setSuggest(null)
      }
    }
    el.addEventListener('keydown', onKeydown, true)
    return () => el.removeEventListener('keydown', onKeydown, true)
    // pickSuggestion 只读 ref，闭包稳定
  }, [ready, suggest, suggestCandidates, suggestIndex])

  // 双链点击 = 应用内跳转（与经典预览一致）：已有笔记直接打开（含自身，等于无操作），否则按标题新建
  const handleHostClick = (e: React.MouseEvent) => {
    const span = (e.target as HTMLElement).closest?.('.kg-wiki') as HTMLElement | null
    if (!span) return
    e.preventDefault()
    const title = span.dataset.title ?? (span.textContent ?? '').replace(/^\[\[|\]\]\??$/g, '')
    if (!title) return
    const { onOpenNote: open, onCreateNote: create, notes: all } = navRef.current
    const found = all.find((n) => n.title === title)
    if (found) open(found.id)
    else create(title)
  }

  return (
    <div ref={rootRef} className={flow ? 'relative flex flex-col' : 'relative flex min-h-0 flex-1 flex-col'} data-testid="wysiwyg-editor">
      <div ref={hostRef} className={flow ? 'kg-vditor kg-vditor-flow' : 'kg-vditor min-h-0 flex-1'} onClick={handleHostClick} />
      {suggest && suggestCandidates.length > 0 && (
        <div
          className="absolute z-20 max-h-60 w-64 overflow-y-auto rounded-md border bg-popover shadow-md"
          style={{ left: suggest.x, top: suggest.y }}
          role="listbox"
          aria-label="匹配笔记"
        >
          {suggestCandidates.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={i === suggestIndex}
              // mousedown 拦住默认行为：保住编辑器里的光标/选区，pickSuggestion 才能找到 `[[查询词`
              onMouseDown={(e) => {
                e.preventDefault()
                pickSuggestion(c.title)
              }}
              onMouseEnter={() => setSuggestIndex(i)}
              className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-accent ${
                i === suggestIndex ? 'bg-accent' : ''
              }`}
            >
              {c.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
