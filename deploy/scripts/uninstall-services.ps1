#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Stop and remove Nginx and FuturePred backend Windows services

.USAGE
    Set-ExecutionPolicy Bypass -Scope Process -Force
    .\uninstall-services.ps1
#>
param(
    [string]$NssmExe = "C:\tools\nssm\nssm.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "SilentlyContinue"

Write-Host "`n=== FuturePred Service Uninstall ===" -ForegroundColor Cyan

foreach ($name in @("nginx", "futurepred-backend")) {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Host "  [$name] Service does not exist, skipping."
        continue
    }
    Write-Host "  Stopping $name ..."
    if (Test-Path $NssmExe) {
        & $NssmExe stop   $name confirm 2>$null
        & $NssmExe remove $name confirm
    } else {
        Stop-Service -Name $name -Force
        & sc.exe delete $name
    }
    Write-Host "  [$name] Removed." -ForegroundColor Green
}

Write-Host "`n✔ Uninstall complete.`n" -ForegroundColor Green
