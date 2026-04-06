# FuturePred 部署手册（Alibaba Cloud Linux 3，无域名，IP 直连）

适用环境：

- 系统：Alibaba Cloud Linux 3.2104 U11 (OpenAnolis)
- 访问方式：仅 IP（无域名）
- 示例 IP：`8.130.76.33`

## 1. 服务器基础准备

```bash
sudo dnf -y update
sudo dnf -y install git nginx python3 python3-pip python3-devel gcc gcc-c++ make rsync
```

安装 Node.js（推荐 20 LTS）：

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf -y install nodejs
node -v
npm -v
```

## 2. 拉代码并切到部署分支

```bash
cd /opt
sudo git clone https://github.com/YangJian1016/futurepred.git
sudo chown -R $USER:$USER /opt/futurepred
cd /opt/futurepred
git checkout feature/linux-deploy-prep
```

## 3. 后端环境配置

```bash
cd /opt/futurepred/backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
cp -n .env.example .env
```

编辑 `/opt/futurepred/backend/.env`，至少设置：

- `PUBLIC_BASE_URL=http://8.130.76.33`
- `FRONTEND_ORIGIN=*`
- `AUTH_USERNAME=你的账号`
- `AUTH_PASSWORD=你的密码`
- `JWT_SECRET=随机长字符串`
- `SILICONFLOW_API_KEY=你的key`

说明：当前是 IP 同源访问（前端与 API 同主机同端口），浏览器不会产生跨域问题。

## 4. 构建前端并发布静态资源

```bash
cd /opt/futurepred/frontend
npm ci
npm run build

sudo mkdir -p /var/www/futurepred/frontend/dist
sudo rsync -a --delete /opt/futurepred/frontend/dist/ /var/www/futurepred/frontend/dist/
```

## 5. 配置后端 systemd 服务

创建服务文件：

```bash
sudo tee /etc/systemd/system/futurepred-backend.service >/dev/null <<'EOF'
[Unit]
Description=FuturePred FastAPI Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/futurepred/backend
EnvironmentFile=/opt/futurepred/backend/.env
ExecStart=/opt/futurepred/backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --app-dir /opt/futurepred/backend
Restart=always
RestartSec=3
User=nginx
Group=nginx

[Install]
WantedBy=multi-user.target
EOF
```

授权后端数据目录给 nginx 用户：

```bash
sudo mkdir -p /opt/futurepred/backend/data/generated
sudo chown -R nginx:nginx /opt/futurepred/backend/data
```

启动后端服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now futurepred-backend
sudo systemctl status futurepred-backend --no-pager
```

## 6. 配置 Nginx

```bash
sudo cp /opt/futurepred/deploy/nginx/futurepred.conf /etc/nginx/conf.d/futurepred.conf
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl restart nginx
```

## 7. 开放安全组与防火墙

阿里云安全组至少放行：

- TCP 22（SSH）
- TCP 80（HTTP）

如果系统启用了 firewalld：

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload
```

## 8. 验证

```bash
curl -f http://127.0.0.1:8000/health
curl -f http://127.0.0.1/health
curl -I http://8.130.76.33
```

浏览器访问：

- `http://8.130.76.33`

## 9. 常用排障

```bash
sudo journalctl -u futurepred-backend -f
sudo tail -f /var/log/nginx/error.log
sudo nginx -t
```

如果后端服务起不来，优先检查：

- `/opt/futurepred/backend/.env` 是否存在且格式正确
- API key 是否填写
- `nginx` 用户是否有 `backend/data` 写权限
