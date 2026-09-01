# =============================================================================
# MLBB COMPANION — HIGH-PERFORMANCE ADB ENGINE & CONNECTOR (connector.py)
# =============================================================================
# Role & Purpose in Project:
#   This file manages live communication between the MLBB Companion backend and
#   the BlueStacks Android emulator instance over ADB.
#
# Key Functions:
#   1. Asynchronous Frame Capturing: Dedicated background thread continuously captures
#      game frames via ADB exec-out screencap with direct C++ OpenCV in-memory decoding.
#   2. Memory-Only Rolling Ring Buffer: Stores recent frames in RAM (maxlen=30) with
#      zero disk writes for instant retrieval and analysis.
#   3. Connection State Machine: Manages transitions (DISCONNECTED, CONNECTED, GAME_RUNNING)
#      with automatic health checks and exponential backoff retry.
#   4. Focused Window Watchdog: Inspects Android window focus via dumpsys window to
#      detect whether MLBB is on launcher, splash loading, or active 3D gameplay.
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
            "phase": "Standby",
            "confidence": 0.0,
            "details": "Standby",
            "sub_phase": None,
            "is_transient": False
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
                                "phase": "Standby",
                                "confidence": 1.0,
                                "details": "BlueStacks Launcher (Direct ADB Watchdog)",
                                "sub_phase": None,
                                "is_transient": False
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
                                "phase": "Loading",
                                "confidence": 1.0,
                                "details": "MLBB Game Splash Loading (Direct ADB)",
                                "sub_phase": None,
                                "is_transient": False
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
                                "phase": "In Game",
                                "confidence": 0.5,
                                "details": "PhaseMatcher unavailable",
                                "sub_phase": None,
                                "is_transient": False
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
                                "phase": "Standby",
                                "confidence": 0.0,
                                "details": "BlueStacks Disconnected",
                                "sub_phase": None,
                                "is_transient": False
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
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=1.5,
                                 stdin=subprocess.DEVNULL, creationflags=creationflags)
            return "device" in res.stdout.strip().lower()
        except Exception:
            return False

    def _enumerate_devices(self) -> Optional[str]:
        creationflags = 0x08000000 if os.name == 'nt' else 0
        try:
            res = subprocess.run([self.adb_bin, "devices"], capture_output=True, text=True,
                                 timeout=1.5, stdin=subprocess.DEVNULL, creationflags=creationflags)
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
            res = subprocess.run([self.adb_bin, "connect", device_str],
                                 capture_output=True, text=True, timeout=1.5,
                                 stdin=subprocess.DEVNULL, creationflags=creationflags)
            out = res.stdout.lower()
            return "connected" in out or "already connected" in out
        except Exception:
            return False

    def _ping_device(self) -> bool:
        """Fast ADB get-state ping check."""
        # ... (rest of the method)