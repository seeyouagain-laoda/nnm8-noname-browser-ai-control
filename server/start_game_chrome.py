# -*- coding: utf-8 -*-
"""拉起「游戏专用」调试 Chrome（端口 9333，DETACHED 避免被沙箱回收）
背景：9222 已被 WorkBuddy 桌面端自身占用（PID 6852），不能抢也不能杀，
      故游戏 Chrome 改用 9333，并直接打开 8091 桥接页。
"""
import subprocess, os, time, urllib.request

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
USER_DIR = r"C:/Users/user/AppData/Local/Google/ChromeDebug"
URL = "http://127.0.0.1:8091/__bridge.html"
PORT = 9333
LOG = r"C:\Users\user\WorkBuddy\2026-08-24-15-01-51\start_game_chrome.log"
FLAGS = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

logf = open(LOG, "w", encoding="utf-8")

def wait_port(n=45):
    for i in range(n):
        try:
            r = opener.open(f"http://127.0.0.1:{PORT}/json/version", timeout=2)
            print(f"{PORT} ready ({i+1}s): {r.status}")
            return True
        except Exception:
            time.sleep(1)
    print(f"{PORT} FAILED")
    return False

if not wait_port(1):
    p = subprocess.Popen([
        CHROME,
        f"--user-data-dir={USER_DIR}",
        f"--remote-debugging-port={PORT}",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        URL,
    ], creationflags=FLAGS, close_fds=True, stdout=logf, stderr=logf)
    print("chrome started pid=", p.pid)
    wait_port(45)
else:
    print(f"{PORT} 已在运行，复用")
print("DONE")
