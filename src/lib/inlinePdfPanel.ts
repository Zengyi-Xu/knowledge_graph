/**
 * 详情页内嵌 PDF 面板与顶层布局之间的协作（模块级小状态，不需要 Provider）。
 *
 * 面板本体留在 LiteratureAttachments（打开入口与标注状态都在那儿），但「面板占哪一列」由布局说了算：
 * 展开时图谱收窄、面板独占一整列，详情信息与正文各占半列 —— 否则正文会被挤成一行。
 *
 * 用模块级状态而不是 Context：布局（App）与面板之间隔着懒加载的 NoteEditor，
 * 包 Provider 要重排整段布局的缩进；这里只有两个标量，够用且不引入新的依赖关系。
 * 没有布局时 slot 为 null，面板就地渲染（手机端、单栏「笔记」视图、自测里的 SSR 渲染）。
 */
import { useSyncExternalStore } from 'react'

let open = false
let slot: HTMLElement | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit() {
  for (const listener of listeners) listener()
}

/** 面板自己上报：内嵌 PDF 面板是否展开 */
export function setInlinePdfPanelOpen(next: boolean) {
  if (open === next) return
  open = next
  emit()
}

/** 布局提供挂载点：面板拿到它就 portal 过去；null = 就地渲染在笔记卡片里 */
export function setInlinePdfPanelSlot(next: HTMLElement | null) {
  if (slot === next) return
  slot = next
  emit()
}

export function useInlinePdfPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false)
}

export function useInlinePdfPanelSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => slot, () => null)
}
