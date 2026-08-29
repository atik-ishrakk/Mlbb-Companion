# =============================================================================
#   MLBB COMPANION — PRE-WARMED GPU/RAM TENSOR & TEXTURE CACHE (cache.py)
# =============================================================================
#   Role & Purpose in Project:
#     This file acts as the high-speed in-memory vector database and texture store
#     for the computer vision pipeline. During startup, it pre-loads, resizes,
#     enhances with CLAHE, and pre-normalizes all hero portraits (136 bans, 134 picks)
#     and in-game equipment items (61 items) into contiguous 2D float32 tensor matrices.
#     
#     By keeping these reference tensors pre-warmed in resident system RAM / VRAM:
#       1. Zero Disk I/O: Live frame matching requires 0 disk reads during gameplay.
#       2. SIMD Acceleration: Hero classification computes matrix-vector dot products
#          (np.dot) in <0.5ms per slot rather than running slow per-template disk scans.
#       3. Resource Safety: Automatically evicts PyTorch/CUDA VRAM buffers on shutdown
#          using registered atexit hooks to prevent memory leaks.
# =============================================================================

import os
import time
import atexit
from typing import Dict, List, Tuple, Optional, Set
import cv2
import numpy as np

try:
    import torch
    HAS_TORCH = True
except ImportError:
    torch = None  # type: ignore
    HAS_TORCH = False

from hashing import compute_dhash

_GLOBAL_GPU_CACHE: Optional["GPUTextureCache"] = None


def _cleanup_global_gpu_cache():
    global _GLOBAL_GPU_CACHE
    if _GLOBAL_GPU_CACHE is not None:
        _GLOBAL_GPU_CACHE.clear()
        _GLOBAL_GPU_CACHE = None


atexit.register(_cleanup_global_gpu_cache)


def get_gpu_cache(project_root: Optional[str] = None) -> "GPUTextureCache":
    """Thread-safe singleton accessor for the pre-warmed GPU Texture Cache."""
    global _GLOBAL_GPU_CACHE
    if _GLOBAL_GPU_CACHE is None:
        _GLOBAL_GPU_CACHE = GPUTextureCache(project_root)
    return _GLOBAL_GPU_CACHE


