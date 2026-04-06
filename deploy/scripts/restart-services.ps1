#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Quick restart services for FuturePred

.USAGE
    Set-ExecutionPolicy Bypass -Scope Process -Force
    .\restart-services.ps1
#>

param(
    [string]$NssmExe = "C:\tools\nssm\nssm.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "`n=== Restarting FuturePred Services ===" -ForegroundColor Cyan

# Restart backend first
Write-Host "`nRestarting futurepred-backend..." -ForegroundColor Yellow
try {
    if (Test-Path $NssmExe) {
        & $NssmExe restart futurepred-backend
    } else {
        Restart-Service -Name "futurepred-backend" -Force
    }
    Start-Sleep -Seconds 3
    Write-Host "  ✔ Backend restarted" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
}

# Restart nginx
Write-Host "`nRestarting nginx..." -ForegroundColor Yellow
try {
    if (Test-Path $NssmExe) {
        & $NssmExe restart nginx
    } else {
        Restart-Service -Name "nginx" -Force
    }
    Start-Sleep -Seconds 2
    Write-Host "  ✔ Nginx restarted" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
}

# Status check
Write-Host "`n=== Service Status ===" -ForegroundColor Cyan
Get-Service -Name "nginx", "futurepred-backend" |
    Format-Table -AutoSize Name, Status, StartType

# Health check
Write-Host "`nPerforming health check..." -ForegroundColor Yellow
try {
    $prev = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    $resp = Invoke-RestMethod -Uri "https://127.0.0.1/health" -TimeoutSec 5
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $prev
    Write-Host "  Status: $($resp.status)" -ForegroundColor Green
    Write-Host "`n✔ Services are running normally" -ForegroundColor Green
} catch {
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $null
    Write-Host "  [WARNING] Health check failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
