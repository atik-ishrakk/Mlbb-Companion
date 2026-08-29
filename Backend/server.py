# =============================================================================
#   MLBB COMPANION — HIGH-PERFORMANCE BACKEND API & COMPUTER VISION SERVER
# =============================================================================
#   Role & Purpose in Project:
#     This file is the main executable entry point for the backend server.
#     It launches the multi-threaded Flask HTTP server on http://127.0.0.1:5000,
#     exposing REST endpoints to the Chrome/Brave browser extension and web dashboard.
#     
#     Key Responsibilities:
#       1. Web Service Host: Serves live game state, draft scans, and launcher APIs.
#       2. Protocol Registry Target: Automatically executed in the background when the
#          user clicks 'Launch MLBB Companion' or triggers the companion:// protocol.
# =============================================================================

import os
import sys

# Prevent Python from writing __pycache__ bytecode files to prevent Chrome extension loader errors
sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

# Ensure Backend directory is in path
_backend_dir = os.path.dirname(os.path.abspath(__file__))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from routes import (
    app,
    get_system_status,
    api_ping,
    init_backend,
    process_draft_ui,
    analyze_frame_api,
    reload_database,
    launch_game_and_emulator,
    close_bluestacks_instance,
    emergency_stop,
)

if __name__ == '__main__':
    print("=" * 70)
    print("  MLBB COMPANION — BRAVE EXTENSION FLASK BACKEND SERVER")
    print("  Host   : http://127.0.0.1:5000")
    print("  Status : Ready (Zero-Disk High-Precision CV Engine Active)")
    print("=" * 70)
    app.run(host='127.0.0.1', port=5000, threaded=True)
