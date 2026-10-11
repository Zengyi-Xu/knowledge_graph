import React, { useMemo } from 'react'
import type { Note } from '@/types/note'
import { parseMarkdown } from '@/lib/md'
import type { Align, Block, DefItem, FootnoteItem, Inline, ListItem, TocItem } from '@/lib/md'
import { parseTex } from '@/lib/tex'
import type { Tex } from '@/lib/tex'

interface Props {
  content: string
  notes?: Note[]
  onOpenNote?: (id: string) => void
  onCreateNote?: (title: string) => void
}

interface Ctx {
  linkIndex?: Map<string, Note>
  onOpenNote?: (id: string) => void
  onCreateNote?: (title: string) => void
}

/**
 * 渲染层保持"语义 DOM + Typora 兼容类名"：
 *   .md-fences / .md-meta-block / .md-task-list-item / .md-footnote / .md-toc / .mathjax-block
 * 这样 src/themes 里的 Typora 主题能直接命中。视觉样式集中在 src/markdown-base.css，
 * 不再用 Tailwind 工具类堆在正文里（preflight 会把列表符号、标题层级重置掉）。
 */

/* ------------------------------------------------------------------ 行内渲染 */

/** 数学（LaTeX 子集）渲染；不支持时返回 null，调用方退化成显示源码 */
function renderTex(nodes: Tex[], key: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    // 大运算符（∫ ∑ ∏）的上下限竖排，和 Typora/MathJax 的观感一致
    if (n.t === 'op') {
      const next = nodes[i + 1]
      if (next && (next.t === 'sub' || next.t === 'sup' || next.t === 'subsup')) {
        const sub = next.t === 'sub' ? next.c : next.t === 'subsup' ? next.sub : undefined
        const sup = next.t === 'sup' ? next.c : next.t === 'subsup' ? next.sup : undefined
        out.push(
          <span key={`${key}-op${i}`} className="tex-op tex-op-limits">
            <span className="tex-op-sym">{n.v}</span>
            <span className="tex-limits">
              {sup && <sup>{renderTex(sup, `${key}-op${i}-p`)}</sup>}
              {sub && <sub>{renderTex(sub, `${key}-op${i}-s`)}</sub>}
            </span>
          </span>,
        )
        i++
        continue
      }
    }
    out.push(...renderTexNode(n, `${key}-${i}`))
  }
  return out
}

function renderTexNode(n: Tex, k: string): React.ReactNode[] {
  switch (n.t) {
      case 'var':
        return [<i key={k}>{n.v}</i>]
      case 'ord':
        return [<span key={k}>{n.v}</span>]
      case 'op':
        return [
          <span key={k} className="tex-op">
            {n.v}
          </span>,
        ]
      case 'group':
        return [<span key={k}>{renderTex(n.c, k)}</span>]
      case 'frac':
        return [
          <span key={k} className="tex-frac">
            <span className="tex-frac-num">{renderTex(n.num, k + '-n')}</span>
            <span className="tex-frac-den">{renderTex(n.den, k + '-d')}</span>
          </span>,
        ]
      case 'sqrt':
        return [
          <span key={k} className="tex-sqrt">
            {n.idx && <span className="tex-sqrt-idx">{renderTex(n.idx, k + '-i')}</span>}
            <span className="tex-sqrt-sign">√</span>
            <span className="tex-sqrt-body">{renderTex(n.c, k + '-b')}</span>
          </span>,
        ]
      case 'sup':
        return [<sup key={k}>{renderTex(n.c, k)}</sup>]
      case 'sub':
        return [<sub key={k}>{renderTex(n.c, k)}</sub>]
      case 'subsup':
        return [
          <span key={k} className="tex-subsup">
            <sup>{renderTex(n.sup, k + '-p')}</sup>
            <sub>{renderTex(n.sub, k + '-s')}</sub>
          </span>,
        ]
      case 'space':
        return [<span key={k} className="tex-space" style={{ width: n.w }} />]
      case 'text':
        return [
          <span key={k} className="tex-text">
            {n.v}
          </span>,
        ]
      case 'accent':
        return [
          <span key={k} className={`tex-accent${n.below ? ' tex-accent-below' : ''}`} data-mark={n.mark}>
            {renderTex(n.c, k)}
          </span>,
        ]
    default:
      return []
  }
}

function renderMath(value: string, display: boolean, key: string): React.ReactNode {
  const tex = parseTex(value)
  if (display) {
    return (
      <div key={key} className="mathjax-block">
        {tex ? (
          <span className="tex-display">{renderTex(tex, key)}</span>
        ) : (
          <div className="md-math-src">{value}</div>
        )}
      </div>
    )
  }
  if (!tex) {
    return (
      <span key={key} className="md-math-inline" data-math={value}>
        {value}
      </span>
    )
  }
  return (
    <span key={key} className="md-math-inline" data-math={value}>
      {renderTex(tex, key)}
    </span>
  )
}

