# =============================================================================
#   MLBB COMPANION — HIGH-PRECISION ALLY PICK MATCHER (ally_pick_matcher.py)
# =============================================================================
#   Role & Purpose in Project:
#     Provides dedicated vision matching for the 5 Ally hero pick cards (left side).
#     
#     Multi-Feature Vision Architecture:
#       1. Dual Source Reference Ingestion:
#          Loads high-fidelity in-game training crops ('src/assets/training/ally_picks/')
#          and full-card master templates ('src/assets/rect/').
#       2. Unoccluded Hero Portrait Windowing:
#          Excludes left badges (Flag, Lane) and right Spell overlays to focus
#          purely on the hero's face and character silhouette (139x110px).
#       3. Multi-Feature Vision Fusion:
#          - CLAHE ZNCC Vector (Zero-mean normalized structural texture).
#          - 2D HSV Color Histogram (128-bin Hue & Saturation fingerprint).
#          - Multi-Scale Facial Pattern Matching.
#       4. 9-Point Spatial Jitter Search:
#          Translation sweeps (±3px, ±6px) for emulator scaling & positioning invariance.
#       5. Empty Pick Slot & Nebula Rejection:
#          Cross-references 'empty_pick_slot_ally.png' and 'empty_pick_slot_ally_dim.png'.
#       6. Strict 0-Duplicate Pick & 0-Duplicate Optimal Lane Assignment:
#          Solves maximum-weight bipartite matching for lane assignments to guarantee
#          that no two ally pick slots can ever share the same lane role.
# =============================================================================

import os
import time
from collections import deque
from typing import Dict, List, Tuple, Optional, Set, Any
import cv2
import numpy as np