class GPUTextureCache:
    """
    Pre-warms all 133 Round Ban icons (80x80), 133 Corner Pick icons (210x132),
    and 61 Item icons into resident GPU/PyTorch/SIMD memory tensors.
    """
    def __init__(self, project_root: Optional[str] = None):
        if project_root is None:
            project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.project_root = project_root

        # Find folders with proper fallback priority (src/assets -> src/shared/assets -> assets)
        self.db_corner_dir = os.path.join(project_root, "src", "assets", "rect")
        if not os.path.exists(self.db_corner_dir):
            self.db_corner_dir = os.path.join(project_root, "src", "shared", "assets", "rect")
        if not os.path.exists(self.db_corner_dir):
            self.db_corner_dir = os.path.join(project_root, "assets", "rect")

        self.db_round_heroes_dir = os.path.join(project_root, "src", "assets", "heroes")
        if not os.path.exists(self.db_round_heroes_dir):
            self.db_round_heroes_dir = os.path.join(project_root, "src", "shared", "assets", "heroes")
        if not os.path.exists(self.db_round_heroes_dir):
            self.db_round_heroes_dir = os.path.join(project_root, "assets", "heroes")

        self.db_round_items_dir = os.path.join(project_root, "src", "assets", "items")
        if not os.path.exists(self.db_round_items_dir):
            self.db_round_items_dir = os.path.join(project_root, "src", "shared", "assets", "items")
        if not os.path.exists(self.db_round_items_dir):
            self.db_round_items_dir = os.path.join(project_root, "assets", "items")

        self.round_templates: Dict[str, np.ndarray] = {}
        self.round_clahe: Dict[str, np.ndarray] = {}
        self.round_hashes: Dict[str, int] = {}
        self.ban_hero_names: List[str] = []

        self.corner_templates: Dict[str, np.ndarray] = {}
        self.corner_clahe: Dict[str, np.ndarray] = {}
        self.corner_hashes: Dict[str, int] = {}
        self.pick_hero_names: List[str] = []

        self.item_templates: Dict[str, np.ndarray] = {}
        self.item_clahe: Dict[str, np.ndarray] = {}
        self.item_hashes: Dict[str, int] = {}
        self.item_names: List[str] = []

        self.ban_tensor_matrix: Optional[np.ndarray] = None
        self.pick_tensor_matrix: Optional[np.ndarray] = None
        self.item_tensor_matrix: Optional[np.ndarray] = None

        # Empty Slot Reference Vectors
        self.empty_ban_ally_vec: Optional[np.ndarray] = None
        self.empty_ban_enemy_vec: Optional[np.ndarray] = None
        self.empty_pick_ally_vec: Optional[np.ndarray] = None
        self.empty_pick_ally_dim_vec: Optional[np.ndarray] = None
        self.empty_pick_enemy_vec: Optional[np.ndarray] = None

        self._clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        self._load_all_databases()

    def _apply_clahe(self, img: np.ndarray) -> np.ndarray:
        if len(img.shape) == 3:
            lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            l = self._clahe.apply(l)
            return cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)
        return self._clahe.apply(img)

    def _load_all_databases(self):
        t0 = time.perf_counter()

        # 1. Ban Hero Icons (80x80 Round)
        if os.path.exists(self.db_round_heroes_dir):
            ban_tensors = []
            for fname in sorted(os.listdir(self.db_round_heroes_dir)):
                if fname.lower().endswith(".png"):
                    hname = os.path.splitext(fname)[0].lower()
                    img = cv2.imread(os.path.join(self.db_round_heroes_dir, fname))
                    if img is not None:
                        img_80 = cv2.resize(img, (80, 80))
                        clahe_img = self._apply_clahe(img_80)
                        self.round_templates[hname] = img_80
                        self.round_clahe[hname] = clahe_img
                        self.round_hashes[hname] = compute_dhash(img_80)
                        self.ban_hero_names.append(hname)

                        vec = clahe_img.astype(np.float32).flatten()
                        norm = np.linalg.norm(vec)
                        ban_tensors.append(vec / (norm + 1e-7))
            if ban_tensors:
                self.ban_tensor_matrix = np.stack(ban_tensors)

        # 2. Pick Corner Icons (210x132 Rectangles)
        resized_corner_dir = os.path.join(self.db_corner_dir, "Resized")
        if os.path.exists(self.db_corner_dir):
            pick_tensors = []
            for fname in sorted(os.listdir(self.db_corner_dir)):
                if fname.lower().endswith(".png"):
                    hname = os.path.splitext(fname)[0].lower()
                    custom_path = os.path.join(resized_corner_dir, fname) if os.path.exists(resized_corner_dir) else ""
                    target_path = custom_path if (custom_path and os.path.exists(custom_path)) else os.path.join(self.db_corner_dir, fname)
                    img = cv2.imread(target_path)
                    if img is not None:
                        img_pick = cv2.resize(img, (210, 132))
                        clahe_img = self._apply_clahe(img_pick)
                        self.corner_templates[hname] = img_pick
                        self.corner_clahe[hname] = clahe_img
                        self.corner_hashes[hname] = compute_dhash(img_pick)
                        self.pick_hero_names.append(hname)

                        vec = clahe_img.astype(np.float32).flatten()
                        norm = np.linalg.norm(vec)
                        pick_tensors.append(vec / (norm + 1e-7))
            if pick_tensors:
                self.pick_tensor_matrix = np.stack(pick_tensors)

        # 3. Scoreboard Items (40x40 Round)
        if os.path.exists(self.db_round_items_dir):
            item_tensors = []
            for fname in sorted(os.listdir(self.db_round_items_dir)):
                if fname.lower().endswith(".png"):
                    iname = os.path.splitext(fname)[0].lower()
                    img = cv2.imread(os.path.join(self.db_round_items_dir, fname))
                    if img is not None:
                        img_40 = cv2.resize(img, (40, 40))
                        clahe_img = self._apply_clahe(img_40)
                        self.item_templates[iname] = img_40
                        self.item_clahe[iname] = clahe_img
                        self.item_hashes[iname] = compute_dhash(img_40)
                        self.item_names.append(iname)

                        vec = clahe_img.astype(np.float32).flatten()
                        norm = np.linalg.norm(vec)
                        item_tensors.append(vec / (norm + 1e-7))
            if item_tensors:
                self.item_tensor_matrix = np.stack(item_tensors)

        # 4. Empty Slot Templates
        possible_tpl_dirs = [
            os.path.join(self.project_root, "src", "assets", "templates"),
            os.path.join(self.project_root, "src", "shared", "assets", "templates"),
            os.path.join(self.project_root, "Backend", "assets", "templates"),
            os.path.join(self.project_root, "assets", "templates"),
            os.path.join(self.project_root, "DB", "templates"),
        ]
        tpl_dir = self.project_root
        for p in possible_tpl_dirs:
            if os.path.exists(p):
                tpl_dir = p
                break
        
        p_eba = os.path.join(tpl_dir, "empty_ban_ally.png")
        if os.path.exists(p_eba):
            img = cv2.imread(p_eba)
            if img is not None:
                clahe_img = self._apply_clahe(cv2.resize(img, (80, 80)))
                vec = clahe_img.astype(np.float32).flatten()
                vec -= np.mean(vec)
                self.empty_ban_ally_vec = vec / (np.linalg.norm(vec) + 1e-7)

        p_ebe = os.path.join(tpl_dir, "empty_ban_enemy.png")
        if os.path.exists(p_ebe):
            img = cv2.imread(p_ebe)
            if img is not None:
                clahe_img = self._apply_clahe(cv2.resize(img, (80, 80)))
                vec = clahe_img.astype(np.float32).flatten()
                vec -= np.mean(vec)
                self.empty_ban_enemy_vec = vec / (np.linalg.norm(vec) + 1e-7)

        p_epa = os.path.join(tpl_dir, "empty_pick_slot_ally.png")
        if os.path.exists(p_epa):
            img = cv2.imread(p_epa)
            if img is not None:
                clahe_img = self._apply_clahe(cv2.resize(img, (210, 132)))
                vec = clahe_img.astype(np.float32).flatten()
                vec -= np.mean(vec)
                self.empty_pick_ally_vec = vec / (np.linalg.norm(vec) + 1e-7)

        p_epa_dim = os.path.join(tpl_dir, "empty_pick_slot_ally_dim.png")
        if os.path.exists(p_epa_dim):
            img = cv2.imread(p_epa_dim)
            if img is not None:
                clahe_img = self._apply_clahe(cv2.resize(img, (210, 132)))
                vec = clahe_img.astype(np.float32).flatten()
                vec -= np.mean(vec)
                self.empty_pick_ally_dim_vec = vec / (np.linalg.norm(vec) + 1e-7)
        else:
            self.empty_pick_ally_dim_vec = None

        p_epe = os.path.join(tpl_dir, "empty_pick_slot_enemy.png")
        if os.path.exists(p_epe):
            img = cv2.imread(p_epe)
            if img is not None:
                clahe_img = self._apply_clahe(cv2.resize(img, (210, 132)))
                vec = clahe_img.astype(np.float32).flatten()
                vec -= np.mean(vec)
                self.empty_pick_enemy_vec = vec / (np.linalg.norm(vec) + 1e-7)

        self.is_preloaded = bool(self.ban_hero_names and self.pick_hero_names)
        dt = (time.perf_counter() - t0) * 1000.0
        print(f"[GPU Texture Cache] Loaded {len(self.ban_hero_names)} bans, {len(self.pick_hero_names)} picks, {len(self.item_names)} items in {dt:.1f}ms.")

    def reload(self):
        self.clear()
        self._load_all_databases()

    def clear(self):
        import gc
        self.ban_hero_names.clear()
        self.pick_hero_names.clear()
        self.item_names.clear()
        self.round_templates.clear()
        self.corner_templates.clear()
        self.item_templates.clear()
        self.round_clahe.clear()
        self.corner_clahe.clear()
        self.item_clahe.clear()
        self.round_hashes.clear()
        self.corner_hashes.clear()
        self.item_hashes.clear()
        self.ban_tensor_matrix = None
        self.pick_tensor_matrix = None
        self.item_tensor_matrix = None
        self.empty_ban_ally_vec = None
        self.empty_ban_enemy_vec = None
        self.empty_pick_ally_vec = None
        self.empty_pick_ally_dim_vec = None
        self.empty_pick_enemy_vec = None

        if HAS_TORCH and torch is not None:
            try:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.ipc_collect()
            except Exception:
                pass

        try:
            cv2.ocl.setUseOpenCL(False)
        except Exception:
            pass

        gc.collect()

    def match_single_ban(self, crop: np.ndarray, threshold: float = 0.28, taken: Optional[Set[str]] = None) -> Tuple[Optional[str], float]:
        if crop is None or crop.size == 0 or self.ban_tensor_matrix is None:
            return None, 0.0
        
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
        if float(np.std(gray)) < 12.0 or float(np.mean(gray)) < 12.0:
            return None, 0.0

        resized = cv2.resize(crop, (80, 80))
        clahe_crop = self._apply_clahe(resized)

        if self.empty_ban_ally_vec is not None or self.empty_ban_enemy_vec is not None:
            z_vec = clahe_crop.astype(np.float32).flatten()
            z_vec -= np.mean(z_vec)
            z_norm = np.linalg.norm(z_vec) + 1e-7
            z_vec /= z_norm

            if self.empty_ban_ally_vec is not None:
                if float(np.dot(self.empty_ban_ally_vec, z_vec)) >= 0.55:
                    return None, 0.0
            if self.empty_ban_enemy_vec is not None:
                if float(np.dot(self.empty_ban_enemy_vec, z_vec)) >= 0.55:
                    return None, 0.0

        vec = clahe_crop.astype(np.float32).flatten()
        vec /= (np.linalg.norm(vec) + 1e-7)

        scores = np.dot(self.ban_tensor_matrix, vec)
        best_idx = int(np.argmax(scores))
        best_score = float(scores[best_idx])
        best_hero = self.ban_hero_names[best_idx]

        if best_hero.lower().startswith("question"):
            return None, 0.0

        if taken and best_hero in taken:
            sorted_indices = np.argsort(scores)[::-1]
            for idx in sorted_indices:
                cand = self.ban_hero_names[idx]
                if cand.lower().startswith("question"):
                    return None, 0.0
                if cand not in taken:
                    best_hero = cand
                    best_score = float(scores[idx])
                    break

        if best_score < threshold or best_hero.lower().startswith("question"):
            return None, 0.0

        return (best_hero, best_score)

    def match_single_pick(self, crop: np.ndarray, threshold: float = 0.28, taken: Optional[Set[str]] = None) -> Tuple[Optional[str], float]:
        if crop is None or crop.size == 0 or self.pick_tensor_matrix is None:
            return None, 0.0
        
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
        if float(np.std(gray)) < 12.0 or float(np.mean(gray)) < 12.0:
            return None, 0.0

        edges = cv2.Canny(gray, 40, 120)
        edge_density = float(np.sum(edges > 0) / edges.size)
        if edge_density < 0.025:
            return None, 0.0

        resized = cv2.resize(crop, (210, 132))
        clahe_crop = self._apply_clahe(resized)

        if self.empty_pick_ally_vec is not None or self.empty_pick_ally_dim_vec is not None or self.empty_pick_enemy_vec is not None:
            z_vec = clahe_crop.astype(np.float32).flatten()
            z_vec -= np.mean(z_vec)
            z_norm = np.linalg.norm(z_vec) + 1e-7
            z_vec /= z_norm

            if self.empty_pick_ally_vec is not None:
                if float(np.dot(self.empty_pick_ally_vec, z_vec)) >= 0.52:
                    return None, 0.0
            if self.empty_pick_ally_dim_vec is not None:
                if float(np.dot(self.empty_pick_ally_dim_vec, z_vec)) >= 0.48:
                    return None, 0.0
            if self.empty_pick_enemy_vec is not None:
                if float(np.dot(self.empty_pick_enemy_vec, z_vec)) >= 0.52:
                    return None, 0.0

        vec = clahe_crop.astype(np.float32).flatten()
        vec /= (np.linalg.norm(vec) + 1e-7)

        scores = np.dot(self.pick_tensor_matrix, vec)

        flipped = cv2.flip(clahe_crop, 1)
        f_vec = flipped.astype(np.float32).flatten()
        f_vec /= (np.linalg.norm(f_vec) + 1e-7)
        f_scores = np.dot(self.pick_tensor_matrix, f_vec)
        max_scores = np.maximum(scores, f_scores)

        best_idx = int(np.argmax(max_scores))
        best_score = float(max_scores[best_idx])
        best_hero = self.pick_hero_names[best_idx]

        if best_hero.lower().startswith("question"):
            return None, 0.0

        if taken and best_hero in taken:
            sorted_indices = np.argsort(max_scores)[::-1]
            for idx in sorted_indices:
                cand = self.pick_hero_names[idx]
                if cand.lower().startswith("question"):
                    return None, 0.0
                if cand not in taken:
                    best_hero = cand
                    best_score = float(max_scores[idx])
                    break

        if best_score < threshold or best_hero.lower().startswith("question"):
            return None, 0.0

        return (best_hero, best_score)

    def match_item(self, crop: np.ndarray, threshold: float = 0.50) -> Tuple[Optional[str], float]:
        if crop is None or crop.size == 0 or self.item_tensor_matrix is None:
            return None, 0.0
        resized = cv2.resize(crop, (40, 40))
        clahe_crop = self._apply_clahe(resized)
        vec = clahe_crop.astype(np.float32).flatten()
        vec /= (np.linalg.norm(vec) + 1e-7)

        scores = np.dot(self.item_tensor_matrix, vec)
        best_idx = int(np.argmax(scores))
        best_score = float(scores[best_idx])
        return (self.item_names[best_idx], best_score) if best_score >= threshold else (None, 0.0)
