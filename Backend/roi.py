# =============================================================================
#   MLBB COMPANION — COORDINATE & ROI ANCHOR SYSTEM (roi.py)
# =============================================================================
#   Role & Purpose in Project:
#     This file defines normalized layout geometry and safe memory-slicing functions
#     for extracting Regions of Interest (ROIs) from 1920x1080 MLBB game frames.
#     
#     Key Components:
#       1. DEFAULT_ROIS: Pixel-perfect normalized (0.0..1.0) coordinates for all 10
#          ban slots (80x80px at y=6px) and 10 pick slots (210x132px at y=125, 298, 470, 642, 814px)
#          strictly conforming to 'src/assets/docs/Draft Pick Template Fixed Slots Coordination.txt'.
#       2. ScreenAnalyzer: Manages custom calibration overrides from 'rois_config.json'
#          and handles bounds-checked frame slicing without disk I/O.
#       3. Dedicated Extractors:
#          - extract_ban_regions(): Returns 10 circular ban crops with mean/std stats.
#          - extract_pick_regions(): Returns 10 rectangular pick crops with Canny edge density.
#          - extract_lane_regions(): Returns 10 lane badge crops (38x38px).
# =============================================================================

import os
import json
from typing import Dict, List, Tuple, Optional, Any
import cv2
import numpy as np

DEFAULT_ROIS = {
    # 1. Ally Round Ban Hero Icon Placeholder Positions (80x80px at y=6px, 30px gap):
    "ally_ban_0":  (30/1920, 6/1080, 80/1920, 80/1080),     # Slot 1: 30px from left, 6px from top
    "ally_ban_1":  (140/1920, 6/1080, 80/1920, 80/1080),    # Slot 2: 140px from left, 6px from top
    "ally_ban_2":  (250/1920, 6/1080, 80/1920, 80/1080),    # Slot 3: 250px from left, 6px from top
    "ally_ban_3":  (360/1920, 6/1080, 80/1920, 80/1080),    # Slot 4: 360px from left, 6px from top
    "ally_ban_4":  (470/1920, 6/1080, 80/1920, 80/1080),    # Slot 5: 470px from left, 6px from top

    # 2. Enemy Round Ban Hero Icon Placeholder Positions (80x80px at y=6px, 30px gap):
    "enemy_ban_0": (1370/1920, 6/1080, 80/1920, 80/1080),   # Slot 6: 1370px from left, 6px from top
    "enemy_ban_1": (1480/1920, 6/1080, 80/1920, 80/1080),   # Slot 7: 1480px from left, 6px from top
    "enemy_ban_2": (1590/1920, 6/1080, 80/1920, 80/1080),   # Slot 8: 1590px from left, 6px from top
    "enemy_ban_3": (1700/1920, 6/1080, 80/1920, 80/1080),   # Slot 9: 1700px from left, 6px from top
    "enemy_ban_4": (1810/1920, 6/1080, 80/1920, 80/1080),   # Slot 10: 1810px from left, 6px from top

    # 3. Ally Team Rectangle Hero Pick Icon Placeholder Positions (210x132px, x=0px):
    "ally_pick_0": (0/1920, 125/1080, 210/1920, 132/1080),  # Slot 1: 0px from left, 125px from top
    "ally_pick_1": (0/1920, 298/1080, 210/1920, 132/1080),  # Slot 2: 0px from left, 298px from top
    "ally_pick_2": (0/1920, 470/1080, 210/1920, 132/1080),  # Slot 3: 0px from left, 470px from top
    "ally_pick_3": (0/1920, 642/1080, 210/1920, 132/1080),  # Slot 4: 0px from left, 642px from top
    "ally_pick_4": (0/1920, 814/1080, 210/1920, 132/1080),  # Slot 5: 0px from left, 814px from top

    # 4. Enemy Team Rectangle Hero Pick Icon Placeholder Positions (210x132px, x=1710px):
    "enemy_pick_0": (1710/1920, 125/1080, 210/1920, 132/1080), # Slot 6: 1710px from left, 125px from top
    "enemy_pick_1": (1710/1920, 298/1080, 210/1920, 132/1080), # Slot 7: 1710px from left, 298px from top
    "enemy_pick_2": (1710/1920, 470/1080, 210/1920, 132/1080), # Slot 8: 1710px from left, 470px from top
    "enemy_pick_3": (1710/1920, 642/1080, 210/1920, 132/1080), # Slot 9: 1710px from left, 642px from top
    "enemy_pick_4": (1710/1920, 814/1080, 210/1920, 132/1080), # Slot 10: 1710px from left, 814px from top
}


