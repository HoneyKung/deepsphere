"""Deep Sphere submarine dashboard with a compact instrument-console layout."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import queue
import tkinter as tk
from tkinter import ttk

try:
    from PIL import Image, ImageTk
except ImportError:
    Image = ImageTk = None

try:
    from serial.tools import list_ports
except ImportError:
    list_ports = None

from core import AudioMixer, BoardSimulator, DashboardModel, KeyboardCommandRouter, SerialLinkLog, SerialWorker
import live_ocean
from atlas_math import aim_projection, faces_from_config, quaternion_matrix

ROOT = Path(__file__).resolve().parents[1]
COLORS = {"background": "#07141C", "panel": "#10232D", "inset": "#0B1C25", "border": "#284550", "text": "#E7F0F2", "muted": "#9DB3BC", "accent": "#48C7BE", "warning": "#E8B66A", "error": "#ED8D8D"}


def configured_target_aims():
    try:
        scene = json.loads((ROOT / "config/scene.json").read_text(encoding="utf-8"))
        faces_cfg = json.loads((ROOT / "config/faces.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, KeyError):
        return ()
    faces = faces_from_config(faces_cfg)
    mount = quaternion_matrix(faces_cfg["mount_orientation"]["quaternion_wxyz"])
    active = faces_cfg["active_image"]
    aims = []
    for target in live_ocean.targets_at_tick(0):
        best = (999.0, 0.0, 0.35)
        for step in range(720):
            yaw = step * 0.5
            projection = aim_projection(yaw, tuple(scene["aim_world"]), mount, faces, active, 0.35, scene,
                                        physical_rects={item["id"]: item["physical_face_uv"] for item in faces_cfg["faces"]},
                                        enabled_faces=faces_cfg["enabled_outputs"]["faces"])
            if projection["face_id"] != target["face_id"]:
                continue
            error = abs(projection["local"][0] - target["u"]) + abs(projection["local"][1] - target["v"])
            if error < best[0]: best = (error, yaw, 0.35)
        aims.append((target["target_id"], best[1], best[2]))
    return tuple(aims)


TARGET_AIMS = configured_target_aims()


def depth_pointer_y(depth_norm: float, canvas_height: float, margin: float = 18.0) -> float:
    """Map surface (0) to the top and deepest level (1) to the bottom."""
    depth = max(0.0, min(1.0, float(depth_norm)))
    usable = max(0.0, float(canvas_height) - 2.0 * margin)
    return margin + usable * depth


class DashboardApp:
    def __init__(self, simulate: bool = False, no_audio: bool = False):
        self.simulate = simulate
        self.root = tk.Tk()
        self.root.title("Deep Sphere / Submersible Console")
        self.root.geometry("1280x800")
        self.root.minsize(760, 540)
        self.root.configure(bg=COLORS["background"])
        self.events: queue.Queue[dict] = queue.Queue()
        self.worker: SerialWorker | None = None
        self.simulator = BoardSimulator(ROOT, self.events.put) if simulate else None
        self.audio = AudioMixer(ROOT / "assets/audio", ROOT / "assets/audio/catalog.json", enabled=not no_audio)
        self.model = DashboardModel(ROOT, self.send_message, self.audio)
        self.model.on_change = self.refresh
        self._after_ids: set[str] = set()
        self._depth_display = 0.0
        self._depth_target = 0.0
        self._depth_animation_active = False
        self._scan_seen = ""
        self._sample_count = len(self.model.store.samples)
        self._selected_seen = self.model.state.selected_sample_id
        self._settings_window: tk.Toplevel | None = None
        self._suspend_refresh = False
        self.keyboard = KeyboardCommandRouter()
        self._held_depth_keys: set[str] = set()
        self._held_yaw_keys: set[str] = set()
        self._syncing_yaw = False
        self._build_styles()
        self._build_ui()
        self.root.bind("<KeyPress>", self._on_key_press, add="+")
        self.root.bind("<KeyRelease>", self._on_key_release, add="+")
        self.root.bind("<FocusOut>", self._on_focus_out, add="+")
        self.refresh_ports()
        self.root.after(50, self.drain_events)
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        if self.audio.missing:
            self.model.log("audio unavailable: " + ", ".join(self.audio.missing))
        if simulate:
            self.root.after(150, self.simulation_start)

    def _build_styles(self):
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("Console.TButton", background=COLORS["inset"], foreground=COLORS["text"], bordercolor=COLORS["border"], padding=(12, 8), font=("Segoe UI", 10, "bold"))
        style.map("Console.TButton", background=[("active", "#173A45"), ("pressed", "#21645F")], foreground=[("disabled", "#61767E")])
        style.configure("Accent.TButton", background="#1C5E5A", foreground=COLORS["text"], bordercolor=COLORS["accent"], padding=(3, 5), font=("Segoe UI", 8, "bold"))
        style.map("Accent.TButton", background=[("active", "#287F78"), ("pressed", "#329F95")])

    def _panel(self, parent, title: str | None = None):
        frame = tk.Frame(parent, bg=COLORS["panel"], highlightbackground=COLORS["border"], highlightthickness=1)
        if title:
            tk.Label(frame, text=title.upper(), bg=COLORS["panel"], fg=COLORS["muted"], font=("Segoe UI", 9, "bold"), anchor="w").pack(fill="x", padx=14, pady=(12, 5))
        return frame

    def _build_ui(self):
        self.root.grid_rowconfigure(1, weight=1)
        self.root.grid_columnconfigure(0, weight=1)
        top = tk.Frame(self.root, bg=COLORS["background"], height=58)
        top.grid(row=0, column=0, sticky="ew", padx=22, pady=(14, 4))
        top.grid_columnconfigure(1, weight=1)
        tk.Label(top, text="DEEP SPHERE", bg=COLORS["background"], fg=COLORS["text"], font=("Segoe UI", 16, "bold")).grid(row=0, column=0, sticky="w")
        tk.Label(top, text="SUBMERSIBLE CONSOLE", bg=COLORS["background"], fg=COLORS["muted"], font=("Consolas", 9)).grid(row=1, column=0, sticky="w")
        self.mode_label = tk.Label(top, text="SIMULATED / NO BOARD" if self.simulate else "HARDWARE / BOARD COMMANDS", bg=COLORS["background"], fg=COLORS["warning"] if self.simulate else COLORS["muted"], font=("Consolas", 9, "bold"))
        self.mode_label.grid(row=0, column=2, rowspan=2, padx=16)
        self.connection_var = tk.StringVar(value="DISCONNECTED")
        tk.Label(top, textvariable=self.connection_var, bg=COLORS["background"], fg=COLORS["accent"], font=("Consolas", 9, "bold")).grid(row=0, column=3, sticky="e")
        ttk.Button(top, text="SETTINGS", style="Console.TButton", command=self.open_settings).grid(row=0, column=4, rowspan=2, padx=(18, 0))

        main = tk.Frame(self.root, bg=COLORS["background"])
        main.grid(row=1, column=0, sticky="nsew", padx=22, pady=8)
        main.grid_columnconfigure(0, minsize=178, weight=0)
        main.grid_columnconfigure(1, weight=1)
        main.grid_columnconfigure(2, minsize=230, weight=0)
        main.grid_rowconfigure(0, weight=1)
        self._build_depth_panel(main).grid(row=0, column=0, sticky="nsew", padx=(0, 12))
        self._build_sample_panel(main).grid(row=0, column=1, sticky="nsew", padx=(0, 12))
        self._build_analysis_panel(main).grid(row=0, column=2, sticky="nsew")

        self.collection_panel = self._panel(self.root, "Collection / saved snapshots")
        self.collection_panel.grid(row=2, column=0, sticky="ew", padx=22, pady=(4, 6))
        self.thumb_frame = tk.Frame(self.collection_panel, bg=COLORS["panel"])
        self.thumb_frame.pack(fill="x", padx=12, pady=(0, 10))

        footer = tk.Frame(self.root, bg=COLORS["background"])
        footer.grid(row=3, column=0, sticky="ew", padx=22, pady=(0, 12))
        footer.grid_columnconfigure(1, weight=1)
        self.feedback_var = tk.StringVar(value="Ready. Collect is confirmed only after the laptop saves the snapshot.")
        tk.Label(footer, textvariable=self.feedback_var, bg=COLORS["background"], fg=COLORS["muted"], font=("Segoe UI", 9), anchor="w").grid(row=0, column=0, sticky="w")
        self.audio_var = tk.StringVar(value="AUDIO ON" if self.audio.enabled else "AUDIO SKIPPED")
        ttk.Button(footer, textvariable=self.audio_var, style="Console.TButton", command=self.toggle_audio).grid(row=0, column=2, padx=10)
        tk.Label(footer, text="Diagnostics in Settings", bg=COLORS["background"], fg=COLORS["muted"], font=("Consolas", 8)).grid(row=0, column=3, sticky="e")

    def _build_depth_panel(self, parent):
        panel = self._panel(parent, "Depth instrument")
        body = tk.Frame(panel, bg=COLORS["panel"])
        body.pack(fill="both", expand=True, padx=12, pady=8)
        body.grid_rowconfigure(0, weight=1, minsize=140)
        body.grid_columnconfigure(0, weight=1)
        self.depth_canvas = tk.Canvas(body, width=150, height=260, bg=COLORS["inset"], highlightthickness=0)
        self.depth_canvas.grid(row=0, column=0, sticky="nsew")
        self.depth_value = tk.StringVar(value="LEVEL —")
        tk.Label(body, textvariable=self.depth_value, bg=COLORS["panel"], fg=COLORS["text"], font=("Consolas", 18, "bold")).grid(row=1, column=0, sticky="w", pady=(8, 0))
        self.heading_value = tk.StringVar(value="FIXED HEADING —")
        self.wheel_value = tk.StringVar(value="KEYBOARD INPUT")
        return panel

    def _build_sample_panel(self, parent):
        panel = self._panel(parent, "Sample / scan result")
        self.sample_title = tk.StringVar(value="NO SAMPLE SELECTED")
        tk.Label(panel, textvariable=self.sample_title, bg=COLORS["panel"], fg=COLORS["accent"], font=("Consolas", 11, "bold"), anchor="w", wraplength=300).pack(fill="x", padx=14)
        self.image_label = tk.Label(panel, text="\n\nEMPTY COLLECTION\n\nScan, then Collect to save a snapshot.", bg=COLORS["inset"], fg=COLORS["muted"], font=("Segoe UI", 12), justify="center", wraplength=320)
        self.image_label.pack(fill="both", expand=True, padx=14, pady=10)
        self.sample_caption = tk.StringVar(value="No sample image has been saved.")
        tk.Label(panel, textvariable=self.sample_caption, bg=COLORS["panel"], fg=COLORS["muted"], font=("Segoe UI", 9), anchor="w", justify="left", wraplength=320).pack(fill="x", padx=14, pady=(0, 10))
        action = tk.Frame(panel, bg=COLORS["panel"])
        action.pack(fill="x", padx=14, pady=(0, 14))
        self.scan_button = ttk.Button(action, text="SCAN [1]", style="Accent.TButton", command=self.scan_action)
        self.collect_button = ttk.Button(action, text="COLLECT [2]", style="Accent.TButton", command=self.collect_action)
        self.analyze_button = ttk.Button(action, text="ANALYZE [3]", style="Accent.TButton", command=self.analyze_action)
        action.grid_columnconfigure(0, weight=1)
        action.grid_columnconfigure(1, weight=1)
        action.grid_columnconfigure(2, weight=1)
        self.scan_button.grid(row=0, column=0, sticky="ew", padx=2)
        self.collect_button.grid(row=0, column=1, sticky="ew", padx=2)
        self.analyze_button.grid(row=0, column=2, sticky="ew", padx=2)
        tk.Label(panel, text="KEYS  1 Scan   2 Collect   3 Analyze   Up/Down depth", bg=COLORS["panel"], fg=COLORS["muted"], font=("Consolas", 8), anchor="w").pack(fill="x", padx=14, pady=(0, 12))
        return panel

    def _build_analysis_panel(self, parent):
        panel = self._panel(parent, "Analysis")
        self.analysis_header = tk.StringVar(value="SELECT A SAVED SAMPLE")
        self.analysis_header_label = tk.Label(panel, textvariable=self.analysis_header, bg=COLORS["panel"], fg=COLORS["text"], font=("Segoe UI", 13, "bold"), anchor="w", wraplength=240, justify="left")
        self.analysis_header_label.pack(fill="x", padx=14, pady=(4, 12))
        self.analysis_text = tk.Text(panel, width=24, height=12, bg=COLORS["inset"], fg=COLORS["text"], insertbackground=COLORS["text"], relief="flat", wrap="word", font=("Segoe UI", 10), padx=12, pady=10, state="disabled")
        self.analysis_text.pack(fill="both", expand=True, padx=14, pady=(0, 12))
        self.target_value = tk.StringVar(value="AIM / —")
        tk.Label(panel, textvariable=self.target_value, bg=COLORS["panel"], fg=COLORS["muted"], font=("Consolas", 9), anchor="w").pack(fill="x", padx=14, pady=(0, 4))
        self.asset_value = tk.StringVar(value="ASSET / NOT CHECKED")
        tk.Label(panel, textvariable=self.asset_value, bg=COLORS["panel"], fg=COLORS["muted"], font=("Consolas", 9), anchor="w").pack(fill="x", padx=14, pady=(0, 14))
        return panel

    def open_settings(self):
        self.clear_held_keys()
        if self._settings_window and self._settings_window.winfo_exists():
            self._settings_window.lift(); return
        window = self._settings_window = tk.Toplevel(self.root)
        window.title("Deep Sphere / Settings and diagnostics")
        window.geometry("640x520")
        window.configure(bg=COLORS["background"])
        frame = tk.Frame(window, bg=COLORS["background"], padx=18, pady=18); frame.pack(fill="both", expand=True)
        tk.Label(frame, text="CONNECTION / SIMULATION", bg=COLORS["background"], fg=COLORS["text"], font=("Segoe UI", 12, "bold")).pack(anchor="w")
        row = tk.Frame(frame, bg=COLORS["background"]); row.pack(fill="x", pady=10)
        tk.Label(row, text="COM", bg=COLORS["background"], fg=COLORS["muted"]).pack(side="left")
        self.port = ttk.Combobox(row, width=22, state="readonly"); self.port.pack(side="left", padx=8)
        for text, command, style in (("Refresh", self.refresh_ports, "Console.TButton"), ("Connect", self.connect, "Accent.TButton"), ("Disconnect", self.disconnect, "Console.TButton"), ("Request state", self.request_state, "Console.TButton")):
            ttk.Button(row, text=text, style=style, command=command).pack(side="left", padx=2)
        if self.simulate:
            sim = self._panel(frame, "Simulator controls / clearly not hardware"); sim.pack(fill="x", pady=(12, 8))
            for label, attr, start, end, command in (("HEADING", "yaw_scale", 0.0, 359.9, self.on_yaw), ("DEPTH", "depth_scale", 0.0, 1.0, self.on_depth)):
                line = tk.Frame(sim, bg=COLORS["panel"]); line.pack(fill="x", padx=12, pady=6)
                tk.Label(line, text=label, bg=COLORS["panel"], fg=COLORS["muted"], width=10, anchor="w").pack(side="left")
                scale = ttk.Scale(line, from_=start, to=end, command=command); scale.pack(side="left", fill="x", expand=True); setattr(self, attr, scale)
            if self.simulator:
                self._syncing_yaw = True
                try:
                    self.yaw_scale.set(self.simulator.yaw_deg)
                finally:
                    self._syncing_yaw = False
            actions = tk.Frame(sim, bg=COLORS["panel"]); actions.pack(fill="x", padx=12, pady=(0, 12))
            for target_id, yaw, depth in TARGET_AIMS:
                ttk.Button(actions, text=target_id, style="Console.TButton", command=lambda y=yaw, d=depth: self.aim_at(y, d)).pack(side="left", padx=(0, 5))
            ttk.Button(actions, text="empty water", style="Console.TButton", command=lambda: self.aim_at(0.0, 0.35)).pack(side="left")
        diag = self._panel(frame, "Diagnostics"); diag.pack(fill="both", expand=True, pady=(8, 0))
        diag_actions = tk.Frame(diag, bg=COLORS["panel"]); diag_actions.pack(fill="x", padx=12, pady=(0, 8))
        for face in ("px", "nx", "py", "ny", "pz", "nz"):
            ttk.Button(diag_actions, text=f"Face {face}", style="Console.TButton",
                       command=lambda selected=face: self._send_display_diagnostic(selected)).pack(side="left", padx=(0, 3))
        ttk.Button(diag_actions, text="All enabled", style="Accent.TButton",
                   command=lambda: self._send_display_diagnostic()).pack(side="left", padx=(4, 0))
        self.diag_text = tk.Text(diag, bg=COLORS["inset"], fg=COLORS["muted"], relief="flat", height=8, state="disabled", font=("Consolas", 8), wrap="word")
        self.diag_text.pack(fill="both", expand=True, padx=12, pady=(0, 12))
        self.refresh()

    def refresh_ports(self):
        if not hasattr(self, "port"): return
        ports = [port.device for port in list_ports.comports()] if list_ports else []
        self.port["values"] = ports
        if ports and not self.port.get(): self.port.set(ports[0])

    def connect(self):
        if self.worker:
            if self.worker.is_alive():
                released = self.disconnect()
                if not released or (self.worker and self.worker.is_alive()):
                    self.model.stopping()
                    self.model.log("cannot connect: previous serial worker is still stopping")
                    return
            else:
                self.worker = None
        selected = self.port.get() if hasattr(self, "port") else ""
        if not selected:
            self.model.disconnected("select a COM port in Settings")
            return
        # Every open, close and reconnect is written to a file as it happens, so a drop can be
        # read back afterwards instead of reconstructed from what the console still showed.
        link_log = SerialLinkLog(ROOT / "output/usb-stability",
                                 lambda entry: self.events.put({"type": "_link", **entry}))
        self.worker = SerialWorker(selected, self.events.put,
                                   lambda reason: self.events.put({"type": "_disconnect", "reason": reason}),
                                   link_log=link_log)
        self.worker.start()
        self.model.connected_to(selected)

    def disconnect(self):
        self.clear_held_keys()
        # stop() waits for the port handle to be released, so an upload started right after
        # this returns does not race the worker for the port.
        if self.worker:
            if not self.worker.is_alive():
                self.worker = None
            else:
                released = self.worker.stop()
                if not released:
                    self.model.stopping()
                    self.model.log("warning: serial worker did not stop cleanly; port may still be held")
                    return False
                self.worker = None
        if self.model.state.connected:
            self.model.disconnected("closed")
        return True

    def request_state(self): self.send_message({"v": 1, "type": "get_state"})

    def send_message(self, message: dict):
        if self.simulator:
            self.model.log("simulation TX: " + json.dumps(message, separators=(",", ":"))); self.simulator.receive_from_host(message)
            return True
        if self.worker and self.model.state.connected:
            self.worker.send(message)
            return True
        self.model.log("command not sent: board is disconnected")
        return False

    def simulation_start(self): self.model.connected_to("SIMULATOR READY")
    def on_yaw(self, value):
        if self._syncing_yaw: return
        if self.simulator:
            self.keyboard.yaw_deg = float(value) % 360.0
            self.simulator.set_yaw(float(value), source="keyboard")
    def on_depth(self, value):
        if self.simulator: self.simulator.set_depth(float(value))
    def aim_at(self, yaw, depth):
        if hasattr(self, "yaw_scale"): self.yaw_scale.set(yaw); self.depth_scale.set(depth)
    def _request_id(self) -> str:
        self._request_counter = getattr(self, "_request_counter", 0) + 1
        return f"ui-{self._request_counter}"

    def _send_action(self, action: str) -> None:
        self.send_message({"v": 1, "type": "command", "action": action, "request_id": self._request_id()})

    def _send_display_diagnostic(self, face: str | None = None) -> None:
        action = "display_diagnostic_all" if face is None else "display_diagnostic"
        message = {"v": 1, "type": "command", "action": action, "request_id": self._request_id()}
        if face is not None: message["face"] = face
        self.send_message(message)

    def scan_action(self): self._send_action("scan")
    def collect_action(self): self._send_action("collect")
    def analyze_action(self): self.model.analyze()

    def _send_depth_delta(self, direction: float) -> None:
        self.send_message({"v": 1, "type": "depth_delta", "delta_norm": direction * self.keyboard.step, "request_id": self._request_id()})

    def _apply_yaw_key(self, key: str) -> None:
        """Left/Right step the simulated heading. Nothing here reads the cube turning."""
        result = self.keyboard.press(key)
        if not result:
            return
        if not self.simulator:
            self.model.log("heading unchanged: this build has no rotation sensor and the board holds a fixed heading")
            return
        yaw = result[1]
        if hasattr(self, "yaw_scale") and self._settings_window and self._settings_window.winfo_exists():
            self._syncing_yaw = True
            try:
                self.yaw_scale.set(yaw)
            finally:
                self._syncing_yaw = False
        self.simulator.set_yaw(yaw, source="keyboard")

    def _text_focus(self, event) -> bool:
        widget = event.widget
        settings_focus = self._settings_window and widget.winfo_toplevel() == self._settings_window
        return settings_focus or widget.winfo_class() in {"Entry", "TEntry", "Text", "TCombobox", "Combobox", "Spinbox"}

    def _on_key_press(self, event):
        if self._text_focus(event):
            return None
        if event.keysym in {"Up", "Down"}:
            if event.keysym not in self._held_depth_keys:
                self._held_depth_keys.add(event.keysym)
                self.keyboard.press(event.keysym)
                self._send_depth_delta(-1.0 if event.keysym == "Up" else 1.0)
                self._schedule(140, lambda key=event.keysym: self._repeat_depth(key))
            return "break"
        if event.keysym in self.keyboard.YAW_KEYS:
            if event.keysym not in self._held_yaw_keys:
                self._held_yaw_keys.add(event.keysym)
                self._apply_yaw_key(event.keysym)
                self._schedule(140, lambda key=event.keysym: self._repeat_yaw(key))
            return "break"
        result = self.keyboard.press(event.keysym)
        if result:
            action, _ = result
            if action == "scan": self.scan_action()
            elif action == "collect": self.collect_action()
            elif action == "analyze": self.analyze_action()
            return "break"
        return None

    def _repeat_depth(self, key: str):
        if key not in self._held_depth_keys or self._focus_blocks_keyboard():
            if self._focus_blocks_keyboard():
                self.clear_held_keys()
            return
        self.keyboard.press(key)
        self._send_depth_delta(-1.0 if key == "Up" else 1.0)
        self._schedule(110, lambda: self._repeat_depth(key))

    def _repeat_yaw(self, key: str):
        if key not in self._held_yaw_keys or self._focus_blocks_keyboard():
            if self._focus_blocks_keyboard():
                self.clear_held_keys()
            return
        self._apply_yaw_key(key)
        self._schedule(110, lambda: self._repeat_yaw(key))

    def _on_key_release(self, event):
        self.keyboard.release(event.keysym)
        self._held_depth_keys.discard(event.keysym)
        self._held_yaw_keys.discard(event.keysym)

    def _focus_blocks_keyboard(self) -> bool:
        focus = self.root.focus_get()
        if focus is None:
            return True
        return bool(self._settings_window and self._settings_window.winfo_exists() and focus.winfo_toplevel() == self._settings_window)

    def clear_held_keys(self):
        self._held_depth_keys.clear()
        self._held_yaw_keys.clear()
        self.keyboard.clear()

    def _on_focus_out(self, _event):
        self.clear_held_keys()

    def sim_scan(self): self.scan_action()
    def sim_collect(self): self.collect_action()
    def analyze(self): self.analyze_action()

    def drain_events(self):
        # The board heartbeats state several times a second and every message used to drive a
        # full UI repaint, which starved the Tk event loop and showed up as "Not Responding"
        # the moment a real board connected. Drain the whole queue first, repaint once.
        drained = False
        self._suspend_refresh = True
        try:
            while True:
                message = self.events.get_nowait()
                drained = True
                if message.get("type") == "_disconnect":
                    self.clear_held_keys()
                    self.model.disconnected(message.get("reason", "serial error"))
                elif message.get("type") == "_link":
                    # Port lifecycle, not board traffic. Only the events that mean something
                    # went wrong or the link changed hands reach the console.
                    if message.get("event") in {"open_success", "open_error", "read_error", "write_error", "reconnect"}:
                        detail = message.get("reason", "")
                        self.model.log(f"link {message['event']} on {message.get('port', '?')}"
                                       + (f": {detail}" if detail else ""))
                else: self.model.receive(message)
        except queue.Empty: pass
        finally:
            self._suspend_refresh = False
        if drained: self.refresh()
        self.root.after(50, self.drain_events)

    def select_sample(self, sample_id): self.model.state.selected_sample_id = sample_id; self.refresh()
    def toggle_audio(self):
        if not self.audio.enabled:
            self.audio_var.set("AUDIO SKIPPED")
            self.feedback_var.set("Audio is unavailable; image collection is unaffected.")
            return
        self.audio.set_muted(not self.audio.muted)
        self.audio_var.set("AUDIO MUTED" if self.audio.muted else "AUDIO ON")
        self.feedback_var.set("Audio muted; image collection is unaffected." if self.audio.muted else "Audio playback enabled.")

    def _animate_depth(self):
        target = self._depth_target
        self._depth_display += (target - self._depth_display) * 0.28
        if abs(target - self._depth_display) < 0.005:
            self._depth_display = target
            self._depth_animation_active = False
        self._draw_depth()
        if self._depth_animation_active:
            self._schedule(35, self._animate_depth)

    def _draw_depth(self):
        canvas = self.depth_canvas; canvas.delete("all")
        width = max(80, canvas.winfo_width()); height = max(80, canvas.winfo_height()); margin = 18; x = max(26, min(48, width * 0.28))
        canvas.create_line(x, margin, x, height - margin, fill=COLORS["border"], width=2)
        for i in range(11):
            y = margin + (height - 2 * margin) * i / 10
            canvas.create_line(x - 8, y, x + 8, y, fill=COLORS["border"])
            canvas.create_text(x + 22, y, text=str(i * 10), fill=COLORS["muted"], font=("Consolas", 8), anchor="w")
        y = depth_pointer_y(self._depth_display, height, margin)
        canvas.create_line(x - 20, y, width - 22, y, fill=COLORS["accent"], width=2, tags=("depth-pointer",))
        canvas.create_polygon(width - 22, y, width - 10, y - 7, width - 10, y + 7, fill=COLORS["accent"], tags=("depth-pointer",))
        canvas.create_text(width - 14, 10, text="DEPTH", fill=COLORS["muted"], font=("Consolas", 8), anchor="e")
        heading = self.heading_value.get().replace("FIXED HEADING ", "FIX ").replace("WHEEL / HEADING ", "WHEEL ")
        canvas.create_text(width - 4, height - 29, text=heading, fill=COLORS["muted"], font=("Consolas", 7), anchor="e")
        input_label = "KEYS" if self.wheel_value.get() == "KEYBOARD INPUT" else "WHEEL"
        canvas.create_text(width - 4, height - 14, text=input_label, fill=COLORS["muted"], font=("Consolas", 7), anchor="e")

    def _schedule(self, delay, callback):
        token = self.root.after(delay, lambda: (self._after_ids.discard(token), callback()))
        self._after_ids.add(token)

    def _flash_scan(self):
        self.sample_title.set("SCAN RESULT / " + self.model.state.scan_result.upper())
        self._schedule(320, lambda: self.sample_title.set(self._sample_title_value()))
    def _flash_collect(self):
        self.thumb_frame.configure(highlightbackground=COLORS["accent"], highlightthickness=2)
        self._schedule(220, lambda: self.thumb_frame.configure(highlightthickness=0))
    def _flash_analyze(self):
        self.analysis_header_label.configure(fg=COLORS["accent"])
        self._schedule(180, lambda: self.analysis_header_label.configure(fg=COLORS["text"]))
    def _sample_title_value(self):
        sample = self.model.store.samples.get(self.model.state.selected_sample_id) if self.model.state.selected_sample_id else None
        return f"SAMPLE / {sample.sample_id}" if sample else "NO SAMPLE SELECTED"

    def _render_thumbnails(self):
        for child in self.thumb_frame.winfo_children(): child.destroy()
        self._thumb_photos = []
        for sample_id, sample in self.model.store.samples.items():
            selected = sample_id == self.model.state.selected_sample_id
            try:
                image = Image.open(sample.image_path).convert("RGB") if Image else None
                if image:
                    image.thumbnail((92, 68)); photo = ImageTk.PhotoImage(image); self._thumb_photos.append(photo)
                    button = tk.Button(self.thumb_frame, image=photo, text=sample_id, compound="top", command=lambda sid=sample_id: self.select_sample(sid), bg=COLORS["inset"], fg=COLORS["text"], activebackground="#173A45", activeforeground=COLORS["text"], relief="flat", bd=0, highlightthickness=2, highlightbackground=COLORS["accent"] if selected else COLORS["border"], padx=5, pady=4, font=("Consolas", 8))
                else:
                    button = tk.Button(self.thumb_frame, text=sample_id, command=lambda sid=sample_id: self.select_sample(sid), bg=COLORS["inset"], fg=COLORS["text"], relief="flat")
                button.pack(side="left", padx=5)
            except OSError: continue
        if not self.model.store.samples: tk.Label(self.thumb_frame, text="NO SNAPSHOTS YET", bg=COLORS["panel"], fg=COLORS["muted"], font=("Consolas", 9)).pack(anchor="w", padx=8, pady=12)

    def refresh(self):
        if getattr(self, "_suspend_refresh", False): return
        state = self.model.state
        ready = self.simulate or state.connected
        for button in (self.scan_button, self.collect_button):
            button.state(["!disabled"] if ready else ["disabled"])
        self.analyze_button.state(["!disabled"])
        self.connection_var.set(state.connection_label.upper())
        self.depth_value.set("LEVEL —" if state.depth_norm is None else f"LEVEL {state.depth_norm * 100:04.1f}%")
        if state.yaw_source == "none":
            self.heading_value.set("FIXED HEADING " + ("—" if state.yaw_deg is None else f"{state.yaw_deg:05.1f}°"))
            self.wheel_value.set("KEYBOARD INPUT")
        elif state.yaw_source == "keyboard":
            self.heading_value.set("KEYBOARD HEADING " + ("—" if state.yaw_deg is None else f"{state.yaw_deg:05.1f}°"))
            self.wheel_value.set("KEYBOARD INPUT / NO ROTATION SENSOR")
        else:
            self.heading_value.set("WHEEL / HEADING —" if state.yaw_deg is None else f"WHEEL / HEADING {state.yaw_deg:05.1f}°")
            self.wheel_value.set("WHEEL MODE / " + (state.wheel_role.upper() if state.wheel_role else "—"))
        self.target_value.set("AIM / " + (state.target_id if state.aim_visible and state.target_id else "BEZEL GAP" if not state.aim_visible else "EMPTY WATER"))
        self.asset_value.set("ASSET / " + state.asset_status.upper())
        self._depth_target = float(state.depth_norm) if state.depth_norm is not None else 0.0
        if not self._depth_animation_active:
            self._depth_animation_active = True
            self._animate_depth()
        if state.scan_result != self._scan_seen and state.scan_result != "no scan yet": self._scan_seen = state.scan_result; self._flash_scan()
        if len(self.model.store.samples) > self._sample_count: self._sample_count = len(self.model.store.samples); self._flash_collect()
        if state.selected_sample_id != self._selected_seen: self._selected_seen = state.selected_sample_id; self._flash_analyze() if state.selected_sample_id else None
        sample = self.model.store.samples.get(state.selected_sample_id) if state.selected_sample_id else None
        self.sample_title.set(f"SAMPLE / {sample.sample_id}" if sample else "NO SAMPLE SELECTED")
        if sample:
            mode = "SIMULATED / NO BOARD" if self.simulate else "BOARD SAMPLE"
            self.sample_caption.set(f"{mode}  |  Target {sample.target_id}  |  Level {sample.depth_norm * 100:04.1f}%  |  {sample.asset_pack}")
            self.analysis_header.set(sample.sample_id + " / " + mode)
            self.analysis_text.configure(state="normal"); self.analysis_text.delete("1.0", tk.END)
            self.analysis_text.insert(tk.END, ("SIMULATED / NO BOARD\n\n" if self.simulate else "BOARD SAMPLE\n\n") if state.asset_status != "asset_mismatch" else "ASSET MISMATCH\n\n")
            target_info = self.model.store.target_info(sample.target_id)
            label = target_info.get("label", "descriptive label unavailable")
            band = target_info.get("band", "unclassified")
            self.analysis_text.insert(tk.END, f"Subject\n{label}\n\nDepth band\n{band}\n\nTarget ID\n{sample.target_id}\n\nSample ID\n{sample.sample_id}\n\nCaptured level\n{sample.depth_norm * 100:04.1f}%\n\nThe snapshot is immutable and does not follow the current wheel level.")
            self.analysis_text.configure(state="disabled")
            if Image:
                try:
                    self.image_label.update_idletasks()
                    image = Image.open(sample.image_path).convert("RGB")
                    max_width = max(120, min(620, self.image_label.winfo_width() - 20))
                    max_height = max(100, min(420, self.image_label.winfo_height() - 20))
                    scale = min(max_width / image.width, max_height / image.height)
                    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
                    image = image.resize(size, Image.Resampling.NEAREST)
                    self.sample_photo = ImageTk.PhotoImage(image)
                    self.image_label.configure(image=self.sample_photo, text="", bg=COLORS["inset"])
                except OSError as exc: self.image_label.configure(image="", text=f"SAMPLE IMAGE ERROR\n{exc}")
        else:
            self.sample_caption.set("No sample image has been saved. Scan, then Collect to save a snapshot.")
            self.analysis_header.set("SELECT A SAVED SAMPLE")
            self.analysis_text.configure(state="normal"); self.analysis_text.delete("1.0", tk.END); self.analysis_text.insert(tk.END, "No sample selected.\n\nCollect a snapshot from the cube before opening Analyze."); self.analysis_text.configure(state="disabled")
            self.image_label.configure(image="", text="\n\nEMPTY COLLECTION\n\nScan, then Collect to save a snapshot.")
        self._render_thumbnails()
        if state.error: self.feedback_var.set("ERROR / " + state.error)
        elif state.scan_result != "no scan yet": self.feedback_var.set("SCAN / " + state.scan_result.upper() + (f" / {state.scan_target}" if state.scan_target else ""))
        else: self.feedback_var.set("Ready. Collect is confirmed only after the laptop saves the snapshot.")
        if self._settings_window and self._settings_window.winfo_exists() and hasattr(self, "diag_text"):
            self.diag_text.configure(state="normal"); self.diag_text.delete("1.0", tk.END); self.diag_text.insert(tk.END, f"Connection: {state.connection_label}\nAsset: {state.asset_status}\nSamples: {len(self.model.store.samples)}\nAudio: {'muted' if self.audio.muted else 'enabled' if self.audio.enabled else 'skipped'}\n\n" + "\n".join(self.model.log_lines)); self.diag_text.configure(state="disabled")

    def close(self):
        self.clear_held_keys()
        for token in list(self._after_ids):
            try: self.root.after_cancel(token)
            except tk.TclError: pass
        self._after_ids.clear(); self.disconnect(); self.audio.close(); self.root.destroy()

    def run(self): self.refresh(); self.root.mainloop()


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--simulate", action="store_true", help="drive the panel from a clearly labelled simulated board"); parser.add_argument("--no-audio", action="store_true")
    args = parser.parse_args(); logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"); DashboardApp(args.simulate, args.no_audio).run()


if __name__ == "__main__": main()
