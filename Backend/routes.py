# =============================================================================
#   MLBB COMPANION — FLASK REST API ROUTER & CONTROLLER (routes.py)
# =============================================================================
#   Role & Purpose in Project:
#     This file defines the HTTP REST API endpoints serving the Chrome/Brave Extension
#     frontend, live web dashboard, and diagnostic checker tools.
#     
#     Direct Matcher Architecture:
#       Directly integrates and orchestrates the 4 standalone high-precision matchers:
#       1. PhaseMatcher    : 17 invariant anchors & temporal phase FSM
#       2. BanMatcher      : Circular masked ZNCC ban classifier (Slots 0..9)
#       3. AllyPickMatcher : Left-aligned rectangular ally pick classifier (Slots 0..4)
#       4. EnemyPickMatcher: Right-aligned mirrored rectangular enemy pick classifier (Slots 5..9)
# =============================================================================

import os
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

import json
import time
import base64
import subprocess
from typing import Dict, List, Any, Optional, Set, Tuple

import cv2
import numpy as np
import pygetwindow as gw
import pyautogui
from flask import Flask, jsonify, request
from flask_cors import CORS

backend_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.abspath(os.path.join(backend_dir, ".."))

from roi import (
    ScreenAnalyzer,
    extract_ban_regions,
    extract_pick_regions,
    extract_ally_pick_regions,
    extract_enemy_pick_regions,
    extract_ban_area,
    extract_pick_area,
    DEFAULT_ROIS,
)
from phase_matcher import PhaseMatcher, get_phase_anchor_db
from ban_matcher import BanMatcher
from ally_pick_matcher import AllyPickMatcher
from enemy_pick_matcher import EnemyPickMatcher
from cache import get_gpu_cache
from process import is_bluestacks_process_running, get_bluestacks_ports_from_config
from connector import ADBConnector
from shutdown import kill_by_process_name, close_everything

app = Flask(__name__)
CORS(app)

# Global singleton standalone matchers
global_analyzer = ScreenAnalyzer()
global_phase_matcher = PhaseMatcher(project_root)
global_ban_matcher = BanMatcher(project_root)
global_ally_pick_matcher = AllyPickMatcher(project_root, analyzer=global_analyzer)
global_enemy_pick_matcher = EnemyPickMatcher(project_root, analyzer=global_analyzer)
global_gpu_cache = get_gpu_cache(project_root)
global_adb: Optional[ADBConnector] = None


def get_adb_connector() -> ADBConnector:
    global global_adb
    if global_adb is None:
        global_adb = ADBConnector(project_root=project_root)
    return global_adb


def capture_target_window() -> Optional[np.ndarray]:
    """
    Captures active screen frame prioritizing:
    1. ADB direct framebuffer (if connected)
    2. BlueStacks App Player OS window screenshot (via PyAutoGUI / pygetwindow)
    3. Full desktop display fallback
    """
    # 1. Check ADB screencap
    try:
        adb = get_adb_connector()
        if adb.connected:
            frame = adb.capture_screen()
            if frame is not None and frame.size > 0:
                return frame
    except Exception:
        pass

    # 2. Check BlueStacks desktop window
    try:
        targets = gw.getWindowsWithTitle('BlueStacks App Player') or gw.getWindowsWithTitle('BlueStacks')
        if targets:
            win = targets[0]
            if win.isMinimized:
                win.restore()
            if win.width > 100 and win.height > 100:
                screenshot = pyautogui.screenshot(region=(win.left, win.top, win.width, win.height))
                frame = cv2.cvtColor(np.array(screenshot), cv2.COLOR_RGB2BGR)
                return frame
    except Exception:
        pass

    # 3. Fallback fullscreen screenshot
    try:
        screenshot = pyautogui.screenshot()
        return cv2.cvtColor(np.array(screenshot), cv2.COLOR_RGB2BGR)
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# REST API ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/', methods=['GET'])
def root_status():
    return jsonify({
        "app": "MLBB Companion Suite",
        "status": "online",
        "version": "2.0",
        "matchers": [
            "PhaseMatcher", "BanMatcher", "AllyPickMatcher", "EnemyPickMatcher"
        ],
        "endpoints": [
            "/status", "/checker/ping", "/cv/initialize",
            "/cv/draft-scan", "/api/analyze_frame", "/api/reload_db", "/launch"
        ]
    })


