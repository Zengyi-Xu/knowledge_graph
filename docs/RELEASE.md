# 打包与发布

## 两种发行物

| 发行物 | 产物 | 构建方式 |
| --- | --- | --- |
| 三端桌面安装包 | macOS dmg/zip（arm64 + x64）、Windows NSIS（x64）、Linux AppImage/deb（arm64） | 打 `v*` tag，GitHub Actions 三端并行构建并发布到同名 Release |
| Windows x64 免安装网页包 | 目录包 + ZIP + `SHA256SUMS.txt` | `npm run build` + `npm run release:web` |

### 三端桌面安装包（electron-builder）

配置在 `package.json` 的 `build` 字段，工作流 `.github/workflows/release.yml`：

- `release-windows`：`windows-latest`，NSIS x64（`KnowledgeGraph-<版本>-win-x64.exe`）
- `release-mac`：`macos-latest`，dmg/zip，arm64 + x64
- `release-linux-arm64`：`ubuntu-24.04-arm`，AppImage/deb（树莓派 64 位；原生模块在目标架构上编译）

发布步骤：

1. 本地 `npx tsc -b`、`npm run frozen:check`、`npm run build` 全绿。
2. 改 `package.json` 的 `version`，用 `npm install --package-lock-only --ignore-scripts` 同步 lockfile，
   并更新根目录 `release-notes.md`（electron-builder 会把它作为 Release 正文）。
3. 提交后 `git tag v<版本>`、`git push origin main --tags`。
4. Actions 三个 job 全绿后，Release 应同时有 win / mac / linux 产物；失败看对应 job 日志，
   不要手改 tag 指向或复用同一版本号重发不同内容。
5. `.blockmap` 与 `latest-*.yml` 是自动更新元数据（应用目前没有内置自动更新），保留无妨。

### Windows x64 免安装网页包

```bash
npm ci
npm run frozen:check
npx tsc -b
npm run test:web
npm run build
npm run release:web
npm run test:web-portable
```

`npm run build` 完成 TypeScript 与 Vite 生产构建；`npm run release:web` 复用 `dist/`，生成：

- `release/web-v<版本>/knowledge-graph-web-<版本>-windows-x64/`
- 同名 ZIP
- `MANIFEST.json`（随目录包）
- `SHA256SUMS.txt`（ZIP 校验值）

打包按白名单搬运 `dist/` 里的 `index.html`、`assets/`、`vditor/`、`manifest.webmanifest`、`sw.js`、`icons/`
（后三项是 PWA 外壳，`index.html` 与 `sw.js` 直接引用，缺任何一项都是 404；`dist/notes.json` 之类的本地快照永不进包）。

网页包附带 Windows x64 Node 和 SQLite 原生模块。用户完整解压后双击
`启动知识图谱.wsf`（无窗口启动；同级还有窗口版 `启动知识图谱.cmd`、停止用 `停止知识图谱.wsf`），
无需预装 Node、npm、Electron 或 NSIS。三个入口都由 `scripts/package-web-portable.mjs` 从
`build/web-portable/` 复制进包，并统一改写成 CRLF。

## 安装与升级（桌面安装包）

### macOS

首次安装：打开 dmg，把 `KnowledgeGraph` 拖进「应用程序」。已装旧版时：

1. 完全退出旧版（⌘Q）。
2. 下载与芯片对应的新 dmg：Apple 芯片选 `...-mac-arm64.dmg`，Intel 选 `...-mac-x64.dmg`
   （终端 `uname -m` 显示 `arm64` 或 `x86_64`）。
3. 打开 dmg，把 `KnowledgeGraph` 拖进「应用程序」，提示已存在时选「替换」。
4. 应用未做 Apple 签名/公证：首次打开若提示「无法验证开发者」，右键 App →「打开」；
   若提示「已损坏」，执行 `xattr -cr /Applications/KnowledgeGraph.app` 后再打开。

笔记库（默认 `~/Documents/知识图谱`）与应用设置（`~/Library/Application Support/KnowledgeGraph`）
都在 App 之外，替换 App 不会改动它们；仍建议升级前把 vault 复制一份或做一次应用内导出。

### Windows

运行新的 `KnowledgeGraph-<版本>-win-x64.exe` 覆盖安装即可；笔记库在界面选择的 vault 目录里，
卸载/升级安装包不会删除笔记。

### Linux arm64（树莓派 64 位）

```bash
sudo apt install ./KnowledgeGraph-<版本>-linux-arm64.deb   # 覆盖升级
# 或替换 AppImage
chmod +x KnowledgeGraph-<版本>-linux-arm64.AppImage
```

