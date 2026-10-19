import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { captureInstallPrompt, registerServiceWorker } from '@/lib/pwa'

// PWA：先捕获安装机会（事件可能在任何时刻派发），再注册离线壳 Service Worker
captureInstallPrompt()
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 不再套 BrowserRouter：全库没有任何 Routes/useNavigate/useParams（只有 main.tsx 引过它），
        而 react-router 在入口里是 ~30KB 的死重（预算见 docs/BUNDLE_BUDGET.md）。
        将来真要按 URL 分路由，再把 BrowserRouter 套回来即可。 */}
    <App />
  </StrictMode>,
)
