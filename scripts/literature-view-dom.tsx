/**
 * 文献表真实 DOM 交互自测（在无头 Chrome 里跑，页面自带探针脚本）。
 *
 * 覆盖 node 层测不到的交互：单击 PDF 徽标**立即**触发（不是 220ms 延迟）、「显示更多」真的加 150 行、
 * 筛选变化把分页退回首页、标签列切换、Zotero 同步对话框「读取 → 预览 → 应用」全流程。
 *
 * 依赖全部打桩（window.knowledgeGraphDesktop 是假的），不读真实 vault / 真实 Zotero 库。
 * 结果写进 <pre id="report">，由 scripts/lit-view-dom-test.mjs 用 chrome --dump-dom 取回。
 */
import { createRoot } from 'react-dom/client'
import { LiteratureView } from '@/components/LiteratureView'
import type { Note } from '@/types/note'
import type { ZoteroSyncUpdate } from '@/lib/zoteroSync'

// ---------- fixture ----------

const CATEGORY_PATHS = ['硅光/调制器/高速', '硅光/探测器', '算法', '硅光']

function litNote(id: string, title: string, partial: Partial<Note['literature']> = {}, tags: string[] = []): Note {
  return {
    id,
    title,
    type: 'literature',
    grade: '',
    tags,
    content: '',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    literature: {
      authors: ['Zhang, San'],
      venue: 'Nature Photonics',
      year: 2024,
      doi: `10.1000/${id}`,
      citekey: id,
      attachments: [],
      collections: [],
      ...partial,
    },
  }
}

/** 400 篇（年份 2000–2024 轮转，每档 16 篇）+ 带 PDF 的 5 篇 */
const NOTES: Note[] = [
  ...Array.from({ length: 400 }, (_, i) =>
    litNote(`n${i}`, `Paper ${String(i).padStart(3, '0')}`, {
      year: 2000 + (i % 25),
      collections: [CATEGORY_PATHS[i % CATEGORY_PATHS.length]],
    }, i % 10 === 0 ? ['方向:硅光'] : []),
  ),
  litNote('p-local', '本地 PDF 的一篇', { localPdf: 'D:/pdfs/local.pdf', collections: [] }),
  litNote('p-zotero', 'Zotero 里有 PDF 的一篇', { zoteroKey: 'AAAA1111', zoteroPdfCount: 1, zoteroAvailablePdfCount: 1, collections: [] }),
  litNote('p-missing', '文件不在本机的一篇', { zoteroKey: 'BBBB2222', zoteroPdfCount: 1, zoteroAvailablePdfCount: 0, collections: [] }),
  litNote('p-unsynced', '未同步的一篇', { zoteroKey: 'CCCC3333', collections: [] }),
  litNote('p-none', '没有 PDF 的一篇', { collections: [] }),
]

/** 同步对话框用：一篇能被 key 匹配上的笔记 */
const SYNC_NOTES: Note[] = [
  ...NOTES,
  litNote('n-sync', 'Silicon photonics for quantum computing', { zoteroKey: 'DDDD4444', doi: '10.1038/sync', collections: [] }),
]

// ---------- 打桩的桌面桥 ----------

const calls: string[] = []