function renderInline(nodes: Inline[], keyPrefix: string, ctx: Ctx): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`
    switch (node.t) {
      case 'text':
        return node.v
      case 'strong':
        return <strong key={key}>{renderInline(node.c, key, ctx)}</strong>
      case 'em':
        return <em key={key}>{renderInline(node.c, key, ctx)}</em>
      case 'del':
        return <del key={key}>{renderInline(node.c, key, ctx)}</del>
      case 'mark':
        return <mark key={key}>{renderInline(node.c, key, ctx)}</mark>
      case 'code':
        return <code key={key}>{node.v}</code>
      case 'link':
        return (
          <a
            key={key}
            href={node.href}
            title={node.title}
            target="_blank"
            rel="noreferrer noopener"
          >
            {renderInline(node.c, key, ctx)}
          </a>
        )
      case 'image':
        return (
          <img key={key} className="md-inline-img" src={node.src} alt={node.alt} title={node.title} loading="lazy" />
        )
      case 'wikilink': {
        const found = ctx.linkIndex?.get(node.target.toLowerCase())
        return (
          <button
            key={key}
            type="button"
            onClick={() => (found ? ctx.onOpenNote?.(found.id) : ctx.onCreateNote?.(node.target))}
            className={`md-wikilink rounded px-1 underline decoration-dotted underline-offset-2 transition-colors ${
              found ? 'text-primary hover:bg-primary/10' : 'text-muted-foreground hover:bg-muted'
            }`}
            title={found ? '打开笔记' : '点击创建这篇笔记'}
          >
            {node.alias ?? node.target}
            {!found && <span className="ml-0.5 opacity-60">?</span>}
          </button>
        )
      }
      case 'tag':
        return (
          <span key={key} className="md-tag rounded-full bg-accent px-1.5 py-0.5 text-[0.85em] text-accent-foreground">
            #{node.v}
          </span>
        )
      case 'sub':
        return <sub key={key}>{renderInline(node.c, key, ctx)}</sub>
      case 'sup':
        return <sup key={key}>{renderInline(node.c, key, ctx)}</sup>
      case 'br':
        return <br key={key} />
      case 'math':
        return renderMath(node.v, false, key)
      case 'emoji':
        return (
          <span key={key} className="md-emoji" title={`:${node.v}:`}>
            {node.char}
          </span>
        )
      case 'html':
        return <span key={key} className="md-html" dangerouslySetInnerHTML={{ __html: node.v }} />
      case 'footnote-ref':
        return (
          <sup key={key} className="md-footnote" id={node.id}>
            <a href={`#fn-${node.index}`}>{node.index}</a>
          </sup>
        )
      default:
        return null
    }
  })
}

/* ------------------------------------------------------------------ 块级渲染 */

const ALIGN_STYLE: Record<Exclude<Align, null>, React.CSSProperties> = {
  left: { textAlign: 'left' },
  center: { textAlign: 'center' },
  right: { textAlign: 'right' },
}

function renderListItem(item: ListItem, key: string, ctx: Ctx, tight: boolean): React.ReactNode {
  const blocks = item.blocks
  const isTask = item.checked !== undefined
  const className = isTask ? 'md-task-list-item task-list-item' : undefined
  const checkbox = isTask ? (
    <input type="checkbox" className="md-task-checkbox" defaultChecked={item.checked} disabled />
  ) : null
  const simple = tight && blocks.length === 1 && blocks[0].t === 'paragraph'

  if (simple) {
    const p = blocks[0] as Extract<Block, { t: 'paragraph' }>
    return (
      <li key={key} className={className}>
        {checkbox}
        {renderInline(p.c, key + '-p', ctx)}
      </li>
    )
  }

  // 多项/多项块：复选框放进第一段里，避免它自己占一行（Typora 的 li 结构）
  const [first, ...rest] = blocks
  if (first && first.t === 'paragraph') {
    return (
      <li key={key} className={className}>
        <p>
          {checkbox}
          {renderInline(first.c, key + '-p0', ctx)}
        </p>
        {rest.length > 0 && renderBlocks(rest, key + '-rest', ctx)}
      </li>
    )
  }

  return (
    <li key={key} className={className}>
      {checkbox}
      {renderBlocks(blocks, key, ctx)}
    </li>
  )
}

