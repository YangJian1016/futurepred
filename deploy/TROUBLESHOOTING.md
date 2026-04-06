# FuturePred Windows Deployment - Troubleshooting Guide

## 502 Bad Gateway Error

When accessing `/api/` or `/generated/` routes returns a 502 Bad Gateway error, follow this diagnosis process:

### Step 1: Run Diagnostic Script

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
C:\Deploy\FuturePred\deploy\scripts\diagnose-502.ps1
```

This script will check:
- Service status (nginx, futurepred-backend)
- Backend logs for crashes or errors
- Direct backend connectivity (127.0.0.1:8000)
- Nginx error logs
- Port availability

### Step 2: Check Service Status

```powershell
Get-Service -Name "futurepred-backend", "nginx" | Select Name, Status, StartType
```

Expected output:
```
Name                  Status StartType
----                  ------ ---------
futurepred-backend   Running    Auto
nginx                Running    Auto
```

### Step 3: Verify Backend is Listening

```powershell
netstat -ano | findstr "127.0.0.1:8000"
```

Expected: Should show a LISTENING entry

### Step 4: Test Direct Backend Connection

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 5
```

Expected output:
```
status
------
ok
```

### Step 5: Check Backend Logs

```powershell
# Last 50 lines of stdout
Get-Content "C:\Deploy\FuturePred\logs\backend-stdout.log" -Tail 50

# Last 50 lines of stderr (if exists)
Get-Content "C:\Deploy\FuturePred\logs\backend-stderr.log" -Tail 50
```

Look for:
- Python import errors
- Port already in use
- Missing environment variables
- Database connection errors

### Step 6: Check Nginx Error Log

```powershell
Get-Content "C:\nginx-1.28.3\logs\error.log" -Tail 50
```

Look for:
- Connection refused errors
- Upstream errors
- Configuration issues

### Step 7: Validate Nginx Configuration

```powershell
cd C:\nginx-1.28.3
.\nginx.exe -t
```

Expected: `nginx: configuration file ... test is successful`

### Step 8: Restart Services

If diagnosis shows services are down or behind:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
C:\Deploy\FuturePred\deploy\scripts\restart-services.ps1
```

This will:
1. Restart futurepred-backend
2. Restart nginx
3. Display service status
4. Run a health check

---

## Common Issues and Solutions

### Issue: Backend service won't start

**Cause**: Python virtual environment not initialized or dependencies not installed

**Solution**:
```powershell
cd C:\Deploy\FuturePred
python -m venv .venv
.venv\Scripts\pip install -r backend\requirements.txt
# Then restart service
Get-Service futurepred-backend | Restart-Service
```

### Issue: "Port 8000 already in use"

**Solution**:
```powershell
# Find process using port 8000
netstat -ano | findstr "127.0.0.1:8000"
# Kill the process (replace PID)
taskkill /PID <PID> /F
# Restart backend service
Get-Service futurepred-backend | Restart-Service
```

### Issue: Nginx returns 502 but backend is running

**Cause**: Nginx proxy configuration issue

**Solution**:
1. Verify nginx config: `nginx.exe -t`
2. Check that `upstream futurepred_backend { server 127.0.0.1:8000; }` exists
3. Reload nginx: `send-signal reload` or restart service

### Issue: Backend logs show import errors

**Cause**: Missing dependencies

**Solution**:
```powershell
cd C:\Deploy\FuturePred\backend
.\..\venv\Scripts\pip install -r requirements.txt
# Or if using project root venv
..\.venv\Scripts\pip install -r requirements.txt
```

### Issue: Backend crashes immediately after starting

**Cause**: Missing .env configuration or bad environment variables

**Solution**:
1. Check if `.env` file exists in `C:\Deploy\FuturePred\backend`
2. Verify all required environment variables are set
3. Check `backend-stderr.log` for specific error

---

## Service Management Commands

### View Service Status
```powershell
Get-Service -Name "nginx", "futurepred-backend" | Format-Table Name, Status, StartType
```

### Start Service
```powershell
Start-Service -Name "futurepred-backend"
Start-Service -Name "nginx"
```

### Stop Service
```powershell
Stop-Service -Name "futurepred-backend"
Stop-Service -Name "nginx"
```

### Restart Service
```powershell
Restart-Service -Name "futurepred-backend" -Force
Restart-Service -Name "nginx" -Force
```

### View Service Logs (NSSM)
```powershell
Get-Content "C:\Deploy\FuturePred\logs\backend-stdout.log" -Tail 50
Get-Content "C:\nginx-1.28.3\logs\service-stdout.log" -Tail 50
```

---

## Quick Health Check

Test all endpoints from the server:

```powershell
# Health endpoint
Invoke-RestMethod -Uri "http://127.0.0.1:8000/health"

# API endpoint
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/admin/history"

# Through HTTPS (ignore cert errors)
$prev = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
Invoke-RestMethod -Uri "https://127.0.0.1/health"
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = $prev
```

---

## Emergency Procedures

### Force restart all services
```powershell
Get-Service "futurepred-backend", "nginx" | Restart-Service -Force
Start-Sleep -Seconds 5
Get-Service "futurepred-backend", "nginx" | Select Name, Status
```

### Uninstall and reinstall services
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
C:\Deploy\FuturePred\deploy\scripts\uninstall-services.ps1
Start-Sleep -Seconds 3
C:\Deploy\FuturePred\deploy\scripts\install-services.ps1
```

### Check all logs at once
```powershell
Write-Host "=== Backend STDOUT ===" -ForegroundColor Cyan
Get-Content "C:\Deploy\FuturePred\logs\backend-stdout.log" -Tail 30

Write-Host "`n=== Nginx Error ===" -ForegroundColor Cyan
Get-Content "C:\nginx-1.28.3\logs\error.log" -Tail 30
```
