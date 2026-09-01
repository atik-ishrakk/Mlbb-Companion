# =============================================================================
# MLBB COMPANION — GENERIC MATCHER
# =============================================================================
#
# Consolidates:
#   - ally_pick_matcher.py
#   - enemy_pick_matcher.py
#   - ban_matcher.py
#   - phase_matcher.py
#
# Public API:
#
#   matcher = Matcher(project_root)
#
#   matcher.match_bans(...)
#   matcher.match_picks(...)
#   matcher.match_phase(...)
#
# Compatibility classes are also exported:
#
#   BanMatcher
#   AllyPickMatcher
#   EnemyPickMatcher
#   PhaseMatcher
#
# =============================================================================

import os
import time
from collections import Counter, deque
from typing import Any, Dict, List, Optional, Set, Tuple

import cv2
import numpy as np


# =============================================================================
# COMMON HELPERS
# =============================================================================

OFFSETS = [
    (0, 0),
    (-3, 0),
    (+3, 0),
    (0, -3),
    (0, +3),
    (-6, 0),
    (+6, 0),
    (-3, -3),
    (+3, -3),
]


def _first_existing(paths: List[str]) -> str:
    for path in paths:
        if os.path.exists(path):
            return path
    return paths[0]


def _resize_if_needed(
    image: np.ndarray,
    width: int,
    height: int,
) -> np.ndarray:
    if image is None or image.size == 0:
        return image

    if image.shape[:2] != (height, width):
        return cv2.resize(image, (width, height))

    return image


def _safe_mean(image: Optional[np.ndarray]) -> float:
    if image is None or image.size == 0:
        return 0.0
    return float(np.mean(image))


def _safe_std(image: Optional[np.ndarray]) -> float:
    if image is None or image.size == 0:
        return 0.0
    return float(np.std(image))


# =============================================================================
# GENERIC MATCHER
# =============================================================================

