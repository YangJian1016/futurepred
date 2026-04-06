# FuturePred Linux Deployment Guide

This guide prepares a Linux host for production deployment with:

- Frontend static files served by Nginx
- Backend FastAPI served by Uvicorn + systemd
- Same-origin routing via Nginx (`/api`, `/generated`, `/health`)

With this layout, browser requests are same-origin and CORS is usually not triggered.

## 1. Prerequisites

- Ubuntu 22.04+ / Debian 12+ (or equivalent)
- `sudo` privileges
- Installed packages: `nginx`, `python3`, `python3-venv`, `python3-pip`, `nodejs`, `npm`
- If available, Python 3.14 is preferred for consistency with your current environment.

Install packages (Debian/Ubuntu):

```bash
sudo apt update
sudo apt install -y nginx python3 python3-venv python3-pip nodejs npm
```

## 2. Prepare Project

```bash
git clone https://github.com/YangJian1016/futurepred.git
cd futurepred
git checkout develop
```

## 3. Run Preparation Script

```bash
chmod +x deploy/scripts/linux/prepare-linux.sh
sudo bash deploy/scripts/linux/prepare-linux.sh
```

What the script does:

- Builds frontend and copies `frontend/dist` to `/var/www/futurepred/frontend/dist`
- Creates backend venv at `backend/.venv` and installs requirements
- Creates `backend/.env` from `.env.example` if missing
- Installs systemd unit: `futurepred-backend.service`
- Installs Nginx config: `/etc/nginx/conf.d/futurepred.conf`
- Starts backend service and reloads Nginx

Interpreter selection in script:

- Prefer `python3.14` if installed
- Fallback to `python3`

## 4. Configure Secrets

Edit backend environment file:

```bash
sudo nano backend/.env
```

At minimum set:

- `SILICONFLOW_API_KEY`
- `DASHSCOPE_API_KEY` (optional fallback)
- `AUTH_USERNAME`
- `AUTH_PASSWORD`
- `JWT_SECRET`

For same-origin Nginx deployment, recommended:

- `FRONTEND_ORIGIN=*`
- `PUBLIC_BASE_URL=https://your-domain.com` (or `http://server-ip`)

Then restart backend:

```bash
sudo systemctl restart futurepred-backend
```

## 5. Verify Deployment

```bash
bash deploy/scripts/linux/verify-linux-deploy.sh
```

Or run manually:

```bash
curl -f http://127.0.0.1:8000/health
curl -f http://127.0.0.1/health
```

## 6. Optional: Enable Auto-Start

```bash
sudo systemctl enable futurepred-backend
sudo systemctl enable nginx
```

## Troubleshooting

- Backend logs: `sudo journalctl -u futurepred-backend -f`
- Nginx test: `sudo nginx -t`
- Nginx logs:
  - `/var/log/nginx/access.log`
  - `/var/log/nginx/error.log`
