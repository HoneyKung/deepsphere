"""Capture real Tk dashboard states for visual validation on a desktop session."""

from __future__ import annotations

import sys
import time
import ctypes
import json
from pathlib import Path

from PIL import Image, ImageGrab

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "laptop"))

from app import DashboardApp, TARGET_AIMS


def pump(app: DashboardApp, seconds: float = 0.6) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        app.root.update()
        time.sleep(0.02)
    app.root.update_idletasks()


def client_rect(app: DashboardApp) -> dict:
    class Rect(ctypes.Structure):
        _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                    ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

    class Point(ctypes.Structure):
        _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

    hwnd = app.root.winfo_id()
    rect = Rect()
    point = Point()
    if not ctypes.windll.user32.GetClientRect(hwnd, ctypes.byref(rect)):
        raise OSError("GetClientRect failed")
    if not ctypes.windll.user32.ClientToScreen(hwnd, ctypes.byref(point)):
        raise OSError("ClientToScreen failed")
    dpi = ctypes.windll.user32.GetDpiForWindow(hwnd)
    scale = (dpi or 96) / 96.0
    return {"x": point.x, "y": point.y, "width": rect.right - rect.left,
            "height": rect.bottom - rect.top, "dpi": dpi or 96, "scale": scale}


def capture(app: DashboardApp, path: Path, target_size: tuple[int, int], metadata: list[dict]) -> None:
    app.root.update_idletasks()
    rect = client_rect(app)
    print(f"capture {path.name}: client={rect['width']}x{rect['height']}+{rect['x']}+{rect['y']} dpi={rect['dpi']}")
    image = ImageGrab.grab(bbox=(rect["x"], rect["y"], rect["x"] + rect["width"], rect["y"] + rect["height"]), include_layered_windows=True)
    image = image.resize(target_size, Image.Resampling.LANCZOS)
    image.save(path)
    metadata.append({"file": path.name, "requested_output": {"width": target_size[0], "height": target_size[1]}, "client": rect, "captured_pixels": {"width": image.width, "height": image.height}})


def main() -> int:
    output = ROOT / "output"
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except (AttributeError, OSError):
        pass
    app = DashboardApp(simulate=True, no_audio=True)
    captures: list[dict] = []
    app.root.overrideredirect(True)
    app.root.deiconify()
    app.root.lift()
    app.root.attributes("-topmost", True)
    app.root.focus_force()
    pump(app, 0.8)

    app.model.store.samples.clear()
    app.model.state.selected_sample_id = None
    app.refresh()
    pump(app, 0.2)
    scale = client_rect(app)["scale"]
    app.root.minsize(round(1280 / scale), round(800 / scale))
    app.root.geometry(f"{round(1280 / scale)}x{round(800 / scale)}+0+0")
    pump(app, 0.3)
    capture(app, output / "dashboard-after-empty-1280x800.png", (1280, 800), captures)

    target_yaw, target_depth = TARGET_AIMS[0][1], TARGET_AIMS[0][2]
    app.simulator.set_yaw(target_yaw)
    app.simulator.set_depth(target_depth)
    pump(app, 0.2)
    app.collect_action()
    pump(app, 0.8)
    app.analyze_action()
    pump(app, 0.3)
    capture(app, output / "dashboard-after-collected-1280x800.png", (1280, 800), captures)

    app.simulator.set_yaw(0.0)
    app.simulator.set_depth(0.35)
    pump(app, 0.2)
    app.collect_action()
    pump(app, 0.4)
    capture(app, output / "dashboard-after-error-1280x800.png", (1280, 800), captures)

    app.simulator.set_yaw(target_yaw)
    app.simulator.set_depth(target_depth)
    app.model.state.error = None
    pump(app, 0.2)
    app.root.minsize(round(1024 / scale), round(720 / scale))
    app.root.geometry(f"{round(1024 / scale)}x{round(720 / scale)}+0+0")
    pump(app, 0.4)
    capture(app, output / "dashboard-after-collected-1024x720.png", (1024, 720), captures)

    gui_checks = {}
    app.root.focus_force()
    app._held_depth_keys.add("Down")
    app.keyboard.press("Down")
    app.root.event_generate("<FocusOut>")
    pump(app, 0.1)
    gui_checks["focus_out_clears_held_depth"] = not app._held_depth_keys
    app._held_depth_keys.add("Up")
    app.keyboard.press("Up")
    app.open_settings()
    pump(app, 0.1)
    gui_checks["open_settings_clears_held_depth"] = not app._held_depth_keys
    if app._settings_window and app._settings_window.winfo_exists():
        app._settings_window.destroy()
    app._settings_window = None
    app._held_yaw_keys.add("Right")
    app._apply_yaw_key("Right")
    app.root.event_generate("<FocusOut>")
    pump(app, 0.1)
    gui_checks["focus_out_clears_held_heading"] = not app._held_yaw_keys
    yaw_before = app.simulator.yaw_deg
    app._apply_yaw_key("Right")
    app._apply_yaw_key("Right")
    pump(app, 0.15)
    step = app.keyboard.yaw_step
    gui_checks["arrow_keys_step_heading"] = round((app.simulator.yaw_deg - yaw_before) % 360.0, 3) == round(2 * step, 3)
    gui_checks["arrow_keys_report_keyboard_heading_source"] = app.model.state.yaw_source == "keyboard"
    app._apply_yaw_key("Left")
    app._apply_yaw_key("Left")
    pump(app, 0.15)
    gui_checks["opposite_arrow_steps_return_heading"] = round((app.simulator.yaw_deg - yaw_before) % 360.0, 3) == 0.0
    depth_samples = []
    for depth in (0.0, 0.5, 1.0):
        app.simulator.set_depth(depth)
        pump(app, 0.15)
        deadline = time.time() + 2.0
        while app._depth_animation_active and time.time() < deadline:
            app.root.update()
            time.sleep(0.02)
        app.root.update_idletasks()
        items = app.depth_canvas.find_withtag("depth-pointer")
        coords = app.depth_canvas.coords(items[0]) if items else []
        depth_samples.append({"depth_norm": depth, "pointer_coords": coords,
                              "canvas_height": app.depth_canvas.winfo_height()})
    app.disconnect()
    gui_checks["disconnect_clears_held_depth"] = not app._held_depth_keys
    (output / "dashboard-capture-metadata.json").write_text(json.dumps({
        "captures": captures, "depth_pointer_samples": depth_samples,
        "gui_interaction_checks": gui_checks
    }, indent=2) + "\n", encoding="utf-8")

    app.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
