"""在隔离便携包中真实启动 Qt WebEngine，并验证网页与本地桥接。"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path


launcher_path = Path(sys.argv[1]).resolve()
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
spec = importlib.util.spec_from_file_location("kg_qt_launcher", launcher_path)
if spec is None or spec.loader is None:
    raise RuntimeError(f"无法加载 Qt 启动器：{launcher_path}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
sys.argv = [str(launcher_path), "--no-open", "--port", "0"]

class DebugPage(module.QWebEnginePage):
    def javaScriptConsoleMessage(self, level, message, line, source) -> None:
        if level > 0:
            print(f"浏览器控制台 [{source}:{line}] {message}", flush=True)


module.QWebEnginePage = DebugPage
app = module.QApplication([str(launcher_path)])
window = module.QtLauncher()
window.show()
state = {"code": 1, "finished": False, "polling": False}


def finish(code: int, message: str) -> None:
    if state["finished"]:
        return
    state["finished"] = True
    state["code"] = code
    print(message, flush=True)
    window.close()
    app.quit()


def inspect_page() -> None:
    if state["finished"] or state["polling"]:
        return
    state["polling"] = True

    def inspect(result) -> None:
        state["polling"] = False
        if state["finished"]:
            return
        result = json.loads(result) if isinstance(result, str) else {}
        if result.get("root", 0) > 0 and result.get("localBridge"):
            print(f"Qt 页面标题：{result.get('title', '')}", flush=True)
            finish(0, "✓ Qt WebEngine 已渲染 React DOM，local bridge 可用")
            return
        module.QTimer.singleShot(250, inspect_page)

    window.view.page().runJavaScript(
        "JSON.stringify({root: document.querySelector('#root')?.children.length || 0,"
        " localBridge: window.knowledgeGraphDesktop?.isLocalWeb === true,"
        " title: document.title})",
        inspect,
    )


def load_finished(ok: bool) -> None:
    print(f"Qt loadFinished={ok} url={window.view.url().toString()}", flush=True)
    if not ok:
        finish(1, "Qt 页面加载失败")
        return
    inspect_page()


def timeout() -> None:
    def diagnose(result) -> None:
        print(f"Qt 超时诊断：{result}", flush=True)
        finish(1, "Qt 页面或本地桥接加载超时")

    window.view.page().runJavaScript(
        "JSON.stringify({root: document.querySelector('#root')?.children.length || 0,"
        " localBridge: window.knowledgeGraphDesktop?.isLocalWeb === true,"
        " html: document.documentElement.outerHTML.slice(0, 1200)})",
        diagnose,
    )


window.view.loadFinished.connect(load_finished)
module.QTimer.singleShot(45000, timeout)
sys.exit(app.exec() or state["code"])
