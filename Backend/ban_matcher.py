# =============================================================================
#   MLBB COMPANION — CIRCULAR BAN SLOT MATCHER (ban_matcher.py)
# =============================================================================
#   Role & Purpose in Project:
#     This file provides dedicated, high-precision computer vision logic for
#     detecting, extracting, and identifying the 10 circular ban slots at the
#     top of the MLBB draft screen (Slots 0..4 for Ally, Slots 5..9 for Enemy).
#     
#     Multi-Feature Vision Fusion:
#       1. Circular Masked CLAHE ZNCC (w1 = 0.60): Focuses on the inner core
#          (r = 30px from center) to eliminate outer bezel and ban slash borders.
#       2. HSV Color Histogram Correlation (w2 = 0.40): Verifies hue & saturation
#          distribution to prevent false matches between different colored heroes.
#       3. Robust Question Mark & Empty Slot Rejection:
#          Cross-references 'empty_ban_ally.png' and 'empty_ban_enemy.png' with NCC
#          template matching and strict confidence gating (threshold = 0.60).
#       4. 0-Duplicate Enforcement: Enforces unique hero bans across all 10 slots.
# =============================================================================

import os
import time
from collections import deque
from typing import Dict, List, Tuple, Optional, Set, Any
import cv2
import numpy as np