class Matcher:
    """
    Unified MLBB computer-vision matcher.

    Handles:

        1. Circular ban slots
        2. Ally pick slots
        3. Enemy pick slots
        4. MLBB UI phase detection

    The individual algorithms remain logically separated internally, but all
    shared infrastructure lives in this class.
    """

    # -------------------------------------------------------------------------
    # Constructor
    # -------------------------------------------------------------------------

    def __init__(
        self,
        project_root: Optional[str] = None,
        threshold: float = 0.50,
        ban_threshold: float = 0.60,
        ally_threshold: Optional[float] = None,
        enemy_threshold: Optional[float] = None,
        analyzer: Optional[Any] = None,
    ):
        if project_root is None:
            project_root = os.path.abspath(
                os.path.join(os.path.dirname(__file__), "..")
            )

        self.project_root = project_root

        self.threshold = threshold
        self.ban_threshold = ban_threshold
        self.ally_threshold = (
            threshold if ally_threshold is None else ally_threshold
        )
        self.enemy_threshold = (
            threshold if enemy_threshold is None else enemy_threshold
        )

        self.clahe = cv2.createCLAHE(
            clipLimit=2.0,
            tileGridSize=(8, 8),
        )

        # ---------------------------------------------------------------------
        # Pick configuration
        # ---------------------------------------------------------------------

        self.pick_w = 210
        self.pick_h = 132

        self.win_x1 = 55
        self.win_x2 = 194
        self.win_y1 = 0
        self.win_y2 = 110

        self.win_w = self.win_x2 - self.win_x1
        self.win_h = self.win_y2 - self.win_y1
        self.n_pixels = self.win_w * self.win_h

        # ---------------------------------------------------------------------
        # Ally state
        # ---------------------------------------------------------------------

        self.ally_temporal_buffers = {
            f"ally_pick_{i}": deque(maxlen=5)
            for i in range(5)
        }

        self.ally_last_confirmed = {
            f"ally_pick_{i}": (None, 0.0, "-")
            for i in range(5)
        }

        # ---------------------------------------------------------------------
        # Enemy state
        # ---------------------------------------------------------------------

        self.enemy_temporal_buffers = {
            f"enemy_pick_{i}": deque(maxlen=5)
            for i in range(5)
        }

        self.enemy_last_confirmed = {
            f"enemy_pick_{i}": (None, 0.0)
            for i in range(5)
        }

        # ---------------------------------------------------------------------
        # Ban state
        # ---------------------------------------------------------------------

        self.ban_temporal_buffers = {
            f"ban_{i}": deque(maxlen=5)
            for i in range(10)
        }

        self.ban_last_confirmed = {
            f"ban_{i}": (None, 0.0)
            for i in range(10)
        }

        self.hold_seconds = 4.0

        # ---------------------------------------------------------------------
        # Ban circular mask
        # ---------------------------------------------------------------------

        self.ban_size = 80

        self.ban_mask = np.zeros(
            (self.ban_size, self.ban_size),
            dtype=np.uint8,
        )

        cv2.circle(
            self.ban_mask,
            (40, 40),
            30,
            255,
            -1,
        )

        self.ban_mask_indices = self.ban_mask > 0
        self.ban_n_pixels = int(np.sum(self.ban_mask_indices))

        # ---------------------------------------------------------------------
        # Lane configuration
        # ---------------------------------------------------------------------

        self.lane_keys = [
            "exp",
            "gold",
            "jungle",
            "mid",
            "roam",
        ]

        self.lane_display_map = {
            "exp": "EXP Lane",
            "gold": "Gold Lane",
            "jungle": "Jungle",
            "mid": "Mid Lane",
            "roam": "Roam",
        }

        self.lane_scales = [
            0.75,
            0.85,
            1.0,
            1.15,
        ]

        self.lane_templates: Dict[str, np.ndarray] = {}
        self.scaled_lane_templates: Dict[
            Tuple[str, float],
            np.ndarray,
        ] = {}

        self.empty_ally = None
        self.empty_ally_dim = None

        self.empty_ban_ally_img = None
        self.empty_ban_enemy_img = None

        self.empty_enemy = None

        # ---------------------------------------------------------------------
        # Hero banks
        # ---------------------------------------------------------------------

        self.ally_hero_names: List[str] = []
        self.ally_zncc_matrix = np.zeros(
            (0, self.n_pixels),
            dtype=np.float32,
        )
        self.ally_hsv_matrix = np.zeros(
            (0, 128),
            dtype=np.float32,
        )

        self.enemy_hero_names: List[str] = []
        self.enemy_zncc_matrix = np.zeros(
            (0, self.n_pixels),
            dtype=np.float32,
        )
        self.enemy_hsv_matrix = np.zeros(
            (0, 128),
            dtype=np.float32,
        )

        self.ban_hero_names: List[str] = []
        self.ban_zncc_matrix = np.zeros(
            (0, self.ban_n_pixels),
            dtype=np.float32,
        )
        self.ban_hsv_matrix = np.zeros(
            (0, 128),
            dtype=np.float32,
        )

        # Compatibility properties used by the previous implementations.
        self.hero_names: List[str] = []
        self.rect_zncc_matrix = np.zeros(
            (0, self.n_pixels),
            dtype=np.float32,
        )
        self.hsv_matrix = np.zeros(
            (0, 128),
            dtype=np.float32,
        )

        # ---------------------------------------------------------------------
        # Phase matcher
        # ---------------------------------------------------------------------

        self.phase_fsm = PhaseFSM()
        self.phase_anchor_db = None
        self.current_phase = "N/A"
        self.current_confidence = 0.0

        # ---------------------------------------------------------------------
        # Initialization
        # ---------------------------------------------------------------------

        self._load_lane_anchors()
        self._load_empty_templates()
        self.update_calibration(analyzer)

        self._load_ban_bank()
        self._load_enemy_bank()

        self._load_phase_database()

    # =========================================================================
    # PATH HELPERS
    # =========================================================================

    def _asset_dir(self, name: str) -> str:
        return _first_existing(
            [
                os.path.join(
                    self.project_root,
                    "src",
                    "assets",
                    name,
                ),
                os.path.join(
                    self.project_root,
                    "src",
                    "shared",
                    "assets",
                    name,
                ),
                os.path.join(
                    self.project_root,
                    "assets",
                    name,
                ),
            ]
        )

    # =========================================================================
    # EMPTY / LANE TEMPLATES
    # =========================================================================

    def _load_empty_templates(self) -> None:
        tpl_dir = self._asset_dir("templates")

        ally = os.path.join(
            tpl_dir,
            "empty_pick_slot_ally.png",
        )

        ally_dim = os.path.join(
            tpl_dir,
            "empty_pick_slot_ally_dim.png",
        )

        enemy = os.path.join(
            tpl_dir,
            "empty_pick_slot_enemy.png",
        )

        ban_ally = os.path.join(
            tpl_dir,
            "empty_ban_ally.png",
        )

        ban_enemy = os.path.join(
            tpl_dir,
            "empty_ban_enemy.png",
        )

        self.empty_ally = (
            cv2.imread(ally)
            if os.path.exists(ally)
            else None
        )

        self.empty_ally_dim = (
            cv2.imread(ally_dim)
            if os.path.exists(ally_dim)
            else None
        )

        self.empty_enemy = (
            cv2.imread(enemy)
            if os.path.exists(enemy)
            else None
        )

        self.empty_ban_ally_img = (
            cv2.resize(
                cv2.imread(ban_ally),
                (80, 80),
            )
            if os.path.exists(ban_ally)
            else None
        )

        self.empty_ban_enemy_img = (
            cv2.resize(
                cv2.imread(ban_enemy),
                (80, 80),
            )
            if os.path.exists(ban_enemy)
            else None
        )

    def _load_lane_anchors(self) -> None:
        lane_dir = self._asset_dir("lanes")

        for lane_key in self.lane_keys:
            path = os.path.join(
                lane_dir,
                f"{lane_key}.png",
            )

            if not os.path.exists(path):
                continue

            image = cv2.imread(path)

            if image is None:
                continue

            self.lane_templates[lane_key] = image

            for scale in self.lane_scales:
                width = max(
                    1,
                    int(image.shape[1] * scale),
                )
                height = max(
                    1,
                    int(image.shape[0] * scale),
                )

                self.scaled_lane_templates[
                    (lane_key, scale)
                ] = cv2.resize(
                    image,
                    (width, height),
                )

    # =========================================================================
    # PICK CALIBRATION
    # =========================================================================

    def update_calibration(
        self,
        analyzer: Optional[Any] = None,
    ) -> None:

        pick_w = 210
        pick_h = 132

        flag_rel_x = 6
        flag_size = 46

        lane_rel_x = 5
        lane_size = 50

        spell_rel_x = 194

        if analyzer is not None:
            raw = getattr(
                analyzer,
                "raw_pixel_spec",
                {},
            )

            if isinstance(raw, dict):

                ally_picks = raw.get(
                    "allyPicks"
                )

                enemy_picks = raw.get(
                    "enemyPicks"
                )

                candidate = None

                if (
                    isinstance(ally_picks, list)
                    and ally_picks
                    and isinstance(ally_picks[0], dict)
                ):
                    candidate = ally_picks[0]

                elif (
                    isinstance(enemy_picks, list)
                    and enemy_picks
                    and isinstance(enemy_picks[0], dict)
                ):
                    candidate = enemy_picks[0]

                if candidate is not None:
                    pick_w = int(
                        candidate.get(
                            "w",
                            210,
                        )
                    )

                    pick_h = int(
                        candidate.get(
                            "h",
                            132,
                        )
                    )

        left_bound = max(
            flag_rel_x + flag_size,
            lane_rel_x + lane_size,
        )

        win_x1 = max(
            0,
            min(
                pick_w - 40,
                left_bound,
            ),
        )

        win_x2 = max(
            win_x1 + 40,
            min(
                pick_w,
                spell_rel_x
                if spell_rel_x > win_x1 + 30
                else pick_w,
            ),
        )

        self.pick_w = pick_w
        self.pick_h = pick_h

        self.win_x1 = win_x1
        self.win_x2 = win_x2
        self.win_y1 = 0
        self.win_y2 = max(
            40,
            pick_h - 22,
        )

        self.win_w = (
            self.win_x2 - self.win_x1
        )

        self.win_h = (
            self.win_y2 - self.win_y1
        )

        self.n_pixels = (
            self.win_w * self.win_h
        )

    # =========================================================================
    # FEATURE EXTRACTION
    # =========================================================================

    def _extract_window_features(
        self,
        image: np.ndarray,
    ) -> Tuple[np.ndarray, np.ndarray]:

        if image is None or image.size == 0:
            return (
                np.zeros(
                    self.n_pixels,
                    dtype=np.float32,
                ),
                np.zeros(
                    128,
                    dtype=np.float32,
                ),
            )

        image = _resize_if_needed(
            image,
            self.win_w,
            self.win_h,
        )

        if len(image.shape) == 3:
            gray = cv2.cvtColor(
                image,
                cv2.COLOR_BGR2GRAY,
            )
        else:
            gray = image

        enhanced = self.clahe.apply(
            gray
        ).astype(np.float32)

        std = float(
            np.std(enhanced)
        )

        if std > 1e-5:
            z_vec = (
                (
                    enhanced
                    - np.mean(enhanced)
                )
                / (std + 1e-6)
            ).flatten()
        else:
            z_vec = np.zeros(
                self.n_pixels,
                dtype=np.float32,
            )

        if len(image.shape) == 3:

            hsv = cv2.cvtColor(
                image,
                cv2.COLOR_BGR2HSV,
            )

            hist = cv2.calcHist(
                [hsv],
                [0, 1],
                None,
                [16, 8],
                [0, 180, 0, 256],
            )

            hist = hist.flatten()

            hist /= (
                np.linalg.norm(hist)
                + 1e-6
            )

            hsv_vec = hist.astype(
                np.float32
            )

        else:
            hsv_vec = np.zeros(
                128,
                dtype=np.float32,
            )

        return z_vec, hsv_vec

    def _extract_ban_features(
        self,
        image: np.ndarray,
        dx: int = 0,
        dy: int = 0,
    ) -> Tuple[np.ndarray, np.ndarray]:

        image = _resize_if_needed(
            image,
            80,
            80,
        )

        if image is None or image.size == 0:
            return (
                np.zeros(
                    self.ban_n_pixels,
                    dtype=np.float32,
                ),
                np.zeros(
                    128,
                    dtype=np.float32,
                ),
            )

        shifted = image

        if dx != 0 or dy != 0:

            matrix = np.float32(
                [
                    [1, 0, dx],
                    [0, 1, dy],
                ]
            )

            shifted = cv2.warpAffine(
                image,
                matrix,
                (80, 80),
                borderMode=cv2.BORDER_REPLICATE,
            )

        gray = cv2.cvtColor(
            shifted,
            cv2.COLOR_BGR2GRAY,
        )

        enhanced = self.clahe.apply(
            gray
        ).astype(np.float32)

        values = enhanced[
            self.ban_mask_indices
        ]

        std = float(np.std(values))

        if std > 1e-5:
            z_vec = (
                (
                    values
                    - np.mean(values)
                )
                / (std + 1e-6)
            ).astype(np.float32)

        else:
            z_vec = np.zeros(
                self.ban_n_pixels,
                dtype=np.float32,
            )

        hsv = cv2.cvtColor(
            shifted,
            cv2.COLOR_BGR2HSV,
        )

        hist = cv2.calcHist(
            [hsv],
            [0, 1],
            self.ban_mask,
            [16, 8],
            [0, 180, 0, 256],
        )

        hist = hist.flatten()

        hist /= (
            np.linalg.norm(hist)
            + 1e-6
        )

        return (
            z_vec,
            hist.astype(np.float32),
        )

    # =========================================================================
    # HERO BANK LOADING
    # =========================================================================

    def _load_pick_bank(
        self,
        training_subdir: str,
        mirrored: bool = False,
    ) -> Tuple[
        List[str],
        np.ndarray,
        np.ndarray,
    ]:

        names: List[str] = []
        z_vectors: List[np.ndarray] = []
        h_vectors: List[np.ndarray] = []

        hero_dir = self._asset_dir(
            "heroes"
        )

        training_dir = _first_existing(
            [
                os.path.join(
                    self.project_root,
                    "src",
                    "assets",
                    "training",
                    training_subdir,
                ),
                os.path.join(
                    self.project_root,
                    "src",
                    "shared",
                    "training",
                    training_subdir,
                ),
            ]
        )

        if os.path.exists(training_dir):

            for filename in sorted(
                os.listdir(training_dir)
            ):

                if not filename.lower().endswith(
                    ".png"
                ):
                    continue

                hero = os.path.splitext(
                    filename
                )[0].lower()

                path = os.path.join(
                    training_dir,
                    filename,
                )

                image = cv2.imread(path)

                if image is None:
                    continue

                if mirrored:
                    image = cv2.flip(
                        image,
                        1,
                    )

                window = image[
                    self.win_y1:self.win_y2,
                    self.win_x1:self.win_x2,
                ]

                z_vec, h_vec = (
                    self._extract_window_features(
                        window
                    )
                )

                names.append(hero)
                z_vectors.append(z_vec)
                h_vectors.append(h_vec)

        rect_dir = self._asset_dir(
            "rect"
        )

        if os.path.exists(rect_dir):

            for filename in sorted(
                os.listdir(rect_dir)
            ):

                if not filename.lower().endswith(
                    ".png"
                ):
                    continue

                hero = os.path.splitext(
                    filename
                )[0].lower()

                if hero.startswith(
                    "question"
                ):
                    continue

                path = os.path.join(
                    rect_dir,
                    filename,
                )

                image = cv2.imread(path)

                if image is None:
                    continue

                image = _resize_if_needed(
                    image,
                    self.pick_w,
                    self.pick_h,
                )

                if mirrored:
                    image = cv2.flip(
                        image,
                        1,
                    )

                window = image[
                    self.win_y1:self.win_y2,
                    self.win_x1:self.win_x2,
                ]

                z_vec, h_vec = (
                    self._extract_window_features(
                        window
                    )
                )

                names.append(hero)
                z_vectors.append(z_vec)
                h_vectors.append(h_vec)

        if z_vectors:
            z_matrix = np.vstack(
                z_vectors
            ).astype(np.float32)
        else:
            z_matrix = np.zeros(
                (0, self.n_pixels),
                dtype=np.float32,
            )

        if h_vectors:
            h_matrix = np.vstack(
                h_vectors
            ).astype(np.float32)
        else:
            h_matrix = np.zeros(
                (0, 128),
                dtype=np.float32,
            )

        return (
            names,
            z_matrix,
            h_matrix,
        )

    def _load_enemy_bank(self) -> None:

        start = time.perf_counter()

        (
            self.enemy_hero_names,
            self.enemy_zncc_matrix,
            self.enemy_hsv_matrix,
        ) = self._load_pick_bank(
            "enemy_picks",
            mirrored=True,
        )

        self.hero_names = (
            self.enemy_hero_names
        )

        self.rect_zncc_matrix = (
            self.enemy_zncc_matrix
        )

        self.hsv_matrix = (
            self.enemy_hsv_matrix
        )

        elapsed = (
            time.perf_counter()
            - start
        ) * 1000.0

        print(
            "[Matcher] Enemy bank loaded: "
            f"{len(self.enemy_hero_names)} models "
            f"in {elapsed:.1f}ms."
        )

    def _load_ally_bank(self) -> None:

        (
            self.ally_hero_names,
            self.ally_zncc_matrix,
            self.ally_hsv_matrix,
        ) = self._load_pick_bank(
            "ally_picks",
            mirrored=False,
        )

    # =========================================================================
    # BAN BANK
    # =========================================================================

    def _load_ban_bank(self) -> None:

        start = time.perf_counter()

        names: List[str] = []
        z_vectors: List[np.ndarray] = []
        h_vectors: List[np.ndarray] = []

        hero_dir = self._asset_dir(
            "heroes"
        )

        if os.path.exists(hero_dir):

            for filename in sorted(
                os.listdir(hero_dir)
            ):

                if not filename.lower().endswith(
                    ".png"
                ):
                    continue

                hero = os.path.splitext(
                    filename
                )[0].lower()

                if hero.startswith(
                    "question"
                ):
                    continue

                image = cv2.imread(
                    os.path.join(
                        hero_dir,
                        filename,
                    )
                )

                if image is None:
                    continue

                z_vec, h_vec = (
                    self._extract_ban_features(
                        image
                    )
                )

                names.append(hero)
                z_vectors.append(z_vec)
                h_vectors.append(h_vec)

        training_dir = _first_existing(
            [
                os.path.join(
                    self.project_root,
                    "src",
                    "assets",
                    "training",
                    "bans",
                ),
                os.path.join(
                    self.project_root,
                    "src",
                    "shared",
                    "training",
                    "bans",
                ),
            ]
        )

        if os.path.exists(training_dir):

            for filename in sorted(
                os.listdir(training_dir)
            ):

                if not filename.lower().endswith(
                    ".png"
                ):
                    continue

                hero = os.path.splitext(
                    filename
                )[0].lower()

                hero = (
                    hero
                    .replace("ally_", "")
                    .replace("enemy_", "")
                )

                image = cv2.imread(
                    os.path.join(
                        training_dir,
                        filename,
                    )
                )

                if image is None:
                    continue

                z_vec, h_vec = (
                    self._extract_ban_features(
                        image
                    )
                )

                names.append(hero)
                z_vectors.append(z_vec)
                h_vectors.append(h_vec)

        self.ban_hero_names = names

        if z_vectors:
            self.ban_zncc_matrix = (
                np.vstack(
                    z_vectors
                ).astype(np.float32)
            )
        else:
            self.ban_zncc_matrix = (
                np.zeros(
                    (0, self.ban_n_pixels),
                    dtype=np.float32,
                )
            )

        if h_vectors:
            raw_hsv = np.vstack(
                h_vectors
            ).astype(np.float32)

            norms = (
                np.linalg.norm(
                    raw_hsv,
                    axis=1,
                    keepdims=True,
                )
                + 1e-6
            )

            self.ban_hsv_matrix = (
                raw_hsv / norms
            )

        else:
            self.ban_hsv_matrix = (
                np.zeros(
                    (0, 128),
                    dtype=np.float32,
                )
            )

        elapsed = (
            time.perf_counter()
            - start
        ) * 1000.0

        print(
            "[Matcher] Ban bank loaded: "
            f"{len(self.ban_hero_names)} models "
            f"in {elapsed:.1f}ms."
        )

    # =========================================================================
    # ALLY BANK
    # =========================================================================

    def _ensure_ally_bank(self) -> None:
        if not self.ally_hero_names:
            self._load_ally_bank()

    # =========================================================================
    # PICK WINDOW MATCHING
    # =========================================================================

    def _pick_match(
        self,
        crop: np.ndarray,
        side: str,
        slot_index: int,
        taken_bans: Optional[Set[str]] = None,
        taken_picks: Optional[Set[str]] = None,
        threshold: Optional[float] = None,
        top_k: int = 5,
        is_stream: bool = False,
    ) -> Tuple[
        Optional[str],
        float,
        List[Dict[str, Any]],
        float,
        Optional[str],
        Dict[str, Any],
        str,
    ]:

        active_threshold = (
            threshold
            if threshold is not None
            else (
                self.ally_threshold
                if side == "ally"
                else self.enemy_threshold
            )
        )

        excluded = set()

        if taken_bans:
            excluded.update(
                h.lower()
                for h in taken_bans
                if h
            )

        if taken_picks:
            excluded.update(
                h.lower()
                for h in taken_picks
                if h
            )

        debug = {
            "slot_index": slot_index,
            "side": side,
            "crop_shape": (
                crop.shape
                if crop is not None
                and crop.size > 0
                else (0, 0)
            ),
            "mean_bgr": round(
                _safe_mean(crop),
                2,
            ),
            "std_bgr": round(
                _safe_std(crop),
                2,
            ),
            "calibrated_window": (
                self.win_x1,
                self.win_x2,
                self.win_y1,
                self.win_y2,
            ),
            "status": "EVALUATING",
        }

        if (
            crop is None
            or crop.size == 0
            or _safe_mean(crop) < 10.0
            or _safe_std(crop) < 8.0
        ):

            debug["status"] = (
                "EMPTY_NEBULA"
            )

            return (
                None,
                0.0,
                [],
                0.0,
                "EMPTY_SLOT",
                debug,
                "Roam",
            )

        crop = _resize_if_needed(
            crop,
            self.pick_w,
            self.pick_h,
        )

        # ---------------------------------------------------------------------
        # Empty slot detection
        # ---------------------------------------------------------------------

        empty_template = (
            self.empty_ally
            if side == "ally"
            else self.empty_enemy
        )

        empty_similarity = 0.0

        if empty_template is not None:

            template = _resize_if_needed(
                empty_template,
                self.pick_w,
                self.pick_h,
            )

            result = cv2.matchTemplate(
                crop,
                template,
                cv2.TM_CCOEFF_NORMED,
            )

            empty_similarity = float(
                np.max(result)
            )

        if side == "ally":

            if self.empty_ally_dim is not None:

                template = _resize_if_needed(
                    self.empty_ally_dim,
                    self.pick_w,
                    self.pick_h,
                )

                result = cv2.matchTemplate(
                    crop,
                    template,
                    cv2.TM_CCOEFF_NORMED,
                )

                empty_similarity = max(
                    empty_similarity,
                    float(np.max(result)),
                )

        if empty_similarity >= 0.50:

            debug["status"] = (
                "EMPTY_SLOT_DETECTED"
            )

            debug[
                "empty_similarity"
            ] = round(
                empty_similarity,
                4,
            )

            return (
                None,
                0.0,
                [],
                empty_similarity,
                "EMPTY_SLOT",
                debug,
                "Roam",
            )

        # ---------------------------------------------------------------------
        # Select bank
        # ---------------------------------------------------------------------

        if side == "ally":

            self._ensure_ally_bank()

            hero_names = (
                self.ally_hero_names
            )

            zncc_matrix = (
                self.ally_zncc_matrix
            )

            hsv_matrix = (
                self.ally_hsv_matrix
            )

        else:

            hero_names = (
                self.enemy_hero_names
            )

            zncc_matrix = (
                self.enemy_zncc_matrix
            )

            hsv_matrix = (
                self.enemy_hsv_matrix
            )

        if not hero_names:

            debug["status"] = (
                "EMPTY_REFERENCE_BANK"
            )

            return (
                None,
                0.0,
                [],
                empty_similarity,
                "NO_REFERENCE_BANK",
                debug,
                "Roam",
            )

        # ---------------------------------------------------------------------
        # Jitter search
        # ---------------------------------------------------------------------

        best_fused = None
        best_zncc = None
        best_hsv = None

        for dx, dy in OFFSETS:

            y1 = max(
                0,
                min(
                    crop.shape[0] - 20,
                    self.win_y1 + dy,
                ),
            )

            y2 = min(
                crop.shape[0],
                self.win_y2 + dy,
            )

            x1 = max(
                0,
                min(
                    crop.shape[1] - 20,
                    self.win_x1 + dx,
                ),
            )

            x2 = min(
                crop.shape[1],
                self.win_x2 + dx,
            )

            window = crop[
                y1:y2,
                x1:x2,
            ]

            q_zncc, q_hsv = (
                self._extract_window_features(
                    window
                )
            )

            if (
                zncc_matrix.shape[0] == 0
            ):
                continue

            z_scores = (
                np.dot(
                    zncc_matrix,
                    q_zncc,
                )
                / float(
                    self.n_pixels
                )
            )

            h_scores = np.dot(
                hsv_matrix,
                q_hsv,
            )

            fused = (
                0.55 * z_scores
                + 0.45
                * np.maximum(
                    0.0,
                    h_scores,
                )
            )

            if (
                best_fused is None
                or np.max(fused)
                > np.max(best_fused)
            ):

                best_fused = fused
                best_zncc = z_scores
                best_hsv = h_scores

        if best_fused is None:

            debug["status"] = (
                "NO_SIGNAL"
            )

            return (
                None,
                0.0,
                [],
                empty_similarity,
                "EMPTY_SLOT",
                debug,
                "Roam",
            )

        # ---------------------------------------------------------------------
        # Candidate ranking
        # ---------------------------------------------------------------------

        order = np.argsort(
            best_fused
        )[::-1]

        candidates = []
        seen = set()

        for idx in order:

            idx = int(idx)

            hero = hero_names[idx]

            if hero in excluded:
                continue

            if hero in seen:
                continue

            seen.add(hero)

            candidates.append(
                {
                    "hero": hero,
                    "score": round(
                        float(
                            best_fused[idx]
                        ),
                        4,
                    ),
                    "zncc": round(
                        float(
                            best_zncc[idx]
                        ),
                        4,
                    ),
                    "hsv": round(
                        float(
                            best_hsv[idx]
                        ),
                        4,
                    ),
                }
            )

            if len(candidates) >= top_k:
                break

        for i in range(
            len(candidates) - 1
        ):
            candidates[i][
                "margin"
            ] = round(
                candidates[i]["score"]
                - candidates[i + 1]["score"],
                4,
            )

        if candidates:
            candidates[-1][
                "margin"
            ] = 0.0

        top = (
            candidates[0]
            if candidates
            else {
                "hero": None,
                "score": 0.0,
            }
        )

        matched = (
            top["hero"]
            if (
                top["hero"]
                and top["score"]
                >= active_threshold
            )
            else None
        )

        rejection = (
            None
            if matched
            else "LOW_CONFIDENCE"
        )

        # ---------------------------------------------------------------------
        # Temporal smoothing
        # ---------------------------------------------------------------------

        if is_stream:

            if side == "ally":
                matched, confidence, lane = (
                    self._update_ally_temporal(
                        slot_index,
                        matched,
                        top["score"]
                        if matched
                        else 0.0,
                        "Roam",
                    )
                )
            else:
                matched, confidence = (
                    self._update_enemy_temporal(
                        slot_index,
                        matched,
                        top["score"]
                        if matched
                        else 0.0,
                    )
                )

            if matched:
                top["score"] = confidence
                rejection = None

            else:
                rejection = (
                    "TEMPORAL_SMOOTH_REJECT"
                )

        debug["status"] = (
            "MATCHED"
            if matched
            else "REJECTED"
        )

        debug["matched_hero"] = matched
        debug["confidence"] = (
            top["score"]
            if matched
            else 0.0
        )

        debug[
            "empty_similarity"
        ] = round(
            empty_similarity,
            4,
        )

        debug[
            "top_candidates"
        ] = candidates

        return (
            matched,
            top["score"]
            if matched
            else 0.0,
            candidates,
            empty_similarity,
            rejection,
            debug,
            "Roam",
        )

    # =========================================================================
    # ALLY LANE MATCHING
    # =========================================================================

    def _compute_optimal_lanes(
        self,
        crops: List[Optional[np.ndarray]],
    ) -> List[str]:

        if not crops:
            return []

        default_lanes = [
            "Roam",
            "EXP Lane",
            "Gold Lane",
            "Jungle",
            "Mid Lane",
        ]

        matrix = np.zeros(
            (
                len(crops),
                len(self.lane_keys),
            ),
            dtype=np.float32,
        )

        for row, crop in enumerate(crops):

            if (
                crop is None
                or crop.size == 0
                or not self.lane_templates
            ):
                continue

            crop = _resize_if_needed(
                crop,
                self.pick_w,
                self.pick_h,
            )

            lane_area = crop[
                45:105,
                0:56,
            ]

            for col, lane in enumerate(
                self.lane_keys
            ):

                best = -1.0

                for scale in (
                    self.lane_scales
                ):

                    template = (
                        self.scaled_lane_templates.get(
                            (lane, scale)
                        )
                    )

                    if template is None:
                        continue

                    if (
                        template.shape[0]
                        >= lane_area.shape[0]
                        or template.shape[1]
                        >= lane_area.shape[1]
                    ):
                        continue

                    result = cv2.matchTemplate(
                        lane_area,
                        template,
                        cv2.TM_CCOEFF_NORMED,
                    )

                    _, value, _, _ = (
                        cv2.minMaxLoc(
                            result
                        )
                    )

                    best = max(
                        best,
                        float(value),
                    )

                matrix[
                    row,
                    col,
                ] = best

        try:

            from scipy.optimize import (
                linear_sum_assignment
            )

            rows, cols = (
                linear_sum_assignment(
                    -matrix
                )
            )

            assigned = [
                default_lanes[
                    i % len(default_lanes)
                ]
                for i in range(
                    len(crops)
                )
            ]

            for row, col in zip(
                rows,
                cols,
            ):
                assigned[row] = (
                    self.lane_display_map[
                        self.lane_keys[col]
                    ]
                )

            return assigned

        except Exception:

            used = set()
            assigned = []

            for row in range(
                len(crops)
            ):

                chosen = None

                for col in np.argsort(
                    -matrix[row]
                ):

                    lane_name = (
                        self.lane_display_map[
                            self.lane_keys[
                                int(col)
                            ]
                        ]
                    )

                    if lane_name not in used:
                        chosen = lane_name
                        break

                if chosen is None:

                    for lane_name in (
                        default_lanes
                    ):

                        if (
                            lane_name
                            not in used
                        ):
                            chosen = lane_name
                            break

                chosen = (
                    chosen
                    or default_lanes[
                        row
                        % len(default_lanes)
                    ]
                )

                used.add(chosen)
                assigned.append(chosen)

            return assigned

    # =========================================================================
    # TEMPORAL STATE
    # =========================================================================

    def _update_ally_temporal(
        self,
        slot_idx: int,
        hero: Optional[str],
        score: float,
        lane: str,
    ) -> Tuple[
        Optional[str],
        float,
        str,
    ]:

        key = f"ally_pick_{slot_idx}"

        buf = (
            self.ally_temporal_buffers[
                key
            ]
        )

        now = time.time()

        if hero and score >= self.ally_threshold:
            buf.append(
                (
                    hero,
                    score,
                    lane,
                    now,
                )
            )
        else:
            buf.append(
                (
                    None,
                    0.0,
                    lane,
                    now,
                )
            )

        if (
            sum(
                1
                for h, _, _, _ in buf
                if h is None
            )
            >= 3
        ):

            self.ally_last_confirmed[
                key
            ] = (
                None,
                0.0,
                "-",
            )

            return None, 0.0, "-"

        scores: Dict[
            str,
            Tuple[float, str],
        ] = {}

        for (
            current_hero,
            current_score,
            current_lane,
            timestamp,
        ) in buf:

            if (
                current_hero
                and now - timestamp
                <= self.hold_seconds
            ):

                old = scores.get(
                    current_hero
                )

                if (
                    old is None
                    or current_score
                    > old[0]
                ):
                    scores[
                        current_hero
                    ] = (
                        current_score,
                        current_lane,
                    )

        if scores:

            peak = max(
                scores,
                key=lambda hero:
                    scores[hero][0],
            )

            confidence, lane = (
                scores[peak]
            )

            self.ally_last_confirmed[
                key
            ] = (
                peak,
                confidence,
                lane,
            )

            return (
                peak,
                confidence,
                lane,
            )

        self.ally_last_confirmed[
            key
        ] = (
            None,
            0.0,
            "-",
        )

        return None, 0.0, "-"

    def _update_enemy_temporal(
        self,
        slot_idx: int,
        hero: Optional[str],
        score: float,
    ) -> Tuple[
        Optional[str],
        float,
    ]:

        key = f"enemy_pick_{slot_idx}"

        buf = (
            self.enemy_temporal_buffers[
                key
            ]
        )

        now = time.time()

        if (
            hero
            and score >= self.enemy_threshold
        ):
            buf.append(
                (
                    hero,
                    score,
                    now,
                )
            )
        else:
            buf.append(
                (
                    None,
                    0.0,
                    now,
                )
            )

        if (
            sum(
                1
                for h, _, _ in buf
                if h is None
            )
            >= 3
        ):

            self.enemy_last_confirmed[
                key
            ] = (
                None,
                0.0,
            )

            return None, 0.0

        scores: Dict[
            str,
            float,
        ] = {}

        for (
            current_hero,
            current_score,
            timestamp,
        ) in buf:

            if (
                current_hero
                and now - timestamp
                <= self.hold_seconds
            ):
                scores[
                    current_hero
                ] = max(
                    scores.get(
                        current_hero,
                        0.0,
                    ),
                    current_score,
                )

        if scores:

            peak = max(
                scores,
                key=scores.get,
            )

            confidence = scores[
                peak
            ]

            self.enemy_last_confirmed[
                key
            ] = (
                peak,
                confidence,
            )

            return (
                peak,
                confidence,
            )

        self.enemy_last_confirmed[
            key
        ] = (
            None,
            0.0,
        )

        return None, 0.0

    # =========================================================================
    # PUBLIC PICK API
    # =========================================================================

    def match_picks(
        self,
        pick_rois: List[Dict[str, Any]],
        taken_bans: Optional[Set[str]] = None,
        threshold: Optional[float] = None,
        top_k: int = 5,
        is_stream: bool = False,
    ) -> Tuple[
        List[Dict[str, Any]],
        float,
        List[Dict[str, Any]],
    ]:

        start = time.perf_counter()

        self._ensure_ally_bank()

        results = []
        debug_array = []

        taken_heroes: Set[str] = set()

        crops = [
            roi.get("crop")
            for roi in pick_rois[:10]
        ]

        ally_crops = crops[:5]

        lanes = (
            self._compute_optimal_lanes(
                ally_crops
            )
        )

        for index, roi in enumerate(
            pick_rois[:10]
        ):

            crop = roi.get(
                "crop"
            )

            if index < 5:

                side = "ally"

                assigned_lane = (
                    lanes[index]
                    if index < len(lanes)
                    else "Roam"
                )

            else:

                side = "enemy"
                assigned_lane = "Roam"

            (
                hero,
                confidence,
                candidates,
                empty_similarity,
                rejection,
                diagnostics,
                _,
            ) = self._pick_match(
                crop=crop,
                side=side,
                slot_index=(
                    index
                    if index < 5
                    else index - 5
                ),
                taken_bans=taken_bans,
                taken_picks=taken_heroes,
                threshold=threshold,
                top_k=top_k,
                is_stream=is_stream,
            )

            # -----------------------------------------------------------------
            # Global duplicate prevention
            # -----------------------------------------------------------------

            if (
                hero
                and hero in taken_heroes
            ):

                replacement = None

                active_threshold = (
                    threshold
                    if threshold is not None
                    else (
                        self.ally_threshold
                        if side == "ally"
                        else self.enemy_threshold
                    )
                )

                for candidate in (
                    candidates[1:]
                ):

                    candidate_hero = (
                        candidate["hero"]
                    )

                    if (
                        candidate_hero
                        not in taken_heroes
                        and candidate[
                            "score"
                        ] >= active_threshold
                    ):
                        replacement = (
                            candidate
                        )
                        break

                if replacement:

                    hero = replacement[
                        "hero"
                    ]

                    confidence = (
                        replacement[
                            "score"
                        ]
                    )

                    rejection = None

                else:

                    hero = None
                    confidence = 0.0
                    rejection = (
                        "DUPLICATE_PICK"
                    )

            if hero:
                taken_heroes.add(hero)

            result = {
                "slot_index": index,
                "side": side,
                "matched_hero": hero,
                "detected_lane": (
                    assigned_lane
                    if side == "ally"
                    else "-"
                ),
                "confidence": confidence,
                "top_k_candidates": candidates,
                "empty_similarity": (
                    round(
                        empty_similarity,
                        4,
                    )
                ),
                "rejection_reason": rejection,
            }

            results.append(result)

            debug_array.append(
                {
                    **result,
                    "diagnostics": diagnostics,
                }
            )

        elapsed = (
            time.perf_counter()
            - start
        ) * 1000.0

        return (
            results,
            elapsed,
            debug_array,
        )

    def match_all_picks(
        self,
        pick_crops: List[
            Optional[np.ndarray]
        ],
        taken_bans: Optional[Set[str]] = None,
        is_stream: bool = False,
    ) -> List[
        Tuple[
            Optional[str],
            float,
            str,
        ]
    ]:

        rois = [
            {
                "crop": crop
            }
            for crop in pick_crops
        ]

        results, _, _ = (
            self.match_picks(
                rois,
                taken_bans=taken_bans,
                is_stream=is_stream,
            )
        )

        return [
            (
                result[
                    "matched_hero"
                ],
                result[
                    "confidence"
                ],
                result.get(
                    "detected_lane",
                    "-",
                ),
            )
            for result in results
        ]

    # =========================================================================
    # BAN MATCHING
    # =========================================================================

    def match_bans(
        self,
        ban_rois: List[Dict[str, Any]],
        threshold: Optional[float] = None,
        top_k: int = 5,
    ) -> Tuple[
        List[Dict[str, Any]],
        float,
    ]:

        start = time.perf_counter()

        active_threshold = (
            threshold
            if threshold is not None
            else self.ban_threshold
        )

        results = []
        taken_bans: Set[str] = set()

        for index, roi in enumerate(
            ban_rois[:10]
        ):

            crop = roi.get(
                "crop"
            )

            side = roi.get(
                "side",
                "ally",
            )

            roi_key = roi.get(
                "roi_key",
                f"{side}_ban_{index}",
            )

            bbox = roi.get(
                "bbox",
                (0, 0, 80, 80),
            )

            base_result = {
                "slot_index": index,
                "side": side,
                "roi_key": roi_key,
                "bbox": bbox,
                "matched_hero": None,
                "confidence": 0.0,
                "rejection_reason": None,
                "empty_similarity": 0.0,
                "top_k_candidates": [],
            }

            if (
                crop is None
                or crop.size == 0
                or _safe_mean(crop) < 10.0
                or _safe_std(crop) < 7.0
            ):

                base_result[
                    "rejection_reason"
                ] = (
                    "DARK_OR_EMPTY_SLOT"
                )

                results.append(
                    base_result
                )

                continue

            crop_80 = _resize_if_needed(
                crop,
                80,
                80,
            )

            # -------------------------------------------------------------
            # Empty question-mark template
            # -------------------------------------------------------------

            empty_template = (
                self.empty_ban_ally_img
                if side == "ally"
                else self.empty_ban_enemy_img
            )

            empty_similarity = 0.0

            if empty_template is not None:

                similarity = cv2.matchTemplate(
                    crop_80,
                    empty_template,
                    cv2.TM_CCOEFF_NORMED,
                )

                empty_similarity = float(
                    similarity[0, 0]
                )

            base_result[
                "empty_similarity"
            ] = round(
                empty_similarity,
                4,
            )

            if empty_similarity >= 0.45:

                base_result[
                    "rejection_reason"
                ] = (
                    "EMPTY_QUESTION_SLOT"
                )

                results.append(
                    base_result
                )

                continue

            # -------------------------------------------------------------
            # Multi-offset matching
            # -------------------------------------------------------------

            best_fused = None
            best_zncc = None
            best_hsv = None

            for dx, dy in OFFSETS:

                q_zncc, q_hsv = (
                    self._extract_ban_features(
                        crop_80,
                        dx=dx,
                        dy=dy,
                    )
                )

                if (
                    self.ban_zncc_matrix.shape[
                        0
                    ]
                    == 0
                ):
                    continue

                z_scores = (
                    np.dot(
                        self.ban_zncc_matrix,
                        q_zncc,
                    )
                    / float(
                        self.ban_n_pixels
                    )
                )

                q_norm = (
                    q_hsv
                    / (
                        np.linalg.norm(
                            q_hsv
                        )
                        + 1e-6
                    )
                )

                h_scores = np.dot(
                    self.ban_hsv_matrix,
                    q_norm,
                )

                fused = (
                    0.60 * z_scores
                    + 0.40
                    * np.maximum(
                        0.0,
                        h_scores,
                    )
                )

                if (
                    best_fused is None
                    or np.max(fused)
                    > np.max(best_fused)
                ):

                    best_fused = fused
                    best_zncc = z_scores
                    best_hsv = h_scores

            if best_fused is None:

                base_result[
                    "rejection_reason"
                ] = "NO_REFERENCE_BANK"

                results.append(
                    base_result
                )

                continue

            # -------------------------------------------------------------
            # Candidate list
            # -------------------------------------------------------------

            order = np.argsort(
                best_fused
            )[::-1]

            candidates = []
            seen = set()

            for idx in order:

                idx = int(idx)

                hero = (
                    self.ban_hero_names[
                        idx
                    ]
                )

                if hero in seen:
                    continue

                seen.add(hero)

                candidates.append(
                    {
                        "hero": hero,
                        "score": round(
                            float(
                                best_fused[
                                    idx
                                ]
                            ),
                            4,
                        ),
                        "zncc": round(
                            float(
                                best_zncc[
                                    idx
                                ]
                            ),
                            4,
                        ),
                        "hsv": round(
                            float(
                                best_hsv[
                                    idx
                                ]
                            ),
                            4,
                        ),
                    }
                )

                if len(candidates) >= top_k:
                    break

            for i in range(
                len(candidates) - 1
            ):
                candidates[i][
                    "margin"
                ] = round(
                    candidates[i]["score"]
                    - candidates[
                        i + 1
                    ]["score"],
                    4,
                )

            if candidates:
                candidates[-1][
                    "margin"
                ] = 0.0

            base_result[
                "top_k_candidates"
            ] = candidates

            if not candidates:

                base_result[
                    "rejection_reason"
                ] = "NO_CANDIDATE"

                results.append(
                    base_result
                )

                continue

            top = candidates[0]

            # -------------------------------------------------------------
            # Confidence + duplicate protection
            # -------------------------------------------------------------

            if top["score"] < active_threshold:

                base_result[
                    "rejection_reason"
                ] = "LOW_CONFIDENCE"

            elif top["hero"] in taken_bans:

                replacement = None

                for candidate in (
                    candidates[1:]
                ):

                    if (
                        candidate[
                            "hero"
                        ]
                        not in taken_bans
                        and candidate[
                            "score"
                        ]
                        >= active_threshold
                    ):
                        replacement = (
                            candidate
                        )
                        break

                if replacement:

                    top = replacement

                else:

                    base_result[
                        "rejection_reason"
                    ] = (
                        "DUPLICATE_BAN_PREVENTED"
                    )

            if (
                top["score"]
                >= active_threshold
                and top["hero"]
                not in taken_bans
            ):

                base_result[
                    "matched_hero"
                ] = top["hero"]

                base_result[
                    "confidence"
                ] = top["score"]

                taken_bans.add(
                    top["hero"]
                )

            # -------------------------------------------------------------
            # Temporal ban smoothing is deliberately only applied by
            # match_slot(), matching the original public API.
            # -------------------------------------------------------------

            results.append(
                base_result
            )

        elapsed = (
            time.perf_counter()
            - start
        ) * 1000.0

        return (
            results,
            elapsed,
        )

    def match_slot(
        self,
        slot_crop: np.ndarray,
        slot_idx: int,
        taken_bans: Optional[Set[str]] = None,
        is_stream: bool = False,
    ) -> Tuple[
        Optional[str],
        float,
    ]:

        if (
            slot_crop is None
            or slot_crop.size == 0
        ):

            if is_stream:

                key = (
                    f"ban_{slot_idx}"
                )

                buffer = (
                    self.ban_temporal_buffers[
                        key
                    ]
                )

                buffer.append(
                    (
                        None,
                        0.0,
                        time.time(),
                    )
                )

                if (
                    sum(
                        1
                        for hero, _, _ in buffer
                        if hero is None
                    )
                    >= 3
                ):

                    self.ban_last_confirmed[
                        key
                    ] = (
                        None,
                        0.0,
                    )

                    return None, 0.0

                return (
                    self.ban_last_confirmed.get(
                        key,
                        (None, 0.0),
                    )
                )

            return None, 0.0

        side = (
            "ally"
            if slot_idx < 5
            else "enemy"
        )

        roi = {
            "crop": slot_crop,
            "side": side,
            "roi_key": (
                f"{side}_ban_{slot_idx}"
            ),
        }

        results, _ = (
            self.match_bans(
                [roi],
                threshold=self.ban_threshold,
                top_k=5,
            )
        )

        top = (
            results[0]
            if results
            else {}
        )

        matched = top.get(
            "matched_hero"
        )

        confidence = top.get(
            "confidence",
            0.0,
        )

        if not is_stream:
            return matched, confidence

        key = f"ban_{slot_idx}"

        buffer = (
            self.ban_temporal_buffers[
                key
            ]
        )

        now = time.time()

        if (
            matched
            and confidence
            >= self.ban_threshold
        ):

            buffer.append(
                (
                    matched,
                    confidence,
                    now,
                )
            )

        else:

            buffer.append(
                (
                    None,
                    0.0,
                    now,
                )
            )

        if (
            sum(
                1
                for hero, _, _ in buffer
                if hero is None
            )
            >= 3
        ):

            self.ban_last_confirmed[
                key
            ] = (
                None,
                0.0,
            )

            return None, 0.0

        scores: Dict[
            str,
            float,
        ] = {}

        for (
            hero,
            score,
            timestamp,
        ) in buffer:

            if (
                hero
                and now - timestamp
                <= self.hold_seconds
            ):

                scores[hero] = max(
                    scores.get(
                        hero,
                        0.0,
                    ),
                    score,
                )

        if scores:

            peak = max(
                scores,
                key=scores.get,
            )

            confidence = scores[
                peak
            ]

            self.ban_last_confirmed[
                key
            ] = (
                peak,
                confidence,
            )

            return (
                peak,
                confidence,
            )

        self.ban_last_confirmed[
            key
        ] = (
            None,
            0.0,
        )

        return None, 0.0

    # =========================================================================
    # RESET
    # =========================================================================

    def reset_buffers(self) -> None:

        for buffer in (
            self.ally_temporal_buffers.values()
        ):
            buffer.clear()

        for buffer in (
            self.enemy_temporal_buffers.values()
        ):
            buffer.clear()

        for buffer in (
            self.ban_temporal_buffers.values()
        ):
            buffer.clear()

        for key in (
            self.ally_last_confirmed
        ):
            self.ally_last_confirmed[
                key
            ] = (
                None,
                0.0,
                "-",
            )

        for key in (
            self.enemy_last_confirmed
        ):
            self.enemy_last_confirmed[
                key
            ] = (
                None,
                0.0,
            )

        for key in (
            self.ban_last_confirmed
        ):
            self.ban_last_confirmed[
                key
            ] = (
                None,
                0.0,
            )

        self.phase_fsm.reset()

        self.current_phase = "N/A"
        self.current_confidence = 0.0

    # =========================================================================
    # PHASE DETECTION
    # =========================================================================

    def _load_phase_database(self) -> None:

        self.phase_anchor_db = PhaseAnchorDB(
            self.project_root
        )

    def match_phase(
        self,
        frame: np.ndarray,
    ) -> Dict[str, Any]:

        valid, transient, reason, stats = (
            FrameIntegrityGuard.inspect(
                frame
            )
        )

        if not valid:

            return {
                "phase": "N/A",
                "confidence": 0.0,
                "details": reason,
                "metrics": {},
                "sub_phase": None,
                "is_transient": False,
            }

        if transient:

            phase, confidence = (
                self.phase_fsm.update(
                    self.current_phase,
                    self.current_confidence,
                    is_transient=True,
                )
            )

            return {
                "phase": phase,
                "confidence": confidence,
                "details": (
                    f"Transient hold: {reason}"
                ),
                "metrics": stats,
                "sub_phase": None,
                "is_transient": True,
            }

        detected, score, anchors = (
            self.phase_anchor_db.match_phase_ncc(
                frame
            )
        )

        if detected == "N/A":

            phase, confidence = (
                self.phase_fsm.update(
                    "N/A",
                    0.0,
                )
            )

            self.current_phase = phase
            self.current_confidence = confidence

            return {
                "phase": phase,
                "confidence": confidence,
                "details": (
                    "N/A — No anchor template matched"
                ),
                "metrics": {
                    "matched_anchors": 0
                },
                "sub_phase": None,
                "is_transient": False,
            }

        sub_phase = None

        if detected == "Draft Pick":
            sub_phase = (
                self._detect_draft_sub_phase(
                    frame
                )
            )

        phase, confidence = (
            self.phase_fsm.update(
                detected,
                score,
            )
        )

        self.current_phase = phase
        self.current_confidence = confidence

        return {
            "phase": phase,
            "confidence": confidence,
            "details": (
                f"{phase} confirmed "
                f"(NCC={score:.3f})"
            ),
            "metrics": {
                "ncc_score": score,
                "matched_anchors": len(
                    anchors
                ),
                "anchors": [
                    (
                        p,
                        filename,
                        round(
                            value,
                            3,
                        ),
                    )
                    for (
                        p,
                        filename,
                        value,
                    ) in anchors
                ],
            },
            "sub_phase": sub_phase,
            "is_transient": False,
        }

    def _detect_draft_sub_phase(
        self,
        frame: np.ndarray,
    ) -> str:

        if frame is None or frame.size == 0:
            return "Ban Phase"

        h, w = frame.shape[:2]

        roi = frame[
            0:int(h * 0.09),
            int(w * 0.35):int(w * 0.65),
        ]

        if roi.size == 0:
            return "Ban Phase"

        hsv = cv2.cvtColor(
            roi,
            cv2.COLOR_BGR2HSV,
        )

        red_1 = cv2.inRange(
            hsv,
            (0, 70, 70),
            (15, 255, 255),
        )

        red_2 = cv2.inRange(
            hsv,
            (165, 70, 70),
            (180, 255, 255),
        )

        red_ratio = (
            np.sum(red_1 > 0)
            + np.sum(red_2 > 0)
        ) / float(
            roi.shape[0]
            * roi.shape[1]
        )

        return (
            "Ban Phase"
            if red_ratio >= 0.035
            else "Pick Phase"
        )


