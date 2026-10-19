/**
 * 文献表工具栏 + 筛选行（纯展示）：搜索、计数、引用样式、导入/同步入口、分类/期刊/年份/PDF/标签筛选。
 * 状态与派生都在 `useLiteratureQuery`，这里只发出意图。
 */
import { BookOpen, ClipboardCopy, Import, Search, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CITATION_STYLES, type CitationStyleId } from '@/lib/literature'
import { CollectionFilter } from './CollectionFilter'
import { ALL_VENUES } from './literatureQuery'
import type { LiteratureQueryController } from './useLiteratureQuery'

export interface LiteratureToolbarProps {
  ctl: LiteratureQueryController
  /** 「标签」列是否显示（默认隐藏，偏好由调用方持久化） */
  showTags: boolean
  onToggleTags: () => void
  styleId: CitationStyleId
  onStyleChange: (id: CitationStyleId) => void
  onCopyBibliography: () => void
  onOpenDoi: () => void
  onOpenBib: () => void
  onOpenZotero: () => void
}

export function LiteratureToolbar({
  ctl,
  showTags,
  onToggleTags,
  styleId,
  onStyleChange,
  onCopyBibliography,
  onOpenDoi,
  onOpenBib,
  onOpenZotero,
}: LiteratureToolbarProps) {
  const { state, collectionTree, selectedCollectionCount, venueOptions } = ctl

  return (
    <>
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 md:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={state.search}
            onChange={(e) => ctl.setSearch(e.target.value)}
            placeholder="搜索标题 / 作者 / 期刊 / 分类 / 标签"
            className="pl-7"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {ctl.rows.length} / {ctl.literature.length} 篇文献
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={styleId} onValueChange={(v) => onStyleChange(v as CitationStyleId)}>
            <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="引用样式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(CITATION_STYLES).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            title="把当前筛出的文献按所选样式排成文献表，复制为 RTF 富文本 + 纯文本"
            onClick={onCopyBibliography}
          >
            <ClipboardCopy className="mr-1 h-3.5 w-3.5" /> 复制参考文献表
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenDoi}>
            <Import className="mr-1 h-3.5 w-3.5" /> 按 DOI / arXiv 导入
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenBib}>
            <Import className="mr-1 h-3.5 w-3.5" /> 导入 BibTeX / RIS
          </Button>
          <Button
            variant="outline"
            size="sm"
            title="读取本机 Zotero 数据库，为文献笔记同步分类并自动打标签"
            onClick={onOpenZotero}
          >
            <BookOpen className="mr-1 h-3.5 w-3.5" /> 同步 Zotero 分类
          </Button>
        </div>
      </div>

      {/* 筛选行：分类 / 期刊 / 年份范围 / 有本地 PDF / 标签列 */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <CollectionFilter
          value={state.collection}
          tree={collectionTree.tree}
          none={collectionTree.none}
          selectedCount={selectedCollectionCount}
          onChange={ctl.setCollection}
        />
        <Select value={state.venue} onValueChange={ctl.setVenue}>
          <SelectTrigger className="h-7 w-[190px] text-xs" aria-label="按期刊筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VENUES}>全部期刊/会议</SelectItem>
            {venueOptions.map(([name, count]) => (
              <SelectItem key={name} value={name}>
                {name}（{count}）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Input
            value={state.yearFrom}
            onChange={(e) => ctl.setYearFrom(e.target.value)}
            placeholder="年（起）"
            className="h-7 w-20 text-xs"
            aria-label="起始年份"
          />
          <span>–</span>
          <Input
            value={state.yearTo}
            onChange={(e) => ctl.setYearTo(e.target.value)}
            placeholder="年（止）"
            className="h-7 w-20 text-xs"
            aria-label="结束年份"
          />
        </div>
        <Button
          variant={state.onlyWithPdf ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          title="只显示本机 Zotero 里有可访问 PDF 的文献"
          onClick={ctl.toggleOnlyWithPdf}
        >
          有本地 PDF
        </Button>
        <Button
          variant={showTags ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          title="显示 / 隐藏「标签」列（默认隐藏，保证标题与 PDF 列始终可见）"
          onClick={onToggleTags}
        >
          标签列
        </Button>
        {ctl.filtersActive && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={ctl.clearFilters}>
            清除筛选
          </Button>
        )}
        <span className="ml-auto hidden md:inline">单击标题打开笔记；点 PDF 徽标进入全屏阅读</span>
      </div>
    </>
  )
}
