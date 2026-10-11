# 打包与发布

## 每次改动：留一个免安装 exe

```bash
npm run release:portable
```

脚本 `scripts/package-portable.mjs` 会：

1. `npm run build`（`tsc -b` + 生产构建到 `dist/`）；
2. `electron-builder --win portable --publish never`；
3. 把产物放在 `release/v<版本>/知识图谱-Portable-<版本>-x64.exe`；
4. 写 `release/v<版本>/MANIFEST.json`：版本、git commit（以及是否 dirty）、构建时间、
   electron 版本、该目录下所有 exe 的 SHA-256；
5. 往 `release/CHANGELOG.md` 追加一行。

同一个版本号再次打包时，旧 exe 会先被改名成 `…-<yyyyMMdd-HHmm>.exe` 留在同一目录，
不会被覆盖——这样「每次编辑」都有一个可以直接运行的 exe。

`release/` 已在 `.gitignore` 里：exe 不进 git（100 MB 级二进制），发布走 GitHub Releases。

## 版本号

改 `package.json` 的 `version` 即可（例如 `1.2.0` → `1.3.0`）。它同时决定：

- 产物目录 `release/v1.3.0/`
- exe 文件名里的版本
- 界面右上角的版本角标（`__APP_VERSION__`）

## 安装程序

```bash
npm run desktop:installer   # NSIS 安装包，同样落在 release/v<版本>/
npm run desktop:dist        # 免安装 + 安装包
```

## 发布到 GitHub Releases

1. 确认 `.gitignore` 生效：`git status --short` 里不应出现 `release/`、`public/notes.json`。
2. 提交并推送代码（exe 不进仓库）。
3. 在 GitHub 上新建 tag（如 `v1.2.0`）与 Release，把 `release/v<版本>/` 里的
   `…-Portable-….exe` 与 `…-Setup-….exe` 作为附件上传。
4. 把 `MANIFEST.json` 里的 SHA-256 贴进 Release 说明，方便下载者校验。

## 绝对不要提交的东西

- `public/notes.json`（笔记导出快照）与任何 `*.notes-backup.json`
- vault 目录里的 `.md` / `meta.json`
- `release/` 下的 exe
- `.env*`、签名密钥

`.gitignore` 已覆盖以上各项；如果误加了，用
`git rm --cached <文件>` 取消跟踪（保留本地文件）。
