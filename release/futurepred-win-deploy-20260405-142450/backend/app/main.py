from __future__ import annotations

import json
import os
import random
import threading
import time
import uuid
import base64
import re
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

from .models import (
    DeleteSelectedRequest,
    HistoryItem,
    HistoryListResponse,
    LoginRequest,
    LoginResponse,
    PredictRequest,
    PredictResponse,
    ResetRequest,
)
from .professions import HIGH_END_PROFESSIONS

load_dotenv()


def _read_int_env(name: str, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError:
        value = default
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def _read_float_env(name: str, default: float, *, minimum: float | None = None, maximum: float | None = None) -> float:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = float(raw)
    except ValueError:
        value = default
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def _read_bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name, str(default)).strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f"{path.suffix}.tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
STATE_FILE = DATA_DIR / "assignment_state.json"
HISTORY_FILE = DATA_DIR / "prediction_history.json"
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
NAME_PATTERN = re.compile(r"^[A-Za-z\u4e00-\u9fff]+(?: [A-Za-z\u4e00-\u9fff]+)*$")
PROVIDER_HTTP_TIMEOUT_SECONDS = _read_float_env("PROVIDER_HTTP_TIMEOUT_SECONDS", 90.0, minimum=5.0, maximum=300.0)
PROVIDER_RETRY_ATTEMPTS = _read_int_env("PROVIDER_RETRY_ATTEMPTS", 2, minimum=0, maximum=5)
PROVIDER_RETRY_BACKOFF_SECONDS = _read_float_env("PROVIDER_RETRY_BACKOFF_SECONDS", 1.2, minimum=0.1, maximum=10.0)
GENERATION_CONCURRENCY = _read_int_env("GENERATION_CONCURRENCY", 8, minimum=1, maximum=64)
GENERATION_WAIT_TIMEOUT_SECONDS = _read_float_env("GENERATION_WAIT_TIMEOUT_SECONDS", 25.0, minimum=1.0, maximum=120.0)
MAX_IMAGE_BYTES = _read_int_env("MAX_IMAGE_BYTES", 8 * 1024 * 1024, minimum=256 * 1024, maximum=20 * 1024 * 1024)
HISTORY_MAX_RECORDS = _read_int_env("HISTORY_MAX_RECORDS", 5000, minimum=200, maximum=50000)
generation_slots = threading.BoundedSemaphore(value=GENERATION_CONCURRENCY)

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
        _atomic_write_json(
            self._state_file,
            {
                "queue": self._queue,
                "assigned": self._assigned,
                "seed": self._seed,
            },
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


class PredictionHistoryStore:
    def __init__(self, history_file: Path) -> None:
        self._history_file = history_file
        self._lock = threading.Lock()
        self._records: list[dict[str, str]] = []
        self._history_file.parent.mkdir(parents=True, exist_ok=True)
        self._load_or_init()

    def _load_or_init(self) -> None:
        if not self._history_file.exists():
            self._persist()
            return
        try:
            raw = json.loads(self._history_file.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                self._records = [record for record in raw if isinstance(record, dict)]
        except (json.JSONDecodeError, OSError):
            self._records = []
            self._persist()

    def _persist(self) -> None:
        _atomic_write_json(self._history_file, self._records)

    def list(self) -> list[dict[str, str]]:
        with self._lock:
            return list(self._records)

    def add(self, record: dict[str, str]) -> None:
        with self._lock:
            self._records.insert(0, record)
            if len(self._records) > HISTORY_MAX_RECORDS:
                self._records = self._records[:HISTORY_MAX_RECORDS]
            self._persist()

    def delete_selected(self, prediction_ids: set[str]) -> list[dict[str, str]]:
        with self._lock:
            deleted = [record for record in self._records if record.get("prediction_id", "") in prediction_ids]
            self._records = [record for record in self._records if record.get("prediction_id", "") not in prediction_ids]
            self._persist()
            return deleted

    def clear_all(self) -> list[dict[str, str]]:
        with self._lock:
            deleted = list(self._records)
            self._records = []
            self._persist()
            return deleted


allocator = RoleAllocator(HIGH_END_PROFESSIONS, STATE_FILE)
history_store = PredictionHistoryStore(HISTORY_FILE)
GENERATED_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Future Profession Predictor API", version="0.1.0")
app.mount("/generated", StaticFiles(directory=str(GENERATED_DIR)), name="generated")
auth_scheme = HTTPBearer(auto_error=False)

origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGIN", "*").split(",")
    if origin.strip()
]
origin_regex = os.getenv("FRONTEND_ORIGIN_REGEX", "").strip() or None
cors_allow_credentials = _read_bool_env("CORS_ALLOW_CREDENTIALS", False)

# Browsers disallow wildcard origin when credentials are enabled.
if "*" in origins and cors_allow_credentials:
    cors_allow_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=origin_regex,
    allow_credentials=cors_allow_credentials,
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


def _remove_generated_image(filename: str) -> None:
    if not filename:
        return
    target = GENERATED_DIR / filename
    if target.exists():
        target.unlink(missing_ok=True)


def _is_retryable_http_error(error: Exception) -> bool:
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code in {408, 429, 500, 502, 503, 504}
    if isinstance(error, httpx.TimeoutException):
        return True
    if isinstance(error, httpx.NetworkError):
        return True
    return False


def _request_with_retry(
    client: httpx.Client,
    method: str,
    url: str,
    **kwargs: Any,
) -> httpx.Response:
    last_error: Exception | None = None
    for attempt in range(PROVIDER_RETRY_ATTEMPTS + 1):
        try:
            response = client.request(method, url, **kwargs)
            response.raise_for_status()
            return response
        except (httpx.HTTPError, httpx.TimeoutException) as error:
            last_error = error
            if attempt >= PROVIDER_RETRY_ATTEMPTS or not _is_retryable_http_error(error):
                raise
            time.sleep(PROVIDER_RETRY_BACKOFF_SECONDS * (attempt + 1))
    raise ValueError(f"请求失败: {last_error}")


def _acquire_generation_slot() -> None:
    acquired = generation_slots.acquire(timeout=GENERATION_WAIT_TIMEOUT_SECONDS)
    if not acquired:
        raise HTTPException(
            status_code=429,
            detail="当前活动人数较多，生图任务排队中，请稍后重试。",
        )


def _release_generation_slot() -> None:
    generation_slots.release()


def _download_image(client: httpx.Client, url: str, output_path: Path) -> None:
    response = _request_with_retry(client, "GET", url)
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

    if len(binary) > MAX_IMAGE_BYTES:
        raise ValueError(f"图片过大，请压缩到 {MAX_IMAGE_BYTES // (1024 * 1024)}MB 以内")

    return mime_type, binary


def _generate_with_siliconflow(client: httpx.Client, prompt: str, seed: str, output_path: Path) -> str:
    if not SILICONFLOW_API_KEY:
        raise ValueError("SiliconFlow 未配置 API Key")

    response = _request_with_retry(
        client,
        "POST",
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
        f"Create a photorealistic portrait of the same person as a {profession_label}, "
        "age around 20 years old young adult, warm and friendly smile, refined and attractive appearance, "
        "clear natural skin texture, professional styling, formal outfit, soft cinematic studio lighting, "
        "high detail, clean background, school-ceremony friendly"
    )

    response = _request_with_retry(
        client,
        "POST",
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

    response = _request_with_retry(
        client,
        "POST",
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
    data: dict[str, Any] = response.json()
    image_url = (((data.get("output") or {}).get("results") or [{}])[0]).get("url")
    if not image_url:
        raise ValueError("DashScope 未返回图片链接")

    _download_image(client, image_url, output_path)
    return "dashscope"


def _generate_with_zhipu(client: httpx.Client, prompt: str, output_path: Path) -> str:
    if not ZHIPU_API_KEY:
        raise ValueError("智谱 未配置 API Key")

    response = _request_with_retry(
        client,
        "POST",
        "https://open.bigmodel.cn/api/paas/v4/images/generations",
        headers={"Authorization": f"Bearer {ZHIPU_API_KEY}"},
        json={
            "model": ZHIPU_MODEL,
            "prompt": prompt,
            "size": "768x768",
        },
    )
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


def _generate_future_image_with_client(client: httpx.Client, prompt: str, seed: str, output_path: Path) -> str:
    failures: list[str] = []

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


def _generate_future_image(prompt: str, seed: str, output_path: Path) -> str:
    with httpx.Client(timeout=PROVIDER_HTTP_TIMEOUT_SECONDS) as client:
        return _generate_future_image_with_client(client, prompt, seed, output_path)


def _generate_future_image_plan_b(
    prompt: str,
    profession_label: str,
    seed: str,
    output_path: Path,
    reference_image_data: str,
) -> str:
    failures: list[str] = []

    with httpx.Client(timeout=PROVIDER_HTTP_TIMEOUT_SECONDS) as client:
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
            return _generate_future_image_with_client(client, prompt, seed, output_path)
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
        "robustness": {
            "generation_concurrency": GENERATION_CONCURRENCY,
            "generation_wait_timeout_seconds": GENERATION_WAIT_TIMEOUT_SECONDS,
            "provider_timeout_seconds": PROVIDER_HTTP_TIMEOUT_SECONDS,
            "provider_retry_attempts": PROVIDER_RETRY_ATTEMPTS,
            "provider_retry_backoff_seconds": PROVIDER_RETRY_BACKOFF_SECONDS,
            "max_image_bytes": MAX_IMAGE_BYTES,
            "history_max_records": HISTORY_MAX_RECORDS,
        },
    }


@app.get("/api/admin/history", response_model=HistoryListResponse)
def admin_history(request: Request, _: str = Depends(_require_auth)) -> HistoryListResponse:
    records = history_store.list()
    items = [
        HistoryItem(
            prediction_id=record.get("prediction_id", ""),
            participant_name=record.get("participant_name", ""),
            profession=record.get("profession", ""),
            generated_image_url=_build_public_image_url(request, record.get("filename", "")),
            image_provider=record.get("image_provider", "unknown"),
            created_at=record.get("created_at", ""),
        )
        for record in records
        if record.get("prediction_id") and record.get("filename")
    ]
    return HistoryListResponse(items=items, count=len(items))


@app.post("/api/admin/history/delete-selected")
def admin_delete_selected(payload: DeleteSelectedRequest, _: str = Depends(_require_auth)) -> dict[str, int]:
    prediction_ids = {prediction_id.strip() for prediction_id in payload.prediction_ids if prediction_id.strip()}
    if not prediction_ids:
        return {"deleted": 0}

    deleted_records = history_store.delete_selected(prediction_ids)
    for record in deleted_records:
        _remove_generated_image(record.get("filename", ""))

    return {"deleted": len(deleted_records)}


@app.post("/api/admin/history/clear-reset")
def admin_clear_reset(_: str = Depends(_require_auth)) -> dict[str, int]:
    deleted_records = history_store.clear_all()
    for record in deleted_records:
        _remove_generated_image(record.get("filename", ""))

    allocator.reset(seed=None)
    return {"deleted": len(deleted_records)}


@app.post("/api/predict", response_model=PredictResponse)
def predict_future_profession(
    payload: PredictRequest,
    request: Request,
    _: str = Depends(_require_auth),
) -> PredictResponse:
    participant_name = payload.participant_name.strip()
    if not participant_name:
        raise HTTPException(status_code=400, detail="请输入姓名")
    if not NAME_PATTERN.fullmatch(participant_name):
        raise HTTPException(status_code=400, detail="姓名仅支持中文、英文和空格")

    if not payload.image_data.startswith("data:image"):
        raise HTTPException(status_code=400, detail="请上传有效的照片数据")

    try:
        _parse_image_data_url(payload.image_data)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    _acquire_generation_slot()
    try:
        try:
            profession, profession_index, total = allocator.next_role(participant_name)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

        prediction_id = str(uuid.uuid4())
        seed_value = str(uuid.uuid4().int % 1_000_000_000)
        profession_label = PROFESSION_EN_LABELS.get(profession, profession)
        image_prompt = (
            "masterpiece, photorealistic portrait, future career professional, "
            f"{profession_label}, around 20 years old young adult, "
            "warm friendly smile, refined attractive appearance, clean natural skin, "
            "professional formal outfit, soft cinematic lighting, high detail, 85mm lens, "
            "clean background, uplifting and school-ceremony friendly"
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
        history_store.add(
            {
                "prediction_id": prediction_id,
                "participant_name": participant_name,
                "profession": profession,
                "filename": filename,
                "image_provider": image_provider,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )

        return PredictResponse(
            prediction_id=prediction_id,
            participant_name=participant_name,
            profession=profession,
            profession_index=profession_index,
            total_professions=total,
            status_text="正在预测未来职业...",
            image_prompt=image_prompt,
            generated_image_url=generated_image_url,
            image_provider=image_provider,
        )
    finally:
        _release_generation_slot()


@app.post("/api/admin/reset")
def reset_assignments(payload: ResetRequest, _: str = Depends(_require_auth)) -> dict[str, str]:
    allocator.reset(payload.seed)
    return {"message": "职业池已重置"}
