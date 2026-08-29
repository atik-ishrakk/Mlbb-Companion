# =============================================================================
#   MLBB COMPANION — HIGH-PERFORMANCE ADB ENGINE & CONNECTOR (connector.py)
# =============================================================================
#   Role & Purpose in Project:
#     This file manages live communication between the MLBB Companion backend and
#     the BlueStacks Android emulator instance over ADB.
#     
#     Key Functions:
#       1. Asynchronous Frame Capturing: Dedicated background thread continuously captures
#          game frames via ADB exec-out screencap with direct C++ OpenCV in-memory decoding.
#       2. Memory-Only Rolling Ring Buffer: Stores recent frames in RAM (maxlen=30) with
#          zero disk writes for instant retrieval and analysis.
#       3. Connection State Machine: Manages transitions (DISCONNECTED, CONNECTED, GAME_RUNNING)
#          with automatic health checks and exponential backoff retry.
#       4. Focused Window Watchdog: Inspects Android window focus via dumpsys window to
#          detect whether MLBB is on launcher, splash loading, or active 3D gameplay.
# =============================================================================

import os
import sys
import time
import hashlib
import subprocess
import threading
from collections import deque
from typing import Optional, Tuple, Dict, List, Any, Union, Set, Deque
import cv2
import numpy as np

from process import (
    get_bluestacks_ports_from_config,
    get_adb_binary,
    is_bluestacks_process_running,
)
from phase_matcher import PhaseMatcher


class ConnectionState:
    DISCONNECTED = "DISCONNECTED"
    DETECTING = "DETECTING"
    CONNECTING = "CONNECTING"
    CONNECTED = "CONNECTED"
    GAME_RUNNING = "GAME_RUNNING"
    STREAMING = "STREAMING"
    ERROR = "ERROR"


class DeviceHealth:
    """Persistent Health Monitor for tracking ADB ping, frame latency, and failures."""
    def __init__(self):
        self.last_success_time = 0.0
        self.last_frame_time = 0.0
        self.last_ping_time = 0.0
        self.consecutive_failures = 0
        self.retry_delay = 1.0

    def record_success(self):
        now = time.time()
        self.last_success_time = now
        self.last_frame_time = now
        self.consecutive_failures = 0
        self.retry_delay = 1.0

    def record_failure(self):
        self.consecutive_failures += 1
        self.retry_delay = min(16.0, 2.0 ** min(self.consecutive_failures, 4))


