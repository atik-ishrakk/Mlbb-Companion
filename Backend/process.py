# =============================================================================
#   MLBB COMPANION — FAST WIN32 PROCESS & BLUESTACKS DISCOVERY (process.py)
# =============================================================================
#   Role & Purpose in Project:
#     This file handles low-level Windows OS interop, instant emulator detection,
#     and automated ADB network port discovery.
#     
#     Key Functions:
#       1. Zero-Overhead Process Check (<1ms): Uses native Win32 CreateToolhelp32Snapshot
#          to query 'HD-Player.exe' without spawning slow child processes (tasklist/powershell).
#       2. Configuration Parsing: Parses 'C:\\ProgramData\\BlueStacks_nxt\\bluestacks.conf'
#          to extract the exact dynamic ADB port (e.g. 5555, 5565) assigned to active instances.
#       3. ADB Binary Locator: Auto-locates HD-Adb.exe or system adb binaries.
# =============================================================================

import os
import re
import time
import ctypes
import ctypes.wintypes
from typing import Dict, List, Tuple, Optional, Set

_PROGRAM_DATA = os.environ.get("PROGRAMDATA", r"C:\ProgramData")
_BLUESTACKS_CONF_PATHS = [
    os.path.join(_PROGRAM_DATA, r"BlueStacks_nxt\bluestacks.conf"),
    os.path.join(_PROGRAM_DATA, r"BlueStacks_nxt_cn\bluestacks.conf"),
    os.path.join(_PROGRAM_DATA, r"BlueStacks\bluestacks.conf"),
    r"C:\ProgramData\BlueStacks_nxt\bluestacks.conf",
    r"C:\ProgramData\BlueStacks_nxt_cn\bluestacks.conf",
    r"C:\ProgramData\BlueStacks\bluestacks.conf",
]
_LAST_REPORTED_INSTANCES: Optional[Dict[str, int]] = None

TH32CS_SNAPPROCESS = 0x00000002


class PROCESSENTRY32(ctypes.Structure):
    _fields_ = [
        ('dwSize', ctypes.wintypes.DWORD),
        ('cntUsage', ctypes.wintypes.DWORD),
        ('th32ProcessID', ctypes.wintypes.DWORD),
        ('th32DefaultHeapID', ctypes.c_void_p),
        ('th32ModuleID', ctypes.wintypes.DWORD),
        ('cntThreads', ctypes.wintypes.DWORD),
        ('th32ParentProcessID', ctypes.wintypes.DWORD),
        ('pcPriClassBase', ctypes.c_long),
        ('dwFlags', ctypes.wintypes.DWORD),
        ('szExeFile', ctypes.c_char * 260)
    ]


def fast_is_process_running(exe_name: str) -> bool:
    """Ultra-fast Win32 snapshot process checker (<1ms, 0 child processes spawned)."""
    if os.name != 'nt':
        return False
    try:
        hSnapshot = ctypes.windll.kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
        if hSnapshot == -1:
            return False
        entry = PROCESSENTRY32()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32)
        target = exe_name.lower().encode('utf-8')
        try:
            success = ctypes.windll.kernel32.Process32First(hSnapshot, ctypes.byref(entry))
            while success:
                if entry.szExeFile.lower() == target:
                    return True
                success = ctypes.windll.kernel32.Process32Next(hSnapshot, ctypes.byref(entry))
        finally:
            ctypes.windll.kernel32.CloseHandle(hSnapshot)
    except Exception:
        pass
    return False


# Compatibility alias
_fast_is_process_running = fast_is_process_running


def get_bluestacks_ports_from_config() -> Dict[str, int]:
    """
    Parse bluestacks.conf to extract all active running instance names & ADB ports.
    Returns a dictionary like {'Pie64': 5555, 'Nougat32': 5555}.
    """
    status_pattern = re.compile(r'bst\.instance\.([^.]+)\.status\.adb_port="(\d+)"')
    fallback_pattern = re.compile(r'bst\.instance\.([^.]+)\.adb_port="(\d+)"')
    adb_access_pattern = re.compile(r'bst\.enable_adb_access="(\d+)"')

    seen_paths: Set[str] = set()
    for conf_path in _BLUESTACKS_CONF_PATHS:
        norm_p = os.path.normpath(conf_path)
        if norm_p in seen_paths or not os.path.exists(norm_p):
            continue
        seen_paths.add(norm_p)

        instances: Dict[str, int] = {}
        adb_enabled = True
        try:
            with open(norm_p, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

                adb_match = adb_access_pattern.search(content)
                if adb_match and adb_match.group(1) == "0":
                    adb_enabled = False
                    print("[ADB WARNING] 'Enable ADB' is OFF in BlueStacks Settings -> Preferences -> ADB!")

                # 1. Primary match: Active runtime status ports
                for line in content.splitlines():
                    match = status_pattern.search(line)
                    if match:
                        port = int(match.group(2))
                        if 1024 <= port <= 65535:
                            instances[match.group(1)] = port

                # 2. Fallback match: Configured adb_port
                if not instances:
                    for line in content.splitlines():
                        match = fallback_pattern.search(line)
                        if match:
                            port = int(match.group(2))
                            if 1024 <= port <= 65535:
                                instances[match.group(1)] = port

            global _LAST_REPORTED_INSTANCES
            if instances:
                if instances != _LAST_REPORTED_INSTANCES:
                    _LAST_REPORTED_INSTANCES = dict(instances)
                    print(f"[ADB] Discovered BlueStacks instances ({os.path.basename(norm_p)}):")
                    for name, port in instances.items():
                        status_flag = " [ADB Disabled in Settings]" if not adb_enabled else " [Active]"
                        print(f"  -> {name:<16} : 127.0.0.1:{port}{status_flag}")
                return instances
        except PermissionError:
            print("[ADB ERROR] bluestacks.conf: Permission denied.")
        except Exception as e:
            print(f"[ADB ERROR] bluestacks.conf read error: {e}")
    return {}


def get_adb_binary() -> str:
    """Finds HD-Adb.exe installed with BlueStacks or falls back to system adb."""
    possible_paths = [
        r"C:\Program Files\BlueStacks_nxt\HD-Adb.exe",
        r"C:\Program Files (x86)\BlueStacks_nxt\HD-Adb.exe",
        r"C:\Program Files\BlueStacks\HD-Adb.exe",
        r"C:\Program Files (x86)\BlueStacks\HD-Adb.exe",
    ]
    for p in possible_paths:
        if os.path.exists(p):
            return p
    return "adb"


_CACHED_BS_PORT = 5555
_LAST_PORT_CHECK = 0.0


def is_bluestacks_process_running() -> Tuple[bool, int]:
    """
    Ultra-fast check if BlueStacks HD-Player.exe is active in Windows (<1ms),
    returning (is_running, configured_adb_port).
    """
    global _CACHED_BS_PORT, _LAST_PORT_CHECK
    now = time.time()
    if now - _LAST_PORT_CHECK > 10.0:
        instances = get_bluestacks_ports_from_config()
        if instances:
            _CACHED_BS_PORT = sorted(instances.values())[0]
        _LAST_PORT_CHECK = now

    is_running = fast_is_process_running('HD-Player.exe')
    return is_running, _CACHED_BS_PORT