function renderToc(items: TocItem[], key: string): React.ReactNode {
  if (!items.length) return null
  const min = Math.min(...items.map((t) => t.level))
  return (
    <nav key={key} className="md-toc" aria-label="目录">
      <div className="md-toc-title">目录</div>
      <ul className="md-toc-list">
        {items.map((t, i) => (
          <li key={i} className="md-toc-item" style={{ marginLeft: `${(t.level - min) * 1.1}em` }}>
            <a href={`#${t.id}`}>{t.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function renderDefList(items: DefItem[], key: string, ctx: Ctx): React.ReactNode {
  return (
    <dl key={key} className="md-deflist">
      {items.map((it, i) => (
        <React.Fragment key={i}>
          <dt>{renderInline(it.term, `${key}-t${i}`, ctx)}</dt>
          {it.defs.map((d, di) => (
            <dd key={di}>{renderInline(d, `${key}-d${i}-${di}`, ctx)}</dd>
          ))}
        </React.Fragment>
      ))}
    </dl>
  )
}

function renderFootnotes(items: FootnoteItem[], key: string, ctx: Ctx): React.ReactNode {
  if (!items.length) return null
  return (
    <section key={key} className="md-footnotes">
      <hr className="md-footnotes-sep" />
      <ol>
        {items.map((f) => {
          const back = (
            <a className="md-footnote-back" href={`#${f.refId}`} title="返回正文">
              ↩
            </a>
          )
          const last = f.blocks[f.blocks.length - 1]
          // 返回锚点跟在最后一段里，避免自己占一行
          if (last && last.t === 'paragraph') {
            return (
              <li key={f.label} id={f.id}>
                {renderBlocks(f.blocks.slice(0, -1), `${key}-${f.label}`, ctx)}
                <p>
                  {renderInline(last.c, `${key}-${f.label}-last`, ctx)} {back}
                </p>
              </li>
            )
          }
          return (
            <li key={f.label} id={f.id}>
              {renderBlocks(f.blocks, `${key}-${f.label}`, ctx)}
              {back}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function renderBlocks(blocks: Block[], keyPrefix: string, ctx: Ctx): React.ReactNode {
  return blocks.map((b, i) => {
    const key = `${keyPrefix}-${i}`
    switch (b.t) {
      case 'heading': {
        const Tag = `h${Math.min(Math.max(b.level, 1), 6)}` as React.ElementType
        return (
          <Tag key={key} id={b.id || undefined}>
            {renderInline(b.c, key, ctx)}
          </Tag>
        )
      }
      case 'paragraph': {
        // 只有图片的段落按 Typora 的 figure.md-image 结构渲染
        if (b.c.length === 1 && b.c[0].t === 'image') {
          const img = b.c[0]
          return (
            <figure key={key} className="md-image">
              <img src={img.src} alt={img.alt} title={img.title} loading="lazy" />
              {img.title && <figcaption className="md-meta">{img.title}</figcaption>}
            </figure>
          )
        }
        return <p key={key}>{renderInline(b.c, key, ctx)}</p>
      }
      case 'hr':
        return <hr key={key} />
      case 'code':
        return (
          <pre key={key} className="md-fences" lang={b.lang || undefined} data-lang={b.info || undefined}>
            <code className={b.lang ? `language-${b.lang}` : undefined}>{b.v}</code>
          </pre>
        )
      case 'math':
        return renderMath(b.v, true, key)
      case 'quote':
        return <blockquote key={key}>{renderBlocks(b.blocks, key, ctx)}</blockquote>
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul'
        return (
          <Tag key={key} start={b.ordered && b.start !== 1 ? b.start : undefined}>
            {b.items.map((it, idx) => renderListItem(it, `${key}-i${idx}`, ctx, b.tight))}
          </Tag>
        )
      }
      case 'table':
        return (
          <div key={key} className="md-table">
            <table>
              <thead>
                <tr>
                  {b.header.map((cell, ci) => (
                    <th
                      key={ci}
                      style={b.align[ci] ? ALIGN_STYLE[b.align[ci] as Exclude<Align, null>] : undefined}
                    >
                      {renderInline(cell, `${key}-h${ci}`, ctx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        style={b.align[ci] ? ALIGN_STYLE[b.align[ci] as Exclude<Align, null>] : undefined}
                      >
                        {renderInline(cell, `${key}-r${ri}c${ci}`, ctx)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      case 'deflist':
        return renderDefList(b.items, key, ctx)
      case 'html':
        // 纯注释的 HTML 块清洗后为空，不渲染（否则会留一个空 div 占位）
        if (!b.v.trim()) return null
        return <div key={key} className="md-html-block" dangerouslySetInnerHTML={{ __html: b.v }} />
      case 'meta':
        return (
          <pre key={key} className="md-meta-block">
            {b.v}
          </pre>
        )
      case 'toc':
        return renderToc(b.items, key)
      case 'footnotes':
        return renderFootnotes(b.items, key, ctx)
      default:
        return null
    }
  })
}

/* ------------------------------------------------------------------ 组件 */

export function Markdown({ content, notes, onOpenNote, onCreateNote }: Props) {
  const linkIndex = useMemo(() => {
    const map = new Map<string, Note>()
    for (const n of notes ?? []) map.set(n.title.toLowerCase(), n)
    return map
  }, [notes])

  const blocks = useMemo(() => parseMarkdown(content), [content])

  return <div className="md-body">{renderBlocks(blocks, 'b', { linkIndex, onOpenNote, onCreateNote })}</div>
}
