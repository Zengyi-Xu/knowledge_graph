# 移动端第一阶段交付报告：响应式网页 / PWA + 能力降级

日期：2026-10-15 · 范围：手机/平板视口下的可用性 + 「没有本机服务时明确降级」。
**不生成 APK、不引入 Capacitor**（那是第二阶段，方案见 docs/ANDROID_CAPACITOR_PLAN.md）。
验证内容全部为合成夹具（6 条笔记、无任何个人信息），不读真实 vault、不连真实 Zotero。

## 1. 结论

| 项目 | 结果 |
| --- | --- |
| 六档宽度真浏览器验证 | **325 项断言 / 0 失败**（360/390/412/768/1024/1440 × 有桥、无桥 + 360、1440 各一档所见即所得） |
| 能力检测 | 只看客观信号（桥接方法、`isSecureContext`、回环地址、媒体查询），**不使用 User-Agent** |
| 降级行为 | 无本机服务时 9 项能力标「已降级」，每项写明原因 + 替代做法，**不会提示成功** |
| `npm run frozen:check` | 10 个冻结单元全部一致（未触碰黑箱） |
| `npm run budget:check` | 通过：入口 459.1KB（预算 ≤500KB），文献场景 +1.2KB，各场景均远低于基线 +10% |
| 其它回归 | `test:lit-view` 57 通过 · `test:lit-dom` 41 通过 · `test:vault-gate` 43 通过 · `test:use-notes` 10 通过 |

## 2. 能力检测（src/lib/capabilities.ts）

判定输入全部来自当前页面能直接观察到的事实：桥接对象上**方法是否存在**、`window.isSecureContext`、
`location.hostname` 是否回环（`isLoopbackHost`：`localhost` / `::1` / `127.0.0.0/8`）、
`matchMedia('(display-mode: standalone)')`、`matchMedia('(pointer: coarse)')`、`ClipboardItem.supports('text/rtf')`、
`a[download]` + `URL.createObjectURL`。**没有任何一处读 `navigator.userAgent`。**

能力分两档：

- **host（只在那台跑本机服务的机器上成立）**：`vaultDir`（读写笔记目录）、`vaultAttachments`（目录内附件）、
  `zoteroSqlite`（只读 zotero.sqlite）、`localPdf`（笔记里记录的绝对路径）、`systemOpener`（交给系统打开/定位）、
  `rtfClipboard`（Word 域代码富文本剪贴板）、`localAi`（本机 AI）。
- **client（跟着浏览器 / 设备走）**：`plainClipboard`、`fileTransfer`（下载 + 文件选择）、`installedApp`（可添加到主屏）、
  `coarsePointer`（手指输入）。

host 能力要同时满足「桥在」+「这台机器就是宿主」；跨设备打开网页（`http://<局域网 IP>`）时同样降级，
理由文案会带上地址，说明绝对路径在别的设备上没有意义。

## 3. 降级行为（无本机服务时）

| 能力 | 界面表现 | 用户能做什么 |
| --- | --- | --- |
| 文件目录 | 手机端顶部不再显示存储/同步状态栏，收进底部「存储」面板并写明「本地目录已降级」；顶栏徽标显示「N 项能力已降级」 | 用浏览器本地存储继续记；「导出备份 / 导入备份」搬数据 |
| 本机 Zotero 数据库 | 点「同步 Zotero 分类」只给降级说明，**不打开对话框** | 文献页「按 DOI / arXiv 导入」「导入 BibTeX / RIS」照常可用 |
| localPdf 绝对路径 | 点 PDF 徽标明确说明「本机服务…，不会假装打开成功」，**不进阅读器** | 提示改用 Zotero 打开，或把文件导入当前环境 |
| RTF 富文本 | 剪贴板退回纯文本 / HTML，文案明确说「没有 Word 域」 | 粘贴后仍是可读文本，只是 Zotero 不能识别域代码 |
| 本机 AI | AI 面板显示降级说明，不发请求 | 面板其余功能照常 |

「能力」面板（顶栏徽标打开）逐条列出：范围（本机服务 / 本浏览器）+ `已降级` 徽章 + 为什么 + 替代做法。

## 4. 响应式外壳改动

断点沿用既有的 768（`src/hooks/use-mobile.ts`），新增：

- `src/components/MobileNav.tsx`：底部导航（笔记 / 图谱 / 文献 / 存储），`env(safe-area-inset-bottom)` 留白。
- `src/App.tsx`：手机端列表 ⇄ 详情切换（详情有返回按钮）、不渲染桌面侧栏、`both` 视图在手机端按 `notes` 渲染、
  状态栏收进「存储」对话框、Toaster 改顶部居中；新增 `openPdfReader()` 在打开 PDF 前按能力闸门判定。
- `src/components/literature/LiteratureTable.tsx`：手机端卡片列表（`literature-cards`）与桌面表格共用 `RowActionsMenu`。
- `src/components/NoteEditor.tsx`：标题独占一行，次要操作（导出 / 导入主题 / 删除）收进「更多」菜单，触摸目标 ≥44px。
- `src/components/PdfReadingWorkspace.tsx`：手机端改纵向分栏，头部按钮文字在窄屏隐藏。
- `src/components/BackupTransferMenu.tsx`：手机端整组收进「更多」；768–1279px 只留图标（修顶栏横向溢出）。
- `src/components/EnvironmentCapabilities.tsx` + `src/lib/degrade.ts`：能力面板与统一的降级提示（`toastDegraded`）。