# =============================================================================
# FRAME INTEGRITY
# =============================================================================

class FrameIntegrityGuard:

    @staticmethod
    def inspect(
        frame: np.ndarray,
    ) -> Tuple[
        bool,
        bool,
        str,
        Dict[str, float],
    ]:

        if frame is None or frame.size == 0:

            return (
                False,
                False,
                "Corrupted / None frame",
                {},
            )

        if len(frame.shape) == 3:

            gray = cv2.cvtColor(
                frame,
                cv2.COLOR_BGR2GRAY,
            )

        else:
            gray = frame

        mean_value = float(
            np.mean(gray)
        )

        std_value = float(
            np.std(gray)
        )

        stats = {
            "mean": mean_value,
            "std": std_value,
        }

        if (
            mean_value < 3.0
            and std_value < 2.0
        ):

            return (
                True,
                True,
                "Black fade / Scene load",
                stats,
            )

        if (
            mean_value > 252.0
            and std_value < 2.0
        ):

            return (
                True,
                True,
                "White flash / Scene transition",
                stats,
            )

        return (
            True,
            False,
            "Normal game frame",
            stats,
        )


# =============================================================================
# PHASE FSM
# =============================================================================

class PhaseFSM:

    def __init__(
        self,
        history_len: int = 5,
    ):
        self.history = deque(
            maxlen=history_len
        )

        self.current_phase = "N/A"
        self.current_confidence = 0.0

    def reset(self) -> None:
        self.history.clear()
        self.current_phase = "N/A"
        self.current_confidence = 0.0

    def update(
        self,
        detected_phase: str,
        confidence: float,
        is_transient: bool = False,
    ) -> Tuple[str, float]:

        if is_transient:
            return (
                self.current_phase,
                self.current_confidence,
            )

        self.history.append(
            (
                detected_phase,
                confidence,
            )
        )

        if (
            len(self.history) == 1
            or confidence >= 0.65
        ):

            self.current_phase = (
                detected_phase
            )

            self.current_confidence = (
                confidence
            )

            return (
                self.current_phase,
                self.current_confidence,
            )

        counts = Counter(
            phase
            for phase, _ in self.history
        )

        most_common, count = (
            counts.most_common(1)[0]
        )

        if (
            count >= 2
            or confidence >= 0.60
        ):

            values = [
                value
                for phase, value
                in self.history
                if phase == most_common
            ]

            self.current_phase = (
                most_common
            )

            self.current_confidence = (
                float(np.mean(values))
                if values
                else 0.0
            )

        return (
            self.current_phase,
            self.current_confidence,
        )


