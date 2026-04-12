$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSCommandPath
$backendRoot = Join-Path $repoRoot "backend"
$frontendRoot = Join-Path $repoRoot "frontend"
$pythonExe = Join-Path $repoRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $pythonExe)) {
    throw "Python executable not found at $pythonExe. Create the virtual environment first."
}

if (-not (Test-Path $backendRoot)) {
    throw "Backend folder not found at $backendRoot."
}

if (-not (Test-Path $frontendRoot)) {
    throw "Frontend folder not found at $frontendRoot."
}

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$backendRoot'; & '$pythonExe' api/app.py"
)

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$frontendRoot'; npm run dev"
)

Write-Host "Backend and frontend are starting in separate PowerShell windows."