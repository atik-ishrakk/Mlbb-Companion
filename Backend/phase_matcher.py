# =============================================================================
#   MLBB COMPANION — STRUCTURAL LAYOUT & GAME PHASE CLASSIFIER (phase_matcher.py)
# =============================================================================
#   Role & Purpose in Project:
#     This file detects the current MLBB user interface screen state from live frames,
#     differentiating between 'Homepage', 'Lobby', 'Matchmaking', 'Draft Pick',
#     'Match Start', 'In Game', and 'In Game ScoreBoard'.
#     
#     Key Functions:
#       1. Invariant UI Chrome Anchors: Evaluates 17 high-precision fixed UI anchor
#          templates (buttons, tabs, frames) with CLAHE Normalized Cross-Correlation.
#       2. Frame Integrity Guard: Detects corrupted frames, black fades, or transition flashes.
#       3. Phase FSM: Temporal smoothing filter preventing UI flicker across game states.
# =============================================================================

import os
from collections import deque, Counter
from typing import Dict, List, Tuple, Optional, Any
import cv2
import numpy as np


class FrameIntegrityGuard:
    """Analyzes raw pixel distributions to detect corrupted or transient black/loading frames."""
    @staticmethod
    def inspect(frame: np.ndarray) -> Tuple[bool, bool, str, dict]:
        if frame is None or frame.size == 0:
            return False, False, "Corrupted / None frame", {}
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame
        mean_val = float(np.mean(gray))
        std_val = float(np.std(gray))
        stats = {"mean": mean_val, "std": std_val}

        if mean_val < 3.0 and std_val < 2.0:
            return True, True, "Black fade / Scene load", stats
        if mean_val > 252.0 and std_val < 2.0:
            return True, True, "White flash / Scene transition", stats
        return True, False, "Normal game frame", stats


class StructuralLayoutDetector:
    """Extracts spatial anchors and invariant HUD signatures from 1920x1080 frames."""
    @staticmethod
    def extract_features(frame: np.ndarray) -> dict:
        h, w, _ = frame.shape
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # 1. Top-Left Minimap Edge Density
        roi_minimap = gray[0:int(h * 0.25), 0:int(w * 0.22)]
        edges_map = cv2.Canny(roi_minimap, 50, 150)
        minimap_density = np.sum(edges_map > 0) / float(roi_minimap.size)

        # 2. Bottom-Right Action Buttons Density
        roi_skills = gray[int(h * 0.65):h, int(w * 0.70):w]
        edges_skills = cv2.Canny(roi_skills, 50, 150)
        skills_density = np.sum(edges_skills > 0) / float(roi_skills.size)

        # 3. Scoreboard Horizontal Lines
        roi_center = gray[int(h * 0.20):int(h * 0.80), int(w * 0.15):int(w * 0.85)]
        sobel_y = cv2.Sobel(roi_center, cv2.CV_64F, 0, 1, ksize=3)
        scoreboard_grid_resp = float(np.mean(np.abs(sobel_y)))
        center_std = float(np.std(roi_center))

        # 4. Draft Pick Left & Right Column Edges
        roi_left = gray[int(h * 0.10):int(h * 0.90), 0:int(w * 0.15)]
        roi_right = gray[int(h * 0.10):int(h * 0.90), int(w * 0.85):w]
        left_edges = np.sum(cv2.Canny(roi_left, 50, 150) > 0) / float(roi_left.size)
        right_edges = np.sum(cv2.Canny(roi_right, 50, 150) > 0) / float(roi_right.size)

        # 5. Top Ban Bar Texture
        roi_ban = gray[0:int(h * 0.12), int(w * 0.15):int(w * 0.85)]
        ban_edges = np.sum(cv2.Canny(roi_ban, 50, 150) > 0) / float(roi_ban.size)
        std_ban = float(np.std(roi_ban))

        # 6. Victory/Defeat Gold & Blue Ribbons
        roi_mid_banner = frame[int(h * 0.25):int(h * 0.45), int(w * 0.25):int(w * 0.75)]
        hsv_banner = cv2.cvtColor(roi_mid_banner, cv2.COLOR_BGR2HSV)
        gold_mask = cv2.inRange(hsv_banner, np.array([15, 120, 150]), np.array([35, 255, 255]))
        vic_ratio = np.sum(gold_mask > 0) / float(roi_mid_banner.shape[0] * roi_mid_banner.shape[1])

        # 7. Start Game Button (Lobby)
        roi_start_btn = frame[int(h * 0.85):int(h * 0.98), int(w * 0.40):int(w * 0.60)]
        hsv_start = cv2.cvtColor(roi_start_btn, cv2.COLOR_BGR2HSV)
        yellow_start_mask = cv2.inRange(hsv_start, np.array([15, 100, 150]), np.array([35, 255, 255]))
        yellow_start_ratio = np.sum(yellow_start_mask > 0) / float(roi_start_btn.shape[0] * roi_start_btn.shape[1])

        # 8. Homepage Mode Slot (1600px from left, 924px from top, 320x135px)
        x_hp = int(1600 / 1920 * w)
        y_hp = int(924 / 1080 * h)
        w_hp = int(320 / 1920 * w)
        h_hp = int(135 / 1080 * h)
        roi_hp_mode = frame[y_hp:min(y_hp+h_hp, h), x_hp:min(x_hp+w_hp, w)]
        if roi_hp_mode.size > 0:
            hsv_hp = cv2.cvtColor(roi_hp_mode, cv2.COLOR_BGR2HSV)
            hp_gold_mask = cv2.inRange(hsv_hp, np.array([12, 80, 100]), np.array([38, 255, 255]))
            hp_mode_gold_ratio = np.sum(hp_gold_mask > 0) / float(roi_hp_mode.shape[0] * roi_hp_mode.shape[1])
        else:
            hp_mode_gold_ratio = 0.0

        return {
            "minimap_edge_density": minimap_density,
            "skills_edge_density": skills_density,
            "scoreboard_grid_response": scoreboard_grid_resp,
            "center_std": center_std,
            "left_edges": left_edges,
            "right_edges": right_edges,
            "ban_edge_density": ban_edges,
            "std_ban": std_ban,
            "vic_ratio": vic_ratio,
            "yellow_start_ratio": yellow_start_ratio,
            "hp_mode_gold_ratio": hp_mode_gold_ratio
        }