# =============================================================================
# PHASE ANCHOR DATABASE
# =============================================================================

class PhaseAnchorDB:

    ANCHORS_CONFIG = [

        (
            "Matchmaking",
            "matchmaking_top_banner.png",
            (700, 0, 1220, 105),
            0.60,
        ),

        (
            "In Game ScoreBoard",
            "scoreboard_equipment_tab.png",
            (30, 75, 480, 160),
            0.70,
        ),

        (
            "In Game ScoreBoard",
            "scoreboard_vs_header.png",
            (650, 145, 1270, 215),
            0.70,
        ),

        (
            "Match Start",
            "matchstart_enter_btn.png",
            (680, 825, 1240, 925),
            0.70,
        ),

        (
            "Draft Pick",
            "draft_battlefield_badge.png",
            (1500, 880, 1920, 1020),
            0.65,
        ),

        (
            "Draft Pick",
            "draft_hero_prep_tabs.png",
            (680, 880, 1300, 1000),
            0.65,
        ),

        (
            "Draft Pick",
            "draft_search_icon.png",
            (300, 110, 500, 220),
            0.65,
        ),

        (
            "Draft Pick",
            "draft_bottom_chat_dock.png",
            (0, 880, 320, 1020),
            0.60,
        ),

        (
            "Draft Pick",
            "draft_ally_slot_frame.png",
            (0, 115, 230, 275),
            0.65,
        ),

        (
            "Draft Pick",
            "draft_enemy_slot_frame.png",
            (1690, 115, 1920, 275),
            0.65,
        ),

        (
            "Draft Pick",
            "draft_ban_slot_frame.png",
            (20, 0, 120, 95),
            0.65,
        ),

        (
            "In Game",
            "ingame_recall_regen.png",
            (900, 750, 1360, 1060),
            0.70,
        ),

        (
            "In Game",
            "ingame_top_gold_purse.png",
            (1750, 5, 1920, 90),
            0.70,
        ),

        (
            "Homepage",
            "hp_bottom_tabs.png",
            (280, 980, 720, 1070),
            0.70,
        ),

        (
            "Homepage",
            "hp_mode_icon.png",
            (1300, 920, 1430, 1060),
            0.70,
        ),

        (
            "Lobby",
            "lobby_start_btn.png",
            (400, 845, 940, 950),
            0.70,
        ),

        (
            "Lobby",
            "lobby_header_title.png",
            (25, 25, 360, 90),
            0.70,
        ),
    ]

    def __init__(
        self,
        project_root: Optional[str] = None,
    ):

        if project_root is None:

            project_root = os.path.abspath(
                os.path.join(
                    os.path.dirname(__file__),
                    "..",
                )
            )

        self.project_root = (
            project_root
        )

        self.anchors_dir = _first_existing(
            [
                os.path.join(
                    project_root,
                    "src",
                    "assets",
                    "templates",
                    "Phase Template",
                    "anchors",
                ),
                os.path.join(
                    project_root,
                    "src",
                    "shared",
                    "assets",
                    "templates",
                    "Phase Template",
                    "anchors",
                ),
                os.path.join(
                    project_root,
                    "assets",
                    "templates",
                    "Phase Template",
                    "anchors",
                ),
            ]
        )

        self.clahe = cv2.createCLAHE(
            clipLimit=2.0,
            tileGridSize=(8, 8),
        )

        self.anchors = []

        self._load_anchors()

    def _load_anchors(self) -> None:

        loaded = 0

        for (
            phase,
            filename,
            coordinates,
            threshold,
        ) in self.ANCHORS_CONFIG:

            path = os.path.join(
                self.anchors_dir,
                filename,
            )

            image = cv2.imread(path)

            if image is None:

                print(
                    "[PhaseAnchorDB] WARNING: "
                    f"Missing anchor template: "
                    f"{filename}"
                )

                continue

            gray = cv2.cvtColor(
                image,
                cv2.COLOR_BGR2GRAY,
            )

            gray = self.clahe.apply(
                gray
            )

            self.anchors.append(
                (
                    phase,
                    filename,
                    coordinates,
                    threshold,
                    gray,
                )
            )

            loaded += 1

        print(
            "[PhaseAnchorDB] Loaded "
            f"{loaded}/"
            f"{len(self.ANCHORS_CONFIG)} "
            "precision UI anchors."
        )

    def match_phase_ncc(
        self,
        frame: np.ndarray,
    ) -> Tuple[
        str,
        float,
        List[
            Tuple[str, str, float]
        ],
    ]:

        h, w = frame.shape[:2]

        gray = cv2.cvtColor(
            frame,
            cv2.COLOR_BGR2GRAY,
        )

        gray = self.clahe.apply(
            gray
        )

        scores: Dict[
            str,
            float,
        ] = {}

        matched = []

        for (
            phase,
            filename,
            coords,
            threshold,
            reference,
        ) in self.anchors:

            x1, y1, x2, y2 = coords

            rx1 = int(
                x1
                / 1920.0
                * w
            )

            rx2 = int(
                x2
                / 1920.0
                * w
            )

            ry1 = int(
                y1
                / 1080.0
                * h
            )

            ry2 = int(
                y2
                / 1080.0
                * h
            )

            crop = gray[
                ry1:ry2,
                rx1:rx2,
            ]

            if crop.size == 0:
                continue

            if (
                crop.shape[0]
                < reference.shape[0]
                or crop.shape[1]
                < reference.shape[1]
            ):

                crop = cv2.resize(
                    crop,
                    (
                        reference.shape[1],
                        reference.shape[0],
                    ),
                )

            result = cv2.matchTemplate(
                crop,
                reference,
                cv2.TM_CCOEFF_NORMED,
            )

            score = float(
                np.max(result)
            )

            if score >= threshold:

                matched.append(
                    (
                        phase,
                        filename,
                        score,
                    )
                )

                if (
                    phase not in scores
                    or score
                    > scores[phase]
                ):
                    scores[phase] = score

        priority = [
            "Matchmaking",
            "In Game ScoreBoard",
            "Match Start",
            "Draft Pick",
            "In Game",
            "Lobby",
            "Homepage",
        ]

        for phase in priority:

            if phase in scores:

                return (
                    phase,
                    scores[phase],
                    matched,
                )

        return (
            "N/A",
            0.0,
            [],
        )


