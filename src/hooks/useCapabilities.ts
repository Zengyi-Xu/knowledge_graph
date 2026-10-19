/**
 * 能力表 hook：把 src/lib/capabilities.ts 的纯检测接进 React。
 *
 * 只在「环境真的可能变了」的事件上重算：显示模式（standalone）、指针粒度、
 * 浏览器安装事件。**不监听窗口尺寸** —— 能力与视口宽度无关，宽度由 CSS 断点负责。
 */
import * as React from 'react'
import { capabilitiesFor, readCapabilityEnv, type CapabilityReport } from '@/lib/capabilities'

const QUERIES = ['(display-mode: standalone)', '(display-mode: fullscreen)', '(display-mode: minimal-ui)', '(pointer: coarse)']

export function useCapabilities(): CapabilityReport {
  const [report, setReport] = React.useState<CapabilityReport>(() => capabilitiesFor(readCapabilityEnv()))

  React.useEffect(() => {
    const refresh = () => setReport(capabilitiesFor(readCapabilityEnv()))
    refresh()
    const lists: MediaQueryList[] = []
    for (const query of QUERIES) {
      try {
        const list = window.matchMedia(query)
        list.addEventListener('change', refresh)
        lists.push(list)
      } catch {
        /* 老浏览器不支持 MediaQueryList.addEventListener：忽略这一条 */
      }
    }
    window.addEventListener('beforeinstallprompt', refresh)
    window.addEventListener('appinstalled', refresh)
    return () => {
      for (const list of lists) list.removeEventListener('change', refresh)
      window.removeEventListener('beforeinstallprompt', refresh)
      window.removeEventListener('appinstalled', refresh)
    }
  }, [])

  return report
}