class ScreenAnalyzer:
    """Manages normalized ROI coordinates and safe frame slicing for MLBB 1920x1080 layout."""
    def __init__(self, config_path: Optional[str] = None):
        if config_path is None:
            backend_dir = os.path.dirname(os.path.abspath(__file__))
            config_path = os.path.join(backend_dir, "rois_config.json")
        self.config_path = config_path
        self.rois = dict(DEFAULT_ROIS)
        self.thresholds = {
            "pick_threshold": 0.50,
            "ban_threshold": 0.60,
            "item_threshold": 0.50,
            "empty_slot_std": 12.0,
            "mirror_check": True,
            "clahe_clip_limit": 2.0,
            "clahe_tile_grid": 8
        }
        self.load_config()

    def load_config(self):
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        if "rois" in data and isinstance(data["rois"], dict):
                            self.rois.update(data["rois"])
                        else:
                            self.rois.update({k: v for k, v in data.items() if isinstance(v, (list, tuple))})
                        if "thresholds" in data and isinstance(data["thresholds"], dict):
                            self.thresholds.update(data["thresholds"])
                        if "raw_pixel_spec" in data and isinstance(data["raw_pixel_spec"], dict):
                            self.raw_pixel_spec = data["raw_pixel_spec"]
            except Exception as e:
                print(f"[ScreenAnalyzer] Error loading custom ROIs config: {e}")

    def save_config(self, config_path: Optional[str] = None):
        target = config_path or self.config_path
        try:
            data = {
                "version": "2.0",
                "thresholds": self.thresholds,
                "raw_pixel_spec": getattr(self, "raw_pixel_spec", {}),
                "rois": self.rois
            }
            with open(target, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
        except Exception as e:
            print(f"[ScreenAnalyzer] Error saving ROIs config: {e}")

    def get_roi_pixels(self, frame_shape: Tuple[int, int], roi_key: str) -> Tuple[int, int, int, int]:
        h, w = frame_shape[:2]
        if roi_key not in self.rois:
            raise KeyError(f"ROI '{roi_key}' not defined in ScreenAnalyzer.")
        rx, ry, rw, rh = self.rois[roi_key]
        if rx > 1.0 or ry > 1.0 or rw > 1.0 or rh > 1.0:
            rx /= 1920.0
            ry /= 1080.0
            rw /= 1920.0
            rh /= 1080.0
        x = max(0, min(int(rx * w), w - 1))
        y = max(0, min(int(ry * h), h - 1))
        width = max(1, min(int(rw * w), w - x))
        height = max(1, min(int(rh * h), h - y))
        return (x, y, width, height)

    def crop_roi(self, frame: np.ndarray, roi_key: str) -> Optional[np.ndarray]:
        if frame is None or frame.size == 0 or roi_key not in self.rois:
            return None
        x, y, w, h = self.get_roi_pixels(frame.shape, roi_key)
        crop = frame[y:y+h, x:x+w]
        return crop.copy() if crop.size > 0 else None

    def extract_ban_regions(self, frame: np.ndarray) -> List[Dict[str, Any]]:
        return extract_ban_regions(frame, self)

    def extract_pick_regions(self, frame: np.ndarray) -> List[Dict[str, Any]]:
        return extract_pick_regions(frame, self)



def extract_ban_area(frame: np.ndarray, slot_idx: int, side: str = "ally", analyzer: Optional[ScreenAnalyzer] = None) -> Dict[str, Any]:
    """
    Extracts a specific circular Ban slot (80x80px at y=6px).
    """
    if analyzer is None:
        analyzer = ScreenAnalyzer()

    roi_key = f"{side}_ban_{slot_idx}"
    crop = analyzer.crop_roi(frame, roi_key)
    bbox = analyzer.get_roi_pixels(frame.shape, roi_key) if (frame is not None and frame.size > 0) else (0, 0, 80, 80)

    mean_val = float(np.mean(crop)) if (crop is not None and crop.size > 0) else 0.0
    std_val = float(np.std(crop)) if (crop is not None and crop.size > 0) else 0.0

    return {
        "slot_index": slot_idx,
        "side": side,
        "roi_key": roi_key,
        "bbox": bbox,
        "crop": crop,
        "mean_bgr": round(mean_val, 2),
        "std": round(std_val, 2),
        "is_valid": (crop is not None and crop.size > 0 and mean_val >= 10.0 and std_val >= 7.0)
    }


def extract_pick_area(frame: np.ndarray, slot_idx: int, side: str = "ally", analyzer: Optional[ScreenAnalyzer] = None) -> Dict[str, Any]:
    """
    Extracts a specific rectangular Pick slot (210x132px).
    """
    if analyzer is None:
        analyzer = ScreenAnalyzer()

    roi_key = f"{side}_pick_{slot_idx}"
    crop = analyzer.crop_roi(frame, roi_key)
    bbox = analyzer.get_roi_pixels(frame.shape, roi_key) if (frame is not None and frame.size > 0) else (0, 0, 210, 132)

    mean_val = float(np.mean(crop)) if (crop is not None and crop.size > 0) else 0.0
    std_val = float(np.std(crop)) if (crop is not None and crop.size > 0) else 0.0

    edge_density = 0.0
    if crop is not None and crop.size > 0:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
        edges = cv2.Canny(gray, 40, 120)
        edge_density = float(np.sum(edges > 0) / edges.size)

    return {
        "slot_index": slot_idx,
        "side": side,
        "roi_key": roi_key,
        "bbox": bbox,
        "crop": crop,
        "mean_bgr": round(mean_val, 2),
        "std": round(std_val, 2),
        "edge_density": round(edge_density, 4),
        "is_valid": (crop is not None and crop.size > 0 and mean_val >= 10.0 and std_val >= 6.0)
    }


def extract_ban_regions(frame: np.ndarray, analyzer: Optional[ScreenAnalyzer] = None) -> List[Dict[str, Any]]:
    """
    Dedicated function extracting the 10 circular Ban slots (5 ally + 5 enemy).
    """
    if analyzer is None:
        analyzer = ScreenAnalyzer()

    ban_rois = []
    for i in range(10):
        side = "ally" if i < 5 else "enemy"
        slot_idx = i if i < 5 else (i - 5)
        ban_rois.append(extract_ban_area(frame, slot_idx, side, analyzer))
    return ban_rois


def extract_ally_pick_regions(frame: np.ndarray, analyzer: Optional[ScreenAnalyzer] = None) -> List[Dict[str, Any]]:
    """
    Dedicated function extracting the 5 Ally pick cards (Slots 0..4 on left).
    """
    if analyzer is None:
        analyzer = ScreenAnalyzer()
    return [extract_pick_area(frame, i, "ally", analyzer) for i in range(5)]


def extract_enemy_pick_regions(frame: np.ndarray, analyzer: Optional[ScreenAnalyzer] = None) -> List[Dict[str, Any]]:
    """
    Dedicated function extracting the 5 Enemy pick cards (Slots 0..4 on right).
    """
    if analyzer is None:
        analyzer = ScreenAnalyzer()
    return [extract_pick_area(frame, i, "enemy", analyzer) for i in range(5)]


def extract_pick_regions(frame: np.ndarray, analyzer: Optional[ScreenAnalyzer] = None) -> List[Dict[str, Any]]:
    """
    Dedicated function extracting all 10 Pick slots (5 ally + 5 enemy).
    """
    if analyzer is None:
        analyzer = ScreenAnalyzer()
    return extract_ally_pick_regions(frame, analyzer) + extract_enemy_pick_regions(frame, analyzer)


def extract_lane_regions(frame: np.ndarray, analyzer: Optional[ScreenAnalyzer] = None) -> List[Dict[str, Any]]:
    """
    Dedicated function extracting the 10 Lane role badge areas (50x50px at relative 5px left, 53px top).
    """
    if analyzer is None:
        analyzer = ScreenAnalyzer()

    lane_rois = []
    ally_pick_ys = [125, 298, 470, 642, 814]
    for i in range(5):
        y = ally_pick_ys[i] + 53
        crop_a = frame[y:y+50, 5:5+50].copy() if (frame is not None and frame.shape[0] >= y+50 and frame.shape[1] >= 55) else None
        lane_rois.append({
            "slot_index": i,
            "side": "ally",
            "bbox": (5, y, 50, 50),
            "crop": crop_a
        })
        crop_e = frame[y:y+50, 1710+5:1710+55].copy() if (frame is not None and frame.shape[0] >= y+50 and frame.shape[1] >= 1710+55) else None
        lane_rois.append({
            "slot_index": 5 + i,
            "side": "enemy",
            "bbox": (1715, y, 50, 50),
            "crop": crop_e
        })
    return lane_rois