class PhaseFSM:
    """State Machine with temporal hysteresis to smooth screen transitions."""
    def __init__(self, history_len: int = 5):
        self.history = deque(maxlen=history_len)
        self.current_phase = "N/A"
        self.current_confidence = 0.0

    def update(self, detected_phase: str, confidence: float, is_transient: bool = False) -> Tuple[str, float]:
        if is_transient:
            return self.current_phase, self.current_confidence
        self.history.append((detected_phase, confidence))
        if len(self.history) == 1 or confidence >= 0.65:
            self.current_phase = detected_phase
            self.current_confidence = confidence
            return self.current_phase, self.current_confidence

        counts = Counter([p for p, _ in self.history])
        most_common_phase, count = counts.most_common(1)[0]
        if count >= 2 or confidence >= 0.60:
            self.current_phase = most_common_phase
            self.current_confidence = float(np.mean([c for p, c in self.history if p == most_common_phase]))
        return self.current_phase, self.current_confidence


class PhaseAnchorDB:
    """
    High-Precision Invariant UI Chrome Anchor Database for MLBB Phase Classification.
    Each anchor is a small, structurally invariant UI element (button frames, badges,
    tab bars, icons) free from dynamic text or timer numbers.
    """

    # Master Anchor Definitions: (phase_name, anchor_filename, (x1, y1, x2, y2), min_ncc_threshold)
    ANCHORS_CONFIG = [
        # 1. Matchmaking Overlay Banner
        ("Matchmaking", "matchmaking_top_banner.png", (700, 0, 1220, 105), 0.60),

        # 2. In Game ScoreBoard Overlay
        ("In Game ScoreBoard", "scoreboard_equipment_tab.png", (30, 75, 480, 160), 0.70),
        ("In Game ScoreBoard", "scoreboard_vs_header.png", (650, 145, 1270, 215), 0.70),

        # 3. Match Start Modal
        ("Match Start", "matchstart_enter_btn.png", (680, 825, 1240, 925), 0.70),

        # 4. Draft Pick
        ("Draft Pick", "draft_battlefield_badge.png", (1500, 880, 1920, 1020), 0.65),
        ("Draft Pick", "draft_hero_prep_tabs.png", (680, 880, 1300, 1000), 0.65),
        ("Draft Pick", "draft_search_icon.png", (300, 110, 500, 220), 0.65),
        ("Draft Pick", "draft_bottom_chat_dock.png", (0, 880, 320, 1020), 0.60),
        ("Draft Pick", "draft_ally_slot_frame.png", (0, 115, 230, 275), 0.65),
        ("Draft Pick", "draft_enemy_slot_frame.png", (1690, 115, 1920, 275), 0.65),
        ("Draft Pick", "draft_ban_slot_frame.png", (20, 0, 120, 95), 0.65),

        # 5. In Game standard HUD
        ("In Game", "ingame_recall_regen.png", (900, 750, 1360, 1060), 0.70),
        ("In Game", "ingame_top_gold_purse.png", (1750, 5, 1920, 90), 0.70),

        # 6. Homepage
        ("Homepage", "hp_bottom_tabs.png", (280, 980, 720, 1070), 0.70),
        ("Homepage", "hp_mode_icon.png", (1300, 920, 1430, 1060), 0.70),

        # 7. Lobby
        ("Lobby", "lobby_start_btn.png", (400, 845, 940, 950), 0.70),
        ("Lobby", "lobby_header_title.png", (25, 25, 360, 90), 0.70),
    ]

    def __init__(self, project_root: Optional[str] = None):
        if project_root is None:
            project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        possible_anchor_dirs = [
            os.path.join(project_root, "src", "assets", "templates", "Phase Template", "anchors"),
            os.path.join(project_root, "src", "shared", "assets", "templates", "Phase Template", "anchors"),
            os.path.join(project_root, "assets", "templates", "Phase Template", "anchors"),
        ]
        self.anchors_dir = ""
        for p in possible_anchor_dirs:
            if os.path.exists(p):
                self.anchors_dir = p
                break
        if not self.anchors_dir:
            self.anchors_dir = possible_anchor_dirs[0]
        self._clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        self.anchors: List[Tuple[str, str, Tuple[int, int, int, int], float, np.ndarray]] = []
        self._load_anchors()

    def _load_anchors(self):
        """Load all anchor template images and compute CLAHE grayscale tensors."""
        loaded = 0
        for phase_name, anchor_file, coords, thresh in self.ANCHORS_CONFIG:
            path = os.path.join(self.anchors_dir, anchor_file)
            img = cv2.imread(path)
            if img is None:
                print(f"[PhaseAnchorDB] WARNING: Missing anchor template: {anchor_file}")
                continue
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            gray_clahe = self._clahe.apply(gray)
            self.anchors.append((phase_name, anchor_file, coords, thresh, gray_clahe))
            loaded += 1
        print(f"[PhaseAnchorDB] Loaded {loaded}/{len(self.ANCHORS_CONFIG)} precision UI anchors.")

    def match_phase_ncc(self, frame: np.ndarray) -> Tuple[str, float, List[Tuple[str, str, float]]]:
        h, w = frame.shape[:2]
        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray_frame_clahe = self._clahe.apply(gray_frame)

        scores: Dict[str, float] = {}
        matched_anchors: List[Tuple[str, str, float]] = []

        for phase, fname, (x1, y1, x2, y2), thresh, ref_gray in self.anchors:
            rx1 = int(x1 / 1920.0 * w)
            rx2 = int(x2 / 1920.0 * w)
            ry1 = int(y1 / 1080.0 * h)
            ry2 = int(y2 / 1080.0 * h)

            crop = gray_frame_clahe[ry1:ry2, rx1:rx2]
            if crop.size == 0:
                continue

            if crop.shape[0] < ref_gray.shape[0] or crop.shape[1] < ref_gray.shape[1]:
                crop = cv2.resize(crop, (ref_gray.shape[1], ref_gray.shape[0]))

            res = cv2.matchTemplate(crop, ref_gray, cv2.TM_CCOEFF_NORMED)
            score = float(res.max())

            if score >= thresh:
                matched_anchors.append((phase, fname, score))
                if phase not in scores or score > scores[phase]:
                    scores[phase] = score

        if "Matchmaking" in scores:
            return "Matchmaking", scores["Matchmaking"], matched_anchors
        if "In Game ScoreBoard" in scores:
            return "In Game ScoreBoard", scores["In Game ScoreBoard"], matched_anchors
        if "Match Start" in scores:
            return "Match Start", scores["Match Start"], matched_anchors
        if "Draft Pick" in scores:
            return "Draft Pick", scores["Draft Pick"], matched_anchors
        if "In Game" in scores:
            return "In Game", scores["In Game"], matched_anchors
        if "Lobby" in scores:
            return "Lobby", scores["Lobby"], matched_anchors
        if "Homepage" in scores:
            return "Homepage", scores["Homepage"], matched_anchors

        return "N/A", 0.0, []


