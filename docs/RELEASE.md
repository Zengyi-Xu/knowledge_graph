# 打包与发布

## 唯一推荐发行物：Windows x64 免安装网页包

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

## 版本号

修改 `package.json` 的 `version`。它同时决定界面版本角标、输出目录和 ZIP 文件名。
同版本重打包前应核对现有产物；不要把多个内容不同、版本号相同的 ZIP 发布到外部。

输出目录或 ZIP 已存在时脚本会拒绝执行（保护目录里可能存在的用户 `data/`）。同一版本本地重新验收时用
`npm run release:web -- --replace`：脚本把既有目录包与 ZIP 改名为 `*.superseded-<时间戳>` 保留，再重新生成，不会删除任何文件。

## 发布到 GitHub Releases

1. 确认 `git status --short` 中没有 vault、`public/notes.json`、数据库、PDF、环境配置或密钥。
2. 检查 `release/web-v<版本>/` 的目录包、ZIP 与 `SHA256SUMS.txt`。
3. 运行 `npm run test:web` 与 `npm run test:web-portable`（后者解压 ZIP 后自动启动并回归，见第 1 节），并在解压后的目录人工启动一次。
4. 创建对应 tag/Release，只上传网页 ZIP 与校验文件，并使用相应版本发布说明。
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

## 不再发布 Electron EXE

仓库不再提供 `desktop:pack`、`desktop:installer`、`desktop:dist` 或 `release:portable`。
旧 Portable EXE、NSIS 安装器、解包目录和 electron-builder 配置都不属于当前发行路线。

`electron/**` 与 `src/types/desktop.d.ts` 暂时保留：它们是冻结的兼容层，开发测试仍会使用，
本地网页服务也复用其中部分文件、Zotero 和 AI 后端能力。删除或重构它们必须先按
`docs/FROZEN.md` 解冻并迁移契约，不能作为发布目录清理的一部分。

## 移动端方向

后续移动发行计划是复用 React/Vite 网页资源并接入 Capacitor Android 壳。必须先完成移动导航、
应用内存储、备份/恢复、文件权限、返回键和真机离线验证，再生成测试 APK。该方向不要求恢复
Windows Electron 安装器；详细边界见 `docs/ANDROID_MOBILE_HANDOFF.md`。

## 绝对不要进入分享包

- `public/notes.json`、任何 `*.notes-backup.json`、vault 中的 `.md` / `meta.json`
- SQLite 数据库、PDF、同步配置、`.env*`、签名密钥和真实 API 凭据
- 开发缓存、测试 vault、Electron 解包目录和旧安装器

打包脚本使用静态资源白名单并执行敏感文件扫描。若扫描失败，应修正输入或白名单，不能关闭检查。
