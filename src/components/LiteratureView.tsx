/**
 * 文献库视图（容器）：把查询状态、三个导入/同步弹窗与 PDF 打开动作接到展示组件上。
 *
 * 拆解后的模块（同目录 literature/）：
 *   collectionTree      分类树与筛选值（同源同序、子树唯一篇数、「未分类」动态）
 *   literatureQuery     纯查询模型（筛选 → 排序 → 150 行分页）
 *   useLiteratureQuery  查询 hook（React 外壳）
 *   LiteratureToolbar   工具栏 + 筛选行
 *   LiteratureTable     表格 + PDF 徽标 + 行内操作
 *   DoiImportDialog / BibImportDialog / ZoteroSyncDialog
 *
 * 单击标题或用「操作」菜单打开笔记；点 PDF 徽标直接进全屏阅读（按钮即入口，无延迟）。
 * 纯网络 + 剪贴板能力，浏览器版与桌面版均可用。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import type { Note } from '@/types/note'
import { readSetting, writeSetting } from '@/lib/env'
import { litToCSL, type CitationStyleId, type ImportedLit } from '@/lib/literature'
import { writeBibliographyClipboard } from '@/lib/rtfField'
import { capability } from '@/lib/capabilities'
import { toastDegraded } from '@/lib/degrade'
import type { ZoteroSyncUpdate } from '@/lib/zoteroSync'
import { BibImportDialog } from './literature/BibImportDialog'
import { DoiImportDialog } from './literature/DoiImportDialog'
import { LiteratureTable } from './literature/LiteratureTable'
import { LiteratureToolbar } from './literature/LiteratureToolbar'
import { ZoteroSyncDialog } from './literature/ZoteroSyncDialog'
import { useLiteratureQuery } from './literature/useLiteratureQuery'
import { ensureLocalPdfMatches, localPdfFallbackVersion, subscribeLocalPdfFallback } from '@/lib/localPdfFallback'

interface Props {
  notes: Note[]
  /** 当前打开的笔记（图谱/侧栏选中）：文献表里高亮对应行 */
  activeId?: string | null
  onOpenNote: (id: string) => void
  onReadPdf: (id: string) => void
  /** 批量创建文献笔记（citekey 撞名由调用方处理） */
  onImport: (items: ImportedLit[]) => void
  /** 应用 Zotero 同步计划：合并 collections 与新增标签（调用方负责写库） */
  onApplySync: (updates: ZoteroSyncUpdate[]) => void
}

/** 本机 Zotero 数据库位置；本地网页端由启动参数 --zotero-db 固定 */
export const ZOTERO_DB_KEY = 'zotero-db-v1'
/** 「标签」列默认隐藏（表格更窄，PDF 与标题始终可见），偏好记在本地 */
const SHOW_TAGS_KEY = 'lit-show-tags-v1'

/** 首选项：上次选过的库 > 运行环境给的默认值（Electron preload / 本地网页服务端） */
function initialZoteroDb(): string {
  const desktop = typeof window !== 'undefined' ? window.knowledgeGraphDesktop : undefined
  return readSetting(ZOTERO_DB_KEY) || desktop?.defaultZoteroDb || ''
}

