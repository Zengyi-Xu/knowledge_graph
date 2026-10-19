import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { PreviewContent } from '@/components/PreviewContent'
import fixture from './fixtures/latex-regression.md?raw'

function PreviewCard({ label, width }: { label: string; width: number }) {
  return (
    <section className="visual-card" data-visual={label} style={{ width }}>
      <h2>{label}</h2>
      <div className="preview-host">
        <PreviewContent
          content={fixture}
          notes={[]}
          onOpenNote={() => {}}
          onCreateNote={() => {}}
          theme="default"
          customCss=""
          flow
        />
      </div>
    </section>
  )
}

function App() {
  useEffect(() => {
    let attempts = 0
    const timer = window.setInterval(() => {
      attempts += 1
      const reports = [...document.querySelectorAll<HTMLElement>('[data-visual]')].map((card) => {
        const shadow = card.querySelector<HTMLElement>('.preview-host > div')?.shadowRoot
        const write = shadow?.querySelector<HTMLElement>('#write')
        const formulas = write?.querySelectorAll('.katex').length ?? 0
        const errors = write?.querySelectorAll('[data-math-error="true"]').length ?? 0
        const clone = write?.cloneNode(true) as HTMLElement | undefined
        clone?.querySelectorAll('code, pre, .katex').forEach((node) => node.remove())
        const rawCommands = (clone?.textContent?.match(/\\(?:mathrm|frac|begin|left|right)\b/gu) ?? []).length
        const display = write?.querySelector<HTMLElement>('.kg-math-display')
        return {
          label: card.dataset.visual,
          formulas,
          errors,
          rawCommands,
          pageOverflow: card.scrollWidth > card.clientWidth + 2,
          displayScrollable: display ? display.scrollWidth >= display.clientWidth : false,
        }
      })
      if (reports.every((item) => item.formulas >= 10) || attempts > 100) {
        window.clearInterval(timer)
        const failed = reports.some((item) => item.formulas < 10 || item.errors > 0 || item.rawCommands > 0 || item.pageOverflow)
        const report = document.getElementById('report')
        if (report) report.textContent = JSON.stringify({ failed, reports }, null, 2)
        document.body.dataset.ready = failed ? 'failed' : 'ok'
      }
    }, 50)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <main>
      <PreviewCard label="桌面 900px" width={900} />
      <PreviewCard label="窄栏 390px" width={390} />
      <pre id="report" />
    </main>
  )
}

const style = document.createElement('style')
style.textContent = `
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #eef1f5; color: #1f2328; font-family: system-ui, sans-serif; }
  main { display: flex; align-items: flex-start; gap: 24px; padding: 24px; }
  .visual-card { flex: none; overflow: hidden; border: 1px solid #c9d0d9; border-radius: 12px; background: white; box-shadow: 0 8px 28px #1f293714; }
  .visual-card > h2 { margin: 0; padding: 12px 18px; border-bottom: 1px solid #e3e7ed; background: #f8fafc; font-size: 15px; }
  .preview-host { padding: 0 18px 24px; }
  #report { display: none; }
`
document.head.appendChild(style)

createRoot(document.getElementById('root')!).render(<App />)