const fakeBridge = {
  // 能力检测只看客观信号（桥上的方法在不在 + 这台机器是不是宿主）：
  // 桩要跟真实 preload 一样声明 isElectron，并给全本机能力必需的方法，
  // 否则「同步 Zotero 分类」会被正确降级成只提示、不打开对话框。
  isElectron: true,
  isLocalWeb: false,
  defaultZoteroDb: 'D:/fake/zotero.sqlite',
  openExternalFile: async (filePath: string) => {
    calls.push(`openExternalFile:${filePath}`)
    return { error: null }
  },
  openZoteroPdf: async (dbPath: string, zoteroKey: string, zoteroKeys?: string[]) => {
    calls.push(`openZoteroPdf:${zoteroKey}:${(zoteroKeys ?? []).join(',')}`)
    return { path: 'D:/fake/out.pdf' }
  },
  selectZoteroItem: async (zoteroKey: string) => {
    calls.push(`selectZoteroItem:${zoteroKey}`)
    return { error: null }
  },
  readZotero: async (dbPath: string) => {
    calls.push(`readZotero:${dbPath}`)
    return {
      collections: ['硅光', '硅光/调制器'],
      items: [
        {
          zoteroKey: 'DDDD4444',
          itemType: 'journalArticle',
          title: 'Silicon photonics for quantum computing',
          doi: '10.1038/sync',
          year: 2024,
          venue: 'Nature Photonics',
          authors: ['Zhang, San'],
          collectionPaths: ['硅光/调制器'],
          pdfCount: 1,
          availablePdfCount: 1,
        },
        {
          zoteroKey: 'EEEE5555',
          itemType: 'journalArticle',
          title: 'Zotero 里有、笔记里没有的一篇',
          doi: '10.1038/unmatched',
          year: 2020,
          venue: '其它',
          authors: [],
          collectionPaths: ['其它'],
          pdfCount: 0,
          availablePdfCount: 0,
        },
      ],
    }
  },
  readZoteroPdf: async (_dbPath: string, zoteroKey: string) => {
    calls.push(`readZoteroPdf:${zoteroKey}`)
    return { data: new Uint8Array([1, 2, 3]), name: `${zoteroKey}.pdf`, path: `D:/fake/${zoteroKey}.pdf` }
  },
}

window.knowledgeGraphDesktop = fakeBridge as unknown as NonNullable<typeof window.knowledgeGraphDesktop>

let applied: ZoteroSyncUpdate[] | null = null
let openedNote = ''

// ---------- 探针 ----------

const lines: string[] = []
const ok = (name: string, cond: boolean, detail = '') => lines.push(`${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : ` — ${detail}`}`)
const skip = (name: string, why: string) => lines.push(`SKIP ${name} — ${why}`)
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))
const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)
const qa = <T extends Element = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)]
const byText = <T extends Element = HTMLElement>(selector: string, text: string) =>
  qa<T>(selector).find((el) => (el.textContent ?? '').trim().includes(text))

/** 数据行 = tbody 里有 title（文献标题）的行；「显示更多」与空状态行没有 title */
const dataRows = () => qa('tbody tr[title]')

/** React 受控 input 必须走原生 setter + input 事件，否则 onChange 不触发 */
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error('要点的元素不存在')
  ;(el as HTMLElement).click()
}