## 5. PWA

`public/manifest.webmanifest`（`display: standalone`、图标 192/512 + maskable + apple-touch-icon）、
`public/sw.js`（离线壳：跳过 `/api/*` 与 `local-bridge.js`，导航响应带 `X-KG-No-Cache` 时不缓存，
避免把本机网页端注入的访问令牌缓存下来）、`src/lib/pwa.ts`（`beforeinstallprompt` 捕获 + Service Worker 注册）。
`index.html` 补 `lang="zh-CN"`、`viewport-fit=cover`、manifest / 图标 / apple meta、`theme-color`。

## 6. 怎么验证的

```
npm run test:mobile                                                    # 自动 build 后跑六档
node scripts/mobile-responsive-check.mjs --no-build                    # 复用已有 dist
node scripts/mobile-responsive-check.mjs --no-build --only 360,768
node scripts/mobile-responsive-check.mjs --no-build --shots            # 另存 30 张截图
node scripts/mobile-responsive-check.mjs --no-build --shots=capability # 只补拍某个状态
```

两个环境变量（同一仓库有别的会话在构建 / 清理时用得上）：`KG_MOBILE_TMP` 换产物目录、`KG_MOBILE_DIST` 指向 dist 快照。

关键实现细节：

- **真视口靠 iframe**：无头 Chrome 的窗口最小宽度约 500px，`--window-size=360` 拿不到 360，所以父页 `harness-*.html`
  里放一个 `width=360/390/412` 的 iframe，驱动脚本在 iframe 内测量。
- **每个任务单独启动一次浏览器**，只放一个 iframe，虚拟时间预算各算各的，避免相互干扰。
- 页面内驱动（`scripts/mobile-dom-driver.js`）逐步跑 `default → capability → detail → edit → preview → literature →
  pdf → graph → storage`，每步做完就把报告写进 `<pre id="kg-report">`，即使某个任务半途卡住也能拿到已完成部分。
- 溢出扫描会跳过「祖先有裁剪或自身可横向滚动」的元素：宽表格、代码块内部横向滚动是设计如此，不是页面撑宽。

## 7. 本轮修掉的问题（都是真实缺陷或真实误判）

1. **未知 `type` 的笔记会白屏**：`NoteList` 直接取 `NOTE_TYPE_META[type]`，遇到不认识的类型就抛错。
   夹具里放了一条未知类型，把这条路径暴露出来；已按 `?? NOTE_TYPE_META.other` 兜底。
2. **768 / 1024 顶栏横向溢出**：操作按钮组太宽，改成 768–1279 只留图标、手机端收进菜单。
3. **手机端编辑器是懒加载 chunk**，进详情页 150ms 内量到的是空壳（没有标签页、没有预览）——测试侧改成等挂载再断言。
4. **`test:lit-dom` 撞上手机卡片布局**：无头 Chrome 默认窗口宽度落到 768 以下，表格根本没渲染。
   已固定 `--window-size=1280,900`，并在探针里加一条「窗口是桌面宽度」的断言，避免以后静默退化成空跑。
5. **能力闸门确实在起作用**：闸门上线后 `test:lit-dom` 的桥桩缺少 `readZoteroPdf` / `isElectron`，
   「同步 Zotero 分类」被正确降级成只提示 → 桩按真实 preload 补齐（41/41 恢复全绿）。
6. **能力面板入场动画期间会有一半露在屏幕外**：`ui-kit` 的 `zoom-in-95` 动画帧顶掉了 `-translate-x-1/2`，
   200ms 后回到居中。`src/components/ui/**` 是冻结单元，本轮没有改，只记录为已知外观问题。

## 8. 已知未验证 / 缺口（别当成已完成）

- **真机没验过**：安卓软键盘顶起布局、系统返回键、文件选择器权限、iOS Safari（没有 `beforeinstallprompt`，
  添加到主屏走「共享 → 添加到主屏幕」）。
- **Service Worker 在 `file://` 下不注册**：本地网页端要走 `http://127.0.0.1` 才有离线壳；`--dump-dom` 的
  `file://` 验证覆盖不到 SW 的离线行为。
- 「触摸目标 ≥44px」是静态尺寸检查，不等于真机手感；`(pointer: coarse)` 在无头 Chrome 里也不成立。
- 合成夹具只有 6 条，覆盖不了真实库（668 篇）的长列表滚动性能。
- 未做：正式 APK、Capacitor 打包、安卓桥接层（见 docs/ANDROID_CAPACITOR_PLAN.md）。

## 9. 产物位置

- 断言明细：`.tmp-mobile/out/results.json`（逐条 name / ok / detail）
- 截图：`.tmp-mobile/out/screenshots/`（30 张：六档 × default / detail / preview / literature / capability，合成内容）
