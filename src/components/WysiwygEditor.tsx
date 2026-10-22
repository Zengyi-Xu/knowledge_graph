import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from 'next-themes'
import Vditor from 'vditor'
import { Bold, Code, Heading1, Heading2, Heading3, Italic, Link as LinkIcon, List, ListOrdered, Quote, Strikethrough } from 'lucide-react'
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

const TOOLBAR_BASE: Array<string | IMenuItem> = [
  // 标题按钮自带的 ⌘H 在浏览器里是「历史记录」，按了只会跳页；这里换成 Alt+1…6 并在提示里写清楚
  { name: 'headings', tip: '标题（Alt+1…6）', hotkey: '' },
  'bold', 'italic', 'strike', '|',
  'list', 'ordered-list', 'check', 'quote', '|',
  'code', 'inline-code', 'table', 'link',
  '|', 'undo', 'redo',
]

/** 选中文字后浮出的排版条（Word 的迷你工具栏）：按钮直接转发给 Vditor 工具栏的对应项，
 *  不另写一套格式化逻辑（选区、撤销栈、序列化都仍归 Vditor）。 */
const BUBBLE_BUTTONS: Array<{ label: string; selector: string; icon: ReactNode; divider?: boolean }> = [
  { label: '一级标题', selector: '.vditor-toolbar [data-tag="h1"]', icon: <Heading1 className="h-4 w-4" /> },
  { label: '二级标题', selector: '.vditor-toolbar [data-tag="h2"]', icon: <Heading2 className="h-4 w-4" /> },
  { label: '三级标题', selector: '.vditor-toolbar [data-tag="h3"]', icon: <Heading3 className="h-4 w-4" />, divider: true },
  { label: '加粗', selector: '.vditor-toolbar button[data-type="bold"]', icon: <Bold className="h-4 w-4" /> },
  { label: '斜体', selector: '.vditor-toolbar button[data-type="italic"]', icon: <Italic className="h-4 w-4" /> },
  { label: '删除线', selector: '.vditor-toolbar button[data-type="strike"]', icon: <Strikethrough className="h-4 w-4" />, divider: true },
  { label: '行内代码', selector: '.vditor-toolbar button[data-type="inline-code"]', icon: <Code className="h-4 w-4" /> },
  { label: '引用', selector: '.vditor-toolbar button[data-type="quote"]', icon: <Quote className="h-4 w-4" /> },
  { label: '无序列表', selector: '.vditor-toolbar button[data-type="list"]', icon: <List className="h-4 w-4" /> },
  { label: '有序列表', selector: '.vditor-toolbar button[data-type="ordered-list"]', icon: <ListOrdered className="h-4 w-4" />, divider: true },
  { label: '链接', selector: '.vditor-toolbar button[data-type="link"]', icon: <LinkIcon className="h-4 w-4" /> },
]

/** 浮动排版条距选区边缘的间距、离窗口上沿多近就改到选区下方 */
const BUBBLE_GAP = 8
const BUBBLE_FLIP_TOP = 64
const BUBBLE_HALF_WIDTH = 190


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

