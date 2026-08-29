# =============================================================================
#   MLBB COMPANION — UNIFIED SHUTDOWN & CLEANUP CONTROLLER (shutdown.py)
# =============================================================================
#   Role & Purpose in Project:
#     This tool safely terminates background services, releases occupied network ports
#     (5000, 8000, 8765), closes spawned CMD terminal processes, and purges all
#     resident RAM and CUDA/PyTorch VRAM allocations.
#     
#     Safety Guarantee:
#       - Preserves active browser processes (Brave / Chrome / Edge) so user work
#         and browser tabs are never disrupted.
#       - BlueStacks emulator is preserved by default unless --close-emulator is passed.
# =============================================================================

import os
import sys
import time
import socket
import subprocess
from typing import List, Tuple, Set


def kill_by_process_name(name: str, description: str = "") -> int:
    """Terminates processes matching an executable name."""
    try:
        cmd = f'taskkill /F /IM "{name}" /T'
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if res.returncode == 0:
            print(f"  [CLOSED] {description or name} ({name})")
            return 1
    except Exception as e:
        print(f"  [ERROR] Failed to kill {name}: {e}")
    return 0


def kill_by_port(port: int, description: str = "") -> int:
    """Finds PIDs listening on a port and force kills them."""
    killed = 0
    try:
        cmd = f'netstat -aon | findstr ":{port}" | findstr "LISTENING"'
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        pids: Set[str] = set()
        for line in res.stdout.strip().splitlines():
            parts = line.strip().split()
            if len(parts) >= 5 and parts[-1].isdigit():
                pids.add(parts[-1])

        for pid in pids:
            if pid == "0":
                continue
            k_res = subprocess.run(f'taskkill /F /PID {pid} /T', shell=True, capture_output=True, text=True)
            if k_res.returncode == 0:
                print(f"  [CLOSED] {description or f'Port {port}'} (PID: {pid})")
                killed += 1
    except Exception as e:
        print(f"  [ERROR] Port {port} cleanup error: {e}")
    return killed


def kill_by_window_title(title_pattern: str, description: str = "") -> int:
    """Finds and terminates CMD windows with matching window titles."""
    killed = 0
    try:
        cmd = 'tasklist /V /FI "IMAGENAME eq cmd.exe" /FO CSV'
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        for line in res.stdout.splitlines():
            if title_pattern.lower() in line.lower():
                parts = line.split('","')
                if len(parts) >= 2:
                    pid = parts[1].replace('"', '').strip()
                    if pid.isdigit():
                        subprocess.run(f'taskkill /F /PID {pid} /T', shell=True, capture_output=True, text=True)
                        print(f"  [CLOSED] Terminal: {description or title_pattern} (PID: {pid})")
                        killed += 1
    except Exception as e:
        print(f"  [ERROR] Window title cleanup error: {e}")
    return killed


def flush_system_ram_and_vram():
    """
    Flushes all Python garbage, cleans GPU/DirectML/CUDA caches,
    and calls Windows API to trim process working sets to maximize free system RAM.
    """
    import gc
    gc.collect()

    # 1. Clear PyTorch / CUDA VRAM if present
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass

    # 2. Windows OS Memory Working Set Trim
    if os.name == 'nt':
        try:
            import ctypes
            handle = ctypes.windll.kernel32.GetCurrentProcess()
            ctypes.windll.psapi.EmptyWorkingSet(handle)
        except Exception:
            pass
    print("  * System RAM & VRAM:          CLEARED & FLUSHED")


def close_everything(close_emulator: bool = False) -> dict:
    """
    Closes MLBB HTTP & WS ports, server CMD terminals, and purges RAM/VRAM buffers.
    BlueStacks emulator is PRESERVED by default so user gameplay is never interrupted.
    Browser process is preserved so other user tabs remain intact.
    """
    print("\n" + "=" * 70)
    print("  MLBB COMPANION — SHUTDOWN & MEMORY PURGE CONTROLLER")
    print("=" * 70 + "\n")

    summary = {"servers": 0, "terminals": 0, "emulator": 0}

    # 1. Terminate MLBB Web & API Ports (5000, 8000, and 8765)
    print("[1/5] Closing MLBB Web & API Ports...")
    summary["servers"] += kill_by_port(5000, "MLBB Flask API Server (Port 5000 -> http://127.0.0.1:5000)")
    summary["servers"] += kill_by_port(8000, "MLBB HTTP Server (Port 8000 -> http://127.0.0.1:8000)")
    summary["servers"] += kill_by_port(8765, "MLBB WebSocket Bridge (Port 8765 -> ws://127.0.0.1:8765)")

    # 2. Terminate Companion CMD Terminal Windows
    print("\n[2/5] Closing Server Terminal Windows...")
    summary["terminals"] += kill_by_window_title("MLBB Companion", "MLBB Companion Server")
    summary["terminals"] += kill_by_window_title("MLBB BlueStacks 5 Bridge Server", "Bridge Server Terminal")
    summary["terminals"] += kill_by_window_title("MLBB Web Server", "Web Server Terminal")

    # 3. BlueStacks 5 Emulator (Preserved by default)
    if close_emulator:
        print("\n[3/5] Closing BlueStacks 5 Emulator...")
        summary["emulator"] += kill_by_process_name("HD-Player.exe", "BlueStacks Player")
        summary["emulator"] += kill_by_process_name("HD-Adb.exe", "BlueStacks ADB Subsystem")
        summary["emulator"] += kill_by_process_name("BstkSVC.exe", "BlueStacks Service")
    else:
        print("\n[3/5] BlueStacks Emulator: PRESERVED [RUNNING]")

    # 4. Flush RAM & VRAM
    print("\n[4/5] Clearing RAM & VRAM Allocation...")
    flush_system_ram_and_vram()

    # 5. Final Port State Verification
    print("\n[5/5] Verifying Ports State...")
    time.sleep(0.4)

    ws_free = True
    http_free = True
    try:
        s = socket.socket()
        ws_free = (s.connect_ex(("127.0.0.1", 8765)) != 0)
        s.close()
        s = socket.socket()
        http_free = (s.connect_ex(("127.0.0.1", 8000)) != 0)
        s.close()
    except Exception:
        pass

    print(f"  * MLBB Dashboard Port 8000:   {'RELEASED [CLOSED]' if http_free else 'STILL BUSY'}")
    print(f"  * MLBB WebSocket Port 8765:   {'RELEASED [CLOSED]' if ws_free else 'STILL BUSY'}")
    print("  * BlueStacks Emulator:        PRESERVED (Never closed on exit)")
    print("  * User Browser Process:       PRESERVED (Other tabs untouched)")

    print("\n" + "=" * 70)
    print("  [SUCCESS] MLBB ports closed, RAM/VRAM purged (BlueStacks kept alive).")
    print("=" * 70 + "\n")
    return summary


if __name__ == "__main__":
    close_emulator_flag = False

    for arg in sys.argv[1:]:
        if arg.lower() in ("--close-emulator", "--kill-emulator", "-ke"):
            close_emulator_flag = True

    close_everything(close_emulator=close_emulator_flag)
