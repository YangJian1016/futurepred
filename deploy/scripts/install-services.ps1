#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Register Nginx and FuturePred backend as Windows auto-start services (using NSSM)

.DESCRIPTION
    Dependency: NSSM >= 2.24  https://nssm.cc/download
    By default, nssm.exe is placed at C:\tools\nssm\nssm.exe
    To use a different path, modify the $NssmExe variable below

.USAGE
    # Run in PowerShell as Administrator:
    Set-ExecutionPolicy Bypass -Scope Process -Force
    .\install-services.ps1

    # Optional: Override default paths
    .\install-services.ps1 -NginxDir "D:\nginx-1.28.3" -DeployDir "D:\Deploy\FuturePred"
#>
param(
    [string]$NssmExe   = "C:\tools\nssm\nssm.exe",
    [string]$NginxDir  = "C:\nginx-1.28.3",
    [string]$DeployDir = "C:\Deploy\FuturePred"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Derived paths ─────────────────────────────────────────────────────────────
$BackendDir  = Join-Path $DeployDir "backend"
$PythonExe   = Join-Path $DeployDir ".venv\Scripts\python.exe"
$NginxLogDir = Join-Path $NginxDir  "logs"
$AppLogDir   = Join-Path $DeployDir "logs"
$BackendLaunchCmd = Join-Path $DeployDir "deploy\scripts\run-backend.cmd"

# ── Pre-flight checks ──────────────────────────────────────────────────────────
Write-Host "`n=== FuturePred Service Installation ===" -ForegroundColor Cyan

if (-not (Test-Path $NssmExe)) {
    Write-Host @"

[ERROR] Cannot find nssm.exe: $NssmExe

Please download NSSM first:
  1. Open https://nssm.cc/download in your browser
  2. Download nssm-2.24.zip (or latest version)
  3. Extract and copy win64\nssm.exe to C:\tools\nssm\nssm.exe
  4. Run this script again

"@ -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $NginxDir)) {
    Write-Error "Nginx directory not found: $NginxDir"
}
if (-not (Test-Path $BackendDir)) {
    Write-Error "Backend directory not found: $BackendDir"
}
if (-not (Test-Path $PythonExe)) {
    Write-Host @"

[ERROR] Python virtual environment not found: $PythonExe

Please initialize the virtual environment on the server first:
  cd $DeployDir
  python -m venv .venv
  .venv\Scripts\pip install -r backend\requirements.txt

"@ -ForegroundColor Red
    exit 1
}

# ── Create log directories ────────────────────────────────────────────────────
foreach ($dir in @($NginxLogDir, $AppLogDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "Created directory: $dir"
    }
}

# Create backend launcher script to avoid NSSM argument parsing differences across versions.
$launchScript = @"
@echo off
cd /d "$BackendDir"
"$PythonExe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
"@
Set-Content -Path $BackendLaunchCmd -Value $launchScript -Encoding ASCII

# ── Helper function ───────────────────────────────────────────────────────────
function Install-NssmService {
    param(
        [string]$Name,
        [string]$DisplayName,
        [string]$Description,
        [string]$Exe,
        [string]$AppDir,
        [string]$AppParameters,
        [string]$StdoutLog,
        [string]$StderrLog,
        [hashtable]$Env = @{}
    )

    # If service already exists, remove it first
    $existing = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  Stopping and removing existing service '$Name'..."
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            # Older NSSM builds may emit stop/remove messages on stderr with non-zero exit codes.
            # Treat these as non-fatal and continue with reinstall.
            & $NssmExe stop $Name confirm *> $null
            & $NssmExe remove $Name confirm *> $null
        } finally {
            $ErrorActionPreference = $prevEap
        }
        Start-Sleep -Milliseconds 500
    }

    Write-Host "  Installing service '$Name'..."
    # Pass executable and arguments at install time to avoid empty AppParameters on some NSSM setups.
    if ([string]::IsNullOrWhiteSpace($AppParameters)) {
        & $NssmExe install     $Name $Exe
    } else {
        & $NssmExe install     $Name $Exe $AppParameters
    }
    & $NssmExe set             $Name AppDirectory      $AppDir
    if (-not [string]::IsNullOrWhiteSpace($AppParameters)) {
        & $NssmExe set         $Name AppParameters     $AppParameters
    }
    & $NssmExe set             $Name DisplayName       $DisplayName
    & $NssmExe set             $Name Description       $Description
    & $NssmExe set             $Name Start             SERVICE_AUTO_START
    & $NssmExe set             $Name AppStdout         $StdoutLog
    & $NssmExe set             $Name AppStderr         $StderrLog
    & $NssmExe set             $Name AppStdoutCreationDisposition 4   # append
    & $NssmExe set             $Name AppStderrCreationDisposition 4
    & $NssmExe set             $Name AppRotateFiles     1
    & $NssmExe set             $Name AppRotateBytes     10485760       # 10 MB
    & $NssmExe set             $Name AppRestartDelay    3000           # 3s auto-restart

    foreach ($key in $Env.Keys) {
        & $NssmExe set $Name AppEnvironmentExtra "$key=$($Env[$key])"
    }

    # Best-effort verification for compatibility across NSSM versions.
    # Some old builds do not support querying AppPath/AppDirectory via `nssm get`.
    $effectiveArgs = $null
    try {
        $effectiveArgs = (& $NssmExe get $Name AppParameters 2>$null)
    } catch {
        $effectiveArgs = $null
    }

    if (-not [string]::IsNullOrWhiteSpace($AppParameters) -and [string]::IsNullOrWhiteSpace($effectiveArgs)) {
        Write-Host "  [WARNING] NSSM did not return AppParameters for '$Name'. Continuing (older NSSM may not support this query)." -ForegroundColor Yellow
    }
}

