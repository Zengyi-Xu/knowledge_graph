/**
 * 「环境能力」面板：把 capabilities.ts 的结果如实展示出来。
 *
 * 顶栏的环境徽标点开就是这里。移动端第一阶段的要求是「明确降级」：
 * 所以每一行都写清 支持 / 不支持、为什么、以及不支持时能做什么。
 * 数据属性（data-capability / data-supported）是给响应式验证脚本断言的，
 * 不参与业务逻辑。
 */
import { AlertTriangle, CheckCircle2, CloudOff, MonitorSmartphone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { capabilitySummary, splitCapabilities, type CapabilityState, type CapabilityReport } from '@/lib/capabilities'

interface DialogProps {
  open: boolean
  onClose: () => void
  report: CapabilityReport
}

function Row({ state }: { state: CapabilityState }) {
  const Icon = state.supported ? CheckCircle2 : state.id === 'localAi' ? CloudOff : AlertTriangle
  return (
    <li
      data-capability={state.id}
      data-supported={state.supported ? 'true' : 'false'}
      className="flex items-start gap-2 rounded-md border p-2.5"
    >
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${state.supported ? 'text-emerald-600' : 'text-amber-600'}`}
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{state.label}</span>
          <Badge variant={state.supported ? 'secondary' : 'outline'} className="text-[10px]">
            {state.supported ? '可用' : '已降级'}
          </Badge>
          <span className="text-[10px] text-muted-foreground">{state.scope === 'host' ? '本机服务' : '浏览器自带'}</span>
        </div>
        {!state.supported && (
          <>
            <p className="text-xs text-muted-foreground">{state.reason}</p>
            <p className="text-xs text-muted-foreground">替代：{state.fallback}</p>
          </>
        )}
      </div>
    </li>
  )
}

export function CapabilityDialog({ open, onClose, report }: DialogProps) {
  const { available, degraded } = splitCapabilities(report)
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent
        data-testid="capability-dialog"
        className="max-h-[85vh] overflow-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MonitorSmartphone className="h-4 w-4 text-primary" /> 环境能力
          </DialogTitle>
          <DialogDescription>
            {capabilitySummary(report)}。判定只看客观信号（桥接接口、安全上下文、是否本机打开、显示模式、指针类型），
            不使用 User-Agent。标为「已降级」的功能不会执行，也不会提示成功。
          </DialogDescription>
        </DialogHeader>

        {degraded.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-xs font-medium text-amber-700">已降级（{degraded.length}）</h3>
            <ul className="space-y-1.5">
              {degraded.map((state) => (
                <Row key={state.id} state={state} />
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">可用（{available.length}）</h3>
          <ul className="space-y-1.5">
            {available.map((state) => (
              <Row key={state.id} state={state} />
            ))}
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 顶栏用的环境徽标：点开能力面板 */
export function CapabilityBadge({ report, onClick, className = '' }: { report: CapabilityReport; onClick: () => void; className?: string }) {
  const { degraded } = splitCapabilities(report)
  const hostDegraded = degraded.filter((c) => c.scope === 'host').length
  return (
    <button
      type="button"
      data-testid="capability-badge"
      onClick={onClick}
      title={`${capabilitySummary(report)} · 点开查看明细`}
      className={`flex min-h-11 shrink-0 items-center gap-1 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent md:min-h-8 md:px-1.5 ${className}`}
    >
      <MonitorSmartphone className="h-3 w-3" aria-hidden="true" />
      <span className="hidden md:inline">{hostDegraded > 0 ? `${hostDegraded} 项能力已降级` : '能力完整'}</span>
      <span className="md:hidden">{hostDegraded > 0 ? `降级 ${hostDegraded}` : '完整'}</span>
    </button>
  )
}