只支持 64 位系统（arm64）；32 位 Raspberry Pi OS（armv7l）不在构建范围内。

## 版本号

修改 `package.json` 的 `version`。它同时决定界面版本角标、输出目录和 ZIP 文件名。
同版本重打包前应核对现有产物；不要把多个内容不同、版本号相同的 ZIP 发布到外部。

输出目录或 ZIP 已存在时脚本会拒绝执行（保护目录里可能存在的用户 `data/`）。同一版本本地重新验收时用
`npm run release:web -- --replace`：脚本把既有目录包与 ZIP 改名为 `*.superseded-<时间戳>` 保留，再重新生成，不会删除任何文件。

## 免安装网页包发布到 GitHub Releases

1. 确认 `git status --short` 中没有 vault、`public/notes.json`、数据库、PDF、环境配置或密钥。
2. 检查 `release/web-v<版本>/` 的目录包、ZIP 与 `SHA256SUMS.txt`。
3. 运行 `npm run test:web` 与 `npm run test:web-portable`（后者解压 ZIP 后自动启动并回归，见上一节），并在解压后的目录人工启动一次。
4. 把网页 ZIP 与校验值挂到对应版本 Release（可与三端安装包同一个 Release），并使用相应版本发布说明。
5. 在一台未安装 Node 的 Windows x64 机器上抽查：解压、启动、选择测试 vault、停止服务。

### 受限环境（沙箱/受控目录）里跑 `test:web-portable` 会假失败

`npm run test:web-portable` 会把包复制到工作区根目录下的 `.tmp-web-portable-*/中文 分享测试/` 再启动。
在受限沙箱里，从**工作区根目录下新建的目录**执行任何 exe 都会被拦下，表现为
`Error: 启动退出 0: `（stdout 完全为空）。启动脚本现在把真实退出码透传出来，失败时末尾会打印
「服务已退出（代码 N）」，其中 `N = -1073741502`（`0xC0000142`）就是被沙箱拦下的特征；
连这一行都没有，说明 `.cmd` 压根没被执行。

判据（30 秒内可自证，不是发行缺陷）：把同一份 `runtime\node.exe` 复制到别处执行 `--version`——
放到 `%TEMP%`、`release\` 等既有目录下能正常打印版本号，放到工作区根目录新建的目录下会返回
`-1073741502`（`0xC0000142` DLL 初始化失败）。连宿主 `C:\Program Files\nodejs\node.exe` 复制过去也照样失败，
说明与本包的资源、路径中文字符无关。

处理：这类测试需要**在非沙箱终端**执行（`npm run test:web-portable`，需要时加 `--zip <ZIP>` 直接验分发包）。
沙箱内可照常跑 `frozen:check`、`tsc -b`、`test:web`、`build`、`release:web`。

## 旧桌面 EXE 与当前安装包

`release-archive/` 里归档的是 2026-10-16 之前的旧桌面构建（含旧 Portable EXE / NSIS 安装器）。
它们不认识后来新增的 `formatVersion` / `requiredCapabilities` / `zoteroKeys` / `localPdf` 等
front matter 字段，回写会把字段抹掉，**禁止再指向真实 vault**。

v1.2.6 起由本仓库 CI 构建的安装包（Windows NSIS / macOS dmg / Linux deb+AppImage）包含当前前端与
写入门禁，属于当前发行路线，可以用于真实数据。本地用 `npm run dist:mac` / `npm run dist:win`
打出的包与 CI 包同源，但发布仍以 tag 触发的 CI 产物为准。

`electron/**` 与 `src/types/desktop.d.ts` 是桌面壳与冻结兼容层，开发测试、本地网页服务都依赖它们；
删除或重构必须先按 `docs/FROZEN.md` 解冻并迁移契约，不能作为发布目录清理的一部分。

## 移动端方向

后续移动发行计划是复用 React/Vite 网页资源并接入 Capacitor Android 壳。必须先完成移动导航、
应用内存储、备份/恢复、文件权限、返回键和真机离线验证，再生成测试 APK。该方向与桌面安装包互不影响；
详细边界见 `docs/ANDROID_MOBILE_HANDOFF.md`。

## 绝对不要进入分享包

- `public/notes.json`、任何 `*.notes-backup.json`、vault 中的 `.md` / `meta.json`
- SQLite 数据库、PDF、同步配置、`.env*`、签名密钥和真实 API 凭据
- 开发缓存、测试 vault、Electron 解包目录和旧安装器

打包脚本使用静态资源白名单并执行敏感文件扫描。若扫描失败，应修正输入或白名单，不能关闭检查。