/** 光标后面的第一段文本：先看同级兄弟，再往元素内部找（Vditor 的 <wbr> 会把一个文本节点拆成两段） */
function nextTextNode(from: Node): Text | null {
  let node: Node | null = from.nextSibling
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) return node as Text
    if (node.nodeType === Node.ELEMENT_NODE) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      const found = walker.nextNode()
      if (found) return found as Text
    }
    node = node.nextSibling
  }
  return null
}

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
  /** 选中文字后浮出的排版条（Word 迷你工具栏），坐标是视口坐标 */
  const [bubble, setBubble] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
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
    const value = node.nodeValue ?? ''
    const upto = value.slice(0, range.startOffset)
    const m = upto.match(WIKI_OPEN_RE)
    if (!m) return
    // 工具栏插入的是成对的空括号：光标后面紧跟的 `]]` 要一起吃进替换范围，
    // 否则选完候选会变成 `[[标题]]]]`（多出一对右括号）。Vditor 的 <wbr> 会把
    // `[[查询]]` 拆成 `[[查询` + `]]` 两个文本节点，所以要继续往后找一段。
    const trailing = value.slice(range.startOffset).startsWith(']]') ? 2 : 0
    let endNode: Node = node
    let endOffset = range.startOffset + trailing
    if (!trailing) {
      const after = nextTextNode(node)
      if (after && after.data.startsWith(']]')) {
        endNode = after
        endOffset = 2
      }
    }
    const r = document.createRange()
    r.setStart(node, range.startOffset - m[0].length)
    r.setEnd(endNode, endOffset)
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

  /** 工具栏「双链」：只插入一对空括号，光标落在中间，标题交给用户输入或从补全里选。
   *  以前直接插 `[[笔记标题]]`：它立刻被装饰成「缺失笔记」的芯片，点一下（哪怕只是想放光标）
   *  就会按这个占位标题新建一篇笔记 —— 用户要的只是一对中括号。 */
  const insertWikiPair = () => {
    const vditor = vditorRef.current
    if (!vditor) return
    setSuggest(null)
    vditor.insertValue('[[]]')
    vditor.focus()
    // 光标从 `]]` 之后退回到左右括号中间。Vditor 用 <wbr> 保存/恢复光标，插入后光标可能
    // 落在文本节点里、也可能落在 <p> 的元素偏移上；统一按「编辑区拼接文本」算出位置再定位。
    const caretBetween = () => {
      const sel = window.getSelection()
      const editor = hostRef.current?.querySelector<HTMLElement>('.vditor-reset')
      if (!sel || sel.rangeCount === 0 || !editor) return false
      const range = sel.getRangeAt(0)
      if (!editor.contains(range.startContainer)) return false
      const before = range.cloneRange()
      before.setStart(editor, 0)
      const text = before.toString()
      if (!text.endsWith(']]')) return false
      const target = text.length - 2
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
      let acc = 0
      let node = walker.nextNode()
      while (node) {
        const len = (node as Text).data.length
        if (target <= acc + len) {
          const between = document.createRange()
          between.setStart(node, target - acc)
          between.collapse(true)
          sel.removeAllRanges()
          sel.addRange(between)
          return true
        }
        acc += len
        node = walker.nextNode()
      }
      return false
    }
    // Vditor 只在处理 input 时才用 <wbr> 记住光标；手动挪完光标后补一次 input，
    // 让「光标停在 [[ 与 ]] 中间」进入它自己的渲染/还原流程，之后异步重排不会把光标推回 ]] 之后。
    const applyCaret = () => {
      if (!caretBetween()) return false
      hostRef.current?.querySelector('.vditor-reset')?.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    // Vditor 的渲染是分阶段的：第一次没找到文本节点就等下一帧再试一次
    if (!applyCaret()) requestAnimationFrame(applyCaret)
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
      click: insertWikiPair,
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

  // ---- 标题快捷键：Alt+1…6 ----
  // Vditor 自己只做了 Ctrl+Alt+1…6；浏览器里 Ctrl+1…8 是切换标签页，用户按下去只会跳走
  // （这就是「小标题没有快捷键、似乎会和切换 tab 重合」的来源）。这里补一套不冲突的 Alt+N，
  // 并把按键翻译成 Vditor 自己的组合键 —— 「已经是这一级标题就取消」的语义也复用它，不在应用里重写。
  useEffect(() => {
    if (!ready) return
    const el = hostRef.current
    if (!el) return
    const onKeydown = (e: KeyboardEvent) => {
      if (e.isComposing || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const m = /^(?:Digit|Numpad)([1-6])$/.exec(e.code)
      if (!m) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return
      const editor = el.querySelector('.vditor-reset')
      if (!editor) return
      e.preventDefault()
      e.stopPropagation()
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: m[1], code: `Digit${m[1]}`, ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
      }))
    }
    el.addEventListener('keydown', onKeydown, true)
    return () => el.removeEventListener('keydown', onKeydown, true)
  }, [ready])

  // ---- 选中文字浮出排版条（Word 的迷你工具栏）----
  // 只在桌面宽度、选区落在正文里且不在代码块时出现；按下鼠标到松开之间不显示（拖动选区时不该闪）。
  // 滚动/改窗口大小直接收起：坐标是视口坐标，位置会漂。
  useEffect(() => {
    if (!ready) return
    const host = hostRef.current
    if (!host) return
    let dragging = false
    let frame = 0

    const measure = () => {
      if (window.innerWidth < 768) return null
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
      const range = sel.getRangeAt(0)
      if (!host.contains(range.commonAncestorContainer)) return null
      const start = range.startContainer
      const el = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement
      if (el?.closest('code, .vditor-wysiwyg__pre, [data-type=code-block]')) return null
      const rects = range.getClientRects()
      const rect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect()
      if (!rect || (!rect.width && !rect.height)) return null
      const left = clampNum(
        rect.left + rect.width / 2,
        BUBBLE_HALF_WIDTH + 8,
        Math.max(BUBBLE_HALF_WIDTH + 8, window.innerWidth - BUBBLE_HALF_WIDTH - 8),
      )
      const below = rect.top < BUBBLE_FLIP_TOP
      return { left, top: below ? rect.bottom + BUBBLE_GAP : rect.top - BUBBLE_GAP, below }
    }

    const refresh = () => {
      if (dragging) { setBubble(null); return }
      setBubble(measure())
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; refresh() })
    }
    const hide = () => setBubble(null)
    const onSelectionChange = () => { if (!dragging) schedule() }
    const onMouseDown = (e: MouseEvent) => {
      if (bubbleRef.current?.contains(e.target as Node)) return
      dragging = true
      hide()
    }
    const onMouseUp = (e: MouseEvent) => {
      if (bubbleRef.current?.contains(e.target as Node)) return
      dragging = false
      schedule()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('mouseup', onMouseUp, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('mouseup', onMouseUp, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [ready])

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
      {bubble && (
        <div
          ref={bubbleRef}
          data-testid="wysiwyg-bubble"
          role="toolbar"
          aria-label="选中文字排版"
          className="fixed z-40 hidden items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-lg md:flex"
          style={{
            left: bubble.left,
            top: bubble.top,
            transform: bubble.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
          // 拦住默认行为：点按钮时不把焦点/选区从正文里抢走，Vditor 才能对当前选区生效
          onMouseDown={(e) => e.preventDefault()}
        >
          {BUBBLE_BUTTONS.map((item) => (
            <span key={item.label} className="flex items-center">
              <button
                type="button"
                title={item.label}
                aria-label={item.label}
                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => {
                  // 直接点 Vditor 工具栏上的同名按钮：格式化、撤销栈、序列化都仍由它负责。
                  // Vditor 只在 click/keyup 时刷新按钮的可用状态（拖选文本不会触发），可能残留
                  // 「在代码块里时被禁用」的 class；这里按「正文里有选区」的事实先解禁再点。
                  const target = hostRef.current?.querySelector<HTMLElement>(item.selector)
                  if (target) {
                    target.classList.remove('vditor-menu--disabled')
                    target.click()
                  }
                  setBubble(null)
                }}
              >
                {item.icon}
              </button>
              {item.divider && <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
