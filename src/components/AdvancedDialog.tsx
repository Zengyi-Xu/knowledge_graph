/**
 * 「高级」入口对话框：资料库 / 备份迁移 / Zotero / 诊断 四个页签。
 * 收敛所有底层概念（目录、索引文件、同步 JSON、Zotero 数据库）到这里，
 * 主界面只保留「文献 / 笔记 / 引用」一级入口与状态摘要。
 * 只展示与接线，不自己写库——所有写盘动作都回到 App 的既有处理函数。
 */
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  ClipboardCopy,
  Database,
  Download,
  FileUp,
  FolderOpen,
  FolderSync,
  HardDrive,
  RefreshCw,
  Save,
  Upload,
} from 'lucide-react'
import type { Note } from '@/types/note'
import type { VaultStatus } from '@/hooks/useNotes'
import type { ZoteroSyncUpdate } from '@/lib/zoteroSync'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { APP_NAME, APP_VERSION, BUILD_ENV, ENV_LABEL, isDevApp, readSetting, writeSetting, ZOTERO_DB_KEY } from '@/lib/env'
import { ZoteroSyncPanel } from '@/components/ZoteroSyncPanel'

export type AdvancedTab = 'library' | 'backup' | 'zotero' | 'diagnostics'

interface Props {
  open: boolean
  initialTab: AdvancedTab
  onClose: () => void
  notesCount: number
  vault: VaultStatus
  vaultSupported: boolean
  watchVault: boolean
  onWatchVault: (value: boolean) => void
  /** 选择/切换资料库目录（App 的 pickVault）；成功返回 true */
  onPickVault: () => Promise<boolean>
  onFlushVault: () => void
  onOpenVaultDir: () => void
  onResolveVaultConflicts: (version: 'local' | 'disk') => void
  syncPath: string
  autoSync: boolean
  onAutoSync: (value: boolean) => void
  syncing: boolean
  lastSyncAt: number | null
  onChooseSyncFile: () => void
  onSyncNow: () => void
  onReloadFromSync: () => void
  onExportJson: () => void
  onImportJson: (file: File) => void
  onImportMd: (files: File[]) => void
  notes: Note[]
  onApplySync: (updates: ZoteroSyncUpdate[]) => void
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      {children}
    </div>
  )
}

