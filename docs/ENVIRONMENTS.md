# 开发环境 / 正式环境隔离

目标：在开发环境里改代码、试参数时，**不可能**动到正式版正在用的设置与笔记目录。

## 一、两条清晰的运行路径

| | 开发版 | 正式版 |
| --- | --- | --- |
| 怎么起 | `npm run dev`（浏览器）、`npm run dev:desktop` | 双击 `release/v<版本>/` 里的免安装 exe，或安装版 |
| 前端产物 | `dist-dev/` | `dist/` |
| 构建命令 | `npm run build:dev`（`vite build --mode development`） | `npm run build`（`vite build`） |
| 构建期常量 | `__APP_ENV__ = 'development'` | `__APP_ENV__ = 'production'` |

`vite.config.ts` 按 `mode` 决定 `build.outDir` 并把 `__APP_ENV__` / `__APP_VERSION__`
通过 `define` 注入前端；`electron/main.cjs` 用 `app.isPackaged` 判断当前是开发版还是正式版，
加载 `dist-dev/` 或 `dist/`。两条路径互不覆盖。

## 二、数据隔离（关键）

渲染进程的存储键统一走 `src/lib/env.ts`：

```
正式版：kg-notes-v1 / kg-vault-dir-v1 / kg-graph-physics-v1 …
开发版：kg-dev-notes-v1 / kg-dev-vault-dir-v1 / kg-dev-graph-physics-v1 …
```

再加上 Electron 的 `userData` 分开（`知识图谱-dev` vs `知识图谱`），开发版与正式版
的 `localStorage` 属于两套完全独立的 Chromium profile：

- 开发版不会读到正式版的 vault 目录、同步文件路径、图谱参数；反之亦然。
- 历史键（`kaust-knowledge-graph-*` 等旧命名）只在**正式版**里做一次前向迁移，
  开发版不会把它们搬进来（否则又把正式数据带进开发环境了）。

> 仍然要注意：**vault 目录是共享的**。如果手工在开发版里选中了正式版正在用的笔记目录，
> 两边都会写同一批 md。开发时建议选一个单独的测试目录。

## 三、开发版专属行为

- 窗口标题固定为 `知识图谱（开发版）`（拦截页面的 `title` 更新，避免看不出来）。
- 界面右上角显示橙色「开发版」角标；正式版显示版本号。
- DevTools 可用；正式版 `devTools: false`，且一旦被打开就立刻关闭。
- 启动时在终端打印 `env=… userData=…`，方便确认当前跑的是哪一套。

## 四、临时把正式版当开发版排查

在地址栏路径后加 `?dev=1`（例如 `kg://desktop/?dev=1`）会切到开发版的键前缀。
这只影响存储键，不改变 exe 是正式版的判断；排查完请关掉，避免设置分叉。