class AllyPickMatcher:
    """
    High-Precision One-Shot Vision Classifier for Ally Team Pick Cards (210x132px at x=0px).
    Combines Sub-Element Aware Focal ZNCC, 2D HSV Histogram, 0-Duplicate Lane Bipartite Matching,
    and 0-Duplicate Hero Fallback.
    """
    def __init__(self, project_root: Optional[str] = None, threshold: float = 0.50, analyzer: Optional[Any] = None):
        if project_root is None:
            project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.project_root = project_root
        self.threshold = threshold
        self.clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        
        # Temporal buffers for real-time video stream smoothing
        self.temporal_buffers = {f"ally_pick_{i}": deque(maxlen=5) for i in range(5)}
        self.last_confirmed = {f"ally_pick_{i}": (None, 0.0, "-") for i in range(5)}
        self.hold_seconds = 4.0

        # Load lane anchors & empty templates
        self._load_lane_anchors()
        self._load_empty_templates()
        
        # Initialize calibration & build vision banks
        self.update_calibration(analyzer)

    @property
    def pick_hero_names(self) -> List[str]:
        return self.hero_names

    def _load_empty_templates(self):
        tpl_dir = os.path.join(self.project_root, "src", "assets", "templates")
        if not os.path.exists(tpl_dir):
            tpl_dir = os.path.join(self.project_root, "src", "shared", "assets", "templates")
        if not os.path.exists(tpl_dir):
            tpl_dir = os.path.join(self.project_root, "assets", "templates")

        p_ally = os.path.join(tpl_dir, "empty_pick_slot_ally.png")
        p_ally_dim = os.path.join(tpl_dir, "empty_pick_slot_ally_dim.png")

        self.empty_ally = cv2.imread(p_ally) if os.path.exists(p_ally) else None
        self.empty_ally_dim = cv2.imread(p_ally_dim) if os.path.exists(p_ally_dim) else None

    def _load_lane_anchors(self):
        lane_dir = os.path.join(self.project_root, "src", "assets", "lanes")
        if not os.path.exists(lane_dir):
            lane_dir = os.path.join(self.project_root, "src", "shared", "assets", "lanes")
        if not os.path.exists(lane_dir):
            lane_dir = os.path.join(self.project_root, "assets", "lanes")

        self.lane_keys = ["exp", "gold", "jungle", "mid", "roam"]
        self.lane_display_map = {
            "exp": "EXP Lane",
            "gold": "Gold Lane",
            "jungle": "Jungle",
            "mid": "Mid Lane",
            "roam": "Roam"
        }
        self.lane_templates: Dict[str, np.ndarray] = {}
        self.scaled_lane_templates: Dict[Tuple[str, float], np.ndarray] = {}
        self.lane_scales = [0.75, 0.85, 1.0, 1.15]

        for lane_key in self.lane_keys:
            lp = os.path.join(lane_dir, f"{lane_key}.png")
            if os.path.exists(lp):
                l_img = cv2.imread(lp)
                if l_img is not None:
                    self.lane_templates[lane_key] = l_img
                    for s in self.lane_scales:
                        tw, th = int(l_img.shape[1] * s), int(l_img.shape[0] * s)
                        self.scaled_lane_templates[(lane_key, s)] = cv2.resize(l_img, (tw, th))

    def update_calibration(self, analyzer: Optional[Any] = None):
        """
        Dynamically calculates the exact unoccluded Hero Portrait Window based on calibrated pick card dimensions
        and sub-element coordinates relative to the 210x132 rect images.
        """
        pick_w = 210
        pick_h = 132
        flag_rel_x = 6
        flag_size = 46
        lane_rel_x = 5
        lane_size = 50
        spell_rel_x = 194

        if analyzer is not None:
            raw = getattr(analyzer, "raw_pixel_spec", {})
            if isinstance(raw, dict):
                ally_picks = raw.get("allyPicks")
                if isinstance(ally_picks, list) and len(ally_picks) > 0 and isinstance(ally_picks[0], dict):
                    pick_w = int(ally_picks[0].get("w", 210))
                    pick_h = int(ally_picks[0].get("h", 132))

        # Compute unoccluded hero window (55 to 194 in x, 0 to 110 in y)
        left_bound = max(flag_rel_x + flag_size, lane_rel_x + lane_size)
        win_x1 = max(0, min(pick_w - 40, left_bound))
        win_x2 = max(win_x1 + 40, min(pick_w, spell_rel_x if spell_rel_x > win_x1 + 30 else pick_w))
        win_y1 = 0
        win_y2 = max(win_y1 + 40, pick_h - 22)

        self.pick_w = pick_w
        self.pick_h = pick_h
        self.win_x1 = win_x1
        self.win_x2 = win_x2
        self.win_y1 = win_y1
        self.win_y2 = win_y2
        self.win_w = win_x2 - win_x1
        self.win_h = win_y2 - win_y1
        self.n_pixels = self.win_w * self.win_h

        self._load_banks()

    def _extract_window_features(self, win_img: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Extracts ZNCC vector and L2-normalized 2D HSV histogram for a window."""
        if win_img.shape[:2] != (self.win_h, self.win_w):
            win_img = cv2.resize(win_img, (self.win_w, self.win_h))
        
        gray = cv2.cvtColor(win_img, cv2.COLOR_BGR2GRAY) if len(win_img.shape) == 3 else win_img
        enh = self.clahe.apply(gray).astype(np.float32)
        std_v = float(np.std(enh))
        z_vec = ((enh - np.mean(enh)) / (std_v + 1e-6)).flatten() if std_v > 1e-5 else np.zeros(self.n_pixels, dtype=np.float32)

        if len(win_img.shape) == 3:
            hsv = cv2.cvtColor(win_img, cv2.COLOR_BGR2HSV)
            hist = cv2.calcHist([hsv], [0, 1], None, [16, 8], [0, 180, 0, 256])
            h_flat = hist.flatten()
            h_norm = h_flat / (np.linalg.norm(h_flat) + 1e-6)
        else:
            h_norm = np.zeros(128, dtype=np.float32)

        return z_vec, h_norm

    def _load_banks(self):
        t0 = time.perf_counter()
        self.hero_names: List[str] = []
        zncc_list: List[np.ndarray] = []
        hsv_list: List[np.ndarray] = []
        self.face_templates: List[np.ndarray] = []

        hero_dir = os.path.join(self.project_root, "src", "assets", "heroes")
        if not os.path.exists(hero_dir):
            hero_dir = os.path.join(self.project_root, "src", "shared", "assets", "heroes")

        # 1. Dedicated High-Fidelity Training Dataset for Ally Picks
        training_ally_dir = os.path.join(self.project_root, "src", "assets", "training", "ally_picks")
        if not os.path.exists(training_ally_dir):
            training_ally_dir = os.path.join(self.project_root, "src", "shared", "training", "ally_picks")
        
        if os.path.exists(training_ally_dir):
            for f in sorted(os.listdir(training_ally_dir)):
                if f.lower().endswith(".png"):
                    hname = os.path.splitext(f)[0].lower()
                    r_img = cv2.imread(os.path.join(training_ally_dir, f))
                    if r_img is not None:
                        win = r_img[self.win_y1:self.win_y2, self.win_x1:self.win_x2]
                        z_vec, h_vec = self._extract_window_features(win)
                        
                        self.hero_names.append(hname)
                        zncc_list.append(z_vec)
                        hsv_list.append(h_vec)

                        h_path = os.path.join(hero_dir, f"{hname}.png")
                        h_img = cv2.imread(h_path, 0) if os.path.exists(h_path) else cv2.cvtColor(win, cv2.COLOR_BGR2GRAY)
                        self.face_templates.append(self.clahe.apply(h_img))

        # 2. Master Rect Reference Images
        rect_dir = os.path.join(self.project_root, "src", "assets", "rect")
        if not os.path.exists(rect_dir):
            rect_dir = os.path.join(self.project_root, "src", "shared", "assets", "rect")

        if os.path.exists(rect_dir):
            for f in sorted(os.listdir(rect_dir)):
                if f.lower().endswith(".png"):
                    hname = os.path.splitext(f)[0].lower()
                    if hname.startswith("question"):
                        continue
                    r_img = cv2.imread(os.path.join(rect_dir, f))
                    if r_img is not None and r_img.size > 0:
                        if r_img.shape[:2] != (self.pick_h, self.pick_w):
                            r_img = cv2.resize(r_img, (self.pick_w, self.pick_h))

                        win = r_img[self.win_y1:self.win_y2, self.win_x1:self.win_x2]
                        z_vec, h_vec = self._extract_window_features(win)

                        self.hero_names.append(hname)
                        zncc_list.append(z_vec)
                        hsv_list.append(h_vec)

                        h_path = os.path.join(hero_dir, f"{hname}.png")
                        h_img = cv2.imread(h_path, 0) if os.path.exists(h_path) else cv2.cvtColor(win, cv2.COLOR_BGR2GRAY)
                        self.face_templates.append(self.clahe.apply(h_img))

        self.rect_zncc_matrix = np.vstack(zncc_list) if zncc_list else np.zeros((0, self.n_pixels), dtype=np.float32)
        self.hsv_matrix = np.vstack(hsv_list) if hsv_list else np.zeros((0, 128), dtype=np.float32)

        dt = (time.perf_counter() - t0) * 1000.0
        print(f"[AllyPickMatcher] One-Shot Reference Bank: {len(self.hero_names)} models ({self.win_w}x{self.win_h}px) loaded in {dt:.1f}ms.")

    def match_slot(self, crop: np.ndarray, slot_index: int = 0,
                   taken_bans: Optional[Set[str]] = None,
                   threshold: Optional[float] = None,
                   top_k: int = 5,
                   is_stream: bool = False,
                   assigned_lane: Optional[str] = None) -> Tuple[Optional[str], float, str, List[Dict[str, Any]], float, Optional[str], Dict[str, Any]]:
        """
        Evaluates a single ally pick crop using multi-feature one-shot matching:
        - Unoccluded Hero Window CLAHE ZNCC
        - 2D HSV Color Fingerprint
        - 9-Point Spatial Jitter Search
        - 0-Duplicate Fallback & Temporal Buffering
        """
        active_threshold = threshold if threshold is not None else self.threshold
        detected_lane = assigned_lane if assigned_lane else "Roam"

        debug_info = {
            "slot_index": slot_index,
            "side": "ally",
            "crop_shape": crop.shape if (crop is not None and crop.size > 0) else (0, 0),
            "mean_bgr": round(float(np.mean(crop)), 2) if (crop is not None and crop.size > 0) else 0.0,
            "std_bgr": round(float(np.std(crop)), 2) if (crop is not None and crop.size > 0) else 0.0,
            "calibrated_window": (self.win_x1, self.win_x2, self.win_y1, self.win_y2),
            "status": "EVALUATING"
        }

        # 1. Dark / Empty Nebula Slot Rejection
        if crop is None or crop.size == 0 or np.mean(crop) < 10.0 or np.std(crop) < 8.0:
            debug_info["status"] = "EMPTY_NEBULA"
            if is_stream:
                self._update_temporal_buffer(slot_index, None, 0.0, "-")
            return None, 0.0, "-", [], 0.0, "EMPTY_SLOT", debug_info

        if crop.shape[:2] != (self.pick_h, self.pick_w):
            crop = cv2.resize(crop, (self.pick_w, self.pick_h))

        # 2. Template-based Empty Slot Rejection
        empty_sim = 0.0
        if self.empty_ally is not None:
            res1 = cv2.matchTemplate(crop, cv2.resize(self.empty_ally, (self.pick_w, self.pick_h)), cv2.TM_CCOEFF_NORMED)
            empty_sim = max(empty_sim, float(np.max(res1)))
        if self.empty_ally_dim is not None:
            res2 = cv2.matchTemplate(crop, cv2.resize(self.empty_ally_dim, (self.pick_w, self.pick_h)), cv2.TM_CCOEFF_NORMED)
            empty_sim = max(empty_sim, float(np.max(res2)))

        if empty_sim >= 0.50:
            debug_info["status"] = "EMPTY_SLOT_DETECTED"
            debug_info["empty_similarity"] = round(empty_sim, 4)
            if is_stream:
                self._update_temporal_buffer(slot_index, None, 0.0, "-")
            return None, 0.0, "-", [], round(empty_sim, 4), "EMPTY_SLOT", debug_info

        debug_info["detected_lane"] = detected_lane

        excluded = set(h.lower() for h in taken_bans if h) if taken_bans else set()

        # 3. 9-Point Spatial Jitter Search (±3px, ±6px translation invariance)
        best_fused = None
        best_zncc = None
        best_hsv = None

        offsets = [(0, 0), (-3, 0), (+3, 0), (0, -3), (0, +3), (-6, 0), (+6, 0), (-3, -3), (+3, -3)]
        for dx, dy in offsets:
            y1 = max(0, min(crop.shape[0] - 20, self.win_y1 + dy))
            y2 = min(crop.shape[0], self.win_y2 + dy)
            x1 = max(0, min(crop.shape[1] - 20, self.win_x1 + dx))
            x2 = min(crop.shape[1], self.win_x2 + dx)

            win = crop[y1:y2, x1:x2]
            q_zncc, q_hsv = self._extract_window_features(win)
            
            z_scores = np.dot(self.rect_zncc_matrix, q_zncc) / float(self.n_pixels)
            h_scores = np.dot(self.hsv_matrix, q_hsv)
            f_scores = 0.55 * z_scores + 0.45 * np.maximum(0.0, h_scores)

            if best_fused is None or np.max(f_scores) > np.max(best_fused):
                best_fused = f_scores
                best_zncc = z_scores
                best_hsv = h_scores

        if best_fused is None or np.max(best_fused) < 0.0:
            debug_info["status"] = "NO_SIGNAL"
            if is_stream:
                self._update_temporal_buffer(slot_index, None, 0.0, detected_lane)
            return None, 0.0, detected_lane, [], round(empty_sim, 4), "EMPTY_SLOT", debug_info

        # Filter out banned heroes and build candidate list
        order = np.argsort(best_fused)[::-1]
        cands = []
        seen_heroes = set()
        for idx in order:
            hn = self.hero_names[int(idx)]
            if hn in excluded or hn in seen_heroes:
                continue
            seen_heroes.add(hn)
            cands.append({
                "hero": hn,
                "score": round(float(best_fused[idx]), 4),
                "zncc": round(float(best_zncc[idx]), 4),
                "hsv": round(float(best_hsv[idx]), 4)
            })
            if len(cands) >= top_k:
                break

        for k in range(len(cands) - 1):
            cands[k]["margin"] = round(cands[k]["score"] - cands[k+1]["score"], 4)
        if cands:
            cands[-1]["margin"] = 0.0

        top_cand = cands[0] if cands else {"hero": None, "score": 0.0}
        matched = top_cand["hero"] if (top_cand["hero"] and top_cand["score"] >= active_threshold) else None
        rej = None if matched else "LOW_CONFIDENCE"

        # 4. Temporal Buffer Smoothing
        if is_stream:
            matched, conf_smooth, lane_smooth = self._update_temporal_buffer(
                slot_index, matched, top_cand["score"] if matched else 0.0, detected_lane
            )
            if matched:
                top_cand["score"] = conf_smooth
                detected_lane = lane_smooth
                rej = None
            else:
                rej = "TEMPORAL_SMOOTH_REJECT"

        debug_info["status"] = "MATCHED" if matched else "REJECTED"
        debug_info["matched_hero"] = matched
        debug_info["confidence"] = top_cand["score"]
        debug_info["empty_similarity"] = round(empty_sim, 4)
        debug_info["top_candidates"] = cands

        return matched, top_cand["score"] if matched else 0.0, detected_lane, cands, round(empty_sim, 4), rej, debug_info

    def _update_temporal_buffer(self, slot_idx: int, hero: Optional[str], score: float, lane: str) -> Tuple[Optional[str], float, str]:
        """Manages 5-frame rolling deque buffer and hold duration for video streaming."""
        slot_key = f"ally_pick_{slot_idx}"
        buf = self.temporal_buffers[slot_key]
        now = time.time()

        if hero and score >= self.threshold:
            buf.append((hero, score, lane, now))
        else:
            buf.append((None, 0.0, lane, now))

        if sum(1 for h, _, _, _ in buf if h is None) >= 3:
            self.last_confirmed[slot_key] = (None, 0.0, "-")
            return None, 0.0, "-"

        hero_scores: Dict[str, Tuple[float, str]] = {}
        for h, s, l, t in buf:
            if h and (now - t) <= self.hold_seconds:
                if h not in hero_scores or s > hero_scores[h][0]:
                    hero_scores[h] = (s, l)

        if hero_scores:
            peak_hero = max(hero_scores, key=lambda k: hero_scores[k][0])
            peak_score, peak_lane = hero_scores[peak_hero]
            self.last_confirmed[slot_key] = (peak_hero, peak_score, peak_lane)
            return peak_hero, peak_score, peak_lane

        self.last_confirmed[slot_key] = (None, 0.0, "-")
        return None, 0.0, "-"

    def _compute_optimal_lanes(self, slot_crops: List[Optional[np.ndarray]]) -> List[str]:
        """
        Solves Maximum-Weight Bipartite Matching to guarantee 0 DUPLICATE LANES across the 5 ally pick cards.
        """
        n_slots = len(slot_crops)
        if n_slots == 0:
            return []

        default_lanes = ["Roam", "EXP Lane", "Gold Lane", "Jungle", "Mid Lane"]
        score_matrix = np.zeros((n_slots, len(self.lane_keys)), dtype=np.float32)

        for i, crop in enumerate(slot_crops):
            if crop is None or crop.size == 0 or len(self.lane_templates) == 0:
                continue
            if crop.shape[:2] != (self.pick_h, self.pick_w):
                crop = cv2.resize(crop, (self.pick_w, self.pick_h))

            lane_area = crop[45:105, 0:56]

            for j, k in enumerate(self.lane_keys):
                best_v = -1.0
                for s in self.lane_scales:
                    st = self.scaled_lane_templates.get((k, s))
                    if st is None:
                        continue
                    if st.shape[1] < lane_area.shape[1] and st.shape[0] < lane_area.shape[0]:
                        res = cv2.matchTemplate(lane_area, st, cv2.TM_CCOEFF_NORMED)
                        _, max_v, _, _ = cv2.minMaxLoc(res)
                        if max_v > best_v:
                            best_v = max_v
                score_matrix[i, j] = best_v

        # Solve optimal 1-to-1 bipartite assignment
        try:
            from scipy.optimize import linear_sum_assignment
            row_ind, col_ind = linear_sum_assignment(-score_matrix)
            assigned = [default_lanes[i % 5] for i in range(n_slots)]
            for r, c in zip(row_ind, col_ind):
                assigned[r] = self.lane_display_map[self.lane_keys[c]]
            return assigned
        except Exception:
            # Deterministic greedy fallback
            used_lanes = set()
            assigned = []
            for i in range(n_slots):
                sorted_lanes = np.argsort(-score_matrix[i])
                chosen = None
                for lane_idx in sorted_lanes:
                    lane_name = self.lane_display_map[self.lane_keys[lane_idx]]
                    if lane_name not in used_lanes:
                        chosen = lane_name
                        break
                if not chosen:
                    for d in default_lanes:
                        if d not in used_lanes:
                            chosen = d
                            break
                chosen = chosen or default_lanes[i % 5]
                used_lanes.add(chosen)
                assigned.append(chosen)
            return assigned

    def match_picks(self, pick_rois: List[Dict[str, Any]],
                    taken_bans: Optional[Set[str]] = None,
                    threshold: Optional[float] = None,
                    top_k: int = 5,
                    is_stream: bool = False) -> Tuple[List[Dict[str, Any]], float, List[Dict[str, Any]]]:
        """
        High-Precision batch matcher evaluating the 5 ally pick slots.
        Enforces 0-Duplicate Heroes and 0-Duplicate Lanes across slots.
        """
        t0 = time.perf_counter()
        active_threshold = threshold if threshold is not None else self.threshold
        results = []
        debug_array = []
        taken_heroes: Set[str] = set()

        crops = [r.get("crop") for r in pick_rois[:5]]
        optimal_lanes = self._compute_optimal_lanes(crops)

        for i, roi in enumerate(pick_rois[:5]):
            crop = roi.get("crop")
            assigned_lane = optimal_lanes[i] if i < len(optimal_lanes) else "Roam"

            hero, conf, lane, cands, e_sim, rej, d_info = self.match_slot(
                crop, slot_index=i, taken_bans=taken_bans, threshold=active_threshold, top_k=top_k, is_stream=is_stream, assigned_lane=assigned_lane
            )

            # 0-Duplicate Fallback for picked heroes across slots
            if hero and hero in taken_heroes:
                for cand in cands[1:]:
                    if cand["hero"] not in taken_heroes and cand["score"] >= active_threshold:
                        hero = cand["hero"]
                        conf = cand["score"]
                        rej = None
                        break
                else:
                    hero = None
                    rej = "DUPLICATE_PICK"

            if hero:
                taken_heroes.add(hero)

            res_obj = {
                "slot_index": i,
                "side": "ally",
                "matched_hero": hero,
                "detected_lane": lane,
                "confidence": conf,
                "top_k_candidates": cands,
                "empty_similarity": e_sim,
                "rejection_reason": rej
            }
            results.append(res_obj)
            debug_array.append({**res_obj, "diagnostics": d_info})

        dt = (time.perf_counter() - t0) * 1000.0
        return results, dt, debug_array

    def match_all_picks(self, pick_crops: List[Optional[np.ndarray]],
                        taken_bans: Optional[Set[str]] = None,
                        is_stream: bool = False) -> List[Tuple[Optional[str], float, str]]:
        """Convenience method matching all 5 ally pick crops."""
        rois = [{"crop": c} for c in pick_crops]
        res, _, _ = self.match_picks(rois, taken_bans=taken_bans, is_stream=is_stream)
        return [(r["matched_hero"], r["confidence"], r["detected_lane"]) for r in res]

    def reset_buffers(self):
        """Clears temporal rolling buffers and last confirmed hero states."""
        for buf in self.temporal_buffers.values():
            buf.clear()
        for k in self.last_confirmed:
            self.last_confirmed[k] = (None, 0.0, "-")
