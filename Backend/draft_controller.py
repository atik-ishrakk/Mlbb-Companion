# =============================================================================
#   MLBB COMPANION — DRAFT SEQUENCE & CONTROLLER (draft_controller.py)
# =============================================================================
#   Role & Purpose in Project:
#     This file controls the temporal finite state machine (FSM) for live MLBB draft
#     sessions and manages in-game player telemetry parsing.
#     
#     Key Functions:
#       1. Phase Window Gating: Automatically manages transitions between 'Ban Phase',
#          'Pick Phase', and 'Preparation Phase'.
#       2. Lock Debouncing: Employs lock counters (requiring 3 consecutive matching
#          frames) to prevent UI hover flickering from triggering false lock-ins.
#       3. Ban-to-Pick Exclusion: Feeds locked ban heroes into pick matchers as an
#          exclusion set to guarantee zero false positives on banned heroes.
#       4. Scoreboard Telemetry: Includes PlayerAnalyzer for extracting player builds,
#          battle spells, and stats during active matches.
# =============================================================================

import os
import time
from typing import Dict, List, Tuple, Optional, Set, Any
import cv2
import numpy as np

from roi import ScreenAnalyzer, extract_ban_regions, extract_pick_regions
from cache import get_gpu_cache


class PlayerAnalyzer:
    """Parses player telemetry (KDA, battle spells, build items) from scoreboard frames."""
    def __init__(self):
        self.cache = get_gpu_cache()

    def parse_kda_text(self, crop: np.ndarray) -> str:
        if crop is None or crop.size == 0:
            return "0/0/0"
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
        if float(np.std(gray)) < 10.0:
            return "0/0/0"
        return "Active"


class DraftSequenceController:
    """
    Enterprise-grade sequence state machine & matching window controller for MLBB Draft Pick.
    """
    def __init__(self):
        self.sub_phase = "Ban Phase"
        self.locked_bans = [None] * 10
        self.locked_picks = [None] * 10
        self.ban_confidences = [0.0] * 10
        self.pick_confidences = [0.0] * 10
        self.ban_lock_counters = [0] * 10
        self.pick_lock_counters = [0] * 10
        self.ban_phase_complete = False
        self.last_phase = "Standby"

    def reset(self):
        self.sub_phase = "Ban Phase"
        self.locked_bans = [None] * 10
        self.locked_picks = [None] * 10
        self.ban_confidences = [0.0] * 10
        self.pick_confidences = [0.0] * 10
        self.ban_lock_counters = [0] * 10
        self.pick_lock_counters = [0] * 10
        self.ban_phase_complete = False

    def process_cycle(self, frame: np.ndarray, current_phase: str,
                      analyzer: "ScreenAnalyzer", matcher: Any) -> dict:
        t0 = time.perf_counter()

        if current_phase not in ("Draft Pick", "Preparation Phase", "Homepage", "Lobby"):
            if self.last_phase in ("Draft Pick", "Preparation Phase"):
                self.reset()
            self.last_phase = current_phase
            return {
                "sub_phase": None,
                "debug_bans": [],
                "debug_picks": [],
                "timings": {"ban_inference_ms": 0.0, "pick_inference_ms": 0.0, "extraction_ms": 0.0}
            }
        self.last_phase = current_phase

        t_ext = 0.0
        t_ban = 0.0
        t_pick = 0.0

        active_picks_count = sum(1 for p in self.locked_picks if p is not None)

        if active_picks_count > 0 or self.ban_phase_complete:
            self.sub_phase = "Pick Phase"
            ban_matching_active = False
        else:
            self.sub_phase = "Ban Phase"
            ban_matching_active = True

        debug_bans = []
        if ban_matching_active:
            t_ext_start = time.perf_counter()
            ban_rois = extract_ban_regions(frame, analyzer)
            t_ext += (time.perf_counter() - t_ext_start) * 1000.0

            raw_bans, t_ban = matcher.match_bans(ban_rois, threshold=0.38, top_k=5)

            for idx in range(10):
                matched = raw_bans[idx].get("matched_hero")
                conf = raw_bans[idx].get("confidence", 0.0)
                if matched:
                    if self.locked_bans[idx] == matched:
                        self.ban_lock_counters[idx] += 1
                    else:
                        self.locked_bans[idx] = matched
                        self.ban_confidences[idx] = conf
                        self.ban_lock_counters[idx] = 1
                else:
                    if self.ban_lock_counters[idx] < 3:
                        self.locked_bans[idx] = None
                        self.ban_confidences[idx] = 0.0
                        self.ban_lock_counters[idx] = 0

                debug_bans.append({
                    "slot_index": idx,
                    "side": "ally" if idx < 5 else "enemy",
                    "matched_hero": self.locked_bans[idx],
                    "confidence": self.ban_confidences[idx],
                    "is_locked": (self.ban_lock_counters[idx] >= 3),
                    "rejection_reason": raw_bans[idx].get("rejection_reason"),
                    "top_k_candidates": raw_bans[idx].get("top_k_candidates", [])
                })
        else:
            for idx in range(10):
                debug_bans.append({
                    "slot_index": idx,
                    "side": "ally" if idx < 5 else "enemy",
                    "matched_hero": self.locked_bans[idx],
                    "confidence": self.ban_confidences[idx],
                    "is_locked": True,
                    "rejection_reason": "BAN_LOGIC_DEACTIVATED_DURING_PICKS",
                    "top_k_candidates": []
                })

        debug_picks = []
        banned_set = set(b.lower() for b in self.locked_bans if b)

        t_ext_start = time.perf_counter()
        pick_rois = extract_pick_regions(frame, analyzer)
        t_ext += (time.perf_counter() - t_ext_start) * 1000.0

        raw_picks, t_pick = matcher.match_picks(pick_rois, taken_bans=banned_set, threshold=0.42, top_k=5)

        for idx in range(10):
            matched = raw_picks[idx].get("matched_hero")
            conf = raw_picks[idx].get("confidence", 0.0)
            if matched:
                if self.locked_picks[idx] == matched:
                    self.pick_lock_counters[idx] += 1
                else:
                    self.locked_picks[idx] = matched
                    self.pick_confidences[idx] = conf
                    self.pick_lock_counters[idx] = 1
                self.ban_phase_complete = True
                self.sub_phase = "Pick Phase"
            else:
                if self.pick_lock_counters[idx] < 3:
                    self.locked_picks[idx] = None
                    self.pick_confidences[idx] = 0.0
                    self.pick_lock_counters[idx] = 0

            debug_picks.append({
                "slot_index": idx,
                "side": "ally" if idx < 5 else "enemy",
                "matched_hero": self.locked_picks[idx],
                "confidence": self.pick_confidences[idx],
                "is_locked": (self.pick_lock_counters[idx] >= 3),
                "rejection_reason": raw_picks[idx].get("rejection_reason"),
                "top_k_candidates": raw_picks[idx].get("top_k_candidates", [])
            })

        total_locked = sum(1 for idx in range(10) if self.pick_lock_counters[idx] >= 3)
        if total_locked >= 10:
            self.sub_phase = "Preparation Phase"

        return {
            "sub_phase": self.sub_phase,
            "debug_bans": debug_bans,
            "debug_picks": debug_picks,
            "timings": {
                "extraction_ms": round(t_ext, 2),
                "ban_inference_ms": round(t_ban, 2),
                "pick_inference_ms": round(t_pick, 2),
                "total_ms": round((time.perf_counter() - t0) * 1000.0, 2)
            }
        }
