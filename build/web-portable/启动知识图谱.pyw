"""知识图谱免安装网页端的小型 Windows 启动面板。"""

from __future__ import annotations

import ctypes
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, ttk


CREATE_NO_WINDOW = 0x08000000
CREATE_NEW_PROCESS_GROUP = 0x00000200
APP_ID = "KnowledgeGraph.Portable.Launcher.1.2.7"


class Launcher:
    def __init__(self) -> None:
        self.package_root = Path(__file__).resolve().parent
        self.root_dir = self.package_root
        self.node = self.package_root / "runtime" / "node.exe"
        self.start_script = self.package_root / "scripts" / "start-portable-web.mjs"
        self.port = 4173
        self.child: subprocess.Popen[bytes] | None = None
        self.log_handle = None
        self.opened_once = False
        self.closing = False

        self._resolve_runtime()
        self.log_path = self.root_dir / "data" / "temp" / "web-server.log"
        self._read_port()

        try:
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
        except Exception:
            pass

        self.window = tk.Tk()
        self.window.title("知识图谱")
        self.window.geometry("430x250")
        self.window.minsize(430, 250)
        self.window.resizable(False, False)
        self.window.protocol("WM_DELETE_WINDOW", self.minimize)
        icon = self.package_root / "知识图谱.ico"
        if icon.exists():
            try:
                self.window.iconbitmap(default=str(icon))
            except Exception:
                pass

        self.status = tk.StringVar(value="正在检查本机服务…")
        self.detail = tk.StringVar(value=f"地址：http://127.0.0.1:{self.port}")
        self._build_ui()
        self.window.after(120, self.start_service)
        self.window.after(800, self.poll)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def _resolve_runtime(self) -> None:
        # 此文件在 build/web-portable 中也是发布模板；误从模板目录启动时，
        # 自动回到源码项目并使用系统 Node，而不是报“缺少运行环境”。
        source_root = self.package_root.parent.parent
        if not self.node.exists() and (source_root / "package.json").exists() and (
            source_root / "scripts" / "start-local-web.mjs"
        ).exists():
            system_node = shutil.which("node")
            if system_node:
                self.root_dir = source_root
                self.node = Path(system_node)
                self.start_script = source_root / "scripts" / "start-local-web.mjs"

    def _read_port(self) -> None:
        config = self.package_root / "配置.json"
        try:
            value = json.loads(config.read_text(encoding="utf-8-sig")).get("port", 4173)
            if isinstance(value, int) and 0 < value < 65536:
                self.port = value
        except Exception:
            pass
        # 命令行 --port 显式指定时优先于配置（测试与排错用；0 表示随机端口）
        args = sys.argv[1:]
        if "--port" in args:
            index = args.index("--port")
            if index + 1 < len(args):
                try:
                    value = int(args[index + 1])
                    if 0 <= value < 65536:
                        self.port = value
                except ValueError:
                    pass

    def _build_ui(self) -> None:
        style = ttk.Style(self.window)
        try:
            style.theme_use("vista")
        except tk.TclError:
            pass

        outer = ttk.Frame(self.window, padding=20)
        outer.pack(fill="both", expand=True)
        ttk.Label(outer, text="知识图谱", font=("Microsoft YaHei UI", 18, "bold")).pack(anchor="w")
        ttk.Label(outer, text="本地文献 · 笔记 · 引用工作台", foreground="#666666").pack(anchor="w", pady=(2, 14))

        status_row = ttk.Frame(outer)
        status_row.pack(fill="x")
        self.dot = tk.Canvas(status_row, width=14, height=14, highlightthickness=0)
        self.dot.pack(side="left", padx=(0, 7))
        self.dot_id = self.dot.create_oval(2, 2, 12, 12, fill="#c28b20", outline="")
        ttk.Label(status_row, textvariable=self.status, font=("Microsoft YaHei UI", 10, "bold")).pack(side="left")
        ttk.Label(outer, textvariable=self.detail, foreground="#777777").pack(anchor="w", pady=(5, 16))

        buttons = ttk.Frame(outer)
        buttons.pack(fill="x")
        self.open_button = ttk.Button(buttons, text="打开知识图谱", command=self.open_browser)
        self.open_button.pack(side="left", ipady=5)
        self.start_button = ttk.Button(buttons, text="启动服务", command=self.start_service)
        self.start_button.pack(side="left", padx=(8, 0), ipady=5)
        self.stop_button = ttk.Button(buttons, text="停止服务", command=self.stop_service)
        self.stop_button.pack(side="left", padx=(8, 0), ipady=5)
        ttk.Button(buttons, text="查看日志", command=self.open_log).pack(side="left", padx=(8, 0), ipady=5)

        footer = ttk.Frame(outer)
        footer.pack(fill="x", pady=(18, 0))
        ttk.Label(footer, text="关闭窗口会最小化；“退出”会同时停止本次启动的服务。", foreground="#777777").pack(side="left")
        ttk.Button(footer, text="退出", command=self.exit_app).pack(side="right")

    def service_running(self) -> bool:
        try:
            with urllib.request.urlopen(self.url + "/api/health", timeout=0.45) as response:
                body = json.loads(response.read().decode("utf-8"))
                return response.status == 200 and body.get("service") == "knowledge-graph-local"
        except Exception:
            return False

    def set_state(self, running: bool, message: str | None = None) -> None:
        if running:
            self.dot.itemconfigure(self.dot_id, fill="#2e9b61")
            self.status.set(message or "服务运行中")
            self.detail.set(f"地址：{self.url}")
            self.open_button.state(["!disabled"])
            self.start_button.state(["disabled"])
            self.stop_button.state(["!disabled"] if self.child else ["disabled"])
        else:
            self.dot.itemconfigure(self.dot_id, fill="#b94a48")
            self.status.set(message or "服务未运行")
            self.detail.set(f"地址：{self.url}")
            self.open_button.state(["!disabled"])
            self.start_button.state(["!disabled"])
            self.stop_button.state(["disabled"])

    def _prepare_log(self) -> None:
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        if self.log_path.exists() and self.log_path.stat().st_size > 256 * 1024:
            previous = self.log_path.with_suffix(".previous.log")
            if previous.exists():
                previous.unlink()
            self.log_path.replace(previous)
        with self.log_path.open("a", encoding="utf-8") as log:
            log.write(f"\n=== kg-launcher-ui {time.strftime('%Y%m%d-%H%M%S')} ===\n")

    def start_service(self) -> None:
        if self.service_running():
            self.set_state(True, "服务已经运行")
            if not self.opened_once:
                self.opened_once = True
                webbrowser.open(self.url)
            return
        if not self.node.exists() or not self.start_script.exists():
            self.set_state(False, "缺少运行环境")
            messagebox.showerror("知识图谱", "缺少运行环境，请完整解压整个 ZIP 文件夹后再启动。")
            return

        self._prepare_log()
        hidden = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        startup = None
        if os.name == "nt":
            startup = subprocess.STARTUPINFO()
            startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startup.wShowWindow = 0
        command = [str(self.node), str(self.start_script), "--no-open", "--port", str(self.port), *sys.argv[1:]]
        try:
            self.log_handle = self.log_path.open("ab", buffering=0)
            self.child = subprocess.Popen(
                command, cwd=self.root_dir, stdin=subprocess.DEVNULL, stdout=self.log_handle,
                stderr=subprocess.STDOUT, startupinfo=startup, creationflags=hidden,
            )
            self.set_state(False, "正在启动服务…")
            self.window.after(400, self._open_when_ready)
        except Exception as error:
            self.set_state(False, "启动失败")
            messagebox.showerror("知识图谱", f"知识图谱没有成功启动：\n{error}\n\n日志：{self.log_path}")

    def _open_when_ready(self, attempts: int = 0) -> None:
        if self.service_running():
            self.set_state(True)
            if not self.opened_once:
                self.opened_once = True
                webbrowser.open(self.url)
            return
        if self.child and self.child.poll() is not None:
            self.set_state(False, f"服务已退出（代码 {self.child.returncode}）")
            return
        if attempts < 25:
            self.window.after(200, lambda: self._open_when_ready(attempts + 1))
        else:
            self.set_state(False, "启动超时，请查看日志")

    def open_browser(self) -> None:
        if self.service_running():
            webbrowser.open(self.url)
        else:
            self.opened_once = False
            self.start_service()

    def stop_service(self) -> None:
        if not self.child:
            return
        try:
            if os.name == "nt":
                self.child.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                self.child.terminate()
            try:
                self.child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.child.kill()
        except Exception:
            pass
        self.child = None
        if self.log_handle:
            self.log_handle.close()
            self.log_handle = None
        self.set_state(False)

    def open_log(self) -> None:
        self._prepare_log()
        try:
            os.startfile(self.log_path)
        except Exception as error:
            messagebox.showerror("知识图谱", f"无法打开日志：\n{error}")

    def minimize(self) -> None:
        self.window.iconify()

    def poll(self) -> None:
        if self.closing:
            return
        running = self.service_running()
        if self.child and self.child.poll() is not None:
            code = self.child.returncode
            self.child = None
            if self.log_handle:
                self.log_handle.close()
                self.log_handle = None
            self.set_state(False, f"服务已退出（代码 {code}）")
        else:
            self.set_state(running)
        self.window.after(1200, self.poll)

    def exit_app(self) -> None:
        self.closing = True
        self.stop_service()
        self.window.destroy()

    def run(self) -> None:
        self.window.mainloop()


if __name__ == "__main__":
    Launcher().run()
