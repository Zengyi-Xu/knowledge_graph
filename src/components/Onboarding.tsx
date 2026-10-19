/**
 * 首次启动向导：打开已有资料库 / 新建资料库 / 临时体验，可选连接 Zotero。
 * 只做「选择 + 记录」，不读写任何笔记数据；资料库的建立与接管由 App 的 pickVault 完成。
 * 完成标志写 kg-onboarding-v1（env 键前缀规则自动区分开发/正式版）。
 */
import { useState } from 'react'
import {
  BookOpen,
  Database,
  FolderOpen,
  FolderPlus,
  FlaskConical,
  Network,
  NotebookText,
  Quote,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { APP_NAME, readSetting, writeSetting, ZOTERO_DB_KEY } from '@/lib/env'

export const ONBOARDING_KEY = 'onboarding-done-v1'

interface Props {
  /** 当前环境能否选择本地文件夹作为资料库（浏览器版不行） */
  vaultSupported: boolean
  /** 选择资料库目录并接管（App 里的 pickVault：含确认与提示）；成功返回 true */
  onPickVault: () => Promise<boolean>
  /** 用户做出选择：zoteroSync 表示完成后立即打开一次 Zotero 同步 */
  onDone: (zoteroSync: boolean) => void
}

export function Onboarding({ vaultSupported, onPickVault, onDone }: Props) {
  const desktop = typeof window !== 'undefined' ? window.knowledgeGraphDesktop : undefined
  /** 本地网页端：Zotero 数据库路径由服务端启动参数固定，页面只展示不改 */
  const fixedByServer = Boolean(desktop?.isLocalWeb)
  const initialZotero = (() => {
    try {
      return readSetting(ZOTERO_DB_KEY) || desktop?.defaultZoteroDb || ''
    } catch {
      return desktop?.defaultZoteroDb || ''
    }
  })()
  const [zoteroDb, setZoteroDb] = useState(initialZotero)
  const [zoteroTouched, setZoteroTouched] = useState(false)

  const finish = (zoteroSync: boolean) => {
    if (!fixedByServer && zoteroTouched && zoteroDb.trim()) writeSetting(ZOTERO_DB_KEY, zoteroDb.trim())
    onDone(zoteroSync)
  }

  const pick = async () => {
    if (!vaultSupported) return
    if (await onPickVault()) finish(false)
  }

  const start = () => {
    // 「开始使用」= 临时体验 +（如果填了）连接 Zotero
    finish(!fixedByServer && zoteroTouched && zoteroDb.trim() !== '')
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-background/95 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl space-y-5 rounded-2xl border bg-card p-8 shadow-xl">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Network className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">{APP_NAME}</h1>
            <span className="text-sm text-muted-foreground">本地文献 · 笔记 · 引用工作台</span>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            文献、笔记和引用都保存在你自己的电脑上：一个文件夹就是一个<strong className="text-foreground">资料库</strong>，
            每篇笔记是一个 Markdown 文件，可以用其他编辑器直接打开，随时迁走。
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            disabled={!vaultSupported}
            onClick={() => void pick()}
            className="group flex flex-col items-start gap-2 rounded-xl border bg-background p-4 text-left transition-colors hover:border-primary hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FolderOpen className="h-5 w-5 text-primary" />
            <span className="font-medium">打开已有资料库</span>
            <span className="text-xs text-muted-foreground">
              选择磁盘上已有的资料库文件夹，继续使用里面的笔记
            </span>
          </button>
          <button
            type="button"
            disabled={!vaultSupported}
            onClick={() => void pick()}
            className="group flex flex-col items-start gap-2 rounded-xl border bg-background p-4 text-left transition-colors hover:border-primary hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FolderPlus className="h-5 w-5 text-primary" />
            <span className="font-medium">新建资料库</span>
            <span className="text-xs text-muted-foreground">
              选一个空文件夹（可在选择框里新建），从零开始整理
            </span>
          </button>
          <button
            type="button"
            onClick={start}
            className="group flex flex-col items-start gap-2 rounded-xl border bg-background p-4 text-left transition-colors hover:border-primary hover:bg-muted/40"
          >
            <FlaskConical className="h-5 w-5 text-primary" />
            <span className="font-medium">临时体验</span>
            <span className="text-xs text-muted-foreground">
              直接进入，数据暂存在本浏览器；之后随时可在「高级 → 资料库」迁移
            </span>
          </button>
        </div>

        {!vaultSupported && (
          <p className="text-xs text-muted-foreground">
            当前是浏览器模式，没有本地文件夹权限，只能「临时体验」；桌面版与本地网页端可以打开或新建资料库。
          </p>
        )}

        <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4 text-muted-foreground" />
            连接 Zotero（可选）
            <span className="font-normal text-muted-foreground">只读连接，文献自动带上分类、标签与 PDF 状态</span>
          </div>
          {fixedByServer ? (
            <p className="rounded border bg-background p-2 font-mono text-xs break-all">
              {zoteroDb || '本机服务未配置 Zotero 数据库'}
            </p>
          ) : (
            <Input
              value={zoteroDb}
              onChange={(e) => {
                setZoteroDb(e.target.value)
                setZoteroTouched(true)
              }}
              placeholder="Zotero 数据库（zotero.sqlite）的完整路径，也可以稍后在「高级 → Zotero」里设置"
              className="font-mono text-xs"
            />
          )}
        </div>

        <div className="flex items-center gap-4">
          <Button size="lg" onClick={start}>
            开始使用
          </Button>
          <p className="min-w-0 text-xs text-muted-foreground">
            不选资料库也可以直接开始；{zoteroTouched && zoteroDb.trim() ? '点击后会先记录 Zotero 数据库并同步一次分类。' : '随时可以在「高级」里补上资料库、备份与 Zotero。'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground/70">
          <span className="flex items-center gap-1"><BookOpen className="h-3 w-3" /> 文献：导入 DOI / BibTeX，读 PDF，同步 Zotero</span>
          <span className="flex items-center gap-1"><NotebookText className="h-3 w-3" /> 笔记：Markdown 笔记与双向链接</span>
          <span className="flex items-center gap-1"><Quote className="h-3 w-3" /> 引用：GB/T 7714、APA、BibTeX 与 Word 参考文献表</span>
        </div>
      </div>
    </div>
  )
}
