<#
.SYNOPSIS
    Build frontend and package FuturePred Windows deployment package

.DESCRIPTION
    1. npm run build (frontend)
    2. Copy backend, frontend/dist, deploy/ to release/<timestamp>/
    3. Compress to release/futurepred-win-deploy-<timestamp>.zip

.USAGE
    Set-Location c:\Develop\FuturePred
    .\deploy\scripts\build-release.ps1

    # Skip frontend build (just repackage)
    .\deploy\scripts\build-release.ps1 -SkipBuild
#>
param(
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)  # project root
Set-Location $Root

# \u2500\u2500 1. Build frontend \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
if (-not $SkipBuild) {
    Write-Host \"`n[1/3] Building frontend...\" -ForegroundColor Cyan
    Set-Location .\frontend
    npm run build | Out-Host
    Set-Location $Root
} else {
    Write-Host \"`n[1/3] Skipping frontend build.\" -ForegroundColor Yellow
}

# \u2500\u2500 2. Assemble directory \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Write-Host \"`n[2/3] Assembling deployment package...\" -ForegroundColor Cyan

$stamp       = Get-Date -Format 'yyyyMMdd-HHmmss'
$releaseRoot = Join-Path $Root 'release'
$pkgName     = \"futurepred-win-deploy-$stamp\"
$pkgDir      = Join-Path $releaseRoot $pkgName
$zipPath     = Join-Path $releaseRoot ($pkgName + '.zip')

if (Test-Path $pkgDir) { Remove-Item -Recurse -Force $pkgDir }
New-Item -ItemType Directory -Path $pkgDir | Out-Null

# backend (exclude .venv / __pycache__ / data / .pytest_cache)
$backendDst = Join-Path $pkgDir 'backend'
robocopy .\backend $backendDst /E /XD .venv __pycache__ data .pytest_cache | Out-Null
# Don't package sensitive .env
if (Test-Path (Join-Path $backendDst '.env')) {
    Remove-Item -Force (Join-Path $backendDst '.env')
}

# frontend dist
$frontendDistDst = Join-Path $pkgDir 'frontend\dist'
New-Item -ItemType Directory -Path $frontendDistDst -Force | Out-Null
robocopy .\frontend\dist $frontendDistDst /E | Out-Null

# deploy/nginx (all nginx configs)
$nginxDst = Join-Path $pkgDir 'deploy\nginx'
New-Item -ItemType Directory -Path $nginxDst -Force | Out-Null
robocopy .\deploy\nginx $nginxDst /E | Out-Null

# deploy/scripts (service installation scripts)
$scriptsDst = Join-Path $pkgDir 'deploy\scripts'
New-Item -ItemType Directory -Path $scriptsDst -Force | Out-Null
robocopy .\deploy\scripts $scriptsDst /E | Out-Null

# README
Copy-Item .\README.md (Join-Path $pkgDir 'README.md') -Force

# \u2500\u2500 3. Compress \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Write-Host \"`n[3/3] Compressing...\" -ForegroundColor Cyan
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path $pkgDir -DestinationPath $zipPath -CompressionLevel Optimal

$zipInfo = Get-Item $zipPath
Write-Host \"`n\u2714 Packaging complete\" -ForegroundColor Green
Write-Host \"  Path: $zipPath\"
Write-Host (\"  Size: {0:N2} MB\" -f ($zipInfo.Length / 1MB))
Write-Host \"\"
Write-Host \"Deployment package directory structure:\"
Get-ChildItem $pkgDir -Recurse -File |
    Select-Object -ExpandProperty FullName |
    ForEach-Object { \"  \" + $_.Replace($pkgDir, '') }
