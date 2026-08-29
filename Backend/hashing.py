# =============================================================================
#   MLBB COMPANION — PERCEPTUAL HASHING & FAST SIMD MATH (hashing.py)
# =============================================================================
#   Role & Purpose in Project:
#     This file provides lightweight mathematical primitives for computing 64-bit
#     difference hashes (dHash) and calculating bitwise Hamming distances.
#     
#     Key Applications:
#       1. Duplicate Frame Skipping: Subsamples and hashes raw screencap frames to
#          skip redundant OpenCV decoding when the screen hasn't changed.
#       2. Coarse Pre-Filtering: Enables fast O(1) candidate narrowing before running
#          dense floating-point ZNCC tensor calculations.
# =============================================================================

import cv2
import numpy as np


def compute_dhash(image: np.ndarray, hash_size: int = 8) -> int:
    """Computes 64-bit difference hash (dHash) for rapid perceptual pre-filtering."""
    if image is None or image.size == 0:
        return 0
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    resized = cv2.resize(gray, (hash_size + 1, hash_size), interpolation=cv2.INTER_AREA)
    diff = resized[:, 1:] > resized[:, :-1]
    return sum([2 ** i for (i, v) in enumerate(diff.flatten()) if v])


def hamming_distance(h1: int, h2: int) -> int:
    """Calculates bitwise Hamming distance between two 64-bit perceptual hashes."""
    return bin(h1 ^ h2).count('1')
