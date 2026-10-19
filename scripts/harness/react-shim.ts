/**
 * 极简 React 运行时替身：让 Node 里能直接跑真实的 `useNotes`（无 DOM、无 react-dom）。
 *
 * 只实现 useNotes 系列 hook 依赖的 5 个 API，语义对齐 React 18/19：
 * - 一次 render 按调用顺序占用 hooks 槽位（组件内 hook 顺序固定，与 React 一致）；
 * - effect 依赖按 Object.is 逐项比较；重跑前先按顺序执行上一轮的清理函数；
 * - effect 里 setState 不会立刻重入 render，而是等本轮 effect 全部跑完后再提交（与 React 相同）。
 *
 * 与 React 的**有意差异**：事件/异步回调里的 setState 同步提交（不排队到微任务），
 * 这样测试里「编辑 → 立刻断言 notesRef/磁盘」才有确定时序。
 *
 * 仅供 scripts/ 下的特征测试使用，不进应用产物。
 */

type Deps = readonly unknown[]

interface StateSlot {
  kind: 'state'
  value: unknown
  /** React 的 setState 身份跨渲染稳定，这里也必须只建一次，否则依赖 setState 的 memo/effect 会每轮重跑 */
  set?: (next: unknown) => void
}
interface RefSlot {
  kind: 'ref'
  box: { current: unknown }
}
interface MemoSlot {
  kind: 'memo'
  deps: Deps | undefined
  value: unknown
}
interface EffectSlot {
  kind: 'effect'
  deps: Deps | undefined
  fn: () => void | (() => void)
  needsRun: boolean
  ran: boolean
  cleanup?: () => void
}
type Slot = StateSlot | RefSlot | MemoSlot | EffectSlot

let slots: Slot[] = []
let cursor = 0
let renderFn: (() => void) | null = null
let running = false
let dirty = false
let mounted = false

function sameDeps(a: Deps | undefined, b: Deps | undefined): boolean {
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

function slot<T extends Slot>(make: () => T): T {
  const index = cursor++
  const existing = slots[index]
  if (existing === undefined) {
    const created = make()
    slots[index] = created
    return created
  }
  return existing as T
}

function schedule(): void {
  if (!mounted) return
  dirty = true
  if (!running) flush()
}

function commitEffects(): void {
  // React：先按顺序跑完所有需要重跑的 effect 的清理函数，再跑这一轮的 effect。
  for (const item of slots) {
    if (item.kind !== 'effect' || !item.needsRun || !item.ran) continue
    const cleanup = item.cleanup
    item.cleanup = undefined
    if (cleanup) cleanup()
  }
  for (const item of slots) {
    if (item.kind !== 'effect' || !item.needsRun) continue
    item.needsRun = false
    item.ran = true
    const result = item.fn()
    if (typeof result === 'function') item.cleanup = result
  }
}

function flush(): void {
  if (!renderFn) return
  if (running) {
    dirty = true
    return
  }
  running = true
  try {
    let guard = 0
    do {
      dirty = false
      cursor = 0
      renderFn!()
      commitEffects()
    } while (dirty && ++guard < 200)
  } finally {
    running = false
  }
}

export function useState<S>(init: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void] {
  const item = slot<StateSlot>(() => ({
    kind: 'state',
    value: typeof init === 'function' ? (init as () => S)() : init,
  }))
  if (!item.set) {
    item.set = (next: unknown) => {
      const value = typeof next === 'function' ? (next as (prev: S) => S)(item.value as S) : (next as S)
      if (Object.is(value, item.value)) return
      item.value = value
      schedule()
    }
  }
  return [item.value as S, item.set as (next: S | ((prev: S) => S)) => void]
}

export function useRef<T>(init: T): { current: T } {
  const item = slot<RefSlot>(() => ({ kind: 'ref', box: { current: init } }))
  return item.box as { current: T }
}

export function useMemo<T>(factory: () => T, deps?: Deps): T {
  const item = slot<MemoSlot>(() => ({ kind: 'memo', deps: undefined, value: undefined }))
  if (!sameDeps(item.deps, deps)) {
    item.value = factory()
    item.deps = deps
  }
  return item.value as T
}

export function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps?: Deps): T {
  return useMemo(() => fn, deps)
}

export function useEffect(fn: () => void | (() => void), deps?: Deps): void {
  const item = slot<EffectSlot>(() => ({ kind: 'effect', deps: undefined, fn, needsRun: false, ran: false }))
  item.fn = fn
  if (!sameDeps(item.deps, deps) || !item.ran) {
    item.deps = deps
    item.needsRun = true
  }
}

/** 与 useEffect 同义（useNotes 不用，但替身要完整一点，避免将来 import 报错） */
export const useLayoutEffect = useEffect

export interface Mounted {
  unmount: () => void
}

export function mount(render: () => void): Mounted {
  renderFn = render
  slots = []
  cursor = 0
  mounted = true
  dirty = false
  flush()
  return {
    unmount() {
      mounted = false
      // 卸载后再落地的异步 setState / 定时器回调一律丢弃（renderFn 已清空）
      for (const item of slots) {
        if (item.kind !== 'effect') continue
        const cleanup = item.cleanup
        item.cleanup = undefined
        if (cleanup) cleanup()
      }
      slots = []
      renderFn = null
    },
  }
}
