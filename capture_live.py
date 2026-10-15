# -*- coding: utf-8 -*-
"""Capture real ILM screenshots for the browser demo — from the RUNNING app.

Usage:
    C:\\Users\\zw87652015\\anaconda3\\envs\\imagelayout\\python.exe \\
        Demonstration\\capture_live.py --lang zh
        Demonstration\\capture_live.py --lang en

Drives the live instance over its agent websocket (agent.json discovery)
plus real input (SetCursorPos/mouse_event/keybd_event) for selections,
tabs, menus and dialogs. Saves the window rect and restores it in a
finally block; restores the UI language if it was toggled.
"""
import argparse
import ctypes
import ctypes.wintypes as wt
import json
import os
import re
import subprocess
import sys
import tempfile
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(REPO, "Demonstration", "assets")
W_PHYS, H_PHYS = 2880, 1620          # 1920x1080 logical @150%
SCALE = 1.5
DEBUG_DIR = os.path.join(REPO, "Demonstration", "_frames")

parser = argparse.ArgumentParser()
parser.add_argument("--lang", choices=["zh", "en"], required=True)
parser.add_argument("--keep-window", action="store_true")
parser.add_argument("--skip-uia", action="store_true")

user32 = ctypes.windll.user32
dwmapi = ctypes.windll.dwmapi
gdi32 = ctypes.windll.gdi32
ctypes.windll.shcore.SetProcessDpiAwareness(2)


# ------------------------------------------------------------------ win32
def find_ilm():
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            n = user32.GetWindowTextLengthW(hwnd) + 1
            buf = ctypes.create_unicode_buffer(n)
            user32.GetWindowTextW(hwnd, buf, n)
            if re.match(r"^Image Layout Manager v\d", buf.value):
                found.append((hwnd, buf.value))
        return True
    user32.EnumWindows(cb, 0)
    return found


def all_titled_windows():
    out = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            n = user32.GetWindowTextLengthW(hwnd) + 1
            buf = ctypes.create_unicode_buffer(n)
            user32.GetWindowTextW(hwnd, buf, n)
            if buf.value:
                out.append((hwnd, buf.value))
        return True
    user32.EnumWindows(cb, 0)
    return out


def qt_windows(exclude=None):
    """All visible Qt-owned top-level windows (popups have no title)."""
    out = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        if hwnd == exclude or not user32.IsWindowVisible(hwnd):
            return True
        buf = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, buf, 256)
        if buf.value.startswith("Qt"):
            r = RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(r))
            if r.right - r.left > 20:
                out.append((hwnd, buf.value, r))
        return True
    user32.EnumWindows(cb, 0)
    return out


class RECT(ctypes.Structure):
    _fields_ = [("left", wt.LONG), ("top", wt.LONG),
                ("right", wt.LONG), ("bottom", wt.LONG)]


def get_rect(hwnd):
    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return r


def frame_bounds(hwnd):
    r = RECT()
    dwmapi.DwmGetWindowAttribute(hwnd, 9, ctypes.byref(r), ctypes.sizeof(r))
    return r


def set_pos(hwnd, x, y, w, h):
    user32.SetWindowPos(hwnd, 0, x, y, w, h, 0x0004 | 0x0010)


def shot_printwindow(hwnd):
    """Grab window incl. title bar via PrintWindow; returns PIL image in
    physical px, or None."""
    b = frame_bounds(hwnd)
    w, h = b.right - b.left, b.bottom - b.top
    if w <= 0 or h <= 0:
        return None
    hdc_scr = user32.GetDC(0)
    hdc_mem = gdi32.CreateCompatibleDC(hdc_scr)
    hbmp = gdi32.CreateCompatibleBitmap(hdc_scr, w, h)
    gdi32.SelectObject(hdc_mem, hbmp)
    ok = user32.PrintWindow(hwnd, hdc_mem, 2)  # PW_RENDERFULLCONTENT

    class BMI(ctypes.Structure):
        _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG),
                    ("biHeight", wt.LONG), ("biPlanes", wt.WORD),
                    ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
                    ("biSizeImage", wt.DWORD), ("x", wt.LONG),
                    ("y", wt.LONG), ("clrUsed", wt.DWORD),
                    ("clrImp", wt.DWORD)]

    class BITMAPINFO(ctypes.Structure):
        _fields_ = [("bmiHeader", BMI), ("bmiColors", wt.DWORD * 3)]

    bi = BITMAPINFO()
    bi.bmiHeader.biSize = ctypes.sizeof(BMI)
    bi.bmiHeader.biWidth = w
    bi.bmiHeader.biHeight = -h
    bi.bmiHeader.biPlanes = 1
    bi.bmiHeader.biBitCount = 32
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(hdc_mem, hbmp, 0, h, buf, ctypes.byref(bi), 0)
    gdi32.DeleteObject(hbmp)
    gdi32.DeleteDC(hdc_mem)
    user32.ReleaseDC(0, hdc_scr)
    if not ok:
        return None
    from PIL import Image
    img = Image.frombuffer("RGBA", (w, h), buf, "raw", "BGRA", 0, 1)
    return img.convert("RGB")


def shot_grab(bbox=(0, 0, W_PHYS, H_PHYS)):
    from PIL import ImageGrab
    return ImageGrab.grab(bbox=bbox, all_screens=True)


def trim_black(img):
    """Strip dark uniform border rows/cols (PrintWindow shadow margins)."""
    import numpy as np
    a = np.asarray(img.convert("L"), dtype=np.float64)
    # title bar can paint over the shadow margin on the top rows, so
    # judge columns by their lower two thirds only
    def dark_col(i):
        s = a[a.shape[0] // 3:, i]
        return s.mean() < 25 and s.std() < 25

    def dark_row(i):
        s = a[i, a.shape[1] // 8: 7 * a.shape[1] // 8]
        return s.mean() < 25 and s.std() < 25
    l, r, t, b = 0, a.shape[1], 0, a.shape[0]
    while l < r and dark_col(l): l += 1
    while r > l and dark_col(r - 1): r -= 1
    while t < b and dark_row(t): t += 1
    while b > t and dark_row(b - 1): b -= 1
    return img.crop((l, t, r, b))


def shot(hwnd):
    img = shot_printwindow(hwnd)
    if img is None or img.convert("L").getextrema() == (0, 0):
        img = shot_grab()
    return img  # physical px


def foreground(hwnd):
    user32.keybd_event(0x12, 0, 0, 0)   # ALT tap unlocks foreground
    user32.keybd_event(0x12, 0, 2, 0)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.25)


def click(x, y, dbl=False):
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.12)
    for _ in range(2 if dbl else 1):
        user32.mouse_event(0x0002, 0, 0, 0, 0)
        time.sleep(0.05)
        user32.mouse_event(0x0004, 0, 0, 0, 0)
        time.sleep(0.12)