# ── 1. Nginx service ──────────────────────────────────────────────────────────
Write-Host "`n[1/2] Registering Nginx service..." -ForegroundColor Yellow

Install-NssmService `
    -Name        "nginx" `
    -DisplayName "Nginx Web Server" `
    -Description "Nginx reverse proxy for FuturePred (entel10.xyz)" `
    -Exe         "$NginxDir\nginx.exe" `
    -AppDir      $NginxDir `
    -AppParameters "-p `"$NginxDir`" -c conf\nginx.conf" `
    -StdoutLog   "$NginxLogDir\service-stdout.log" `
    -StderrLog   "$NginxLogDir\service-stderr.log"

# ── 2. FuturePred backend service ─────────────────────────────────────────────
Write-Host "`n[2/2] Registering FuturePred backend service..." -ForegroundColor Yellow

Install-NssmService `
    -Name        "futurepred-backend" `
    -DisplayName "FuturePred Backend (uvicorn)" `
    -Description "FuturePred FastAPI/uvicorn backend on 127.0.0.1:8000" `
    -Exe         "$env:SystemRoot\System32\cmd.exe" `
    -AppDir      $BackendDir `
    -AppParameters "/c $BackendLaunchCmd" `
    -StdoutLog   "$AppLogDir\backend-stdout.log" `
    -StderrLog   "$AppLogDir\backend-stderr.log" `
    -Env         @{ PYTHONUNBUFFERED = "1" }

# ── Start services ───────────────────────────────────────────────────────────
Write-Host "`nStarting services..." -ForegroundColor Yellow

# Backend first, since nginx proxy depends on backend port
Write-Host "  Starting futurepred-backend..."
& $NssmExe start futurepred-backend
Start-Sleep -Seconds 3

Write-Host "  Starting nginx..."
& $NssmExe start nginx
Start-Sleep -Seconds 2

# ── Service status ────────────────────────────────────────────────────────────
Write-Host "`n=== Service Status ===" -ForegroundColor Cyan
Get-Service -Name "nginx","futurepred-backend" |
    Format-Table -AutoSize Name, DisplayName, Status, StartType

# Quick health check (PowerShell 5.1 compatible, ignore self-signed cert errors)
Write-Host "`nHealthcheck https://127.0.0.1/health ..."
try {
    # PS5.1 doesn't support -SkipCertificateCheck, use ServicePointManager to bypass cert validation
    $prev = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    $resp = Invoke-RestMethod -Uri "https://127.0.0.1/health" -TimeoutSec 5
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $prev
    Write-Host "  Status: $($resp.status)" -ForegroundColor Green
} catch {
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $null
    Write-Host "  [WARNING] Health check failed (backend may still be initializing): $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "  Verify manually later: Invoke-RestMethod -Uri 'https://entel10.xyz/health'"
}

Write-Host "`n✔ Installation complete. Services will auto-start on Windows boot." -ForegroundColor Green
Write-Host "  View logs: $AppLogDir\\backend-stdout.log"
Write-Host "  View logs: $NginxLogDir\\service-stdout.log`n"
