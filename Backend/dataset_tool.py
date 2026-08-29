# =============================================================================
#   MLBB COMPANION — DATASET EXTRACTION & CALIBRATION TOOL (dataset_tool.py)
# =============================================================================
#   Role & Purpose in Project:
#     This developer tool extracts calibrated reference crops from in-game draft
#     screenshots to augment and fine-tune template reference banks without
#     modifying pristine master assets:
#       - 'src/assets/training/ally_picks/' (210x132px ally cards)
#       - 'src/assets/training/enemy_picks/' (210x132px enemy cards)
#       - 'src/assets/training/bans/' (80x80px round portraits)
# =============================================================================

import os
import sys
import glob
import json
from typing import Dict, List, Any
import cv2
import numpy as np

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TRAINING_DIR = os.path.join(PROJECT_ROOT, 'src', 'assets', 'training')
if not os.path.exists(TRAINING_DIR):
    TRAINING_DIR = os.path.join(PROJECT_ROOT, 'src', 'shared', 'training')

TRAINING_ALLY_PICKS = os.path.join(TRAINING_DIR, 'ally_picks')
TRAINING_ENEMY_PICKS = os.path.join(TRAINING_DIR, 'enemy_picks')
TRAINING_BANS = os.path.join(TRAINING_DIR, 'bans')


def ensure_training_dirs():
    os.makedirs(TRAINING_ALLY_PICKS, exist_ok=True)
    os.makedirs(TRAINING_ENEMY_PICKS, exist_ok=True)
    os.makedirs(TRAINING_BANS, exist_ok=True)


def calibrate_and_extract_frame(frame_path: str, annotations: dict):
    """
    Extracts high-fidelity training samples from in-game frames into dedicated training folder:
    - src/assets/training/ally_picks/
    - src/assets/training/enemy_picks/
    - src/assets/training/bans/
    """
    img = cv2.imread(frame_path)
    if img is None:
        print(f'[DatasetTool] Failed to load frame: {frame_path}')
        return

    h, w = img.shape[:2]
    if (w, h) != (1920, 1080):
        img = cv2.resize(img, (1920, 1080))

    ensure_training_dirs()

    # Calibrated native draft grid (from Draft Pick Template Fixed Slots Coordination.txt)
    pick_ys = [125, 298, 470, 642, 814]
    ban_xs_ally = [30, 140, 250, 360, 470]
    ban_xs_enemy = [1370, 1480, 1590, 1700, 1810]

    # 1. Ally Bans
    for i, hname in enumerate(annotations.get('ally_bans', [])):
        if hname:
            x = ban_xs_ally[i]
            crop = img[6:86, x:x+80]
            out_p = os.path.join(TRAINING_BANS, f"ally_{hname.lower()}.png")
            cv2.imwrite(out_p, crop)
            print(f'  [TRAINING BAN] {hname} -> {out_p}')

    # 2. Enemy Bans
    for i, hname in enumerate(annotations.get('enemy_bans', [])):
        if hname:
            x = ban_xs_enemy[i]
            crop = img[6:86, x:x+80]
            out_p = os.path.join(TRAINING_BANS, f"enemy_{hname.lower()}.png")
            cv2.imwrite(out_p, crop)
            print(f'  [TRAINING BAN] {hname} -> {out_p}')

    # 3. Ally Picks (210x132px native rect)
    for i, hname in enumerate(annotations.get('ally_picks', [])):
        if hname:
            y = pick_ys[i]
            crop = img[y:y+132, 0:210]
            out_p = os.path.join(TRAINING_ALLY_PICKS, f"{hname.lower()}.png")
            cv2.imwrite(out_p, crop)
            print(f'  [TRAINING ALLY PICK] {hname} -> {out_p}')

    # 4. Enemy Picks (210x132px native mirrored rect)
    for i, hname in enumerate(annotations.get('enemy_picks', [])):
        if hname:
            y = pick_ys[i]
            crop = img[y:y+132, 1710:1920]
            out_p = os.path.join(TRAINING_ENEMY_PICKS, f"{hname.lower()}.png")
            cv2.imwrite(out_p, crop)
            print(f'  [TRAINING ENEMY PICK] {hname} -> {out_p}')


if __name__ == '__main__':
    ensure_training_dirs()
    print(f'[DatasetTool] Dedicated Training Directory initialized at: {TRAINING_DIR}')
