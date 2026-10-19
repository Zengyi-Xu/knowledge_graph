import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { FolderOpen, HardDrive } from 'lucide-react'
import { isDevApp } from '@/lib/env'
import { vaultSupported } from '@/lib/vaultFs'
import type { VaultStatus } from '@/hooks/useNotes'

interface Props {
  vault: VaultStatus
  hydrated: boolean
  watchVault: boolean
  onWatchVaultChange: (watch: boolean) => void
  onFlush: () => void
  onChooseDir: () => void
  onOpenDir: () => void
  onResolveConflicts: (version: 'local' | 'disk') => void
  /** 桌面为顶部状态栏（默认）；手机端收进「存储」面板时用卡片布局 */
  variant?: 'bar' | 'card'
}

/** 本地存储状态栏：vault（md + meta.json）——目录、加载进度、文件冲突与手写入库 */
export function DataSafetyStatus({
  vault,
  hydrated,
  watchVault,
  onWatchVaultChange,
  onFlush,
  onChooseDir,
  onOpenDir,
  onResolveConflicts,
  variant = 'bar',
}: Props) {
  const root =
    variant === 'card'
      ? 'flex flex-wrap items-center gap-2 rounded-md border p-3 text-xs text-muted-foreground'
      : 'flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/20 px-4 py-1.5 text-xs text-muted-foreground'
  return (
    <div className={root} data-testid="data-safety-status">
      <HardDrive className="h-3.5 w-3.5" />
      <span className="truncate" title={vault.dir || '尚未选择笔记目录'}>
        {vault.active
          ? `笔记目录：${vault.dir}（每篇一个 .md + meta.json 索引）`
          : vault.dir
            ? !hydrated ? `正在读取笔记目录：${vault.dir}` : `笔记目录不可用：${vault.dir} · 暂时用浏览器本地存储`
            : vaultSupported()
              ? isDevApp()
                ? '开发版：尚未选择笔记目录（与正式版隔离）· 当前用浏览器本地存储（localStorage）'
                : '尚未选择笔记目录 · 当前用浏览器本地存储（localStorage）'
              : '当前环境没有本地目录能力（已降级）· 笔记存在浏览器本地存储（localStorage），用顶栏「导出备份 / 导入备份」搬运'}
      </span>
      {vault.loading && <span className="shrink-0" role="status">
        {vault.loading.total ? `文献加载中 ${vault.loading.loaded}/${vault.loading.total}` : '检查笔记目录中…'}
      </span>}
      {vault.conflicts > 0 && <div className="flex shrink-0 items-center gap-2" role="alert">
        <span>{vault.conflicts} 篇笔记存在文件冲突，写盘已暂停</span>
        <Button size="sm" variant="outline" onClick={() => {
          if (window.confirm('采用磁盘中的版本会替换这些笔记尚未保存的本地编辑。继续？')) onResolveConflicts('disk')
        }}>采用磁盘版本</Button>
        <Button size="sm" variant="outline" onClick={() => {
          if (window.confirm('保留本地编辑会覆盖这些笔记在磁盘上的外部修改。继续？')) onResolveConflicts('local')
        }}>保留本地编辑</Button>
      </div>}
      {vault.active && vault.saving && <span className="shrink-0">写入中…</span>}
      {vault.active && !vault.saving && vault.savedAt && (
        <span className="shrink-0">已写入 {new Date(vault.savedAt).toLocaleTimeString()}</span>
      )}
      {vault.externalAt && <span className="shrink-0">已跟随目录改动 {new Date(vault.externalAt).toLocaleTimeString()}</span>}
      {vault.unmanaged > 0 && (
        <span className="shrink-0" title="这些 md 不在 meta.json 索引里，本应用不会读取、修改或删除它们">
          目录中另有 {vault.unmanaged} 个未纳管 md
        </span>
      )}
      {vault.error && <span className="shrink-0 text-destructive">{vault.error}</span>}
      {vault.gate.reason && (
        <span
          className="shrink-0 text-amber-600"
          role="status"
          title="磁盘上声明了更高格式 / 本客户端没有的字段能力：这些笔记不写盘、不删除（docs/VAULT_WRITE_GATE.md）"
        >
          {vault.gate.reason}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <label
          className="flex items-center gap-2"
          title="开启后每 3 秒检查一次目录：在 Obsidian/编辑器里的改动会自动进到应用"
        >
          <span>跟随目录改动</span>
          <Switch
            checked={watchVault}
            onCheckedChange={onWatchVaultChange}
            disabled={!vault.active}
            aria-label="跟随目录改动"
          />
        </label>
        <Button variant="outline" size="sm" disabled={!vault.active} onClick={onFlush}>
          写入目录
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onChooseDir}
          title={vaultSupported() ? '选择本地笔记目录（每篇一个 .md + meta.json 索引）' : '当前环境没有本地目录能力：只会提示降级原因，不会假装成功'}
        >
          选择目录
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="在文件管理器里打开笔记目录"
          disabled={!vault.active}
          onClick={onOpenDir}
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
