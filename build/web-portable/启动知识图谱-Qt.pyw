"""知识图谱 Qt 桌面外壳：网页 UI 与本地 Node 服务保持不变。"""

from __future__ import annotations

import ctypes
import html
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

try:
    from PySide6.QtCore import QTimer, QUrl
    from PySide6.QtGui import QIcon
    from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile
    from PySide6.QtWebEngineWidgets import QWebEngineView
    from PySide6.QtWidgets import QApplication, QMainWindow
except ImportError:
    import tkinter as tk
    from tkinter import messagebox

    root = tk.Tk()
    root.withdraw()
    messagebox.showerror(
        "知识图谱 Qt 版",
        "缺少 PySide6。请先运行：\n\npython -m pip install -r requirements-qt.txt\n\n"
        "也可以继续使用原来的 启动知识图谱.pyw。",
    )
    raise SystemExit(1)


CREATE_NO_WINDOW = 0x08000000
CREATE_NEW_PROCESS_GROUP = 0x00000200
APP_ID = "KnowledgeGraph.Portable.Launcher.1.2.7"


class QtLauncher(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.package_root = Path(__file__).resolve().parent
        self.root_dir = self.package_root
        self.node = self.package_root / "runtime" / "node.exe"
        self.start_script = self.package_root / "scripts" / "start-portable-web.mjs"
        self.port = 4173
        self.origin = ""
        self.child: subprocess.Popen[bytes] | None = None
        self.log_handle = None
        self.log_offset = 0
        self.log_text = ""
        self.startup_attempts = 0
        self.closing = False

        self._resolve_runtime()
        self._read_port()
        self.log_path = self.root_dir / "data" / "temp" / "qt-web-server.log"

        self.setWindowTitle("知识图谱")
        self.resize(1440, 900)
        self.setMinimumSize(960, 600)
        icon = self.package_root / "知识图谱.ico"
        if icon.exists():
            self.setWindowIcon(QIcon(str(icon)))

        profile_dir = self.root_dir / "data" / "qt-profile"
        cache_dir = self.root_dir / "data" / "qt-cache"
        profile_dir.mkdir(parents=True, exist_ok=True)
        cache_dir.mkdir(parents=True, exist_ok=True)
        self.web_profile = QWebEngineProfile("KnowledgeGraph", self)
        self.web_profile.setPersistentStoragePath(str(profile_dir))
        self.web_profile.setCachePath(str(cache_dir))
        self.web_profile.setPersistentCookiesPolicy(
            QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies
        )

        self.view = QWebEngineView(self)
        self.page = QWebEnginePage(self.web_profile, self.view)
        self.view.setPage(self.page)
        self.view.loadFinished.connect(self._load_finished)
        self.setCentralWidget(self.view)
        self.statusBar().showMessage("正在启动本地服务…")

        self.startup_timer = QTimer(self)
        self.startup_timer.setInterval(200)
        self.startup_timer.timeout.connect(self._poll_startup)
        QTimer.singleShot(0, self.start_service)

    @property
    def configured_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def _resolve_runtime(self) -> None:
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

    @staticmethod
    def service_running(origin: str) -> bool:
        try:
            with urllib.request.urlopen(origin + "/api/health", timeout=0.35) as response:
                body = json.loads(response.read().decode("utf-8"))
                return response.status == 200 and body.get("service") == "knowledge-graph-local"
        except Exception:
            return False

    def _prepare_log(self) -> None:
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        if self.log_path.exists() and self.log_path.stat().st_size > 256 * 1024:
            previous = self.log_path.with_suffix(".previous.log")
            if previous.exists():
                previous.unlink()
            self.log_path.replace(previous)
        with self.log_path.open("a", encoding="utf-8") as log:
            log.write(f"\n=== kg-qt-launcher {time.strftime('%Y%m%d-%H%M%S')} ===\n")

    def _service_arguments(self) -> list[str]:
        args = sys.argv[1:]
        forwarded: list[str] = []
        skip = False
        for index, arg in enumerate(args):
            if skip:
                skip = False
                continue
            if arg == "--port" and index + 1 < len(args):
                skip = True
                continue
            forwarded.append(arg)
        return forwarded

    def start_service(self) -> None:
        if self.closing:
            return
        if self.port and self.service_running(self.configured_url):
            self.origin = self.configured_url
            self.statusBar().showMessage("正在连接已运行的本地服务…")
            self.view.load(QUrl(self.origin))
            return
        if not self.node.exists() or not self.start_script.exists():
            self._show_error("缺少 Node 运行环境，请完整解压整个 ZIP 文件夹后再启动。")
            return

        self._prepare_log()
        hidden = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        startup = None
        if os.name == "nt":
            startup = subprocess.STARTUPINFO()
            startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startup.wShowWindow = 0
        command = [
            str(self.node), str(self.start_script), "--no-open", "--port", str(self.port),
            *self._service_arguments(),
        ]
        try:
            self.log_handle = self.log_path.open("ab", buffering=0)
            self.log_offset = self.log_handle.tell()
            self.child = subprocess.Popen(
                command, cwd=self.root_dir, stdin=subprocess.DEVNULL, stdout=self.log_handle,
                stderr=subprocess.STDOUT, startupinfo=startup, creationflags=hidden,
            )
            self.startup_attempts = 0
            self.startup_timer.start()
        except Exception as error:
            self._show_error(f"本地服务启动失败：{error}")

    def _read_logged_origin(self) -> str:
        try:
            with self.log_path.open("rb") as log:
                log.seek(self.log_offset)
                self.log_text += log.read().decode("utf-8", errors="replace")
                self.log_offset = log.tell()
        except OSError:
            return ""
        matches = re.findall(r"http://127\.0\.0\.1:\d+", self.log_text)
        return matches[-1] if matches else ""

    def _poll_startup(self) -> None:
        if self.closing:
            return
        candidate = self._read_logged_origin()
        if candidate and self.service_running(candidate):
            self.startup_timer.stop()
            self.origin = candidate
            self.statusBar().showMessage("正在加载知识图谱…")
            self.view.load(QUrl(candidate))
            return
        if self.child and self.child.poll() is not None:
            self.startup_timer.stop()
            self._show_error(f"本地服务已退出（代码 {self.child.returncode}），请查看启动日志。")
            return
        self.startup_attempts += 1
        if self.startup_attempts >= 100:
            self.startup_timer.stop()
            self._show_error("本地服务启动超时，请查看启动日志。")
            self.stop_service()

    def _load_finished(self, ok: bool) -> None:
        if ok:
            self.statusBar().showMessage(f"本地运行 · {self.origin}")
        else:
            self.statusBar().showMessage("页面加载失败，请检查本地服务和启动日志")

    def _show_error(self, message: str) -> None:
        self.statusBar().showMessage("启动失败")
        self.view.setHtml(
            "<!doctype html><meta charset='utf-8'><title>知识图谱启动失败</title>"
            "<style>body{font:16px/1.7 'Microsoft YaHei UI',sans-serif;max-width:760px;"
            "margin:64px auto;padding:0 24px;color:#263238}pre{white-space:pre-wrap;"
            "background:#f5f5f5;padding:16px;border-radius:8px}</style>"
            f"<h1>知识图谱未能启动</h1><pre>{html.escape(message)}</pre>"
            f"<p>日志：{html.escape(str(self.log_path))}</p>"
            "<p>也可以关闭此窗口，使用原来的“启动知识图谱.pyw”在浏览器中打开。</p>",
            QUrl(self.configured_url),
        )

    def stop_service(self) -> None:
        child = self.child
        self.child = None
        if child and child.poll() is None:
            try:
                if os.name == "nt":
                    child.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    child.terminate()
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    if os.name == "nt":
                        subprocess.run(
                            ["taskkill.exe", "/PID", str(child.pid), "/T", "/F"],
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW, check=False,
                        )
                    else:
                        child.kill()
                    child.wait(timeout=3)
            except Exception:
                pass
        if self.log_handle:
            self.log_handle.close()
            self.log_handle = None

    def closeEvent(self, event) -> None:
        self.closing = True
        self.startup_timer.stop()
        self.stop_service()
        event.accept()


def main() -> None:
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except Exception:
        pass
    app = QApplication([sys.argv[0]])
    app.setApplicationName("知识图谱")
    app.setApplicationDisplayName("知识图谱")
    window = QtLauncher()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
