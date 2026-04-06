
=== Backend Service Startup Fix ===


Stop-Service -Name "futurepred-backend" -Force
Start-Sleep -Seconds 2

Write-Host "Starting futurepred-backend..."
"
Start-Service -Name "futurepred-backend"
Start-Sleep -Seconds 5

Write-Host "Service Status:"
Get-Service -Name "futurepred-backend" | Select-Object Name, Status, StartType

Write-Host "
Checking port 8000..."
netstat -ano 2> | Select-String "8000"

Write-Host "
Testing health endpoint..."
try {
    $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 3
    Write-Host "Status: $($resp.status)" -ForegroundColor Green
} catch {
    Write-Host "Failed: $($_.Exception.Message)" -ForegroundColor Yellow
}
