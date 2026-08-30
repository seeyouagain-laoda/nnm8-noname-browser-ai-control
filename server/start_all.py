# -*- coding: utf-8 -*-
# ⚠️ 声明（AI 生成 · 仅供参考）：本代码由 AI 生成；仅适用于《无名杀》PC 版；
# 仅测试过当前版本（诗笺版 Windows64 位 v1.75，引擎内部 1.11.5）；
# 其他版本未验证，仅供参考，使用风险自负。
"""一次性拉起 8091 桥接服务 + 9222 调试 Chrome（均用 DETACHED，避免被沙箱回收）"""
import subprocess, os, time, sys, urllib.request

NODE = r"C:\Users\user\.workbuddy\binaries\node\versions\22.22.2\node.exe"
SRV = r"C:\Users\user\WorkBuddy\2026-08-24-15-01-51\noname-gh\noname_srv.cjs"
ROOT = r"D:\无名杀诗笺版Windows64位v1.75\无名杀-win32-x64\resources\app"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
USER_DIR = r"C:/Users/user/AppData/Local/Google/ChromeDebug"
LOG = r"C:\Users\user\WorkBuddy\2026-08-24-15-01-51\start_all.log"

FLAGS = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

logf = open(LOG, "w", encoding="utf-8")

def wait_port(url, name, n=40):
    for i in range(n):
        try:
            r = opener.open(url, timeout=2)
            print(f"{name} ready ({i+1}s): {r.status}")
            return True
        except Exception:
            time.sleep(1)
    print(f"{name} FAILED")
    return False

# 1) 桥接服务
env = dict(os.environ)
env["NONAME_ROOT"] = ROOT
if not wait_port("http://127.0.0.1:8091/__bridge.html", "8091(已有)", 1):
    p1 = subprocess.Popen([NODE, SRV], env=env, creationflags=FLAGS,
                          close_fds=True, stdout=logf, stderr=logf)
    print("bridge started pid=", p1.pid)
    wait_port("http://127.0.0.1:8091/__bridge.html", "8091(新起)", 40)
else:
    print("8091 已在运行，复用")

# 2) 调试 Chrome
if not wait_port("http://127.0.0.1:9222/json/version", "9222(已有)", 1):
    p2 = subprocess.Popen([
        CHROME, f"--user-data-dir={USER_DIR}",
        "--remote-debugging-port=9222", "--remote-allow-origins=*",
        "--no-first-run", "--no-default-browser-check",
    ], creationflags=FLAGS, close_fds=True, stdout=logf, stderr=logf)
    print("chrome started pid=", p2.pid)
    wait_port("http://127.0.0.1:9222/json/version", "9222(新起)", 40)
else:
    print("9222 已在运行，复用")

print("DONE")
