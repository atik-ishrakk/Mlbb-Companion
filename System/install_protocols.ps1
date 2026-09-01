# MLBB Companion - Protocol Installer
# Registers: bluestacks:// mlbb://
# The script automatically finds the current project directory and Python.
$ErrorActionPreference = "Stop"

# ========================== PROJECT PATH ==========================
$ProjectRoot = (Get-Item $PSScriptRoot).Parent.FullName
$BackendServer = Join-Path $ProjectRoot "Backend\server.py"

if (-not (Test-Path $BackendServer)) {
    throw "Backend/server.py was not found: $BackendServer"
}

Write-Host ""
Write-Host "MLBB Companion Protocol Installer"
Write-Host "================================="
Write-Host ""
Write-Host "Project Root:"
Write-Host "  $ProjectRoot"
Write-Host ""
Write-Host "Backend:"
Write-Host "  $BackendServer"
Write-Host ""

# ========================== PYTHON DISCOVERY ==========================
$PythonExe = $null

# 1. python.exe in PATH
try {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        $PythonExe = $pythonCommand.Source
    }
}
catch {}

# 2. py.exe launcher (use -3 to ensure Python 3)
if (-not $PythonExe) {
    try {
        $pyCommand = Get-Command py.exe -ErrorAction SilentlyContinue
        if ($pyCommand) {
            # We'll use py.exe with -3, but keep the full path to py.exe itself.
            # We'll embed the -3 flag in the command later.
            $PythonExe = $pyCommand.Source
            $UsePyLauncher = $true
        }
    }
    catch {}
}

# 3. Common installation paths (for Python 3.10 - 3.13)
if (-not $PythonExe) {
    $PossiblePythonPaths = @(
        "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe",
        "$env:ProgramFiles\Python313\python.exe",
        "$env:ProgramFiles\Python312\python.exe",
        "$env:ProgramFiles\Python311\python.exe"
    )
    foreach ($candidate in $PossiblePythonPaths) {
        if (Test-Path $candidate) {
            $PythonExe = $candidate
            break
        }
    }
}

if (-not $PythonExe) {
    throw "Python could not be found. Install Python and make sure python.exe is available from PowerShell using: python --version . Then run this installer again."
}

Write-Host "Python:"
Write-Host "  $PythonExe"
if ($UsePyLauncher) {
    Write-Host "  (using py.exe with -3 flag)"
}
Write-Host ""

# ========================== BLUESTACKS DISCOVERY ==========================
$BlueStacksPlayer = $null

# Try to locate BlueStacks via registry (most reliable)
$regPaths = @(
    "HKLM:\SOFTWARE\BlueStacks",
    "HKLM:\SOFTWARE\BlueStacks_nxt",
    "HKLM:\SOFTWARE\BlueStacks X",
    "HKCU:\SOFTWARE\BlueStacks"
)
foreach ($regPath in $regPaths) {
    try {
        $key = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
        if ($key.InstallDir) {
            $player = Join-Path $key.InstallDir "HD-Player.exe"
            if (Test-Path $player) {
                $BlueStacksPlayer = $player
                break
            }
        }
    }
    catch {}
}

# Fallback to common hardcoded paths if registry didn't work
if (-not $BlueStacksPlayer) {
    $fallbackPaths = @(
        "C:\Program Files\BlueStacks_nxt\HD-Player.exe",
        "C:\Program Files\BlueStacks\HD-Player.exe",
        "C:\Program Files\BlueStacks X\HD-Player.exe"
    )
    foreach ($path in $fallbackPaths) {
        if (Test-Path $path) {
            $BlueStacksPlayer = $path
            break
        }
    }
}

if (-not $BlueStacksPlayer) {
    Write-Warning @"
BlueStacks executable could not be located automatically.
The bluestacks:// protocol will still be registered, but you may need
to manually adjust the command path in the registry afterwards.
"@
    # Still set a placeholder so the script can continue
    $BlueStacksPlayer = "C:\Program Files\BlueStacks_nxt\HD-Player.exe"
}

# ========================== REGISTRY HELPERS ==========================
function Set-RegistryValue {
    param(
        [string]$Path,
        [string]$Name,
        [string]$Value
    )
    if (-not (Test-Path $Path)) {
        New-Item -Path $Path -Force | Out-Null
    }
    New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType String -Force | Out-Null
}

# ========================== BLUESTACKS PROTOCOL ==========================
$BlueStacksCommand = "`"$BlueStacksPlayer`" --instance Nougat32 --package com.mobile.legends"
Set-RegistryValue -Path "HKCU:\Software\Classes\bluestacks" -Name "(Default)" -Value "URL:BlueStacks Custom Protocol"
Set-RegistryValue -Path "HKCU:\Software\Classes\bluestacks" -Name "URL Protocol" -Value ""
Set-RegistryValue -Path "HKCU:\Software\Classes\bluestacks\shell\open\command" -Name "(Default)" -Value $BlueStacksCommand

Write-Host "Registered bluestacks://"

# ========================== MLBB SERVER PROTOCOL ==========================
# Build the server command: if using py.exe, we insert -3; otherwise just the python exe.
if ($UsePyLauncher) {
    # Example: "C:\Windows\py.exe" -3 "C:\path\server.py" "%1"
    $ServerCommand = "`"$PythonExe`" -3 `"$BackendServer`" `"%1`""
}
else {
    $ServerCommand = "`"$PythonExe`" `"$BackendServer`" `"%1`""
}

Set-RegistryValue -Path "HKCU:\Software\Classes\mlbb" -Name "(Default)" -Value "URL:MLBB Backend Server Protocol"
Set-RegistryValue -Path "HKCU:\Software\Classes\mlbb" -Name "URL Protocol" -Value ""
Set-RegistryValue -Path "HKCU:\Software\Classes\mlbb\shell\open\command" -Name "(Default)" -Value $ServerCommand
Write-Host "Registered mlbb://"

# ========================== DONE ==========================
Write-Host ""
Write-Host "================================="
Write-Host "Protocol installation completed."
Write-Host "================================="
Write-Host ""
Write-Host "BlueStacks command:"
Write-Host "  $BlueStacksCommand"
Write-Host ""
Write-Host "Server command:"
Write-Host "  $ServerCommand"
Write-Host ""
Write-Host "You can now reload the extension in Brave."
Write-Host ""