# =============================================================================
# BACKWARDS-COMPATIBILITY CLASSES
# =============================================================================
#
# These allow existing code to migrate gradually.
# Eventually these can be removed and all callers can simply use Matcher.
# =============================================================================


class BanMatcher(Matcher):

    def __init__(
        self,
        project_root: Optional[str] = None,
        threshold: float = 0.60,
    ):
        super().__init__(
            project_root=project_root,
            threshold=threshold,
            ban_threshold=threshold,
        )


class AllyPickMatcher(Matcher):

    def __init__(
        self,
        project_root: Optional[str] = None,
        threshold: float = 0.50,
        analyzer: Optional[Any] = None,
    ):
        super().__init__(
            project_root=project_root,
            threshold=threshold,
            ally_threshold=threshold,
            analyzer=analyzer,
        )

    @property
    def pick_hero_names(self) -> List[str]:
        self._ensure_ally_bank()
        return self.ally_hero_names

    def match_slot(
        self,
        crop: np.ndarray,
        slot_index: int = 0,
        taken_bans: Optional[Set[str]] = None,
        threshold: Optional[float] = None,
        top_k: int = 5,
        is_stream: bool = False,
        assigned_lane: Optional[str] = None,
    ):
        result = self._pick_match(
            crop=crop,
            side="ally",
            slot_index=slot_index,
            taken_bans=taken_bans,
            threshold=threshold,
            top_k=top_k,
            is_stream=is_stream,
        )

        (
            hero,
            confidence,
            candidates,
            empty_similarity,
            rejection,
            diagnostics,
            lane,
        ) = result

        if assigned_lane:
            lane = assigned_lane

        return (
            hero,
            confidence,
            lane,
            candidates,
            empty_similarity,
            rejection,
            diagnostics,
        )