class ADBConnector:
    """
    High-Performance Asynchronous ADB Engine featuring Connection State Machine,
    Dedicated Connection Thread, Frame Hashing, and Fast Direct C++ Decoding.
    """
    def __init__(self, port: int = 5555, project_root: Optional[str] = None):
        self.adb_bin = get_adb_binary()
        self.default_port = port
        self.last_device: Optional[str] = f"127.0.0.1:{port}"
        self.devices: Dict[str, Any] = {}

        # RAM-only rolling screenshot ring buffer (bounded maxlen=30 to prevent memory growth)
        self._ram_screenshot_ring: Deque[Tuple[float, np.ndarray]] = deque(maxlen=30)
        self._ram_ring_lock = threading.Lock()

        # 3.0s Hold / Debounce Timestamps
        self.last_bs_ping_success_time = 0.0
        self.last_game_ping_success_time = 0.0
        self.hold_grace_period_sec = 3.0

        self.state = ConnectionState.DISCONNECTED
        self.health = DeviceHealth()

        self.current_frame: Optional[np.ndarray] = None
        self.last_frame_hash = ""
        self.frame_lock = threading.Lock()

        if PhaseMatcher is not None:
            try:
                self.phase_matcher: Optional[PhaseMatcher] = PhaseMatcher(project_root)
            except Exception as e:
                print(f"[ADB WARNING] PhaseMatcher initialization failed: {e}")
                self.phase_matcher = None
        else:
            self.phase_matcher = None

        self._latest_phase_info: Dict[str, Any] = {
            "phase": "Standby", "confidence": 0.0, "details": "Standby", "sub_phase": None, "is_transient": False
        }
        self._phase_lock = threading.Lock()

        self.is_running = False
        self._bg_thread: Optional[threading.Thread] = None
        self._start_background_thread()

    @property
    def connected(self) -> bool:
        bs_running, _ = is_bluestacks_process_running()
        if not bs_running:
            return False
        now = time.time()
        return (now - self.last_bs_ping_success_time < self.hold_grace_period_sec) or (
            self.state in [ConnectionState.CONNECTED, ConnectionState.GAME_RUNNING, ConnectionState.STREAMING]
        )

    def _start_background_thread(self):
        """Dedicated Connection & Frame Capture Background Thread."""
        self.is_running = True
        self._bg_thread = threading.Thread(target=self._connection_loop, daemon=True)
        self._bg_thread.start()

    def _connection_loop(self):
        """
        Background thread main loop:
        1. Checks if BlueStacks HD-Player.exe is active.
        2. Only polls ADB when BlueStacks is actually running.
        3. Completely idle with 0 CPU overhead when BlueStacks is closed.
        """
        while self.is_running:
            try:
                now = time.time()
                bs_running, port = is_bluestacks_process_running()

                if not bs_running:
                    if self.state != ConnectionState.DISCONNECTED:
                        self._transition_to(ConnectionState.DISCONNECTED)
                    time.sleep(1.0)
                    continue

                # BlueStacks is active: Ping ADB device
                bs_ping_ok = self._ping_device()
                if bs_ping_ok:
                    self.last_bs_ping_success_time = now
                    self.health.record_success()
                else:
                    if now - self.last_bs_ping_success_time >= self.hold_grace_period_sec:
                        if self._verify_cached_device():
                            self.last_bs_ping_success_time = now
                            self.health.record_success()
                        else:
                            active_dev = self._enumerate_devices()
                            if active_dev:
                                self.last_device = active_dev
                                self.last_bs_ping_success_time = now
                                self.health.record_success()
                            else:
                                if self._attempt_connect(f"127.0.0.1:{port}"):
                                    self.last_device = f"127.0.0.1:{port}"
                                    self.last_bs_ping_success_time = now
                                    self.health.record_success()

                bs_alive = (now - self.last_bs_ping_success_time < self.hold_grace_period_sec)

                if bs_alive:
                    app_state, pkg = self.get_focused_app_state()

                    if app_state == "STANDBY":
                        target_state = ConnectionState.CONNECTED
                        if self.state != target_state:
                            self._transition_to(target_state)
                        with self._phase_lock:
                            self._latest_phase_info = {
                                "phase": "Standby", "confidence": 1.0, "details": "BlueStacks Launcher (Direct ADB Watchdog)", "sub_phase": None, "is_transient": False
                            }
                        time.sleep(0.35)
                        continue

                    if app_state == "LOADING":
                        self.last_game_ping_success_time = now
                        target_state = ConnectionState.GAME_RUNNING
                        if self.state != target_state:
                            self._transition_to(target_state)
                        with self._phase_lock:
                            self._latest_phase_info = {
                                "phase": "Loading", "confidence": 1.0, "details": "MLBB Game Splash Loading (Direct ADB)", "sub_phase": None, "is_transient": False
                            }
                        time.sleep(0.35)
                        continue

                    # app_state == "GAME_ACTIVE" -> 3D Unity surface rendered
                    self.last_game_ping_success_time = now
                    target_state = ConnectionState.GAME_RUNNING
                    if self.state != target_state:
                        self._transition_to(target_state)

                    frame = self._fetch_frame_internal()
                    if frame is not None:
                        self.last_bs_ping_success_time = now
                        with self.frame_lock:
                            self.current_frame = frame
                        self.push_ram_screenshot(frame)

                        # Real-time In-Memory Game Phase Classification
                        if self.phase_matcher is not None:
                            phase_res = self.phase_matcher.match_phase(frame)
                        else:
                            phase_res = {
                                "phase": "In Game", "confidence": 0.5, "details": "PhaseMatcher unavailable", "sub_phase": None, "is_transient": False
                            }

                        with self._phase_lock:
                            self._latest_phase_info = phase_res

                        p_name = phase_res.get("phase")
                        if p_name and p_name not in ["Unknown", "N/A", "Standby"]:
                            self.last_game_ping_success_time = now
                else:
                    if self.state != ConnectionState.DISCONNECTED:
                        self._transition_to(ConnectionState.DISCONNECTED)
                        with self._phase_lock:
                            self._latest_phase_info = {
                                "phase": "Standby", "confidence": 0.0, "details": "BlueStacks Disconnected", "sub_phase": None, "is_transient": False
                            }

            except Exception:
                pass

            sleep_time = 0.25 if self.connected else 1.0
            time.sleep(sleep_time)

    def _transition_to(self, new_state: str):
        if self.state != new_state:
            print(f"[ADB STATE] Transition: {self.state} -> {new_state}")
            self.state = new_state

    def _verify_cached_device(self) -> bool:
        """Check cached last_device using fast adb get-state."""
        if not self.last_device:
            return False
        creationflags = 0x08000000 if os.name == 'nt' else 0
        try:
            cmd = [self.adb_bin, "-s", self.last_device, "get-state"]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=1.5, stdin=subprocess.DEVNULL, creationflags=creationflags)
            return "device" in res.stdout.strip().lower()
        except Exception:
            return False

    def _enumerate_devices(self) -> Optional[str]:
        creationflags = 0x08000000 if os.name == 'nt' else 0
        try:
            res = subprocess.run([self.adb_bin, "devices"], capture_output=True, text=True, timeout=1.5, stdin=subprocess.DEVNULL, creationflags=creationflags)
            matches = []
            for line in res.stdout.strip().splitlines():
                line = line.strip()
                if not line or line.startswith("List of"):
                    continue
                parts = line.split()
                if len(parts) >= 2 and parts[1] == "device":
                    matches.append(parts[0])
            self.devices = {m: {"status": "device"} for m in matches}

            emulator_devs = [m for m in matches if ("127.0.0.1" in m or "emulator" in m or "localhost" in m)]
            if emulator_devs:
                return emulator_devs[0]
            if matches:
                return matches[0]
        except Exception:
            pass
        return None

    def _attempt_connect(self, device_str: str) -> bool:
        creationflags = 0x08000000 if os.name == 'nt' else 0
        try:
            res = subprocess.run([self.adb_bin, "connect", device_str], capture_output=True, text=True, timeout=1.5, stdin=subprocess.DEVNULL, creationflags=creationflags)
            out = res.stdout.lower()
            return "connected" in out or "already connected" in out
        except Exception:
            return False

    def _ping_device(self) -> bool:
        """Fast ADB get-state ping check."""
        if not self.last_device:
            return False
        creationflags = 0x08000000 if os.name == 'nt' else 0
        try:
            res = subprocess.run([self.adb_bin, "-s", self.last_device, "get-state"], capture_output=True, text=True, timeout=1.5, stdin=subprocess.DEVNULL, creationflags=creationflags)
            return "device" in res.stdout.strip().lower()
        except Exception:
            return False

    def get_focused_app_state(self) -> Tuple[str, str]:
        """
        Direct ADB Window Watchdog:
        Returns (state, package) without capturing frames or running CV.
        - "STANDBY": On BlueStacks launcher / home screen.
        - "LOADING": On SplashActivity (MLBB loading screen).
        - "GAME_ACTIVE": On MobaGameUnityActivity (MLBB 3D Unity surface active).
        """
        if not self.last_device:
            return "STANDBY", ""
        targets = [
            "com.mobile.legends", "com.mobile.legends.usa", "com.mobile.legends.gb",
            "com.mobile.legends.kr", "com.mobile.legends.jp", "com.mobile.legends.vn",
            "com.vng.mlbb", "com.mobile.legends.hw", "com.mobile.legends.mi"
        ]
        creationflags = 0x08000000 if os.name == 'nt' else 0
        try:
            cmd = [self.adb_bin, "-s", self.last_device, "shell", "dumpsys", "window", "windows"]
            res = subprocess.run(cmd, capture_output=True, timeout=1.2, stdin=subprocess.DEVNULL, creationflags=creationflags)
            text = res.stdout.decode('utf-8', errors='replace')
            for line in text.splitlines():
                if "mCurrentFocus" in line or "mFocusedApp" in line:
                    lower = line.lower()
                    if "launcher" in lower:
                        return "STANDBY", "com.bluestacks.launcher"
                    if "splashactivity" in lower:
                        return "LOADING", "com.mobile.legends"
                    if "mobagameunityactivity" in lower or any(t in lower for t in targets):
                        return "GAME_ACTIVE", "com.mobile.legends"
            return "STANDBY", ""
        except Exception:
            return "STANDBY", ""

    def _ping_game_process(self) -> bool:
        """Fast check verifying MLBB is actively running in foreground on BlueStacks."""
        state, pkg = self.get_focused_app_state()
        return state in ["LOADING", "GAME_ACTIVE"]

    def is_game_running(self) -> bool:
        """Returns whether MLBB game is actively running in foreground (with 3.0s grace hold)."""
        now = time.time()
        return (now - self.last_game_ping_success_time < self.hold_grace_period_sec)

    def check_game_running_quick(self) -> bool:
        """Fast check verifying MLBB is actively running in foreground on BlueStacks."""
        return self._ping_game_process()

    def _fetch_frame_internal(self) -> Optional[np.ndarray]:
        """
        Fetch screen frame via exec-out screencap.
        Decodes directly into NumPy array using cv2.imdecode (sub-10ms, 0 PIL overhead).
        """
        if not self.last_device:
            self.last_device = self._enumerate_devices() or f"127.0.0.1:{self.default_port}"
        creationflags = 0x08000000 if os.name == 'nt' else 0
        try:
            cmd = [self.adb_bin, "-s", self.last_device, "exec-out", "screencap", "-p"]
            result = subprocess.run(cmd, capture_output=True, timeout=2.5, stdin=subprocess.DEVNULL, creationflags=creationflags)
            if not result.stdout or len(result.stdout) < 100:
                dev = self._enumerate_devices()
                if dev and dev != self.last_device:
                    self.last_device = dev
                    cmd = [self.adb_bin, "-s", self.last_device, "exec-out", "screencap", "-p"]
                    result = subprocess.run(cmd, capture_output=True, timeout=2.5, stdin=subprocess.DEVNULL, creationflags=creationflags)

            if not result.stdout or len(result.stdout) < 100:
                return None

            raw_data = result.stdout

            # Subsample hash comparison (skips re-decoding static duplicate frames)
            sample = raw_data[::50]
            current_hash = hashlib.md5(sample).hexdigest()
            if current_hash == self.last_frame_hash and self.current_frame is not None:
                return self.current_frame

            self.last_frame_hash = current_hash
            # Fast in-memory direct OpenCV C++ decoding
            img_buf = np.frombuffer(raw_data, dtype=np.uint8)
            frame = cv2.imdecode(img_buf, cv2.IMREAD_COLOR)
            return frame
        except Exception:
            return None

    def connect(self) -> bool:
        """Exposed method for compatibility."""
        if self.connected:
            return True
        if self.last_device:
            return self._attempt_connect(self.last_device)
        return False

    def capture_screen(self) -> Optional[np.ndarray]:
        """Exposed method for non-blocking RAM screenshot retrieval."""
        with self.frame_lock:
            if self.current_frame is not None:
                return self.current_frame.copy()
        return self._fetch_frame_internal()

    def screencap(self) -> Optional[np.ndarray]:
        """Exposed alias for direct frame retrieval."""
        return self.capture_screen()

    def push_ram_screenshot(self, frame: np.ndarray):
        """
        Pushes a fresh screen frame into the memory-only rolling ring buffer.
        Automatically bounded (maxlen=30) to prevent RAM explosion. Zero disk writes!
        """
        if frame is None:
            return
        now = time.time()
        with self._ram_ring_lock:
            self._ram_screenshot_ring.append((now, frame.copy()))

    @property
    def _phase_voting_history(self):
        if self.phase_matcher is not None and hasattr(self.phase_matcher, "fsm"):
            return self.phase_matcher.fsm.history
        return []

    @_phase_voting_history.setter
    def _phase_voting_history(self, val):
        if self.phase_matcher is not None and hasattr(self.phase_matcher, "fsm"):
            self.phase_matcher.fsm.history = val

    def detect_game_phase_detailed(self, frame: Optional[np.ndarray] = None) -> Dict[str, Any]:
        """
        Returns live game phase. When frame is omitted, returns cached real-time
        telemetry evaluated asynchronously by background thread (<0.05ms response).
        """
        if frame is not None:
            if self.phase_matcher is not None:
                return self.phase_matcher.match_phase(frame)
            return {"phase": "Unknown", "confidence": 0.0, "details": "PhaseMatcher unavailable", "sub_phase": None, "is_transient": False}

        with self._phase_lock:
            cached = self._latest_phase_info.copy()
            if cached.get("phase") and cached.get("phase") not in ["Unknown", "N/A", "Standby"]:
                return cached

        # Fallback if cache is not populated yet: capture one frame
        with self.frame_lock:
            cur = self.current_frame.copy() if self.current_frame is not None else None
        if cur is None:
            cur = self.capture_screen()

        if cur is not None and self.phase_matcher is not None:
            res = self.phase_matcher.match_phase(cur)
            with self._phase_lock:
                self._latest_phase_info = res
            return res

        with self._phase_lock:
            return self._latest_phase_info.copy()

    def detect_game_phase(self, frame: Optional[np.ndarray] = None) -> str:
        """Helper method returning string phase name for backwards compatibility."""
        res = self.detect_game_phase_detailed(frame)
        return str(res.get("phase", "Standby"))

    def get_ram_buffer_status(self) -> Dict[str, Any]:
        """Returns current RAM screenshot count, duration, and active memory usage."""
        now = time.time()
        with self._ram_ring_lock:
            count = len(self._ram_screenshot_ring)
            oldest_age = round(now - self._ram_screenshot_ring[0][0], 1) if count > 0 else 0.0
            ram_mb = round((count * 1920 * 1080 * 3) / (1024 * 1024), 1)

        phase = self.detect_game_phase()
        return {
            "count": count,
            "max_age_sec": oldest_age,
            "ram_mb": ram_mb,
            "current_phase": phase,
            "retention_policy": "Rolling bounded memory buffer (max 30 frames, 0 disk I/O)"
        }

    def stop(self):
        """Stops the background connection thread and purges all RAM screenshot buffers."""
        self.is_running = False
        if self._bg_thread and self._bg_thread.is_alive():
            try:
                self._bg_thread.join(timeout=1.0)
            except Exception:
                pass
        with self._ram_ring_lock:
            self._ram_screenshot_ring.clear()
        with self.frame_lock:
            self.current_frame = None
        self.last_frame_hash = ""
        import gc
        gc.collect()


# Compatibility alias
ADBEngine = ADBConnector
