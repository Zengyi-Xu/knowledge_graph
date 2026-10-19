/**
 * 能力降级的统一提示出口。
 *
 * 要求（移动端第一阶段）：不支持的环境里必须**明确降级**，不能假装成功。
 * 所以这里统一用 warning/error 提示，并且永远带上「为什么」和「替代做法」，
 * 而不是丢一句「操作成功」。
 */
import { toast } from 'sonner'
import { capability, type CapabilityId, type CapabilityState } from '@/lib/capabilities'

export type DegradeKind = 'warning' | 'error'

/** 弹一条明确的降级提示，返回该能力项（调用方可用 reason 写进界面文案） */
export function toastDegraded(id: CapabilityId, detail?: string, kind: DegradeKind = 'warning'): CapabilityState {
  const state = capability(id)
  const head = detail ? `${detail}：${state.reason}` : state.reason
  const message = state.fallback ? `${head}\n${state.fallback}` : head
  if (kind === 'error') toast.error(message)
  else toast.warning(message)
  return state
}

/** 只取理由文本，用于 `<Button title>` 或禁用态说明 */
export function degradedReason(id: CapabilityId): string {
  const state = capability(id)
  if (state.supported) return ''
  return state.fallback ? `${state.reason}（${state.fallback}）` : state.reason
}
