"""知识图谱网页端的无窗口启动器。

双击 .pyw 时由 pythonw.exe 执行，不会出现 cmd 窗口，也不经过 Windows
Script Host。服务输出写入 data/temp/web-server.log；需要实时输出时仍可使用
同目录的“启动网页端.cmd”。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path


CREATE_NO_WINDOW = 0x08000000
CREATE_NEW_PROCESS_GROUP = 0x00000200


def show_error(message: str) -> None:
    try:
        from tkinter import messagebox

        messagebox.showerror("知识图谱网页端", message)
    except Exception:
        pass


def append_marker(log_path: Path) -> None:
    if log_path.exists() and log_path.stat().st_size > 256 * 1024:
        log_path.replace(log_path.with_suffix(".previous.log"))
    with log_path.open("a", encoding="utf-8") as log:
        log.write(f"\n=== kg-python-launch {time.strftime('%Y%m%d-%H%M%S')} ===\n")


def main() -> int:
    root = Path(__file__).resolve().parent
    log_path = root / "data" / "temp" / "web-server.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)

    node = shutil.which("node")
    if not node:
        show_error("没有找到 Node.js。请先安装 Node.js，再运行此文件。")
        return 1

    append_marker(log_path)
    hidden = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    startup = None
    if os.name == "nt":
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0

    if not (root / "dist" / "index.html").exists():
        npm = shutil.which("npm.cmd") or shutil.which("npm")
        if not npm:
            show_error("缺少 dist/index.html，并且没有找到 npm，无法自动构建。")
            return 1
        with log_path.open("ab", buffering=0) as log:
            result = subprocess.run(
                [npm, "run", "build"], cwd=root, stdin=subprocess.DEVNULL,
                stdout=log, stderr=subprocess.STDOUT, startupinfo=startup,
                creationflags=hidden, check=False,
            )
        if result.returncode:
            show_error(f"网页端构建失败。请查看日志：\n{log_path}")
            return result.returncode

    command = [node, str(root / "scripts" / "start-local-web.mjs"), *sys.argv[1:]]
    try:
        with log_path.open("ab", buffering=0) as log:
            child = subprocess.Popen(
                command, cwd=root, stdin=subprocess.DEVNULL, stdout=log,
                stderr=subprocess.STDOUT, startupinfo=startup, creationflags=hidden,
            )
            return child.wait()
    except Exception as error:
        show_error(f"知识图谱网页端没有成功启动：\n{error}\n\n日志：{log_path}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