@app.route('/status', methods=['GET'])
def get_system_status():
    """Live telemetry endpoint polled by extension popup & background worker (<1ms response)."""
    bs_running, port = is_bluestacks_process_running()
    if not bs_running:
        return jsonify({
            "status": "online",
            "bluestacks": False,
            "gameRunning": False,
            "connected": False,
            "gamePhase": "Standby",
            "subPhase": None,
            "device": f"127.0.0.1:{port}",
            "timestamp": time.time()
        })

    adb = get_adb_connector()
    phase_info = adb.detect_game_phase_detailed()
    phase_name = phase_info.get("phase", "Standby")
    game_running = (phase_name not in ["N/A", "Standby", "Unknown", None]) or adb.is_game_running() or adb._ping_game_process()

    return jsonify({
        "status": "online",
        "bluestacks": True,
        "gameRunning": game_running,
        "connected": True,
        "gamePhase": phase_name,
        "subPhase": phase_info.get("sub_phase"),
        "device": adb.last_device or f"127.0.0.1:{port}",
        "timestamp": time.time()
    })


@app.route('/checker/ping', methods=['GET'])
def api_ping():
    """Integrity handshake endpoint for Checker page."""
    return jsonify({
        "status": "online",
        "message": "Core infrastructure functional (OpenCV & ADB Bridge Active).",
        "timestamp": time.time()
    })


@app.route('/cv/initialize', methods=['GET'])
def init_backend():
    """Pre-warms CV tensors and responds with template count."""
    return jsonify({
        "status": "ready",
        "message": "4 High-Precision Matchers synchronized.",
        "templates": {
            "bans": len(global_ban_matcher.ban_hero_names),
            "picks": len(global_ally_pick_matcher.pick_hero_names),
            "ally_picks": len(global_ally_pick_matcher.pick_hero_names),
            "enemy_picks": len(global_enemy_pick_matcher.pick_hero_names)
        }
    })


@app.route('/cv/draft-scan', methods=['GET'])
def process_draft_ui():
    """
    Live 10-slot draft scan executing the 4 separate matchers directly:
    1. PhaseMatcher    -> Detects current phase & sub-phase
    2. BanMatcher      -> Matches 10 ban slots (5 ally + 5 enemy)
    3. AllyPickMatcher -> Matches 5 ally pick cards
    4. EnemyPickMatcher-> Matches 5 enemy pick cards
    """
    t0 = time.perf_counter()
    frame = capture_target_window()
    if frame is None:
        return jsonify({
            "status": "standby",
            "message": "No active BlueStacks window or ADB stream found.",
            "blue_slots": ["Empty"] * 5,
            "red_slots": ["Empty"] * 5,
            "blue_bans": ["Empty"] * 5,
            "red_bans": ["Empty"] * 5
        })

    # 1. Phase Classification
    phase_res = global_phase_matcher.match_phase(frame)
    current_phase = phase_res.get("phase", "Standby")

    if current_phase != "Draft Pick":
        return jsonify({
            "status": "standby",
            "phase": current_phase,
            "subPhase": phase_res.get("sub_phase"),
            "confidence": phase_res.get("confidence", 0.0),
            "blue_slots": ["Empty"] * 5,
            "red_slots": ["Empty"] * 5,
            "blue_bans": ["Empty"] * 5,
            "red_bans": ["Empty"] * 5,
            "message": f"Game is currently in {current_phase} phase (Draft Pick inactive)."
        })

    # 2. Extract Memory ROIs via Dedicated Specific Area Functions
    t_ext_start = time.perf_counter()
    ban_rois = extract_ban_regions(frame, global_analyzer)
    ally_pick_rois = extract_ally_pick_regions(frame, global_analyzer)
    enemy_pick_rois = extract_enemy_pick_regions(frame, global_analyzer)
    pick_rois = ally_pick_rois + enemy_pick_rois
    t_ext = (time.perf_counter() - t_ext_start) * 1000.0

    # 3. Ban Matcher (10 circular slots)
    ban_thresh = float(global_analyzer.thresholds.get("ban_threshold", 0.60))
    debug_bans, t_ban = global_ban_matcher.match_bans(ban_rois, threshold=ban_thresh, top_k=5)
    banned_heroes: Set[str] = set()
    for b in debug_bans:
        h = b.get("matched_hero")
        if h:
            banned_heroes.add(h.lower())

    # 4. Ally Pick Matcher (Slots 0..4) — One-Shot 4-Head Model
    pick_thresh = float(global_analyzer.thresholds.get("pick_threshold", 0.50))
    ally_picks, t_ally, debug_ally_picks = global_ally_pick_matcher.match_picks(
        ally_pick_rois, taken_bans=banned_heroes, threshold=pick_thresh, top_k=5
    )

    # 5. Enemy Pick Matcher (Slots 0..4) — Mirrored One-Shot 4-Head Model
    enemy_picks, t_enemy, debug_enemy_picks = global_enemy_pick_matcher.match_picks(
        enemy_pick_rois, taken_bans=banned_heroes, threshold=pick_thresh, top_k=5
    )

    debug_picks = debug_ally_picks + debug_enemy_picks
    blue_bans = [(b.get("matched_hero") or "Empty") for b in debug_bans[:5]]
    red_bans = [(b.get("matched_hero") or "Empty") for b in debug_bans[5:10]]

    blue_slots = [(p.get("matched_hero") or "Empty") for p in ally_picks]
    red_slots = [(p.get("matched_hero") or "Empty") for p in enemy_picks]

    total_ms = (time.perf_counter() - t0) * 1000.0

    timings_payload = {
        "extraction_ms": round(t_ext, 2),
        "ban_inference_ms": round(t_ban, 2),
        "pick_inference_ms": round(t_ally + t_enemy, 2),
        "ally_pick_ms": round(t_ally, 2),
        "enemy_pick_ms": round(t_enemy, 2),
        "total_ms": round(total_ms, 2)
    }

    return jsonify({
        "status": "active",
        "phase": current_phase,
        "subPhase": phase_res.get("sub_phase"),
        "confidence": phase_res.get("confidence", 0.95),
        "blue_slots": blue_slots,
        "red_slots": red_slots,
        "blue_bans": blue_bans,
        "red_bans": red_bans,
        "timings": timings_payload,
        "pipeline_timings_ms": timings_payload,
        "debug_bans_array": debug_bans,
        "debug_ally_picks_array": debug_ally_picks,
        "debug_enemy_picks_array": debug_enemy_picks,
        "debug_picks_array": debug_picks
    })