export function LiteratureView({ notes, activeId, onOpenNote, onReadPdf, onImport, onApplySync }: Props) {
  const ctl = useLiteratureQuery(notes)
  // 缺 PDF 的文献问一次本机服务「按标题能不能在授权目录里找到」：结果在模块级 store 里，
  // 这里订阅它的版本号，只是为了让表格在匹配到达后重新渲染（不引入 Provider）。
  useSyncExternalStore(subscribeLocalPdfFallback, localPdfFallbackVersion, localPdfFallbackVersion)
  useEffect(() => {
    ensureLocalPdfMatches(notes)
  }, [notes])
  const [doiOpen, setDoiOpen] = useState(false)
  const [bibOpen, setBibOpen] = useState(false)
  const [zoteroOpen, setZoteroOpen] = useState(false)
  const [zoteroDb, setZoteroDb] = useState(initialZoteroDb)
  const [styleId, setStyleId] = useState<CitationStyleId>('gb')
  const [showTags, setShowTags] = useState(() => readSetting(SHOW_TAGS_KEY) === '1')

  useEffect(() => {
    writeSetting(ZOTERO_DB_KEY, zoteroDb)
  }, [zoteroDb])

  useEffect(() => {
    writeSetting(SHOW_TAGS_KEY, showTags ? '1' : '0')
  }, [showTags])

  /** 从本机 Zotero 库解析这篇文献的 PDF，交给系统默认阅读器（去重合并后的文献可带多个 key） */
  const openLocalPdf = async (note: Note) => {
    const lit = note.literature
    const desktop = window.knowledgeGraphDesktop
    // 一、笔记里记着的本地 PDF（pdf:link 脚本匹配到的，绝对路径）
    if (lit?.localPdf) {
      if (!desktop?.openExternalFile) {
        toastDegraded('localPdf', '无法打开这篇文献的本地 PDF', 'error')
        return
      }
      try {
        const result = await desktop.openExternalFile(lit.localPdf)
        if (result?.error) toast.error(result.error)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '打开 PDF 失败')
      }
      return
    }
    // 二、Zotero 库里的 PDF（按 key 解析，多 key 回退）
    const key = lit?.zoteroKey
    if (!key) {
      toast.info('这篇文献还没有对应 Zotero 条目：先「同步 Zotero 分类」或跑 pdf:link 脚本匹配本地 PDF')
      return
    }
    if (!desktop?.openZoteroPdf) {
      toastDegraded('zoteroSqlite', '无法打开 Zotero 里的 PDF', 'error')
      return
    }
    try {
      await desktop.openZoteroPdf(desktop.isLocalWeb ? '' : zoteroDb, key, lit?.zoteroKeys ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '打开 PDF 失败')
    }
  }

  /** 在 Zotero 里定位到这篇文献（key 属于 Zotero 当前库时才会命中） */
  const openInZotero = async (note: Note) => {
    const key = note.literature?.zoteroKey
    const desktop = window.knowledgeGraphDesktop
    if (!key) {
      toast.info('这篇文献没有 Zotero key：先「同步 Zotero 分类」或用批量脚本导入')
      return
    }
    if (!desktop?.selectZoteroItem) {
      toastDegraded('systemOpener', '无法在 Zotero 里定位该条目', 'error')
      return
    }
    try {
      await desktop.selectZoteroItem(key)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '跳转 Zotero 失败')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <LiteratureToolbar
        ctl={ctl}
        showTags={showTags}
        onToggleTags={() => setShowTags((v) => !v)}
        styleId={styleId}
        onStyleChange={setStyleId}
        onCopyBibliography={() => void writeBibliographyClipboard(ctl.rows.map(litToCSL), styleId)}
        onOpenDoi={() => setDoiOpen(true)}
        onOpenBib={() => setBibOpen(true)}
        onOpenZotero={() => {
          // 明确降级：本机 Zotero 库只在运行服务的那台电脑上可读
          if (!capability('zoteroSqlite').supported) {
            toastDegraded('zoteroSqlite', '无法同步 Zotero 分类', 'error')
            return
          }
          setZoteroOpen(true)
        }}
      />
      <LiteratureTable
        page={ctl.page}
        literatureCount={ctl.literature.length}
        showTags={showTags}
        selectedId={activeId ?? null}
        onShowMore={ctl.showMore}
        onSort={ctl.toggleSort}
        sortMark={ctl.sortMark}
        actions={{
          onOpenNote,
          onReadPdf,
          onOpenLocalPdf: (n) => void openLocalPdf(n),
          onOpenInZotero: (n) => void openInZotero(n),
          styleId,
        }}
      />

      <DoiImportDialog open={doiOpen} onClose={() => setDoiOpen(false)} onImport={onImport} />
      <BibImportDialog open={bibOpen} onClose={() => setBibOpen(false)} onImport={onImport} />
      <ZoteroSyncDialog
        open={zoteroOpen}
        notes={notes}
        dbPath={zoteroDb}
        onDbPathChange={setZoteroDb}
        onClose={() => setZoteroOpen(false)}
        onApply={(updates) => {
          onApplySync(updates)
          setZoteroOpen(false)
        }}
      />
    </div>
  )
}