def key(vk, ctrl=False, shift=False):
    if ctrl:
        user32.keybd_event(0x11, 0, 0, 0)
    if shift:
        user32.keybd_event(0x10, 0, 0, 0)
    user32.keybd_event(vk, 0, 0, 0)
    time.sleep(0.05)
    user32.keybd_event(vk, 0, 2, 0)
    if shift:
        user32.keybd_event(0x10, 0, 2, 0)
    if ctrl:
        user32.keybd_event(0x11, 0, 2, 0)
    time.sleep(0.15)


def type_text(s):
    for ch in s:
        if ch.isdigit():
            key(ord(ch))
        elif ch == '.':
            key(0xBE)
        elif ch == '-':
            key(0xBD)


# ------------------------------------------------------------- websocket
_AGENT_PORT = None


def read_discovery():
    p = os.path.join(os.environ["APPDATA"], "ImageLayoutManager",
                     "agent.json")
    return json.load(open(p))


def agent_ports(hwnd):
    """Candidate ports: agent.json first, then the ILM PID's listeners."""
    disc = read_discovery()
    ports = [disc["port"]]
    try:
        ppid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(ppid))
        out = subprocess.check_output(
            ["netstat", "-ano"], text=True, encoding="ascii",
            errors="replace")
        for line in out.splitlines():
            if "LISTENING" in line and line.rstrip().endswith(
                    str(ppid.value)) and "127.0.0.1:" in line:
                ports.append(int(line.split()[1].rsplit(":", 1)[1]))
    except Exception:
        pass
    return disc["token"], ports


def agent_call(method, **params):
    import asyncio
    import websockets
    global _AGENT_PORT
    if _AGENT_PORT is None:
        token, ports = agent_ports(_HWND)
        last = None
        for p in dict.fromkeys(ports):
            async def probe():
                async with websockets.connect(
                        f"ws://127.0.0.1:{p}", open_timeout=5) as ws:
                    await ws.send(json.dumps(
                        {"type": "auth", "token": token}))
                    auth = json.loads(await ws.recv())
                    return auth.get("type") == "auth_ok"
            try:
                if asyncio.run(probe()):
                    _AGENT_PORT = (p, token)
                    break
            except Exception as e:
                last = e
        if _AGENT_PORT is None:
            raise RuntimeError("agent unreachable: %s" % last)
        print("  agent on port", _AGENT_PORT[0])
    port, token = _AGENT_PORT

    async def go():
        async with websockets.connect(
                f"ws://127.0.0.1:{port}", open_timeout=10) as ws:
            await ws.send(json.dumps({"type": "auth", "token": token}))
            auth = json.loads(await ws.recv())
            if auth.get("type") != "auth_ok":
                raise RuntimeError("auth failed")
            await ws.send(json.dumps(
                {"id": 1, "method": method, "params": params}))
            return json.loads(await ws.recv())

    r = asyncio.run(go())
    if "error" in r:
        print("  !! %s: %s %s" % (method, r["error"].get("message"),
                                 r["error"].get("data", {}).get("detail")))
    return r


def leaf_cells():
    r = agent_call("project_describe")
    cells = r["result"]["cells"]
    leaves = [c for c in cells if c["parent_id"] is None]
    leaves.sort(key=lambda c: (c["row"], c["col"]))
    return r["result"], leaves


# ------------------------------------------------------------------- UIA
PS_UIA = r"""
param($hwnd)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
if ([int64]$hwnd -eq 0) { $root = [System.Windows.Automation.AutomationElement]::RootElement }
else { $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([int64]$hwnd)) }
$types = @('Button','Edit','MenuItem','TabItem','Text','SplitButton','ComboBox','CheckBox','Pane','Custom','Group','HeaderItem')
$out = @()
foreach ($t in $types) {
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::$t)
  foreach ($e in $root.FindAll('Descendants', $cond)) {
    try {
      $r = $e.Current.BoundingRectangle
      if ($r.Width -gt 0) {
        $tog = ''
        if ($t -eq 'CheckBox') {
          try { $tog = [int]($e.GetCurrentPattern(
            [System.Windows.Automation.TogglePattern]::Pattern
            ).Current.ToggleState) } catch {}
        }
        $out += [pscustomobject]@{name=$e.Current.Name; type=$t;
          x=[math]::Round($r.X); y=[math]::Round($r.Y);
          w=[math]::Round($r.Width); h=[math]::Round($r.Height); tog=$tog}
      }
    } catch {}
  }
}
$out | ConvertTo-Json -Compress
"""


def uia_dump(hwnd):
    with tempfile.NamedTemporaryFile(
            "w", suffix=".ps1", delete=False, encoding="utf-8") as f:
        f.write(PS_UIA)
        ps1 = f.name
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-STA", "-File", ps1, str(hwnd)],
            text=True, encoding="gbk", errors="replace", timeout=90)
        return json.loads(out) if out.strip() else []
    except Exception as e:
        print("  UIA failed:", e)
        return []


def uia_find(elems, *needles):
    for e in elems:
        n = (e.get("name") or "")
        if any(nd in n for nd in needles):
            return e
    return None


def stage_rect(e):
    return [int(round(e["x"] / SCALE)), int(round(e["y"] / SCALE)),
            int(round(e["w"] / SCALE)), int(round(e["h"] / SCALE))]


# --------------------------------------------------------------- capture
PNG = []
hot = {}