export function AdvancedDialog(props: Props) {
  const [tab, setTab] = useState<AdvancedTab>(props.initialTab)
  const jsonRef = useRef<HTMLInputElement>(null)
  const mdRef = useRef<HTMLInputElement>(null)
  const desktop = typeof window !== 'undefined' ? window.knowledgeGraphDesktop : undefined
  /** 每次打开时同步最新设置（文献视图 / 首次启动向导都可能改过） */
  const [zoteroDb, setZoteroDb] = useState(() => {
    try {
      return readSetting(ZOTERO_DB_KEY) || desktop?.defaultZoteroDb || ''
    } catch {
      return desktop?.defaultZoteroDb || ''
    }
  })
  const zoteroDbRef = useRef(zoteroDb)
  zoteroDbRef.current = zoteroDb
  useEffect(() => {
    if (!props.open) return
    const latest = (() => {
      try {
        return readSetting(ZOTERO_DB_KEY) || desktop?.defaultZoteroDb || ''
      } catch {
        return desktop?.defaultZoteroDb || ''
      }
    })()
    if (latest !== zoteroDbRef.current) setZoteroDb(latest)
  }, [props.open, desktop])

  const { vault, notes } = props

  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>高级</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as AdvancedTab)}>
          <TabsList>
            <TabsTrigger value="library"><HardDrive className="mr-1.5 h-4 w-4" /> 资料库</TabsTrigger>
            <TabsTrigger value="backup"><FolderSync className="mr-1.5 h-4 w-4" /> 备份迁移</TabsTrigger>
            <TabsTrigger value="zotero"><Database className="mr-1.5 h-4 w-4" /> Zotero</TabsTrigger>
            <TabsTrigger value="diagnostics"><Activity className="mr-1.5 h-4 w-4" /> 诊断</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="min-h-[260px] space-y-4 pt-2 text-sm">
          {tab === 'library' && (
            <>
              <Section title="存储位置">
                {vault.active ? (
                  <>
                    <p className="text-muted-foreground">
                      资料库目录：<span className="font-mono text-xs break-all">{vault.dir}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      每篇笔记一个 Markdown 文件，可以用 Obsidian 等编辑器直接打开；应用不会改动目录里不属于它的文件。
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    当前使用浏览器本地存储（{props.notesCount} 个条目）。
                    {props.vaultSupported
                      ? '选择资料库目录后，这些条目会写入目录并从此由目录保存。'
                      : '浏览器模式没有本地文件夹权限，请使用桌面版或本地网页端。'}
                  </p>
                )}
              </Section>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void props.onPickVault()}>
                  <FolderOpen className="mr-1 h-3.5 w-3.5" /> {vault.active ? '切换资料库目录' : '选择资料库目录'}
                </Button>
                <Button variant="outline" size="sm" disabled={!vault.active} onClick={props.onOpenVaultDir}>
                  打开资料库文件夹
                </Button>
                <Button variant="outline" size="sm" disabled={!vault.active} onClick={props.onFlushVault}>
                  <Save className="mr-1 h-3.5 w-3.5" /> 写入目录
                </Button>
              </div>
              <Section title="目录状态">
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  {vault.loading && <p>文献加载中 {vault.loading.loaded}/{vault.loading.total}（普通笔记已可用）</p>}
                  {vault.saving && <p>写入中…</p>}
                  {vault.savedAt && <p>最近写入 {new Date(vault.savedAt).toLocaleTimeString()}</p>}
                  {vault.externalAt && <p>最近跟随目录改动 {new Date(vault.externalAt).toLocaleTimeString()}</p>}
                  {vault.unmanaged > 0 && <p>目录里另有 {vault.unmanaged} 个不属于本应用的 Markdown 文件，不会被读取或改动</p>}
                  {vault.error && <p className="text-destructive">{vault.error}</p>}
                </div>
                <label className="flex items-center gap-2 pt-1" title="开启后每隔几秒检查目录，其他编辑器里的改动会自动进入应用">
                  <span>跟随目录改动</span>
                  <Switch checked={props.watchVault} onCheckedChange={props.onWatchVault} disabled={!vault.active} aria-label="跟随目录改动" />
                </label>
              </Section>
              {vault.conflicts > 0 && (
                <div className="space-y-2 rounded border border-destructive/40 bg-destructive/5 p-3" role="alert">
                  <p className="font-medium">{vault.conflicts} 篇笔记存在文件冲突，写盘已暂停</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => {
                      if (window.confirm('采用磁盘中的版本会替换这些笔记尚未保存的本地编辑。继续？')) props.onResolveVaultConflicts('disk')
                    }}>采用磁盘版本</Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      if (window.confirm('保留本地编辑会覆盖这些笔记在磁盘上的外部修改。继续？')) props.onResolveVaultConflicts('local')
                    }}>保留本地编辑</Button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'backup' && (
            <>
              <Section title="备份">
                <p className="text-xs text-muted-foreground">
                  JSON 备份包含全部笔记（含文献字段）；Markdown 导入支持多选批量，读 frontmatter（type / grade / tags / title）。
                </p>
                <div className="flex flex-wrap gap-2">
                  <input ref={jsonRef} type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && props.onImportJson(e.target.files[0])} />
                  <input ref={mdRef} type="file" accept=".md,.markdown" multiple className="hidden" onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; if (picked.length) props.onImportMd(picked) }} />
                  <Button variant="outline" size="sm" onClick={props.onExportJson}>
                    <Download className="mr-1 h-3.5 w-3.5" /> 导出备份
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => jsonRef.current?.click()}>
                    <Upload className="mr-1 h-3.5 w-3.5" /> 导入 JSON 备份
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => mdRef.current?.click()}>
                    <FileUp className="mr-1 h-3.5 w-3.5" /> 导入 Markdown
                  </Button>
                </div>
              </Section>
              <Section title="多端同步文件">
                <p className="text-xs text-muted-foreground">
                  把全部笔记写成一个 JSON 文件（可放在同步盘）。开启双向同步后，本地改动会写回文件，文件被其他设备改动会拉进应用。
                </p>
                <p className="font-mono text-xs break-all text-muted-foreground" title={props.syncPath}>
                  {props.syncPath || '尚未设置同步文件'}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={props.onChooseSyncFile}>
                    <FolderSync className="mr-1 h-3.5 w-3.5" /> 选择同步文件
                  </Button>
                  <Button variant="outline" size="sm" onClick={props.onSyncNow} disabled={props.syncing}>
                    <Save className="mr-1 h-3.5 w-3.5" /> {props.syncing ? '处理中…' : '保存到同步文件'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={props.onReloadFromSync}>
                    <RefreshCw className="mr-1 h-3.5 w-3.5" /> 从同步文件覆盖本地
                  </Button>
                  <label className="flex items-center gap-2" title={props.syncPath ? (props.autoSync ? '开启中：双向同步，可随时关闭' : '开启后双向同步') : '请先选择同步文件'}>
                    <span>双向同步</span>
                    <Switch checked={props.autoSync} onCheckedChange={props.onAutoSync} disabled={!props.syncPath} aria-label="双向同步" />
                  </label>
                </div>
                {props.lastSyncAt && <p className="text-xs text-muted-foreground">最近同步 {new Date(props.lastSyncAt).toLocaleTimeString()}</p>}
              </Section>
            </>
          )}

          {tab === 'zotero' && (
            <ZoteroSyncPanel
              notes={notes}
              dbPath={zoteroDb}
              onDbPathChange={(v) => {
                setZoteroDb(v)
                writeSetting(ZOTERO_DB_KEY, v)
              }}
              onApply={(updates) => {
                props.onApplySync(updates)
                props.onClose()
              }}
            />
          )}

          {tab === 'diagnostics' && (
            <>
              <Section title="版本与环境">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">应用</dt><dd>{APP_NAME} · {ENV_LABEL}{isDevApp() ? '（开发版）' : ''}</dd>
                  <dt className="text-muted-foreground">构建</dt><dd>{APP_VERSION} / {BUILD_ENV}</dd>
                  <dt className="text-muted-foreground">环境</dt>
                  <dd>{desktop?.isElectron ? '桌面版' : desktop?.isLocalWeb ? '本地网页端' : '浏览器'}</dd>
                  <dt className="text-muted-foreground">存储</dt>
                  <dd className="break-all">{vault.active ? `资料库：${vault.dir}` : '浏览器本地存储'}</dd>
                  <dt className="text-muted-foreground">条目</dt><dd>{props.notesCount}</dd>
                  <dt className="text-muted-foreground">同步文件</dt><dd className="break-all">{props.syncPath || '未设置'}</dd>
                  <dt className="text-muted-foreground">Zotero</dt><dd className="break-all">{zoteroDb || '未设置'}</dd>
                  <dt className="text-muted-foreground">最近错误</dt><dd className="break-all">{vault.error ?? '无'}</dd>
                </dl>
              </Section>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const blob = [
                    `${APP_NAME} ${APP_VERSION}（${BUILD_ENV}${isDevApp() ? ' 开发版' : ''}）`,
                    `环境：${desktop?.isElectron ? '桌面版' : desktop?.isLocalWeb ? '本地网页端' : '浏览器'}`,
                    `存储：${vault.active ? vault.dir : '浏览器本地存储'}`,
                    `条目：${props.notesCount}`,
                    `同步文件：${props.syncPath || '未设置'}`,
                    `Zotero：${zoteroDb || '未设置'}`,
                    `错误：${vault.error ?? '无'}`,
                  ].join('\n')
                  void navigator.clipboard.writeText(blob).then(() => toast.success('诊断信息已复制'))
                }}
              >
                <ClipboardCopy className="mr-1 h-3.5 w-3.5" /> 复制诊断信息
              </Button>
            </>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={props.onClose}>关闭</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
