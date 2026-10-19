import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIsMobile } from '@/hooks/use-mobile'
import { Download, FileUp, FolderSync, MoreVertical, RefreshCw, Save, Sparkles, Upload } from 'lucide-react'

interface Props {
  onSaveToSyncFile: () => void
  onChooseSyncFile: () => void
  onReloadFromJson: () => void
  onImportJson: (file: File) => void
  onImportMd: (files: File[]) => void
  onOpenAi: () => void
  onExportJson: () => void
}

/** 顶栏右侧：全库备份/同步文件/导入导出与 AI 统筹入口（含两个隐藏的文件选择框） */
export function BackupTransferMenu({
  onSaveToSyncFile,
  onChooseSyncFile,
  onReloadFromJson,
  onImportJson,
  onImportMd,
  onOpenAi,
  onExportJson,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const mdRef = useRef<HTMLInputElement>(null)
  const isMobile = useIsMobile()

  const hiddenInputs = (
    <>
      <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && onImportJson(e.target.files[0])} />
      <input ref={mdRef} type="file" accept=".md,.markdown" multiple className="hidden" onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; if (picked.length) onImportMd(picked) }} />
    </>
  )

  // 手机端：整套功能收进一个「更多」菜单（功能不减，只是不占满顶栏）
  if (isMobile) {
    return (
      <div className="ml-auto flex items-center gap-2" data-testid="backup-menu-mobile">
        {hiddenInputs}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-11 w-11" title="备份 / 导入导出 / AI 统筹" aria-label="备份、导入导出与 AI">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem className="min-h-11" onSelect={onSaveToSyncFile}>
              <Save className="mr-2 h-4 w-4" /> 保存到同步文件
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={onChooseSyncFile}>
              <FolderSync className="mr-2 h-4 w-4" /> 选择同步文件
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={onReloadFromJson}>
              <RefreshCw className="mr-2 h-4 w-4" /> 用同步文件重新载入
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11" onSelect={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> 导入备份（JSON）
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={() => mdRef.current?.click()}>
              <FileUp className="mr-2 h-4 w-4" /> 导入 .md（可多选）
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={onExportJson}>
              <Save className="mr-2 h-4 w-4" /> 导出备份（JSON）
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11" onSelect={onOpenAi}>
              <Sparkles className="mr-2 h-4 w-4 text-amber-500" /> AI 统筹
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      {hiddenInputs}
      {/* 桌面：768–1279px 只留图标（title 里写全名），≥1280px 才显示文字，
          这样顶栏在平板上仍是一行，不会把页面撑宽 */}
      <Button variant="outline" size="sm" onClick={onSaveToSyncFile} title="保存到同步文件">
        <Save className="h-3.5 w-3.5 xl:mr-1" /> <span className="hidden xl:inline">保存到同步文件</span>
      </Button>
      <Button variant="outline" size="icon" title="选择同步文件" onClick={onChooseSyncFile}>
        <FolderSync className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" title="用同步文件（notes.json）覆盖本地笔记" onClick={onReloadFromJson}>
        <RefreshCw className="h-3.5 w-3.5 xl:mr-1" /> <span className="hidden xl:inline">重新载入</span>
      </Button>
      <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} title="导入备份（JSON）">
        <Upload className="h-3.5 w-3.5 xl:mr-1" /> <span className="hidden xl:inline">导入备份</span>
      </Button>
      <Button variant="outline" size="sm" onClick={() => mdRef.current?.click()} title="导入 .md（可多选，批量导入）">
        <FileUp className="h-3.5 w-3.5 xl:mr-1" /> <span className="hidden xl:inline">导入 .md</span>
      </Button>
      <Button variant="outline" size="sm" onClick={onOpenAi} title="调用本机 Kimi 模型网关，统筹整理笔记（改动需确认后落盘）">
        <Sparkles className="h-3.5 w-3.5 text-amber-500 xl:mr-1" /> <span className="hidden xl:inline">AI 统筹</span>
      </Button>
      <Button variant="outline" size="sm" onClick={onExportJson} title="导出备份（JSON）">
        <Download className="h-3.5 w-3.5 xl:mr-1" /> <span className="hidden xl:inline">导出备份</span>
      </Button>
    </div>
  )
}