@app.route('/api/analyze_frame', methods=['POST'])
def analyze_frame_api():
    """
    High-precision frame analysis endpoint executing the 4 separate matchers directly
    for Checker dropzone & diagnostic test images.
    """
    try:
        t0 = time.perf_counter()
        data = request.get_json(force=True, silent=True) or {}
        raw_b64 = data.get("image_base64") or data.get("image") or ""

        # Fallback to live screen capture if no image is passed
        if not raw_b64:
            frame = capture_target_window()
            if frame is None:
                return jsonify({"success": False, "error": "No image provided and no active window to capture."}), 400
        else:
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",", 1)[1]
            img_bytes = base64.b64decode(raw_b64)
            nparr = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None or frame.size == 0:
                return jsonify({"success": False, "error": "Failed to decode image data."}), 400

        # 1. Phase Matcher
        phase_res = global_phase_matcher.match_phase(frame)

        # 2. Extract Memory ROIs via Dedicated Specific Area Functions
        t_ext_start = time.perf_counter()
        ban_rois = extract_ban_regions(frame, global_analyzer)
        ally_pick_rois = extract_ally_pick_regions(frame, global_analyzer)
        enemy_pick_rois = extract_enemy_pick_regions(frame, global_analyzer)
        pick_rois = ally_pick_rois + enemy_pick_rois
        t_ext = (time.perf_counter() - t_ext_start) * 1000.0

        # 3. Ban Matcher
        ban_thresh = float(global_analyzer.thresholds.get("ban_threshold", 0.60))
        debug_bans, t_ban = global_ban_matcher.match_bans(ban_rois, threshold=ban_thresh, top_k=5)
        banned_heroes: Set[str] = set()
        for b in debug_bans:
            h = b.get("matched_hero")
            if h:
                banned_heroes.add(h.lower())

        # 4. Ally Pick Matcher — One-Shot 4-Head Model
        pick_thresh = float(global_analyzer.thresholds.get("pick_threshold", 0.50))
        ally_picks, t_ally, debug_ally_picks = global_ally_pick_matcher.match_picks(
            ally_pick_rois, taken_bans=banned_heroes, threshold=pick_thresh, top_k=5
        )

        # 5. Enemy Pick Matcher — Mirrored One-Shot 4-Head Model
        enemy_picks, t_enemy, debug_enemy_picks = global_enemy_pick_matcher.match_picks(
            enemy_pick_rois, taken_bans=banned_heroes, threshold=pick_thresh, top_k=5
        )

        debug_picks = debug_ally_picks + debug_enemy_picks

        def crop_to_b64(crop):
            if crop is None or crop.size == 0:
                return None
            _, buf = cv2.imencode('.png', crop)
            return 'data:image/png;base64,' + base64.b64encode(buf).decode('utf-8')

        bans_payload = [
            {
                "slot": i,
                "side": "ally" if i < 5 else "enemy",
                "hero": db.get("matched_hero"),
                "confidence": round(float(db.get("confidence", 0.0)), 3),
                "shape": "round",
                "crop_thumb": crop_to_b64(ban_rois[i]["crop"]) if i < len(ban_rois) else None,
                "rejection_reason": db.get("rejection_reason"),
                "top_k_candidates": db.get("top_k_candidates", []),
                "empty_similarity": db.get("empty_similarity", 0.0)
            }
            for i, db in enumerate(debug_bans)
        ]

        picks_payload = [
            {
                "slot": i,
                "side": "ally" if i < 5 else "enemy",
                "hero": dp.get("matched_hero"),
                "lane": dp.get("detected_lane"),
                "confidence": round(float(dp.get("confidence", 0.0)), 3),
                "shape": "rectangle",
                "crop_thumb": crop_to_b64(pick_rois[i]["crop"]) if i < len(pick_rois) else None,
                "edge_density": dp.get("edge_density", 0.0),
                "rejection_reason": dp.get("rejection_reason"),
                "top_k_candidates": dp.get("top_k_candidates", []),
                "empty_similarity": dp.get("empty_similarity", 0.0)
            }
            for i, dp in enumerate(debug_picks)
        ]

        total_ms = (time.perf_counter() - t0) * 1000.0

        timings_payload = {
            "extraction_ms": round(t_ext, 2),
            "ban_inference_ms": round(t_ban, 2),
            "pick_inference_ms": round(t_ally + t_enemy, 2),
            "ally_pick_ms": round(t_ally, 2),
            "enemy_pick_ms": round(t_enemy, 2),
            "total_ms": round(total_ms, 2)
        }

        return jsonify({
            "success": True,
            "phase": phase_res["phase"],
            "subPhase": phase_res.get("sub_phase"),
            "confidence": round(float(phase_res["confidence"]), 2),
            "details": phase_res.get("details", ""),
            "bans": bans_payload,
            "picks": picks_payload,
            "debug_bans_array": debug_bans,
            "debug_ally_picks_array": debug_ally_picks,
            "debug_enemy_picks_array": debug_enemy_picks,
            "debug_picks_array": debug_picks,
            "pipeline_timings_ms": timings_payload,
            "timings": timings_payload
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/reload_db', methods=['GET'])
def reload_database():
    """Hot-reloads hero textures across all 4 matchers and resets GPU / RAM caches."""
    try:
        global_ban_matcher._load_banks()
        global_ally_pick_matcher._load_banks()
        global_enemy_pick_matcher._load_banks()
        global_gpu_cache.reload()
        return jsonify({
            "success": True,
            "reloaded": True,
            "counts": {
                "bans": len(global_ban_matcher.ban_hero_names),
                "ally_picks": len(global_ally_pick_matcher.pick_hero_names),
                "enemy_picks": len(global_enemy_pick_matcher.pick_hero_names)
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/save_rois', methods=['POST'])
def save_rois_endpoint():
    """Saves custom user-calibrated ROI dimensions and thresholds to rois_config.json."""
    try:
        payload = request.get_json(force=True, silent=True) or {}
        new_rois = payload.get("rois", {})
        new_thresholds = payload.get("thresholds", {})
        raw_pixel_spec = payload.get("raw_pixel_spec", {})
        if new_rois:
            global_analyzer.rois.update(new_rois)
        if new_thresholds:
            global_analyzer.thresholds.update(new_thresholds)
        if raw_pixel_spec:
            global_analyzer.raw_pixel_spec = raw_pixel_spec
        global_analyzer.save_config()
        
        # Immediately re-calibrate template & crop matching windows
        global_ally_pick_matcher.update_calibration(global_analyzer)
        global_enemy_pick_matcher.update_calibration(global_analyzer)
        
        return jsonify({
            "success": True,
            "message": "Calibration dimensions saved and applied successfully.",
            "rois": global_analyzer.rois,
            "raw_pixel_spec": getattr(global_analyzer, "raw_pixel_spec", {}),
            "thresholds": global_analyzer.thresholds
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/get_rois', methods=['GET'])
def get_rois_endpoint():
    """Returns current active ROI dimensions and thresholds."""
    return jsonify({
        "success": True,
        "rois": global_analyzer.rois,
        "raw_pixel_spec": getattr(global_analyzer, "raw_pixel_spec", {}),
        "thresholds": global_analyzer.thresholds
    })


@app.route('/api/reset_rois', methods=['POST'])
def reset_rois_endpoint():
    """Resets in-memory ROIs and rois_config.json to official MLBB default spec."""
    try:
        from roi import DEFAULT_ROIS
        global_analyzer.rois = dict(DEFAULT_ROIS)
        if hasattr(global_analyzer, "raw_pixel_spec"):
            delattr(global_analyzer, "raw_pixel_spec")
        global_analyzer.save_config()
        
        # Immediately restore matchers to default calibration
        global_ally_pick_matcher.update_calibration(global_analyzer)
        global_enemy_pick_matcher.update_calibration(global_analyzer)
        
        return jsonify({
            "success": True,
            "message": "Calibration dimensions reset to MLBB default spec successfully.",
            "rois": global_analyzer.rois,
            "thresholds": global_analyzer.thresholds
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/launch', methods=['GET'])
def launch_game_and_emulator():
    """Invokes BlueStacks 5 / Multi-Instance Manager with visible interactive window (SW_SHOWNORMAL)."""
    import ctypes
    
    # Auto-discover active instance from bluestacks.conf
    discovered = get_bluestacks_ports_from_config()
    instance_name = list(discovered.keys())[0] if discovered else "Nougat32"

    bs_player = r"C:\Program Files\BlueStacks_nxt\HD-Player.exe"
    bs_manager = r"C:\Program Files\BlueStacks_nxt\HD-MultiInstanceManager.exe"

    if os.path.exists(bs_player):
        try:
            # ShellExecuteW with SW_SHOWNORMAL (1) forces normal visible window on the active desktop
            ctypes.windll.shell32.ShellExecuteW(
                None, "open", bs_player, f"--instance {instance_name} --package com.mobile.legends", None, 1
            )
            return jsonify({
                "status": "success",
                "message": f"Launched BlueStacks ({instance_name}) visibly: {bs_player}",
                "instance": instance_name
            })
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    if os.path.exists(bs_manager):
        try:
            ctypes.windll.shell32.ShellExecuteW(None, "open", bs_manager, "", None, 1)
            return jsonify({
                "status": "success",
                "message": f"Launched BlueStacks Multi-Instance Manager: {bs_manager}",
                "instance": instance_name
            })
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    return jsonify({"status": "notice", "message": "BlueStacks executable not found in default paths. Please open manually."})


@app.route('/api/close-bluestacks', methods=['POST', 'GET'])
def close_bluestacks_instance():
    """Closes BlueStacks emulator instance while keeping the Flask API server alive."""
    k1 = kill_by_process_name("HD-Player.exe", "BlueStacks Player")
    k2 = kill_by_process_name("HD-Adb.exe", "BlueStacks ADB Subsystem")
    k3 = kill_by_process_name("BstkSVC.exe", "BlueStacks Service")
    k4 = kill_by_process_name("HD-MultiInstanceManager.exe", "BlueStacks Multi-Instance Manager")
    return jsonify({
        "status": "stopped",
        "message": "BlueStacks instance closed successfully.",
        "processes_killed": k1 + k2 + k3 + k4
    })


@app.route('/shutdown', methods=['POST', 'GET'])
@app.route('/api/e-stop', methods=['POST', 'GET'])
def emergency_stop():
    """
    Emergency Stop (E-STOP): Gracefully terminates BlueStacks 5 emulator
    (HD-Player, HD-Adb, BstkSVC), frees all memory/VRAM, and shuts down the Flask server.
    """
    import threading

    def perform_shutdown():
        time.sleep(0.5)
        close_everything(close_emulator=True)
        os._exit(0)

    threading.Thread(target=perform_shutdown, daemon=True).start()

    return jsonify({
        "status": "stopped",
        "message": "Emergency Stop Triggered. BlueStacks and Backend shutting down..."
    })