def grab(hwnd, name, out_dir):
    # Keep the physical resolution (2880x1620 at 150%): the demo zooms in
    # up to ~2.2x, and a 1920-px frame turns soft at that scale. Hotspots
    # stay in 1920x1080 stage coordinates; use stage_k() to index pixels.
    img = shot(hwnd)
    if img.size != (W_PHYS, H_PHYS):
        img = img.resize((W_PHYS, H_PHYS), __import__(
            "PIL.Image", fromlist=["Image"]).LANCZOS)
    p = os.path.join(out_dir, "%s.png" % name)
    img.save(p)
    PNG.append(p)
    print("  captured", name)


def stage_k(arr):
    """Pixels per 1920-wide stage unit for a saved frame array."""
    return arr.shape[1] / 1920.0


def x_axis_line(path, cell):
    """Lowest long dark horizontal run inside a plot cell -> [y, x0, x1]
    in stage coordinates (the plot's bottom spine), or None."""
    import numpy as np
    from PIL import Image
    a = np.asarray(Image.open(path).convert("L"), dtype=np.int16)
    k = stage_k(a)
    x0, x1 = int(cell[0] * k), int((cell[0] + cell[2]) * k)
    y0 = int(cell[1] * k)
    y1 = min(a.shape[0], int((cell[1] + cell[3] + 60) * k))
    best = None
    for y in range(y0 + int(20 * k), y1):
        dark = np.where(a[y, x0:x1] < 70)[0]
        if len(dark) < (x1 - x0) * 0.3:
            continue
        for s, e in _runs(list(dark), min_w=int((x1 - x0) * 0.3)):
            best = [int(round(y / k)), int(round((x0 + s) / k)),
                    int(round((x0 + e) / k))]
    return best


def _runs(idx, min_w=4):
    if len(idx) == 0:
        return []
    out = []
    s = p = idx[0]
    for x in idx[1:]:
        if x == p + 1:
            p = x
        else:
            out.append((s, p))
            s = p = x
    out.append((s, p))
    return [r for r in out if r[1] - r[0] >= min_w]


