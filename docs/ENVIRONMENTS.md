# 开发环境 / 正式环境隔离

目标：在开发环境里改代码、试参数时，**不可能**动到正式版正在用的设置与笔记目录。

## 一、两条清晰的运行路径

| | 开发版 | 正式发行版 |
| --- | --- | --- |
| 怎么起 | `npm run dev`；需要兼容验证时 `npm run desktop:dev` | 解压 `knowledge-graph-web-<版本>-windows-x64.zip` 后双击 `启动知识图谱.wsf`（无窗口；`启动知识图谱.cmd` 是窗口版） |
| 前端产物 | Vite 开发服务；Electron 兼容验证使用 `dist-dev/` | `dist/`，由随包 Node 启动本地服务 |
| 构建命令 | `npm run build:dev`（仅兼容验证） | `npm run build` 后 `npm run release:web` |
| 构建期常量 | `__APP_ENV__ = 'development'` | `__APP_ENV__ = 'production'` |

`vite.config.ts` 按 `mode` 决定 `build.outDir` 并把 `__APP_ENV__` / `__APP_VERSION__`
通过 `define` 注入前端。冻结的 `electron/main.cjs` 仍能加载 `dist-dev/` 或 `dist/`，用于兼容和测试；
当前发行流程不再调用 electron-builder，也不生成 EXE 或安装器。

## 二、数据隔离（关键）

渲染进程的存储键统一走 `src/lib/env.ts`：

```
正式版：kg-notes-v1 / kg-vault-dir-v1 / kg-graph-physics-v1 …
开发版：kg-dev-notes-v1 / kg-dev-vault-dir-v1 / kg-dev-graph-physics-v1 …
```

Electron 兼容测试的 `userData`（`知识图谱-dev`）与普通浏览器 profile 分开，因此其
`localStorage` 也相互独立：

- 开发版不应读取正式 vault、同步文件路径或图谱参数。
- 历史键（`kaust-knowledge-graph-*` 等旧命名）只在**正式版**里做一次前向迁移，
  开发版不会把它们搬进来（否则又把正式数据带进开发环境了）。

> 仍然要注意：**vault 目录不是靠 profile 隔离的**。如果开发时手工选中真实笔记目录，
> 仍会写同一批 md。开发和测试必须使用单独的测试 vault。

## 三、开发版专属行为

- 窗口标题固定为 `知识图谱（开发版）`（拦截页面的 `title` 更新，避免看不出来）。
- 界面右上角显示橙色「开发版」角标；正式版显示版本号。
- DevTools 可用；正式版 `devTools: false`，且一旦被打开就立刻关闭。
- 启动时在终端打印 `env=… userData=…`，方便确认当前跑的是哪一套。

## 四、Electron 兼容层边界

`electron/**` 与 `src/types/desktop.d.ts` 是冻结单元。本地网页服务仍复用其中经过测试的文件、
Zotero 和 AI 后端能力，因此暂不删除；它们不是新发行路线。若未来移动桥与网页桥完全替代这些
契约，应按 `docs/FROZEN.md` 的解冻流程另行迁移，不能在发行清理中顺手重构。
