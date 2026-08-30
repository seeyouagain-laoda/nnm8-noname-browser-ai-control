# ⚠️ 声明（AI 生成 · 仅供参考）
# 本代码由 AI 生成；仅适用于《无名杀》PC 版；
# 仅测试过当前版本（诗笺版 Windows64 位 v1.75，引擎内部 1.11.5）；
# 其他版本未验证，仅供参考，使用风险自负。
import os, zipfile, shutil, ctypes
from ctypes import wintypes, Structure

# 仓库即源码真相：从本脚本所在位置推导 extension/nm8_console，部署时复制它到游戏目录或导入 zip
HERE = os.path.dirname(os.path.abspath(__file__))
SRC_EXT = os.path.normpath(os.path.join(HERE, "..", "extension", "nm8_console"))
SRC_DOCS = SRC_EXT
OUT_DIR = r"C:/Users/user/Desktop/nm8_console_v3.4.0"
ZIP_PATH = r"C:/Users/user/Desktop/nm8_console_v3.4.0.zip"

DOCS = ["README.md", "AI接口说明.md", "CHANGELOG.md", "扩展示例-技能与卡牌.md", "改进建议.md"]


def recycle(path):
    """把文件送进回收站（FO_DELETE + FOF_ALLOWUNDO），等同右键删除，可恢复。"""
    class SHFILEOPSTRUCTW(Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR), ("pTo", wintypes.LPCWSTR),
            ("fFlags", wintypes.UINT), ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", wintypes.LPVOID), ("lpszProgressTitle", wintypes.LPCWSTR),
        ]
    fop = SHFILEOPSTRUCTW()
    fop.wFunc = 0x0003  # FO_DELETE
    fop.pFrom = ctypes.c_wchar_p(path + "\0\0")
    fop.fFlags = 0x0040 | 0x0010 | 0x0004  # ALLOWUNDO | NOCONFIRMATION | SILENT
    return ctypes.windll.shell32.SHFileOperationW(ctypes.byref(fop)) == 0


def prune_old_zips():
    """回收桌面上除当前版本外的历史 nm8_console_v3.*.zip，避免残留累积。"""
    desk = os.path.dirname(ZIP_PATH)
    for fn in os.listdir(desk):
        if fn.startswith("nm8_console_v3.") and fn.endswith(".zip") and fn != os.path.basename(ZIP_PATH):
            old = os.path.join(desk, fn)
            try:
                if recycle(old):
                    print("  回收旧包:", old)
                else:
                    print("  旧包回收失败(可手动删除):", old)
            except Exception as e:
                print("  旧包处理异常:", old, e)


# 1) 准备干净的输出目录
if os.path.exists(OUT_DIR):
    shutil.rmtree(OUT_DIR)
pkg = os.path.join(OUT_DIR, "nm8_console")
os.makedirs(pkg, exist_ok=True)

# 2) 拷贝扩展本体（以仓库 extension/nm8_console/ 为权威源，当前 v3.4.0）
shutil.copy2(os.path.join(SRC_EXT, "extension.js"), os.path.join(pkg, "extension.js"))
shutil.copy2(os.path.join(SRC_EXT, "info.json"), os.path.join(pkg, "info.json"))

# 3) 拷贝文档
for d in DOCS:
    s = os.path.join(SRC_DOCS, d)
    if os.path.exists(s):
        shutil.copy2(s, os.path.join(pkg, d))
    else:
        print("WARN missing doc:", d)

# 4) 打包（zip 根直接是 nm8_console/）
if os.path.exists(ZIP_PATH):
    os.remove(ZIP_PATH)
with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(OUT_DIR):
        for f in files:
            full = os.path.join(root, f)
            arc = os.path.relpath(full, OUT_DIR)  # nm8_console/xxx
            z.write(full, arc)

# 5) 汇报
print("ZIP:", ZIP_PATH, os.path.getsize(ZIP_PATH), "bytes")
print("Contents:")
with zipfile.ZipFile(ZIP_PATH) as z:
    for n in z.namelist():
        print("  ", n)

# 6) 回收历史版本 zip（避免桌面残留累积）
prune_old_zips()
