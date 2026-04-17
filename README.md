# FuturePred

面向活动现场的“AI 未来职业预测”系统（React + FastAPI）。

## 功能

- 前端调用摄像头拍照
- 班级与姓名必填，点击预测前先进行性别识别并弹窗确认
- 后端按性别使用对应职业池随机且不重复分配（大部分职业男女通用，含少量扩展职业）
- 调用第三方模型实时生成未来职业形象图（支持多通道容灾）
- 支持登录鉴权，未登录无法调用预测接口
- 返回“正在预测未来职业”流程文案与真实生图结果
- 采集页仅展示分页预览，完整职业墙放在独立页面，避免页面变慢
- 第三方生图失败时自动回滚职业名额

## 国内通道实测排名（当前环境）

基于本机实际探测结果：

- **#1 SiliconFlow**：接口可达，返回 `401 Invalid token`（说明网络通，接入门槛低）
- **#2 DashScope**：接口可达，返回 `401 No API-key provided`
- **#3 智谱 BigModel**：接口可达，返回 `401`（缺授权）
- **#4 Pollinations**：可达但返回 `500 Internal Server Error`（不稳定，仅建议兜底）

说明：`401` 在这里是好信号，代表从中国网络到服务端链路正常，只差 API Key。

## 本地开发

### 0) 先配置多通道容灾

在 `backend` 目录创建 `.env`（可从 `.env.example` 复制），至少填写：

```powershell
cd backend
copy .env.example .env
```

- `SILICONFLOW_API_KEY=你的key`
- `DASHSCOPE_API_KEY=你的key`
- `IMAGE_PROVIDER_ORDER=siliconflow,dashscope,pollinations`

这样默认就是：SiliconFlow 主通道 + DashScope 备通道 + Pollinations 兜底。

注意：`.env` 已被 `.gitignore` 忽略，不会被推送到 GitHub。

### 1) 启动后端

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2) 启动前端

```powershell
cd frontend
npm install
npm run dev
```

前端地址：`http://localhost:5173`
后端地址：`http://localhost:8000`

## Docker 一键运行

```powershell
docker compose up --build
```

- 前端：`http://localhost:5173`
- 后端健康检查：`http://localhost:8000/health`

## 云部署（最简）

适合一台云服务器快速上线（Ubuntu/CentOS 均可，需已安装 Docker + Docker Compose）。

1) 拉取代码

```bash
git clone https://github.com/YangJian1016/futurepred.git
cd futurepred
```

2) 配置后端密钥

```bash
cp backend/.env.example backend/.env
```

编辑 `backend/.env`，至少填写：

- `SILICONFLOW_API_KEY=你的key`
- `DASHSCOPE_API_KEY=你的key`（可选备通道）
- `AUTH_USERNAME=活动账号`
- `AUTH_PASSWORD=活动密码`
- `JWT_SECRET=随机长字符串`

3) 一键启动

```bash
docker compose up -d --build
```

4) 验证服务

```bash
curl http://127.0.0.1:8000/health
```

返回 `{"status":"ok"}` 即表示后端已正常运行。

## Nginx 生产部署（推荐）

已提供可直接使用的配置文件：

- [deploy/nginx/futurepred.conf](deploy/nginx/futurepred.conf)

该配置实现：

- 前端静态文件由 Nginx 直接托管
- `/api`、`/generated`、`/health` 反向代理到 FastAPI
- 前后端同源访问，避免跨域问题

### 服务器目录建议

- 前端构建产物目录：`/var/www/futurepred/frontend/dist`
- 后端监听地址：`127.0.0.1:8000`

### 启用步骤（Ubuntu/CentOS 通用思路）

1) 构建并上传前端

```bash
cd frontend
npm install
npm run build
```

将 `frontend/dist` 上传到服务器 `/var/www/futurepred/frontend/dist`。

2) 部署后端并启动 `uvicorn`

确保后端在服务器本机 `127.0.0.1:8000` 可访问：

```bash
curl http://127.0.0.1:8000/health
```

3) 安装 Nginx 配置

```bash
sudo cp deploy/nginx/futurepred.conf /etc/nginx/conf.d/futurepred.conf
sudo nginx -t
sudo systemctl reload nginx
```

4) 验证

```bash
curl http://127.0.0.1/health
```

返回 `{"status":"ok"}` 表示 Nginx 到后端链路正常。

## Linux 部署准备（develop 分支）

已补充 Linux 生产部署所需文件：

- `deploy/LINUX_DEPLOY.md`
- `deploy/systemd/futurepred-backend.service`
- `deploy/scripts/linux/prepare-linux.sh`
- `deploy/scripts/linux/verify-linux-deploy.sh`

跨域说明：

- 当使用 `deploy/nginx/futurepred.conf` 时，前端与 `/api`、`/generated`、`/health` 走同一域名和端口，请求为同源，通常不会触发 CORS 问题。
- 本地开发阶段使用 Vite 代理（`frontend/vite.config.ts`）也可避免浏览器跨域。

Linux 服务器建议按以下入口执行：

```bash
chmod +x deploy/scripts/linux/prepare-linux.sh deploy/scripts/linux/verify-linux-deploy.sh
sudo bash deploy/scripts/linux/prepare-linux.sh
bash deploy/scripts/linux/verify-linux-deploy.sh
```

## API

- `GET /health` 健康检查
- `GET /api/status` 查看男女职业池剩余数量
- `GET /api/providers/probe` 查看多通道配置状态
- `POST /api/face/attributes` 调用阿里云人脸属性识别
- `POST /api/predict` 分配并返回未来职业
- `POST /api/admin/reset` 重置职业池

## 后端环境变量

- `FRONTEND_ORIGIN`：允许的前端域名
- `PUBLIC_BASE_URL`：返回图片 URL 时使用的公网 API 域名
- `IMAGE_PROVIDER_ORDER`：容灾顺序，默认 `siliconflow,dashscope,pollinations`
- `PLAN_B_ENABLED`：是否启用“参考图保留身份”路径（默认 `true`）
- `PLAN_B_REFERENCE_MODEL`：参考图编辑模型（默认 `Qwen/Qwen-Image-Edit-2509`）
- `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET`：阿里云人脸属性识别 AccessKey
- `ALIYUN_FACEBODY_ENDPOINT`：默认 `facebody.cn-shanghai.aliyuncs.com`
- `SILICONFLOW_API_KEY` / `SILICONFLOW_MODEL`
- `DASHSCOPE_API_KEY` / `DASHSCOPE_MODEL`
- `ZHIPU_API_KEY` / `ZHIPU_MODEL`（可选扩展）
- `POLLINATIONS_BASE_URL` / `IMAGE_MODEL`（兜底）

说明：`POST /api/predict` 已经改为直接复用阿里云人脸属性识别结果里的性别信息，不再使用本地 `opencv/onnx/insightface` 检测链路。

说明：前端推荐流程是先调用 `POST /api/face/attributes` 拿到性别并弹窗确认，再调用 `POST /api/predict` 时带上 `confirmed_gender`，这样后端不会重复调用阿里云识别性别。

`POST /api/predict` 请求示例：

```json
{
  "participant_class": "四年级(1)班",
  "participant_name": "小明",
  "confirmed_gender": "male",
  "image_data": "data:image/jpeg;base64,..."
}
```

`POST /api/face/attributes` 请求示例：

```json
{
  "image_data": "data:image/jpeg;base64,...",
  "max_face_number": 3
}
```