async function probe() {
  // --- 首屏 ---
  await tick()
  ok('探针窗口是桌面宽度（测的是表格，不是手机卡片）', window.innerWidth >= 768, `innerWidth=${window.innerWidth}`)
  ok('首屏渲染 150 行数据', dataRows().length === 150, `实际 ${dataRows().length}`)
  ok('首屏有「显示更多」，提示还剩 256 篇', Boolean(byText('button', '显示更多（还有 256 篇）')))
  const headerCells = qa('thead th').map((th) => th.textContent ?? '')
  ok('标签列默认隐藏', !headerCells.includes('标签'), headerCells.join('|'))
  ok('PDF 徽标是 <button>（立即可点，不是要悬停的徽章）', Boolean(q('button[title="在软件内全屏阅读 PDF"]')))

  // --- PDF 按钮即时响应 ---
  calls.length = 0
  const pdfButton = q<HTMLButtonElement>('button[title="在软件内全屏阅读 PDF"]')
  click(pdfButton)
  ok('单击 PDF 徽标「同一帧内」就触发（无 220ms 延迟）', calls.some((c) => c.startsWith('readPdf:')), calls.join(','))
  await tick(300)
  const afterDelay = calls.filter((c) => c.startsWith('readPdf:')).length
  ok('等待 300ms 后不会再多触发一次（不是延迟触发）', afterDelay === 1, `触发 ${afterDelay} 次`)

  // --- 单击标题打开笔记（默认年份倒序 → 第一篇是 2024 年里最先建的那条 n24） ---
  calls.length = 0
  const firstTitle = dataRows()[0].querySelector('[data-slot="table-cell"]')!
  click(firstTitle)
  ok('单击标题行打开对应的那篇笔记', openedNote === 'n24', `实际 ${openedNote || '(没触发)'}`)
  ok('打开笔记走 onOpenNote 回调（表格不自己跳转）', calls.includes('openNote:n24'), calls.join(','))

  // --- 文件不在本机 → 在 Zotero 打开 ---
  calls.length = 0
  const zoteroOpen = byText<HTMLButtonElement>('button', '文件不在本机 · 在 Zotero 打开')
  ok('「文件不在本机」是按钮（引导去 Zotero）', Boolean(zoteroOpen))
  click(zoteroOpen)
  await tick()
  ok('它调用 selectZoteroItem 定位条目', calls.some((c) => c.startsWith('selectZoteroItem:BBBB2222')), calls.join(','))

  // --- 标签列切换 ---
  click(byText('button', '标签列'))
  await tick()
  const withTags = qa('thead th').map((th) => th.textContent ?? '')
  ok('点「标签列」后表头出现标签列', withTags.includes('标签'), withTags.join('|'))
  ok('标签 chip 渲染出来（每 10 篇一个 #方向:硅光）', document.body.textContent!.includes('#方向:硅光'))
  click(byText('button', '标签列'))
  await tick()
  ok('再点一次隐藏标签列', !qa('thead th').map((th) => th.textContent ?? '').includes('标签'))

  // --- 显示更多 ---
  click(byText('button', '显示更多'))
  await tick()
  ok('「显示更多」一次加 150 行 → 300', dataRows().length === 300, `实际 ${dataRows().length}`)
  ok('提示还剩 106 篇', Boolean(byText('button', '显示更多（还有 106 篇）')))
  click(byText('button', '显示更多'))
  await tick()
  ok('再点一次全部展开（406 行）且按钮消失', dataRows().length === 406 && !byText('button', '显示更多'), `实际 ${dataRows().length}`)

  // --- 筛选变化要把分页退回首页（此时「显示更多」计数已加到 450） ---
  const yearFromInput = q<HTMLInputElement>('input[aria-label="起始年份"]')!
  typeInto(yearFromInput, '2012')
  await tick()
  ok('填年份后回到首页（150 行），不是继续显示 208 行', dataRows().length === 150, `实际 ${dataRows().length}`)
  ok('计数更新为 214 / 406（年份 ≥2012 的 13 档 × 16 篇 + 6 篇默认 2024 的补篇）', document.body.textContent!.includes('214 / 406'), '')
  ok('「显示更多」提示还剩 64 篇', Boolean(byText('button', '显示更多（还有 64 篇）')))
  ok('出现「清除筛选」', Boolean(byText('button', '清除筛选')))
  click(byText('button', '清除筛选'))
  await tick()
  ok('清除筛选后恢复 406 篇 / 首屏 150 行', document.body.textContent!.includes('406 / 406') && dataRows().length === 150)

  // --- 搜索：行数实时变化 ---
  const searchInput = q<HTMLInputElement>('input[placeholder="搜索标题 / 作者 / 期刊 / 分类 / 标签"]')!
  typeInto(searchInput, 'Paper 00')
  await tick()
  ok('搜索「Paper 00」筛出 10 篇（Paper 000-009）', document.body.textContent!.includes('10 / 406'), '')
  typeInto(searchInput, '')
  await tick()

  // --- 「有本地 PDF」筛选：只剩 2 篇可读 ---
  click(byText('button', '有本地 PDF'))
  await tick()
  ok('「有本地 PDF」筛出 2 篇（localPdf + Zotero 可访问）', document.body.textContent!.includes('2 / 406'), '')
  ok('筛选后 2 行都是 PDF 按钮', qa('button[title="在软件内全屏阅读 PDF"]').length === 2, `实际 ${qa('button[title="在软件内全屏阅读 PDF"]').length}`)
  click(byText('button', '有本地 PDF'))
  await tick()

  // --- 分类筛选（折叠树：默认只画一级，按 ▸ 逐级展开子目录） ---
  const rows = () => qa('[data-collection]').map((b) => b.textContent ?? '')
  const trigger = q<HTMLButtonElement>('[aria-label="按分类筛选"]')!
  click(trigger)
  await tick()
  ok('分类下拉默认只列一级分类（全部分类 / 未分类 / 硅光 / 算法）', rows().length === 4, rows().join('|'))
  ok(
    '深层分类默认不渲染（调制器 / 探测器 / 高速都没出现）',
    !rows().some((r) => r.includes('调制器') || r.includes('探测器') || r.includes('高速')),
    rows().join('|'),
  )
  const siluArrow = q<HTMLButtonElement>('[data-expand="硅光"]')!
  ok('一级分类带展开箭头（默认收起）', Boolean(siluArrow) && siluArrow.getAttribute('aria-expanded') === 'false')
  click(siluArrow)
  await tick()
  ok('展开「硅光」后出现二级分类，计数取子树（探测器 100 / 调制器 100）', rows().length === 6, rows().join('|'))
  ok(
    '展开后箭头变为 aria-expanded=true',
    q<HTMLButtonElement>('[data-expand="硅光"]')!.getAttribute('aria-expanded') === 'true',
  )
  click(q<HTMLButtonElement>('[data-expand="硅光/调制器"]')!)
  await tick()
  ok('再展开一层才出现三级分类（高速 100）', rows().some((r) => r.includes('高速')), rows().join('|'))
  click(q<HTMLButtonElement>('[data-collection="硅光/调制器"]')!)
  await tick()
  ok('选中「硅光/调制器」后只剩该子树的 100 篇', document.body.textContent!.includes('100 / 406'), '')
  ok(
    '触发器上带完整路径与子树计数（硅光/调制器（100））',
    (q('[aria-label="按分类筛选"]')?.textContent ?? '').includes('硅光/调制器（100）'),
  )

  // --- Zotero 同步对话框全流程 ---
  calls.length = 0
  applied = null
  click(byText('button', '同步 Zotero 分类'))
  await tick(120)
  const dialog = q('[role="dialog"]')
  ok('对话框打开', Boolean(dialog))
  if (!dialog) {
    skip('同步对话框：读取 → 预览 → 应用', '对话框未打开')
    return
  }
  ok('对话框里有「读取并预览」', Boolean(byText('[role="dialog"] button', '读取并预览')))
  const dbInput = q<HTMLInputElement>('[role="dialog"] input')!
  ok('库路径默认取运行环境给的路径', dbInput.value === 'D:/fake/zotero.sqlite', dbInput.value)
  click(byText('[role="dialog"] button', '读取并预览'))
  await tick(160)
  ok('点「读取并预览」按路径只读打开库（路径已 trim）', calls.includes('readZotero:D:/fake/zotero.sqlite'), calls.join(','))
  const dialogText = dialog.textContent ?? ''
  ok('预览显示匹配篇数', dialogText.includes('匹配到 1 篇文献笔记'), dialogText.slice(0, 120))
  ok('预览显示「1 篇需要更新」', dialogText.includes('1 篇需要更新分类或标签'))
  ok('预览显示未匹配条目数（不会创建）', dialogText.includes('1 条带题名的条目在本库没有对应笔记'))
  ok('预览列出要改的分类与新增标签', dialogText.includes('分类 → 硅光/调制器') && dialogText.includes('+标签 #期刊:Nature Photonics'))
  const applyButton = byText<HTMLButtonElement>('[role="dialog"] button', '应用 1 条更新')
  ok('「应用 1 条更新」按钮可用', Boolean(applyButton) && !applyButton!.disabled)
  click(applyButton)
  await tick(120)
  ok('应用后把更新交给调用方（不自己写库）', applied?.length === 1, `实际 ${applied?.length ?? 0}`)
  ok('应用后对话框关闭', !q('[role="dialog"]'))
  ok('更新内容带 Zotero key 与 PDF 计数', applied?.[0]?.zoteroKey === 'DDDD4444' && applied[0].zoteroAvailablePdfCount === 1)
}

void probe()
  .catch((error) => lines.push(`FAIL 探针异常：${error instanceof Error ? error.message : String(error)}`))
  .then(() => {
    lines.push(`PROBE_TOTAL=${lines.length} PROBE_FAIL=${lines.filter((l) => l.startsWith('FAIL')).length}`)
    const pre = document.createElement('pre')
    pre.id = 'report'
    pre.textContent = lines.join('\n')
    document.body.appendChild(pre)
  })

createRoot(document.getElementById('root')!).render(
  <LiteratureView
    notes={SYNC_NOTES}
    onOpenNote={(id) => {
      openedNote = id
      calls.push(`openNote:${id}`)
    }}
    onReadPdf={(id) => calls.push(`readPdf:${id}`)}
    onImport={(items) => calls.push(`import:${items.length}`)}
    onApplySync={(updates) => {
      applied = updates
      calls.push(`applySync:${updates.length}`)
    }}
  />,
)