class BanMatcher:
    """
    Ultra-High-Precision Vision Classifier for Circular Ban Slots (80x80px at y=6px).
    Combines Circular Masked CLAHE ZNCC with 2D HSV Color Histogram Correlation.
    """
    def __init__(self, project_root: Optional[str] = None, threshold: float = 0.60):
        if project_root is None:
            project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.project_root = project_root
        self.threshold = threshold
        self.clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        self.temporal_buffers = {f"ban_{i}": deque(maxlen=5) for i in range(10)}
        self.last_confirmed = {f"ban_{i}": (None, 0.0) for i in range(10)}
        self.hold_seconds = 4.0

        # Circular mask: radius 30 from center (40, 40)
        self.mask = np.zeros((80, 80), dtype=np.uint8)
        cv2.circle(self.mask, (40, 40), 30, 255, -1)
        self.mask_indices = self.mask > 0
        self.n_pixels = int(np.sum(self.mask_indices))

        self._load_banks()

    def _extract_features(self, img: Optional[np.ndarray], dx: int = 0, dy: int = 0) -> Tuple[np.ndarray, np.ndarray]:
        if img is None or img.size == 0:
            return np.zeros(self.n_pixels, dtype=np.float32), np.zeros(128, dtype=np.float32)
        
        img_80 = cv2.resize(img, (80, 80))
        if dx != 0 or dy != 0:
            M = np.float32([[1, 0, dx], [0, 1, dy]])
            img_80 = cv2.warpAffine(img_80, M, (80, 80), borderMode=cv2.BORDER_REFLECT)

        gray = cv2.cvtColor(img_80, cv2.COLOR_BGR2GRAY) if len(img_80.shape) == 3 else img_80
        enh = self.clahe.apply(gray).astype(np.float32)
        masked_pixels = enh[self.mask_indices]
        mean_v = float(np.mean(masked_pixels))
        std_v = float(np.std(masked_pixels))
        if std_v < 1e-5:
            zncc_vec = np.zeros(self.n_pixels, dtype=np.float32)
        else:
            zncc_vec = (masked_pixels - mean_v) / std_v

        # HSV Color Histogram (16 Hue x 8 Saturation = 128 bins)
        if len(img_80.shape) == 3:
            hsv = cv2.cvtColor(img_80, cv2.COLOR_BGR2HSV)
            hist = cv2.calcHist([hsv], [0, 1], self.mask, [16, 8], [0, 180, 0, 256])
            cv2.normalize(hist, hist, alpha=0, beta=1, norm_type=cv2.NORM_MINMAX)
            hsv_vec = hist.flatten()
        else:
            hsv_vec = np.zeros(128, dtype=np.float32)

        return zncc_vec, hsv_vec

    def _load_banks(self):
        t0 = time.perf_counter()
        self.ban_hero_names: List[str] = []
        zncc_list = []
        hsv_list = []

        # 1. Base Round Heroes Directory
        ban_dir = os.path.join(self.project_root, "src", "assets", "heroes")
        if not os.path.exists(ban_dir):
            ban_dir = os.path.join(self.project_root, "src", "shared", "assets", "heroes")
        if not os.path.exists(ban_dir):
            ban_dir = os.path.join(self.project_root, "assets", "heroes")

        if os.path.exists(ban_dir):
            for f in sorted(os.listdir(ban_dir)):
                if f.lower().endswith(".png"):
                    hname = os.path.splitext(f)[0].lower()
                    if hname.startswith("question"):
                        continue
                    img = cv2.imread(os.path.join(ban_dir, f))
                    if img is not None:
                        self.ban_hero_names.append(hname)
                        z_vec, h_vec = self._extract_features(img)
                        zncc_list.append(z_vec)
                        hsv_list.append(h_vec)

        # 2. Dedicated Training Dataset for Bans
        training_ban_dir = os.path.join(self.project_root, "src", "assets", "training", "bans")
        if not os.path.exists(training_ban_dir):
            training_ban_dir = os.path.join(self.project_root, "src", "shared", "training", "bans")
        if os.path.exists(training_ban_dir):
            for f in sorted(os.listdir(training_ban_dir)):
                if f.lower().endswith(".png"):
                    hname = os.path.splitext(f)[0].lower().replace("ally_", "").replace("enemy_", "")
                    img = cv2.imread(os.path.join(training_ban_dir, f))
                    if img is not None:
                        self.ban_hero_names.append(hname)
                        z_vec, h_vec = self._extract_features(img)
                        zncc_list.append(z_vec)
                        hsv_list.append(h_vec)

        self.ban_zncc_matrix = np.vstack(zncc_list) if zncc_list else np.zeros((0, self.n_pixels), dtype=np.float32)
        
        # Pre-normalize HSV matrix for cosine/correlation dot products
        if hsv_list:
            raw_hsv = np.vstack(hsv_list)
            norms = np.linalg.norm(raw_hsv, axis=1, keepdims=True) + 1e-6
            self.ban_hsv_matrix = raw_hsv / norms
        else:
            self.ban_hsv_matrix = np.zeros((0, 128), dtype=np.float32)

        # 3. Empty Question Mark Ban Templates
        tpl_dir = os.path.join(self.project_root, "src", "assets", "templates")
        if not os.path.exists(tpl_dir):
            tpl_dir = os.path.join(self.project_root, "src", "shared", "assets", "templates")
        if not os.path.exists(tpl_dir):
            tpl_dir = os.path.join(self.project_root, "assets", "templates")

        p_ally = os.path.join(tpl_dir, "empty_ban_ally.png")
        p_enemy = os.path.join(tpl_dir, "empty_ban_enemy.png")

        self.empty_ban_ally_img = cv2.resize(cv2.imread(p_ally), (80, 80)) if os.path.exists(p_ally) else None
        self.empty_ban_enemy_img = cv2.resize(cv2.imread(p_enemy), (80, 80)) if os.path.exists(p_enemy) else None

        dt = (time.perf_counter() - t0) * 1000.0
        print(f"[BanMatcher] Pre-computed {len(self.ban_hero_names)} ban multi-feature templates in {dt:.1f}ms.")

    def match_bans(self, ban_rois: List[Dict[str, Any]], threshold: Optional[float] = None, top_k: int = 5) -> Tuple[List[Dict[str, Any]], float]:
        t0 = time.perf_counter()
        active_threshold = threshold if threshold is not None else self.threshold
        debug_array = []
        taken_bans: Set[str] = set()

        for i, roi in enumerate(ban_rois):
            crop = roi.get("crop")
            side = roi.get("side", "ally")
            bbox = roi.get("bbox", (0, 0, 80, 80))
            roi_key = roi.get("roi_key", f"{side}_ban_{i}")

            if crop is None or crop.size == 0 or np.mean(crop) < 10.0 or np.std(crop) < 7.0:
                debug_array.append({
                    "slot_index": i, "side": side, "roi_key": roi_key, "bbox": bbox,
                    "matched_hero": None, "confidence": 0.0,
                    "rejection_reason": "DARK_OR_EMPTY_SLOT", "empty_similarity": 0.0,
                    "top_k_candidates": []
                })
                continue

            crop_80 = cv2.resize(crop, (80, 80))

            # 1. Template-based Empty Question Mark Slot Detection
            e_sim = 0.0
            if side == "ally" and self.empty_ban_ally_img is not None:
                res = cv2.matchTemplate(crop_80, self.empty_ban_ally_img, cv2.TM_CCOEFF_NORMED)
                e_sim = float(res[0, 0])
            elif side == "enemy" and self.empty_ban_enemy_img is not None:
                res = cv2.matchTemplate(crop_80, self.empty_ban_enemy_img, cv2.TM_CCOEFF_NORMED)
                e_sim = float(res[0, 0])

            if e_sim >= 0.45:
                debug_array.append({
                    "slot_index": i, "side": side, "roi_key": roi_key, "bbox": bbox,
                    "matched_hero": None, "confidence": 0.0,
                    "rejection_reason": "EMPTY_QUESTION_SLOT", "empty_similarity": round(e_sim, 4),
                    "top_k_candidates": []
                })
                continue

            # 2. Multi-Offset Peak Jitter Search for ban slot alignment
            best_fused = None
            best_zncc = None
            best_hsv = None

            offsets = [(0, 0), (-3, 0), (+3, 0), (0, -3), (0, +3), (-6, 0), (+6, 0), (-3, -3), (+3, -3)]
            for dx, dy in offsets:
                q_zncc, q_hsv = self._extract_features(crop, dx=dx, dy=dy)
                z_scores = np.dot(self.ban_zncc_matrix, q_zncc) / float(self.n_pixels)
                q_hsv_norm = q_hsv / (np.linalg.norm(q_hsv) + 1e-6)
                h_scores = np.dot(self.ban_hsv_matrix, q_hsv_norm)
                f_scores = 0.60 * z_scores + 0.40 * np.maximum(0.0, h_scores)

                if best_fused is None or np.max(f_scores) > np.max(best_fused):
                    best_fused = f_scores
                    best_zncc = z_scores
                    best_hsv = h_scores

            order = np.argsort(best_fused)[::-1]
            cands = []
            seen_heroes = set()
            for idx in order:
                idx = int(idx)
                hn = self.ban_hero_names[idx]
                if hn in seen_heroes:
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

            top_cand = cands[0] if cands else {"hero": "none", "score": 0.0}
            matched = None
            rej = None

            if top_cand["score"] < active_threshold:
                rej = "LOW_CONFIDENCE"
            elif top_cand["hero"] in taken_bans:
                # Pick next non-duplicate candidate if score is solid
                found_next = False
                for alt in cands[1:]:
                    if alt["hero"] not in taken_bans and alt["score"] >= active_threshold:
                        matched = alt["hero"]
                        top_cand = alt
                        taken_bans.add(matched)
                        found_next = True
                        break
                if not found_next:
                    rej = "DUPLICATE_BAN_PREVENTED"
            else:
                matched = top_cand["hero"]
                taken_bans.add(matched)

            debug_array.append({
                "slot_index": i, "side": side, "roi_key": roi_key, "bbox": bbox,
                "matched_hero": matched,
                "confidence": top_cand["score"] if matched else 0.0,
                "rejection_reason": rej,
                "empty_similarity": round(e_sim, 4),
                "top_k_candidates": cands
            })

        dt = (time.perf_counter() - t0) * 1000.0
        return debug_array, dt

    def match_slot(self, slot_crop: np.ndarray, slot_idx: int, taken_bans: Optional[Set[str]] = None, is_stream: bool = False) -> Tuple[Optional[str], float]:
        if slot_crop is None or slot_crop.size == 0:
            if is_stream:
                slot_key = f"ban_{slot_idx}"
                buf = self.temporal_buffers[slot_key]
                buf.append((None, 0.0, time.time()))
                if sum(1 for h, _, _ in buf if h is None) >= 3:
                    self.last_confirmed[slot_key] = (None, 0.0)
                    return None, 0.0
                return self.last_confirmed.get(slot_key, (None, 0.0))
            return None, 0.0

        side = "ally" if slot_idx < 5 else "enemy"
        roi = {"crop": slot_crop, "side": side, "roi_key": f"{side}_ban_{slot_idx}"}
        res_list, _ = self.match_bans([roi], threshold=self.threshold, top_k=5)
        top = res_list[0] if res_list else {}
        matched = top.get("matched_hero")
        conf = top.get("confidence", 0.0)

        if is_stream:
            slot_key = f"ban_{slot_idx}"
            buf = self.temporal_buffers[slot_key]
            now = time.time()
            if matched and conf >= self.threshold:
                buf.append((matched, conf, now))
            else:
                buf.append((None, 0.0, now))

            if sum(1 for h, _, _ in buf if h is None) >= 3:
                self.last_confirmed[slot_key] = (None, 0.0)
                return None, 0.0

            hero_scores: Dict[str, float] = {}
            for h, s, t in buf:
                if h and (now - t) <= self.hold_seconds:
                    hero_scores[h] = max(hero_scores.get(h, 0.0), s)

            if hero_scores:
                peak_hero = max(hero_scores, key=hero_scores.get)
                self.last_confirmed[slot_key] = (peak_hero, hero_scores[peak_hero])
                return peak_hero, hero_scores[peak_hero]

            self.last_confirmed[slot_key] = (None, 0.0)
            return None, 0.0

        return matched, conf

    def reset_buffers(self):
        for buf in self.temporal_buffers.values():
            buf.clear()
        for k in self.last_confirmed:
            self.last_confirmed[k] = (None, 0.0)
