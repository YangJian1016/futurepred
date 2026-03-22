from __future__ import annotations

import json
import os
import random
import threading
import uuid
import base64
from datetime import datetime, timedelta, timezone
from pathlib import Path
from secrets import compare_digest
from typing import Any
from urllib.parse import quote

from dotenv import load_dotenv
import httpx
import jwt
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles

from .models import LoginRequest, LoginResponse, PredictRequest, PredictResponse, ResetRequest
from .professions import HIGH_END_PROFESSIONS

load_dotenv()

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
STATE_FILE = DATA_DIR / "assignment_state.json"
GENERATED_DIR = DATA_DIR / "generated"
IMAGE_MODEL = os.getenv("IMAGE_MODEL", "flux")
POLLINATIONS_BASE_URL = os.getenv("POLLINATIONS_BASE_URL", "https://image.pollinations.ai/prompt")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "")
IMAGE_PROVIDER_ORDER = [
    provider.strip().lower()
    for provider in os.getenv("IMAGE_PROVIDER_ORDER", "siliconflow,dashscope,pollinations").split(",")
    if provider.strip()
]
PLAN_B_ENABLED = os.getenv("PLAN_B_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
PLAN_B_REFERENCE_MODEL = os.getenv("PLAN_B_REFERENCE_MODEL", "Qwen/Qwen-Image-Edit-2509")
SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY", "")
SILICONFLOW_MODEL = os.getenv("SILICONFLOW_MODEL", "black-forest-labs/FLUX.1-schnell")
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
DASHSCOPE_MODEL = os.getenv("DASHSCOPE_MODEL", "wanx2.1-t2i-turbo")
ZHIPU_API_KEY = os.getenv("ZHIPU_API_KEY", "")
ZHIPU_MODEL = os.getenv("ZHIPU_MODEL", "cogview-3-flash")
AUTH_ENABLED = os.getenv("AUTH_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
AUTH_USERNAME = os.getenv("AUTH_USERNAME", "admin")
AUTH_PASSWORD = os.getenv("AUTH_PASSWORD", "ChangeMe123!")
JWT_SECRET = os.getenv("JWT_SECRET", "change-this-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))

PROFESSION_EN_LABELS = {
    "AI算法科学家": "AI research scientist",
    "芯片架构师": "chip architect",
    "航天工程师": "aerospace engineer",
    "民航机长": "airline captain",
    "心外科医生": "cardiac surgeon",
    "神经外科医生": "neurosurgeon",
    "生物医药研究员": "biomedical researcher",
    "基因工程科学家": "genetic engineering scientist",
    "量化分析师": "quantitative analyst",
    "投资银行家": "investment banker",
    "网络安全专家": "information security engineer",
    "区块链架构师": "blockchain architect",
    "云计算架构师": "cloud architect",
    "机器人研发总监": "robotics R&D director",
    "自动驾驶系统工程师": "autonomous driving engineer",
    "新能源首席工程师": "chief renewable energy engineer",
    "核聚变研究员": "nuclear fusion researcher",
    "材料科学家": "materials scientist",
    "大学教授": "university professor",
    "外交官": "diplomat",
    "法官": "judge",
    "国际律师": "international lawyer",
    "建筑设计师": "architect",
    "工业设计总监": "industrial design director",
    "科技企业创始人": "technology startup founder",
    "产品战略总监": "product strategy director",
    "数据科学总监": "director of data science",
    "人工智能伦理专家": "AI ethics specialist",
}


class RoleAllocator:
    def __init__(self, professions: list[str], state_file: Path) -> None:
        self._professions = professions
        self._state_file = state_file
        self._lock = threading.Lock()
        self._queue: list[str] = []
        self._assigned: list[str] = []
        self._seed: int | None = None
        self._state_file.parent.mkdir(parents=True, exist_ok=True)
        self._load_or_init()

    def _load_or_init(self) -> None:
        if self._state_file.exists():
            try:
                state = json.loads(self._state_file.read_text(encoding="utf-8"))
                queue = state.get("queue", [])
                assigned = state.get("assigned", [])
                if sorted(queue + assigned) == sorted(self._professions):
                    self._queue = queue
                    self._assigned = assigned
                    self._seed = state.get("seed")
                    return
            except (json.JSONDecodeError, OSError):
                pass
        self._reset_internal(seed=None)

    def _persist(self) -> None:
        self._state_file.write_text(
            json.dumps(
                {
                    "queue": self._queue,
                    "assigned": self._assigned,
                    "seed": self._seed,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def _reset_internal(self, seed: int | None) -> None:
        self._seed = seed
        randomizer = random.Random(seed)
        shuffled = self._professions.copy()
        randomizer.shuffle(shuffled)
        self._queue = shuffled
        self._assigned = []
        self._persist()

    def next_role(self, participant_name: str) -> tuple[str, int, int]:
        del participant_name
        with self._lock:
            if not self._queue:
                self._reset_internal(seed=self._seed)

            profession = self._queue.pop(0)
            self._assigned.append(profession)
            self._persist()
            profession_index = len(self._assigned)
            return profession, profession_index, len(self._professions)

    def rollback_role(self, profession: str) -> None:
        with self._lock:
            if self._assigned and self._assigned[-1] == profession:
                self._assigned.pop()
                self._queue.insert(0, profession)
                self._persist()

    def status(self) -> dict[str, int]:
        with self._lock:
            return {
                "assigned": len(self._assigned),
                "remaining": len(self._queue),
                "total": len(self._professions),
            }

    def reset(self, seed: int | None) -> None:
        with self._lock:
            self._reset_internal(seed)


allocator = RoleAllocator(HIGH_END_PROFESSIONS, STATE_FILE)
GENERATED_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Future Profession Predictor API", version="0.1.0")
app.mount("/generated", StaticFiles(directory=str(GENERATED_DIR)), name="generated")
auth_scheme = HTTPBearer(auto_error=False)

origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGIN", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _create_access_token(subject: str) -> tuple[str, int]:
    expire_delta = timedelta(minutes=JWT_EXPIRE_MINUTES)
    expires_at = datetime.now(timezone.utc) + expire_delta
    payload = {
        "sub": subject,
        "exp": expires_at,
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token, int(expire_delta.total_seconds())


def _require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(auth_scheme),
) -> str:
    if not AUTH_ENABLED:
        return "anonymous"

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")

    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        subject = payload.get("sub", "")
    except jwt.PyJWTError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已失效，请重新登录") from error

    if not isinstance(subject, str) or not compare_digest(subject, AUTH_USERNAME):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效登录凭证")

    return subject


@app.post("/api/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    if not AUTH_ENABLED:
        token, expires_in = _create_access_token("anonymous")
        return LoginResponse(access_token=token, expires_in=expires_in)

    if not (compare_digest(payload.username, AUTH_USERNAME) and compare_digest(payload.password, AUTH_PASSWORD)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    token, expires_in = _create_access_token(AUTH_USERNAME)
    return LoginResponse(access_token=token, expires_in=expires_in)


@app.get("/api/status")
def assignment_status(_: str = Depends(_require_auth)) -> dict[str, int]:
    return allocator.status()


def _build_public_image_url(request: Request, filename: str) -> str:
    if PUBLIC_BASE_URL:
        return f"{PUBLIC_BASE_URL.rstrip('/')}/generated/{filename}"
    return str(request.url_for("generated", path=filename))


def _download_image(client: httpx.Client, url: str, output_path: Path) -> None:
    response = client.get(url)
    response.raise_for_status()
    content_type = response.headers.get("content-type", "")
    content = response.content
    is_image_content_type = content_type.startswith("image/")
    is_image_magic = (
        content.startswith(b"\x89PNG\r\n\x1a\n")
        or content.startswith(b"\xff\xd8\xff")
        or content.startswith(b"GIF87a")
        or content.startswith(b"GIF89a")
        or content.startswith(b"RIFF") and b"WEBP" in content[:16]
    )

    if not is_image_content_type and not is_image_magic:
        raise ValueError("第三方返回的资源不是图片")

    output_path.write_bytes(content)


def _parse_image_data_url(image_data: str) -> tuple[str, bytes]:
    if not image_data.startswith("data:image"):
        raise ValueError("无效的图片 data URL")

    try:
        header, body = image_data.split(",", 1)
    except ValueError as error:
        raise ValueError("图片数据格式错误") from error

    mime_type = "image/jpeg"
    if ";" in header:
        mime_type = header[5:].split(";", 1)[0] or "image/jpeg"

    try:
        binary = base64.b64decode(body)
    except Exception as error:
        raise ValueError("图片 base64 解码失败") from error

    return mime_type, binary


def _generate_with_siliconflow(client: httpx.Client, prompt: str, seed: str, output_path: Path) -> str:
    if not SILICONFLOW_API_KEY:
        raise ValueError("SiliconFlow 未配置 API Key")

    response = client.post(
        "https://api.siliconflow.cn/v1/images/generations",
        headers={"Authorization": f"Bearer {SILICONFLOW_API_KEY}"},
        json={
            "model": SILICONFLOW_MODEL,
            "prompt": prompt,
            "size": "768x768",
            "seed": int(seed),
            "response_format": "url",
        },
    )
    response.raise_for_status()
    data = response.json()
    item = ((data.get("data") or [{}])[0]) if data.get("data") else ((data.get("images") or [{}])[0])
    image_url = item.get("url")
    image_b64 = item.get("b64_json") or item.get("base64")

    if image_url:
        _download_image(client, image_url, output_path)
        return "siliconflow"
    if image_b64:
        output_path.write_bytes(base64.b64decode(image_b64))
        return "siliconflow"
    raise ValueError("SiliconFlow 未返回图片链接")


def _generate_with_siliconflow_reference(
    client: httpx.Client,
    profession_label: str,
    reference_image_data: str,
    seed: str,
    output_path: Path,
) -> str:
    if not SILICONFLOW_API_KEY:
        raise ValueError("SiliconFlow 未配置 API Key")

    reference_prompt = (
        "Preserve the same person identity and facial features from the input image. "
        f"Create a realistic adult professional portrait as {profession_label}, "
        "formal outfit, clean studio lighting, highly detailed photo"
    )

    response = client.post(
        "https://api.siliconflow.cn/v1/images/generations",
        headers={"Authorization": f"Bearer {SILICONFLOW_API_KEY}"},
        json={
            "model": PLAN_B_REFERENCE_MODEL,
            "prompt": reference_prompt,
            "image": reference_image_data,
            "size": "768x768",
            "seed": int(seed),
            "response_format": "url",
        },
    )
    response.raise_for_status()
    data = response.json()
    item = ((data.get("images") or [{}])[0]) if data.get("images") else ((data.get("data") or [{}])[0])
    image_url = item.get("url")
    image_b64 = item.get("b64_json") or item.get("base64")

    if image_url:
        _download_image(client, image_url, output_path)
        return "siliconflow-plan-b"
    if image_b64:
        output_path.write_bytes(base64.b64decode(image_b64))
        return "siliconflow-plan-b"
    raise ValueError("SiliconFlow Plan B 未返回图片链接")


def _generate_with_dashscope(client: httpx.Client, prompt: str, output_path: Path) -> str:
    if not DASHSCOPE_API_KEY:
        raise ValueError("DashScope 未配置 API Key")

    response = client.post(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
        headers={
            "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "X-DashScope-Async": "disable",
        },
        json={
            "model": DASHSCOPE_MODEL,
            "input": {"prompt": prompt},
            "parameters": {"size": "768*768", "n": 1},
        },
    )
    response.raise_for_status()
    data: dict[str, Any] = response.json()
    image_url = (((data.get("output") or {}).get("results") or [{}])[0]).get("url")
    if not image_url:
        raise ValueError("DashScope 未返回图片链接")

    _download_image(client, image_url, output_path)
    return "dashscope"


def _generate_with_zhipu(client: httpx.Client, prompt: str, output_path: Path) -> str:
    if not ZHIPU_API_KEY:
        raise ValueError("智谱 未配置 API Key")

    response = client.post(
        "https://open.bigmodel.cn/api/paas/v4/images/generations",
        headers={"Authorization": f"Bearer {ZHIPU_API_KEY}"},
        json={
            "model": ZHIPU_MODEL,
            "prompt": prompt,
            "size": "768x768",
        },
    )
    response.raise_for_status()
    data = response.json()
    image_url = ((data.get("data") or [{}])[0]).get("url")
    if not image_url:
        raise ValueError("智谱 未返回图片链接")

    _download_image(client, image_url, output_path)
    return "zhipu"


def _generate_with_pollinations(client: httpx.Client, prompt: str, seed: str, output_path: Path) -> str:
    encoded_prompt = quote(prompt, safe="")
    model_candidates = [IMAGE_MODEL, "flux"]
    last_error: Exception | None = None

    for model_name in dict.fromkeys(model_candidates):
        image_url = (
            f"{POLLINATIONS_BASE_URL}/{encoded_prompt}"
            f"?width=768&height=768&seed={seed}&model={model_name}&nologo=true&safe=true"
        )
        try:
            _download_image(client, image_url, output_path)
            return "pollinations"
        except (httpx.HTTPError, OSError, ValueError) as error:
            last_error = error

    raise ValueError(f"Pollinations 生图失败: {last_error}")


def _generate_future_image(prompt: str, seed: str, output_path: Path) -> str:
    failures: list[str] = []

    with httpx.Client(timeout=90) as client:
        for provider in IMAGE_PROVIDER_ORDER:
            try:
                if provider == "siliconflow":
                    return _generate_with_siliconflow(client, prompt, seed, output_path)
                if provider == "dashscope":
                    return _generate_with_dashscope(client, prompt, output_path)
                if provider == "zhipu":
                    return _generate_with_zhipu(client, prompt, output_path)
                if provider == "pollinations":
                    return _generate_with_pollinations(client, prompt, seed, output_path)
                failures.append(f"{provider}: 未知 provider")
            except (httpx.HTTPError, OSError, ValueError) as error:
                failures.append(f"{provider}: {error}")

    raise ValueError("; ".join(failures) if failures else "未配置可用生图通道")


def _generate_future_image_plan_b(
    prompt: str,
    profession_label: str,
    seed: str,
    output_path: Path,
    reference_image_data: str,
) -> str:
    failures: list[str] = []

    with httpx.Client(timeout=90) as client:
        if PLAN_B_ENABLED:
            try:
                return _generate_with_siliconflow_reference(
                    client=client,
                    profession_label=profession_label,
                    reference_image_data=reference_image_data,
                    seed=seed,
                    output_path=output_path,
                )
            except (httpx.HTTPError, OSError, ValueError) as error:
                failures.append(f"plan-b: {error}")

        try:
            return _generate_future_image(prompt, seed, output_path)
        except ValueError as error:
            failures.append(f"fallback: {error}")

    raise ValueError("; ".join(failures))


@app.get("/api/providers/probe")
def provider_probe(_: str = Depends(_require_auth)) -> dict[str, Any]:
    return {
        "order": IMAGE_PROVIDER_ORDER,
        "providers": {
            "siliconflow": {
                "configured": bool(SILICONFLOW_API_KEY),
                "endpoint": "https://api.siliconflow.cn/v1/images/generations",
                "model": SILICONFLOW_MODEL,
                "plan_b_model": PLAN_B_REFERENCE_MODEL,
            },
            "dashscope": {
                "configured": bool(DASHSCOPE_API_KEY),
                "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
                "model": DASHSCOPE_MODEL,
            },
            "zhipu": {
                "configured": bool(ZHIPU_API_KEY),
                "endpoint": "https://open.bigmodel.cn/api/paas/v4/images/generations",
                "model": ZHIPU_MODEL,
            },
            "pollinations": {
                "configured": True,
                "endpoint": POLLINATIONS_BASE_URL,
                "model": IMAGE_MODEL,
            },
        },
        "plan_b": {
            "enabled": PLAN_B_ENABLED,
            "reference_model": PLAN_B_REFERENCE_MODEL,
        },
    }


@app.post("/api/predict", response_model=PredictResponse)
def predict_future_profession(
    payload: PredictRequest,
    request: Request,
    _: str = Depends(_require_auth),
) -> PredictResponse:
    if not payload.image_data.startswith("data:image"):
        raise HTTPException(status_code=400, detail="请上传有效的照片数据")

    try:
        _parse_image_data_url(payload.image_data)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    try:
        profession, profession_index, total = allocator.next_role(payload.participant_name)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

    prediction_id = str(uuid.uuid4())
    seed_value = str(uuid.uuid4().int % 1_000_000_000)
    profession_label = PROFESSION_EN_LABELS.get(profession, profession)
    image_prompt = (
        "masterpiece, photorealistic portrait, future career professional, "
        f"adult {profession_label}, high-end uniform, confident expression, "
        "clean studio lighting, ultra detailed, 85mm lens, cinematic"
    )
    filename = f"{prediction_id}.jpg"
    output_path = GENERATED_DIR / filename

    try:
        image_provider = _generate_future_image_plan_b(
            prompt=image_prompt,
            profession_label=profession_label,
            seed=seed_value,
            output_path=output_path,
            reference_image_data=payload.image_data,
        )
    except (httpx.HTTPError, OSError, ValueError) as error:
        allocator.rollback_role(profession)
        raise HTTPException(status_code=502, detail=f"第三方生图服务暂不可用：{error}") from error

    generated_image_url = _build_public_image_url(request, filename)

    return PredictResponse(
        prediction_id=prediction_id,
        participant_name=payload.participant_name,
        profession=profession,
        profession_index=profession_index,
        total_professions=total,
        status_text="正在预测未来职业...",
        image_prompt=image_prompt,
        generated_image_url=generated_image_url,
        image_provider=image_provider,
    )


@app.post("/api/admin/reset")
def reset_assignments(payload: ResetRequest, _: str = Depends(_require_auth)) -> dict[str, str]:
    allocator.reset(payload.seed)
    return {"message": "职业池已重置"}
