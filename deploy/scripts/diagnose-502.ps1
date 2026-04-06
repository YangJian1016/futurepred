#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Diagnose 502 Bad Gateway issues for FuturePred deployment

.DESCRIPTION
    Checks:
    1. Service status (nginx, futurepred-backend)
    2. Backend logs for errors
    3. Direct backend connectivity
    4. Nginx error logs
    5. Port availability

.USAGE
    Set-ExecutionPolicy Bypass -Scope Process -Force
    .\diagnose-502.ps1
#>

param(
    [string]$BackendLogDir = "C:\Deploy\FuturePred\logs",
    [string]$NginxLogDir = "C:\nginx-1.28.3\logs"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

Write-Host "`n=== FuturePred 502 Bad Gateway Diagnostic ===" -ForegroundColor Cyan

# 1. Service Status
Write-Host "`n[1/5] Service Status:" -ForegroundColor Yellow
Get-Service -Name "nginx", "futurepred-backend" -ErrorAction SilentlyContinue |
    Format-Table -AutoSize Name, DisplayName, Status, StartType

# 2. Backend Logs
Write-Host "`n[2/5] Backend Logs (last 20 lines):" -ForegroundColor Yellow

$backendStdout = Join-Path $BackendLogDir "backend-stdout.log"
$backendStderr = Join-Path $BackendLogDir "backend-stderr.log"

if (Test-Path $backendStdout) {
    Write-Host "`n--- STDOUT ---"
    Get-Content $backendStdout -Tail 20 | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "  [WARNING] $backendStdout not found"
}

if (Test-Path $backendStderr) {
    Write-Host "`n--- STDERR ---"
    Get-Content $backendStderr -Tail 20 | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "  [INFO] No stderr log"
}

# 3. Direct Backend Connectivity
Write-Host "`n[3/5] Direct Backend Connectivity (http://127.0.0.1:8000/health):" -ForegroundColor Yellow
try {
    $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 3
    Write-Host "  Status: $($resp.status)" -ForegroundColor Green
    Write-Host "  Response: $($resp | ConvertTo-Json)" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Connection failed: $($_.Exception.Message)" -ForegroundColor Red
}

# 4. Port Status
Write-Host "`n[4/5] Port Availability:" -ForegroundColor Yellow
$portCheck = netstat -ano 2>$null | Select-String "127.0.0.1:8000|0.0.0.0:80|0.0.0.0:443"
if ($portCheck) {
    Write-Host "  Open ports:"
    $portCheck | ForEach-Object { Write-Host "    $_" }
} else {
    Write-Host "  [WARNING] Backend port 8000 may not be listening"
}

# 5. Nginx Error Log
Write-Host "`n[5/5] Nginx Error Log (last 20 lines):" -ForegroundColor Yellow
$nginxError = Join-Path $NginxLogDir "error.log"
if (Test-Path $nginxError) {
    Get-Content $nginxError -Tail 20 | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "  [WARNING] $nginxError not found"
}

Write-Host "`n=== Diagnostic Complete ===" -ForegroundColor Cyan
Write-Host "`nCommon causes of 502 Bad Gateway:"
Write-Host "  1. Backend service is not running -> restart: Get-Service futurepred-backend | Restart-Service"
Write-Host "  2. Backend crashed -> check logs above"
Write-Host "  3. Backend listening on wrong port -> should be 127.0.0.1:8000"
Write-Host "  4. Nginx config incorrect -> validate: nginx.exe -t"
Write-Host ""