class EnemyPickMatcher(Matcher):

    def __init__(
        self,
        project_root: Optional[str] = None,
        threshold: float = 0.50,
        analyzer: Optional[Any] = None,
    ):
        super().__init__(
            project_root=project_root,
            threshold=threshold,
            enemy_threshold=threshold,
            analyzer=analyzer,
        )

    @property
    def pick_hero_names(self) -> List[str]:
        return self.enemy_hero_names

    def match_slot(
        self,
        crop: np.ndarray,
        slot_index: int = 0,
        taken_bans: Optional[Set[str]] = None,
        threshold: Optional[float] = None,
        top_k: int = 5,
        is_stream: bool = False,
    ):
        (
            hero,
            confidence,
            candidates,
            empty_similarity,
            rejection,
            diagnostics,
            _,
        ) = self._pick_match(
            crop=crop,
            side="enemy",
            slot_index=slot_index,
            taken_bans=taken_bans,
            threshold=threshold,
            top_k=top_k,
            is_stream=is_stream,
        )

        return (
            hero,
            confidence,
            candidates,
            empty_similarity,
            rejection,
            diagnostics,
        )


class PhaseMatcher(Matcher):

    def __init__(
        self,
        project_root: Optional[str] = None,
    ):
        super().__init__(
            project_root=project_root
        )

    @property
    def fsm(self):
        return self.phase_fsm

    @property
    def anchor_db(self):
        return self.phase_anchor_db