def cell_rects_from_page(img, res):
    """Find the page via its blue border bands, then split it into cell
    rects along the light gap lines. img is a physical-px RGB PIL image.
    res is a project_describe result (row counts used to validate)."""
    import numpy as np
    a = np.asarray(img, dtype=np.int16)
    W = a.shape[1]
    blue = (a[:, :, 2] > a[:, :, 0] + 25) & (a[:, :, 2] > 140)
    rowfrac = blue[:, W // 8: 7 * W // 8].mean(1)
    ys = np.where(rowfrac > 0.6)[0]
    bands = _runs(ys, min_w=6)
    if len(bands) < 2:
        return None
    # The blue bands border the page *outside* the images; the page
    # interior starts after the top band and ends before the bottom band.
    py0, py1 = bands[0][1] + 1, bands[-1][0] - 1
    xs = np.where(blue[bands[0][0] + 4])[0]
    longs = _runs(xs, min_w=W // 3)
    if not longs:
        return None
    px0, px1 = longs[0][0], max(r[1] for r in longs)

    # calibrated mm→px scale from the rendered page width
    page_mm = res.get("page_mm") or {"w": 210.0, "h": 133.1}
    pw_mm = float(page_mm["w"])
    z = (px1 - px0) / pw_mm
    ph_mm = (py1 - py0) / z          # rendered page height in mm
    m = res.get("margins_mm") or {}
    ml, mt = float(m.get("left", 0)), float(m.get("top", 0))
    mr, mb = float(m.get("right", 0)), float(m.get("bottom", 0))
    gap = float(res.get("gap_mm", 0.0))
    rows_def = res.get("rows", [])
    inner_w = pw_mm - ml - mr
    inner_h = ph_mm - mt - mb
    n = len(rows_def)
    tot = sum(r.get("height_ratio", 1) for r in rows_def)
    rects = {}
    letters = "abcde"
    # Detect the real horizontal gap lines between rows: bright runs
    # spanning most of the page interior; snap each predicted boundary
    # to the nearest detected line.
    light = (a[:, :, 0] > 190) & (a[:, :, 1] > 190) & (a[:, :, 2] > 190)
    rowfrac = light[py0:py1 + 1, px0 + 8:px1 - 8].mean(1)
    hcand = _runs(np.where(rowfrac > 0.5)[0] + py0, min_w=8)

    def snap(pred, cand, tol=60):
        best = None
        for c in cand:
            mid = (c[0] + c[1]) / 2
            if abs(mid - pred) < tol and (best is None or
                    abs(mid - pred) < abs((best[0] + best[1]) / 2 - pred)):
                best = c
        return best

    y_mm = mt
    li = 0
    row_bounds = []      # [(row_top_px, row_bot_px)]
    rt = py0
    for i, r in enumerate(rows_def):
        rh = (inner_h - gap * (n - 1)) * r.get("height_ratio", 1) / tot
        if i < n - 1:
            pred_mid = py0 + (y_mm + rh + gap / 2) * z
            g = snap(pred_mid, hcand)
            if g:
                row_bounds.append((rt, g[0] - 1))
                rt = g[1] + 1
            else:
                row_bounds.append((rt, int(py0 + (y_mm + rh) * z)))
                rt = int(py0 + (y_mm + rh + gap) * z)
        else:
            row_bounds.append((rt, py1))
        y_mm += rh + gap

    y_mm = mt
    for i, r in enumerate(rows_def):
        rh = (inner_h - gap * (n - 1)) * r.get("height_ratio", 1) / tot
        rt_, rb_ = row_bounds[i]
        ccount = r.get("column_count", len(r.get("column_ratios", [1])))
        ratios = r.get("column_ratios") or [1] * ccount
        tcr = sum(ratios)
        cw_total = inner_w - gap * (ccount - 1)
        # vertical gap candidates within this row band
        colfrac = light[rt_:rb_ + 1, px0 + 8:px1 - 8].mean(0)
        vcand = _runs(np.where(colfrac > 0.5)[0] + px0 + 8, min_w=4)
        x_mm = ml
        for ci in range(ccount):
            cw_mm = cw_total * ratios[ci] / tcr
            x0 = px0 + x_mm * z
            x1 = px0 + (x_mm + cw_mm) * z
            if ci < ccount - 1:
                pred_mid = px0 + (x_mm + cw_mm + gap / 2) * z
                g = snap(pred_mid, vcand, tol=50)
                if g:
                    x1 = g[0] - 1
            if li < len(letters):
                rects[letters[li]] = [x0, rt_, x1 - x0, rb_ - rt_]
            x_mm += cw_mm + gap
            li += 1
            if ci < ccount - 1:
                # restart the mm cursor at the detected gap end
                pred_mid = px0 + (x_mm - gap / 2) * z
                g = snap(pred_mid, vcand, tol=50)
                if g:
                    x_mm = (g[1] + 1 - px0) / z
        y_mm += rh + gap
    # normalise everything to 1920x1080 stage coordinates
    k = 1920.0 / img.width
    for k_ in rects:
        rects[k_] = [v * k for v in rects[k_]]
    return rects, (px0 * k, py0 * k, (px1 - px0) * k, (py1 - py0) * k)


def uia_click(e, dwell=0.5):
    click(e["x"] + e["w"] / 2, e["y"] + e["h"] / 2)
    time.sleep(dwell)


def dump_buttons(hwnd=0):
    return [e for e in uia_dump(hwnd) if e["type"] == "Button"]


_DOCK_TABS = ("图层", "历史", "Layers", "History")


def canvas_tabs(elems):
    return [e for e in elems if e["type"] == "TabItem"
            and e["name"] not in _DOCK_TABS]


def close_extra_tabs(hwnd):
    """Close every canvas tab except index 0 (the user's own tab),
    discarding changes. Tabs we created are all unsaved/dirty."""
    for _ in range(12):
        tabs = canvas_tabs(uia_dump(hwnd))
        if len(tabs) <= 1:
            print("  tabs clean: 1 remaining")
            return
        uia_click(tabs[-1], dwell=0.6)          # activate last extra tab
        foreground(hwnd)
        key(ord('W'), ctrl=True)                # Close Tab
        time.sleep(0.8)
        for e in uia_dump(0):                   # save prompt: discard
            if e["type"] == "Button" and any(
                    s in e["name"] for s in
                    ("不保存", "Don't Save", "Discard", "放弃")):
                uia_click(e, dwell=0.7)
                break
    print("  !! tab cleanup did not converge")


_SB_CHK_NAMES = ("启用比例尺", "Enable Scale Bar", "Enable scale bar")
_SB_HDR_NAMES = ("比例尺设置", "Scale Bar Settings", "SCALE BAR SETTINGS",
                 "比例尺", "SCALE BAR", "Scale bar")
_SB_NEXT_NAMES = ("整行布局", "Row Layout", "ROW LAYOUT", "行布局")


def sb_checkbox(elems):
    return next((e for e in elems if e["type"] == "CheckBox"
                 and any(s in e["name"] for s in _SB_CHK_NAMES)
                 and e["w"] > 0), None)


def sb_section_rect(elems):
    """Rect covering the expanded scale-bar section: its header plus
    everything in the right dock until the next section header."""
    hdr = next((e for e in elems if e["type"] != "CheckBox"
                and any(s in e["name"] for s in
                        ("比例尺设置", "Scale Bar Settings",
                         "SCALE BAR SETTINGS"))), None)
    if not hdr:
        return None
    nxt = [e for e in elems if e["y"] > hdr["y"] + 10
           and any(s in e["name"] for s in _SB_NEXT_NAMES)]
    bottom = min(e["y"] for e in nxt) if nxt else hdr["y"] + 500
    return stage_rect({"x": hdr["x"], "y": hdr["y"], "w": hdr["w"],
                       "h": bottom - hdr["y"]})


def ensure_sb_expanded(hwnd, tag):
    """Make the inspector's scale-bar section visibly expanded right
    before a grab: click its header only while the Enable-Scale-Bar
    checkbox isn't on screen. Returns (elems, checkbox_or_None)."""
    for attempt in range(3):
        elems = uia_dump(hwnd)
        chk = sb_checkbox(elems)
        if chk:
            return elems, chk
        expand_section(hwnd, _SB_HDR_NAMES)
        time.sleep(0.6)
    elems = uia_dump(hwnd)
    chk = sb_checkbox(elems)
    if not chk:
        print("  !! scale-bar section still folded for %s "
              "(Enable Scale Bar checkbox not on screen)" % tag)
    return elems, chk


def expand_section(hwnd, needles):
    """Click a CollapsibleSection header by name; returns post-click dump.
    Never clicks a CheckBox (that would toggle instead of expanding)."""
    elems = uia_dump(hwnd)
    cands = [e for e in elems
             if e["type"] != "CheckBox"
             and any(nd in e["name"] for nd in needles)]
    for nd in ("设置", "SETTING", "Settings"):
        hit = next((e for e in cands if nd in e["name"]), None)
        if hit:
            uia_click(hit, dwell=0.8)
            return uia_dump(hwnd)
    if cands:
        uia_click(cands[0], dwell=0.8)
        return uia_dump(hwnd)
    return elems


def restart_agent_server(hwnd):
    """Toggle Tools > MCP Server off then on so the live app rewrites
    agent.json with a fresh port+token we can read. Returns True if a
    working agent was obtained."""
    global _AGENT_PORT
    foreground(hwnd)
    elems = uia_dump(hwnd)
    tools_el = uia_find(elems, "Tools", "工具")
    if not tools_el:
        print("  !! Tools menu not found")
        return False

    def click_mcp_item():
        click(tools_el["x"] + tools_el["w"] / 2,
              tools_el["y"] + tools_el["h"] / 2)
        time.sleep(0.9)
        pop = uia_dump(0)  # desktop-wide: menu popups are separate windows
        item = uia_find(pop, "MCP")
        if not item:
            print("  !! MCP menu item not found")
            key(0x1B)
            return False
        click(item["x"] + item["w"] / 2, item["y"] + item["h"] / 2)
        time.sleep(1.0)
        return True

    # toggle OFF (server currently running) then ON
    if not click_mcp_item():
        return False
    time.sleep(0.8)
    if not click_mcp_item():
        return False
    time.sleep(1.5)
    key(0x0D)   # dismiss the "server started" info box
    key(0x1B)
    time.sleep(0.5)
    try:
        disc = read_discovery()
    except Exception as e:
        print("  !! agent.json missing after restart:", e)
        return False
    print("  agent.json ->", disc["port"])
    return True


# =================================================================== main
def main():
    parsed = parser.parse_args()
    lang = parsed.lang
    out_dir = os.path.join(REPO, "Demonstration", "frames", lang)
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(DEBUG_DIR, exist_ok=True)

    wins = find_ilm()
    if not wins:
        print("ILM not running")
        sys.exit(1)
    hwnd, title = wins[0]
    print("HWND", hwnd, "|", title)
    if user32.IsIconic(hwnd):
        print("  window minimized — restoring")
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        time.sleep(0.8)
    global _HWND, _AGENT_PORT
    _HWND = hwnd

    orig = get_rect(hwnd)
    saved = (orig.left, orig.top, orig.right - orig.left,
             orig.bottom - orig.top)
    cur_lang = None
    toggled_lang = False
    cr = None
    try:
        foreground(hwnd)
        set_pos(hwnd, 0, 0, W_PHYS, H_PHYS)
        time.sleep(0.6)

        def menu_lang():
            el_ = uia_dump(hwnd)
            return ("zh" if uia_find(el_, "文件") else
                    "en" if uia_find(el_, "File") else None)

        # detect language from the menu bar via UIA
        elems = uia_dump(hwnd) if not parsed.skip_uia else []
        if uia_find(elems, "\u6587\u4ef6", "File"):
            cur_lang = "zh" if uia_find(elems, "\u6587\u4ef6") else "en"
        print("  current lang:", cur_lang)
        if cur_lang and cur_lang != lang:
            # Ctrl+Shift+G can silently miss if focus is elsewhere —
            # verify the menu language actually changed, retry 3x
            for _try in range(3):
                foreground(hwnd)
                key(ord('G'), ctrl=True, shift=True)
                time.sleep(0.9)
                if menu_lang() == lang:
                    toggled_lang = True
                    break
                print("  language toggle attempt %d failed" % (_try + 1))
            if not toggled_lang:
                print("  !! language toggle failed — aborting")
                return
        elif cur_lang is None:
            print("  !! could not detect language; assuming", lang)

        # close leftover demo tabs (index>0 only — tab 0 is the user's
        # blank tab and is never touched)
        close_extra_tabs(hwnd)

        # sanity: the user closed all tabs — main window must be showing
        # a canvas tab (menu bar present), not the welcome launcher
        if uia_find(elems, "文件", "File") is None:
            grab(hwnd, "_state-check", out_dir)
            print("  !! ILM main window/canvas not showing "
                  "(welcome launcher?) — stopping; see _state-check.png")
            return

        # the discovery file can be stale (server restarted since) —
        # restart the agent server via the UI if auth fails everywhere
        try:
            leaf_cells()
        except Exception as e:
            print("  agent unreachable (%s); restarting via UI" % e)
            _AGENT_PORT = None
            if not restart_agent_server(hwnd):
                raise
        agent_call("project_new", page_size={"w": 210, "h": 133.1}, dpi=300)
        time.sleep(0.8)

        res, leaves = leaf_cells()
        if len(leaves) == 4:
            agent_call("cell_add", row_index=0)
            res, leaves = leaf_cells()
        # a real file name in the title bar / tab instead of "Untitled"
        demo_dir = os.path.join(tempfile.gettempdir(), "ILM-demo")
        os.makedirs(demo_dir, exist_ok=True)
        agent_call("project_save",
                   path=os.path.join(demo_dir, "Figure 2.figpack"))
        time.sleep(0.6)
        A, B, C, D, E = [c["id"] for c in leaves[:5]]
        print("  cells:", A, B, C, D, E)

        # focus canvas + fit page (Ctrl+0)
        foreground(hwnd)
        click(W_PHYS * 0.45, H_PHYS * 0.55)
        key(ord('0'), ctrl=True)
        time.sleep(0.7)
        grab(hwnd, "01-empty", out_dir)

        for cid, img in [(A, "river.jpg"), (B, "fields.jpg"),
                         (C, "coast.jpg"), (D, "response.ilmplot.svg"),
                         (E, "comparison.ilmplot.svg")]:
            agent_call("image_import", cell_id=cid,
                       path=os.path.join(ASSETS, img))
            time.sleep(0.35)
        grab(hwnd, "02-imported-gap0", out_dir)

        # gap via inspector spinbox (UIA)
        elems = uia_dump(hwnd) if not parsed.skip_uia else []
        gap_el = uia_find(elems, "\u95f4\u8ddd", "Gap")
        if gap_el:
            foreground(hwnd)
            click(gap_el["x"] + gap_el["w"] - 40,
                  gap_el["y"] + gap_el["h"] / 2)
            key(ord('A'), ctrl=True)
            type_text("2.00")
            key(0x0D)
            time.sleep(0.6)
        else:
            print("  !! gap spinbox not found via UIA")
        grab(hwnd, "03-gap2", out_dir)

        agent_call("auto_layout")
        time.sleep(0.6)
        key(ord('0'), ctrl=True)
        time.sleep(0.5)
        grab(hwnd, "04-autolayout", out_dir)

        agent_call("cell_split", cell_id=C, direction="horizontal", count=2)
        time.sleep(0.6)
        grab(hwnd, "05-split-c", out_dir)
        key(ord('Z'), ctrl=True)
        time.sleep(0.7)
        _, lv = leaf_cells()
        if len(lv) != 5:
            print("  !! undo did not restore 5 leaf cells:", len(lv))

        agent_call("auto_label_cells", scheme="a", placement="in_cell")
        time.sleep(0.5)
        grab(hwnd, "06-labels", out_dir)

        # measure page/cells now that the layout is settled (stage px)
        res, _ = leaf_cells()
        cr = None
        for _try in range(3):
            img = shot(hwnd)
            cr = cell_rects_from_page(img, res)
            if cr:
                break
            print("  page detection attempt %d failed" % (_try + 1))
            foreground(hwnd)
            key(ord('0'), ctrl=True)
            time.sleep(0.6)
        if not cr:
            # last resort: detect on the already-saved 1920px frame
            try:
                from PIL import Image
                img2 = Image.open(os.path.join(
                    out_dir, "06-labels.png"))
                cr = cell_rects_from_page(img2.convert("RGB"), res)
                if cr:
                    print("  page detected from saved frame")
            except Exception as e:
                print("  fallback detect failed:", e)
        if not cr:
            print("  !! page detection failed — using rough canvas box")
            cells_px = {}
        else:
            cells_px, page_px = cr

        def cell_click(k_, dbl=False):
            rc = cells_px[k_]          # stage px → physical click
            click(rc[0] * SCALE + rc[2] * SCALE / 2,
                  rc[1] * SCALE + rc[3] * SCALE / 2, dbl=dbl)

        if cr:
            foreground(hwnd)
            cell_click("b")
            time.sleep(0.6)
        # the scale-bar section must be visibly expanded for the grab:
        # a selection refresh may re-fold it, so check the checkbox
        elems, chk = ensure_sb_expanded(hwnd, "07")
        if chk:
            hot["scale_bar_chk"] = stage_rect(chk)
            print("  scale_bar_chk:", hot["scale_bar_chk"])
        sec = sb_section_rect(elems)
        if sec:
            hot["scale_bar_section"] = sec
        grab(hwnd, "07-cell-b-selected", out_dir)

        agent_call("cell_set_scale_bar", cell_id=A, enabled=False)
        agent_call("cell_set_scale_bar", cell_id=B, enabled=True,
                   um_per_px=156250, length_um=50_000_000, unit="m",
                   show_text=True, position="bottom_right",
                   color="#FFFFFF", text_size_pt=9)
        time.sleep(0.6)
        # the tool call's refresh can re-fold the section — re-check
        elems, chk = ensure_sb_expanded(hwnd, "08")
        if chk:
            hot["scale_bar_chk"] = stage_rect(chk)
            print("  scale_bar_chk(08):", hot["scale_bar_chk"],
                  "toggle:", chk.get("tog"))
        sec = sb_section_rect(elems)
        if sec:
            hot["scale_bar_section"] = sec
        grab(hwnd, "08-scalebar", out_dir)

        if cr:
            cell_click("a")
            time.sleep(0.5)
        grab(hwnd, "09-cell-a-selected", out_dir)

        # The GUI creates insets by dropping an image file on the cell's
        # top-right Inset zone (MainWindow._on_pip_image_dropped): an
        # external PiP at the default x/y, w=0.3, h from the image aspect.
        # Zoom insets have no GUI trigger, so the demo must not show one.
        from PIL import Image as _PILImage
        detail = os.path.join(ASSETS, "river-detail.jpg")
        if not os.path.isfile(detail):
            src = _PILImage.open(os.path.join(ASSETS, "river.JPG")).convert("RGB")
            W_, H_ = src.size
            src.crop((round(W_ * .30), round(H_ * .55), round(W_ * .60),
                      round(H_ * .92))).save(detail, quality=92)
        dw, dh = _PILImage.open(detail).size
        ca_ = cells_px.get("a") if cr else None
        cell_aspect = (ca_[2] / ca_[3]) if ca_ else 1.7
        pip_w = 0.3
        pip_h = pip_w * cell_aspect / (dw / dh)
        if pip_h > 0.6:
            pip_w, pip_h = pip_w * 0.6 / pip_h, 0.6
        PIP_RECT = (0.62, 0.05, pip_w, pip_h)
        agent_call("pip_add", cell_id=A, pip_type="external",
                   image_path=detail, x=PIP_RECT[0], y=PIP_RECT[1],
                   w=PIP_RECT[2], h=PIP_RECT[3])
        time.sleep(0.4)
        # PiP item only rebuilds its crop on a full scene rebuild:
        # auto_layout is visually neutral here and forces it
        agent_call("auto_layout")
        time.sleep(0.6)
        foreground(hwnd)
        if cr:
            click(960 * SCALE, 1000 * SCALE)   # empty canvas = deselect
            time.sleep(0.5)
            cell_click("a")
            time.sleep(0.9)
        key(ord('0'), ctrl=True)
        time.sleep(0.9)
        grab(hwnd, "10-pip", out_dir)

        if cr:
            cell_click("d")
            time.sleep(0.5)
        grab(hwnd, "11-plot-d-selected", out_dir)

        agent_call("cell_set_properties", cell_id=D, plot_reflow=True)
        agent_call("cell_set_properties", cell_id=E, plot_reflow=True)
        agent_call("auto_layout")
        time.sleep(0.7)
        grab(hwnd, "12-reflow-on", out_dir)

        # x-axis spines before/after Reflow drive the demo's guide lines
        if cr:
            for tag, fr in (("before", "11-plot-d-selected"),
                            ("after", "12-reflow-on")):
                for k_ in ("d", "e"):
                    try:
                        ln = x_axis_line(os.path.join(out_dir, fr + ".png"),
                                         cells_px[k_])
                    except Exception as e:
                        ln = None
                        print("  axis detect failed:", e)
                    if ln:
                        hot["axis_%s_%s" % (k_, tag)] = ln
                    print("  axis_%s_%s:" % (k_, tag), ln)

        key(0x1B)  # Esc — clear selection
        time.sleep(0.3)
        grab(hwnd, "13-final", out_dir)

        # objective PiP check: 13-final is the known-good state.
        # cell a inside 10/11/12 must match it inside the inset rect
        # and the lower-left of the photo (selection outlines may differ,
        # so shrink each region by 4 px) — fail loudly otherwise
        if cr:
            import numpy as np
            from PIL import Image
            i13 = np.asarray(Image.open(os.path.join(
                out_dir, "13-final.png")).convert("RGB"), dtype=np.int16)
            kk = stage_k(i13)
            ca = [v * kk for v in cells_px["a"]]
            px_, py_, pw_, ph_ = PIP_RECT
            ix0 = int(ca[0] + ca[2] * px_) + 4
            iy0 = int(ca[1] + ca[3] * py_) + 4
            ix1 = int(ca[0] + ca[2] * (px_ + pw_)) - 4
            iy1 = int(ca[1] + ca[3] * (py_ + ph_)) - 4
            sx0 = int(ca[0] + ca[2] * .30) + 4
            sx1 = int(ca[0] + ca[2] * .60) - 4
            sy0 = int(ca[1] + ca[3] * .55) + 4
            sy1 = int(ca[1] + ca[3] * .92) - 4
            pip_ok = True
            for n in ("10-pip", "11-plot-d-selected", "12-reflow-on"):
                im = np.asarray(Image.open(os.path.join(
                    out_dir, n + ".png")).convert("RGB"), dtype=np.int16)
                s_mad = np.abs(im[sy0:sy1, sx0:sx1]
                               - i13[sy0:sy1, sx0:sx1]).mean()
                i_mad = np.abs(im[iy0:iy1, ix0:ix1]
                               - i13[iy0:iy1, ix0:ix1]).mean()
                print("  pip check %s vs 13-final: source mad %.1f, "
                      "inset mad %.1f" % (n, s_mad, i_mad))
                if s_mad > 8 or i_mad > 8:
                    pip_ok = False
                    print("  !! %s STALE — differs from 13-final "
                          "inside cell a" % n)
            if not pip_ok:
                print("  !! PIP CHECK FAILED")

        # history tab
        elems = uia_dump(hwnd) if not parsed.skip_uia else []
        hist_el = uia_find(elems, "\u5386\u53f2", "History")
        if hist_el:
            click(hist_el["x"] + hist_el["w"] / 2,
                  hist_el["y"] + hist_el["h"] / 2)
            time.sleep(0.6)
        grab(hwnd, "14-history-tab", out_dir)
        lay_el = uia_find(elems, "\u56fe\u5c42", "Layers")
        if lay_el:
            click(lay_el["x"] + lay_el["w"] / 2,
                  lay_el["y"] + lay_el["h"] / 2)
            time.sleep(0.4)

        # exported figure via tool
        exp = os.path.join(out_dir, "exported-src.png")
        agent_call("project_export", path=exp, format="PNG")
        print("  exported:", os.path.isfile(exp))

        # plot editor via double-click on cell d
        if cr:
            foreground(hwnd)
            cell_click("d", dbl=True)
            time.sleep(2.5)
            pe = None
            tops = all_titled_windows()
            for h2, t in tops:
                tl = t.lower()
                if h2 != hwnd and ("\u56fe\u8868\u7f16\u8f91\u5668" in t
                                   or "plot editor" in tl):
                    pe = (h2, t)
                    break
            print("  candidates:", tops)
            if pe:
                # Autofit worksheet columns (double-click each header's
                # right divider; QTableView resizes to contents) so values
                # like 0.15 aren't cut to "0." in the screenshot. Rightmost
                # first, so earlier dividers don't move.
                try:
                    foreground(pe[0])
                    heads = [e for e in uia_dump(pe[0])
                             if e["type"] == "HeaderItem" and e["w"] > 20
                             and re.match(r"^[A-Z]+\s*\(", e["name"] or "")]
                    for e in sorted(heads, key=lambda e: -e["x"]):
                        click(e["x"] + e["w"] - 1, e["y"] + e["h"] / 2,
                              dbl=True)
                        time.sleep(0.25)
                    print("  autofit %d worksheet columns" % len(heads))
                    time.sleep(0.4)
                except Exception as e:
                    print("  !! column autofit skipped:", e)
                img = shot_printwindow(pe[0]) or shot_grab()
                img = trim_black(img)
                img.save(os.path.join(out_dir, "plot-editor.png"))
                PNG.append(os.path.join(out_dir, "plot-editor.png"))
                print("  captured plot-editor:", pe[1])
                # close without saving (no edits were made)
                user32.PostMessageW(pe[0], 0x0010, 0, 0)  # WM_CLOSE
                time.sleep(0.8)
                for e2 in dump_buttons(0):
                    if any(s in e2["name"] for s in
                           ("不保存", "Don't Save", "Discard", "放弃")):
                        uia_click(e2)
                        break

        # export menu popup (screenshot the screen region incl. popup)
        elems = uia_dump(hwnd) if not parsed.skip_uia else []
        exp_el = uia_find(elems, "\u5bfc\u51fa", "Export")
        if exp_el:
            foreground(hwnd)
            uia_click(exp_el, dwell=0.9)
            pop = None
            for h2, cls, r2 in qt_windows(exclude=hwnd):
                # the popup drops down just below the Export button
                if (abs(r2.left - exp_el["x"]) < 400 and
                        0 < r2.top - (exp_el["y"] + exp_el["h"]) < 400):
                    pop = (h2, r2)
                    break
            if pop is None:
                cand = qt_windows(exclude=hwnd)
                if cand:
                    h2, _, r2 = min(
                        cand,
                        key=lambda t: (t[2].right - t[2].left) *
                        (t[2].bottom - t[2].top))
                    pop = (h2, r2)
            if pop:
                pimg = shot_printwindow(pop[0]) or shot_grab(
                    (pop[1].left, pop[1].top, pop[1].right,
                     pop[1].bottom))
                pimg = trim_black(pimg)
                pimg.save(os.path.join(out_dir, "export-menu.png"))
                PNG.append(os.path.join(out_dir, "export-menu.png"))
                r2 = pop[1]
                hot["export_menu"] = [int(r2.left / SCALE),
                                      int(r2.top / SCALE),
                                      int((r2.right - r2.left) / SCALE),
                                      int((r2.bottom - r2.top) / SCALE)]
                for e in uia_dump(pop[0]):
                    if "pdf" in e["name"].lower():
                        hot["export_pdf_item"] = [
                            int((e["x"] - r2.left) / SCALE),
                            int((e["y"] - r2.top) / SCALE),
                            int(e["w"] / SCALE), int(e["h"] / SCALE)]
                print("  captured export-menu popup",
                      hot.get("export_menu"))
            else:
                print("  !! export popup window not found")
            key(0x1B)
            time.sleep(0.4)

        # ---------------- hotspots ----------------
        elems = uia_dump(hwnd) if not parsed.skip_uia else []
        dbg = shot(hwnd).resize((1920, 1080))
        from PIL import ImageDraw
        dr = ImageDraw.Draw(dbg)
        names = {
            "tb_undo": ("\u64a4\u9500", "Undo"),
            "tb_redo": ("\u91cd\u505a", "Redo"),
            "tb_new": ("\u65b0\u5efa", "New"),
            "tb_open": ("\u6253\u5f00", "Open"),
            "tb_save": ("\u4fdd\u5b58", "Save"),
            "tb_label_in": ("\u56fe\u5185", "In-Cell"),
            "tb_label_out": ("\u56fe\u5916", "Above-Cell"),
            "tb_autolayout": ("\u81ea\u52a8\u5e03\u5c40", "Auto Layout"),
            "tb_export": ("\u5bfc\u51fa", "Export"),
            "tab_layers": ("\u56fe\u5c42", "Layers"),
            "tab_history": ("\u5386\u53f2", "History"),
            "gap_spin": ("\u95f4\u8ddd", "Gap"),
            "dpi_spin": ("DPI", "\u5206\u8fa8\u7387"),
            "status_ai": ("AI",),
            "scale_bar_chk": ("\u6bd4\u4f8b\u5c3a", "scale bar"),
            "reflow_card": ("REFLOW", "\u91cd\u6392"),
        }
        for k_, needles in names.items():
            e = uia_find(elems, *needles)
            if e and (k_ != "scale_bar_chk" or e["type"] == "CheckBox"):
                hot[k_] = stage_rect(e)
                dr.rectangle(
                    [hot[k_][0], hot[k_][1],
                     hot[k_][0] + hot[k_][2], hot[k_][1] + hot[k_][3]],
                    outline="red", width=3)
        if cr:
            for k_, rc in cells_px.items():
                hot["cell_" + k_] = [int(v) for v in rc]
                dr.rectangle(
                    [hot["cell_" + k_][0], hot["cell_" + k_][1],
                     hot["cell_" + k_][0] + hot["cell_" + k_][2],
                     hot["cell_" + k_][1] + hot["cell_" + k_][3]],
                    outline="lime", width=3)
            ca = hot["cell_a"]
            hot["pip_inset"] = [int(ca[0] + ca[2] * PIP_RECT[0]),
                                int(ca[1] + ca[3] * PIP_RECT[1]),
                                int(ca[2] * PIP_RECT[2]),
                                int(ca[3] * PIP_RECT[3])]
            # same geometry as CellItem._pip_zone_rect (1.5 mm margin)
            mm = page_px[2] / float((res.get("page_mm") or {}).get("w", 210.0))
            hot["pip_zone"] = [round(ca[0] + ca[2] * .70 - 1.5 * mm, 1),
                               round(ca[1] + 1.5 * mm, 1),
                               round(ca[2] * .30, 1), round(ca[3] * .22, 1)]
            for nm, col in (("pip_inset", "yellow"), ("pip_zone", "cyan")):
                pi = hot[nm]
                dr.rectangle([pi[0], pi[1], pi[0] + pi[2], pi[1] + pi[3]],
                             outline=col, width=3)
        if "scale_bar_chk" not in hot:
            for e in elems:
                if e["type"] == "CheckBox" and any(
                        s in e["name"] for s in
                        ("比例尺", "scale", "Scale")):
                    hot["scale_bar_chk"] = stage_rect(e)
                    dr.rectangle([hot["scale_bar_chk"][0],
                                  hot["scale_bar_chk"][1],
                                  hot["scale_bar_chk"][0] +
                                  hot["scale_bar_chk"][2],
                                  hot["scale_bar_chk"][1] +
                                  hot["scale_bar_chk"][3]],
                                 outline="red", width=3)
                    break
        if "gap_spin" in hot:
            g = hot["gap_spin"]
            hot["gap_spin_up"] = [g[0] + int(g[2] * .75), g[1],
                                  int(g[2] * .25), g[3] // 2]
        dbg.save(os.path.join(out_dir, "_hotspots-debug.png"))

        # ---------------- webp + hotspots.js ----------------
        from PIL import Image
        for p in PNG:
            Image.open(p).save(p[:-4] + ".webp", "WEBP", quality=90)
        if os.path.isfile(exp):
            Image.open(exp).save(os.path.join(out_dir, "exported.webp"),
                                 "WEBP", quality=90)

        frames = {}
        for p in PNG:
            base = os.path.basename(p)[:-4]
            key_ = base.split("-", 1)[1] if "-" in base else base
            frames[key_] = "frames/%s/%s.webp" % (lang, base)
        data = {"title": title, "frames": frames,
                "exported": "frames/%s/exported.webp" % lang,
                "hot": {k: v for k, v in hot.items() if v}}
        with open(os.path.join(out_dir, "hotspots.js"), "w",
                  encoding="utf-8") as f:
            f.write("window.FRAMES_%s = " % lang +
                    json.dumps(data, ensure_ascii=False, indent=1) + ";\n")
        # close the en demo tab (don't save); zh run leaves its tab open
        if lang == "en":
            foreground(hwnd)
            key(ord('W'), ctrl=True)
            time.sleep(0.8)
            for e in dump_buttons(0):
                if any(s in e["name"] for s in
                       ("不保存", "Don't Save", "Discard", "放弃")):
                    uia_click(e, dwell=0.6)
                    break

        print("== done == %d frames" % len(frames))

    finally:
        set_pos(hwnd, *saved)
        if toggled_lang and cur_lang:
            for _try in range(3):
                foreground(hwnd)
                key(ord('G'), ctrl=True, shift=True)
                time.sleep(0.9)
                el_ = uia_dump(hwnd)
                back = ("zh" if uia_find(el_, "文件") else
                        "en" if uia_find(el_, "File") else None)
                if back == cur_lang:
                    break
            print("restored language to", cur_lang)
        print("restored rect", saved)


if __name__ == "__main__":
    main()