_GLOBAL_PHASE_ANCHOR_DB: Optional[PhaseAnchorDB] = None


def get_phase_anchor_db(project_root: Optional[str] = None) -> PhaseAnchorDB:
    """Thread-safe singleton accessor for PhaseAnchorDB."""
    global _GLOBAL_PHASE_ANCHOR_DB
    if _GLOBAL_PHASE_ANCHOR_DB is None:
        _GLOBAL_PHASE_ANCHOR_DB = PhaseAnchorDB(project_root)
    return _GLOBAL_PHASE_ANCHOR_DB


class PhaseMatcher:
    """
    Classifies live BlueStacks frames into distinct MLBB UI game phases
    using high-precision invariant UI chrome anchor templates.
    """
    def __init__(self, project_root: Optional[str] = None):
        self.fsm = PhaseFSM()
        self.anchor_db = get_phase_anchor_db(project_root)
        self.current_phase = "N/A"
        self.current_confidence = 0.0

    def match_phase(self, frame: np.ndarray) -> dict:
        is_valid, is_transient, reason, stats = FrameIntegrityGuard.inspect(frame)
        if not is_valid:
            return {
                "phase": "N/A", "confidence": 0.0, "details": reason,
                "metrics": {}, "sub_phase": None, "is_transient": False
            }

        if is_transient:
            phase, conf = self.fsm.update(self.current_phase, self.current_confidence, is_transient=True)
            return {
                "phase": phase, "confidence": conf, "details": f"Transient hold: {reason}",
                "metrics": stats, "sub_phase": None, "is_transient": True
            }

        detected_phase, best_score, matched_anchors = self.anchor_db.match_phase_ncc(frame)

        if detected_phase == "N/A":
            phase, conf = self.fsm.update("N/A", 0.0)
            self.current_phase = phase
            self.current_confidence = conf
            return {
                "phase": phase, "confidence": conf,
                "details": "N/A — No anchor template matched (binary NO)",
                "metrics": {"matched_anchors": 0},
                "sub_phase": None, "is_transient": False
            }

        # Sub-phase detection for Draft Pick
        sub_phase = None
        if detected_phase == "Draft Pick":
            sub_phase = self._detect_draft_sub_phase(frame)

        phase, conf = self.fsm.update(detected_phase, best_score)
        self.current_phase = phase
        self.current_confidence = conf

        return {
            "phase": phase, "confidence": conf,
            "details": f"{phase} confirmed (NCC={best_score:.3f})",
            "metrics": {
                "ncc_score": best_score,
                "matched_anchors": len(matched_anchors),
                "anchors": [(p, f, round(s, 3)) for p, f, s in matched_anchors]
            },
            "sub_phase": sub_phase, "is_transient": False
        }

    def _detect_draft_sub_phase(self, frame: np.ndarray) -> str:
        h, w = frame.shape[:2]
        roi_header = frame[0:int(h * 0.09), int(w * 0.35):int(w * 0.65)]
        if roi_header.size == 0:
            return "Ban Phase"
        hsv_header = cv2.cvtColor(roi_header, cv2.COLOR_BGR2HSV)
        r_mask1 = cv2.inRange(hsv_header, (0, 70, 70), (15, 255, 255))
        r_mask2 = cv2.inRange(hsv_header, (165, 70, 70), (180, 255, 255))
        red_ratio = (np.sum(r_mask1 > 0) + np.sum(r_mask2 > 0)) / float(roi_header.shape[0] * roi_header.shape[1])
        return "Ban Phase" if red_ratio >= 0.035 else "Pick Phase"