# =============================================================================
# MODULE-LEVEL COMPATIBILITY SINGLETON
# =============================================================================

_GLOBAL_PHASE_ANCHOR_DB: Optional[
    PhaseAnchorDB
] = None


def get_phase_anchor_db(
    project_root: Optional[str] = None,
) -> PhaseAnchorDB:

    global _GLOBAL_PHASE_ANCHOR_DB

    if _GLOBAL_PHASE_ANCHOR_DB is None:

        _GLOBAL_PHASE_ANCHOR_DB = (
            PhaseAnchorDB(
                project_root
            )
        )

    return _GLOBAL_PHASE_ANCHOR_DB


# =============================================================================
# OPTIONAL FACTORY
# =============================================================================

def create_matcher(
    project_root: Optional[str] = None,
    threshold: float = 0.50,
    ban_threshold: float = 0.60,
    analyzer: Optional[Any] = None,
) -> Matcher:

    return Matcher(
        project_root=project_root,
        threshold=threshold,
        ban_threshold=ban_threshold,
        analyzer=analyzer,
    )


__all__ = [
    "Matcher",
    "BanMatcher",
    "AllyPickMatcher",
    "EnemyPickMatcher",
    "PhaseMatcher",
    "PhaseFSM",
    "PhaseAnchorDB",
    "FrameIntegrityGuard",
    "get_phase_anchor_db",
    "create_matcher",
]
