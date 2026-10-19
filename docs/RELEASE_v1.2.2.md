# v1.2.2 · Windows x64 免安装网页版

## Summary

修掉一次真实数据事故，并给「按 Zotero key / localPdf 找 PDF」这条链补上不依赖字段的兜底层。

- **服务端字段级写入门禁**（`scripts/vault-write-guard.mjs` + `scripts/local-web.mjs` 的 `vault:write`）：
  笔记声明了 `requiredCapabilities`，本次写入的新文本就必须还带着这些字段（含声明行本身、值不能为空），
  否则**整批拒绝**并在界面报错；`meta.json` 同样不能丢 `formatVersion` 或自定义顶层键。
  客户端里的门禁只约束新客户端；这一层挡的是任何写入方——2026-10-16 就是旧页面绕过的。
- **本地 PDF 按标题兜底**（`scripts/pdf-match.mjs`）：`localPdf` 与 Zotero 都没命中的文献，
  由本机服务在 `--pdf-root` 授权目录里按文件名保守匹配（并列不猜、一份 PDF 只归一篇）。
  文献表的 PDF 徽标直接可读，详情页显示「匹配到的本地 PDF」+「记到这篇笔记」按钮（点了才写 `localPdf`）。
  纯内存状态，不改任何文件。
- 其余与 v1.2.1 相同：Markdown 笔记、双链图谱、文献表、引用、Zotero 只读同步、双栏 PDF 阅读与标注。

## 使用

下载 `knowledge-graph-web-1.2.2-windows-x64.zip`，完整解压后双击 `启动知识图谱.wsf`：默认浏览器打开 `http://127.0.0.1:4173`，
桌面不留命令窗口（输出进 `data/temp/web-server.log`）；停止用 `停止知识图谱.wsf`，要看实时输出就用 `启动知识图谱.cmd`。

从 1.2.1 升级：先停止旧服务，把新版本解压到新文件夹，保留自己的 `data/vault`（或在新 `配置.json` 里指向它）。
旧版本（`release-archive/旧入口-20261016/`）不要再用来打开真实笔记库。

## 验证

- `npm run build` / `npm run frozen:check`（10 个冻结单元一致）/ `npm run test:frozen`（除既有失败的 `test:vault-e2e` 外全绿）。
- `npm run test:web` 56 项（含 6 项写入门禁：抹字段 / 只丢声明行 / 清空值 / 索引降级 / 被拒后磁盘不变 / 正常改写放行）。
- `npm run test:lit-view` 62 项、`npm run test:lit-dom` 41 项（含兜底匹配的徽标与来源优先级）。
- `npm run budget:check` 通过（各场景 +2.7~5.2KB）；`npm run test:bundle-scenarios` 30 项通过。
- `npm run test:web-portable`：随包 Node、隔离 PATH、含中文/空格目录下启动、静态资源、Markdown 读写、SQLite 加载、56 项本地服务回归。
- 真实库实测：服务端门禁对「抹掉能力字段」的写入返回 400 且磁盘不变；按标题兜底在真实标题上首批 400 篇命中 30 篇。
