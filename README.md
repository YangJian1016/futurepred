# FuturePred

面向活动现场的“AI 未来职业预测”系统（React + FastAPI）。

## 功能

- 前端调用摄像头拍照
- 后端从 28 个高端职业中随机且不重复分配
- 调用第三方模型实时生成未来职业形象图（支持多通道容灾）
- 返回“正在预测未来职业”流程文案与真实生图结果
- 28 人分配完会阻止继续分配，避免重复
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

## API

- `GET /health` 健康检查
- `GET /api/status` 查看剩余职业数量
- `GET /api/providers/probe` 查看多通道配置状态
- `POST /api/predict` 分配并返回未来职业
- `POST /api/admin/reset` 重置职业池

## 后端环境变量

- `FRONTEND_ORIGIN`：允许的前端域名
- `PUBLIC_BASE_URL`：返回图片 URL 时使用的公网 API 域名
- `IMAGE_PROVIDER_ORDER`：容灾顺序，默认 `siliconflow,dashscope,pollinations`
- `SILICONFLOW_API_KEY` / `SILICONFLOW_MODEL`
- `DASHSCOPE_API_KEY` / `DASHSCOPE_MODEL`
- `ZHIPU_API_KEY` / `ZHIPU_MODEL`（可选扩展）
- `POLLINATIONS_BASE_URL` / `IMAGE_MODEL`（兜底）

`POST /api/predict` 请求示例：

```json
{
  "participant_name": "小明",
  "image_data": "data:image/jpeg;base64,..."
}
```
