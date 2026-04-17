from __future__ import annotations

import json
import os
import random
import shutil
import threading
import time
import uuid
import base64
import re
from io import BytesIO
from datetime import datetime, timedelta, timezone
from pathlib import Path
from secrets import compare_digest
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import quote

from dotenv import load_dotenv
import httpx
import jwt
from Tea.exceptions import TeaException
from alibabacloud_facebody20191230.client import Client as FacebodyClient
from alibabacloud_facebody20191230 import models as facebody_models
from alibabacloud_tea_openapi import models as open_api_models
from alibabacloud_tea_util import models as util_models
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles

from .models import (
    DeleteSelectedRequest,
    FaceAttributesRequest,
    FaceAttributesResponse,
    HistoryItem,
    HistoryListResponse,
    LoginRequest,
    LoginResponse,
    PredictRequest,
    PredictResponse,
    ResetRequest,
)
from .professions import HIGH_END_PROFESSIONS
from .professions import get_professions_missing_english_labels
from .professions import get_profession_prompt_profile
from .professions import get_professions_for_gender
from .professions import get_professions_using_default_scene

load_dotenv()


def _read_int_env(name: str, default: int, *, minimum: Optional[int] = None, maximum: Optional[int] = None) -> int:
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


def _read_float_env(name: str, default: float, *, minimum: Optional[float] = None, maximum: Optional[float] = None) -> float:
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
ALIYUN_FACEBODY_ENDPOINT = os.getenv("ALIYUN_FACEBODY_ENDPOINT", "facebody.cn-shanghai.aliyuncs.com").strip()
ALIYUN_FACEBODY_ACCESS_KEY_ID = (
    os.getenv("ALIYUN_FACEBODY_ACCESS_KEY_ID", "").strip()
    or os.getenv("ALIBABA_CLOUD_ACCESS_KEY_ID", "").strip()
)
ALIYUN_FACEBODY_ACCESS_KEY_SECRET = (
    os.getenv("ALIYUN_FACEBODY_ACCESS_KEY_SECRET", "").strip()
    or os.getenv("ALIBABA_CLOUD_ACCESS_KEY_SECRET", "").strip()
)
AUTH_ENABLED = os.getenv("AUTH_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
AUTH_USERNAME = os.getenv("AUTH_USERNAME", "admin")
AUTH_PASSWORD = os.getenv("AUTH_PASSWORD", "ChangeMe123!")
JWT_SECRET = os.getenv("JWT_SECRET", "change-this-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))
NAME_PATTERN = re.compile(r"^[A-Za-z\u4e00-\u9fff][A-Za-z\u4e00-\u9fff\-\.'·\s]{0,49}$")
CLASS_PATTERN = re.compile(r"^[0-9]0[0-9]$")
PROVIDER_HTTP_TIMEOUT_SECONDS = _read_float_env("PROVIDER_HTTP_TIMEOUT_SECONDS", 90.0, minimum=5.0, maximum=300.0)
PROVIDER_RETRY_ATTEMPTS = _read_int_env("PROVIDER_RETRY_ATTEMPTS", 2, minimum=0, maximum=5)
PROVIDER_RETRY_BACKOFF_SECONDS = _read_float_env("PROVIDER_RETRY_BACKOFF_SECONDS", 1.2, minimum=0.1, maximum=10.0)
GENERATION_CONCURRENCY = _read_int_env("GENERATION_CONCURRENCY", 8, minimum=1, maximum=64)
GENERATION_WAIT_TIMEOUT_SECONDS = _read_float_env("GENERATION_WAIT_TIMEOUT_SECONDS", 20.0, minimum=1.0, maximum=120.0)
MAX_IMAGE_BYTES = _read_int_env("MAX_IMAGE_BYTES", 8 * 1024 * 1024, minimum=256 * 1024, maximum=20 * 1024 * 1024)
HISTORY_MAX_RECORDS = _read_int_env("HISTORY_MAX_RECORDS", 5000, minimum=200, maximum=50000)
FACE_QUALITY_RETRY_ATTEMPTS = _read_int_env("FACE_QUALITY_RETRY_ATTEMPTS", 2, minimum=0, maximum=4)
FACE_QUALITY_MIN_SCORE = _read_float_env("FACE_QUALITY_MIN_SCORE", 45.0, minimum=0.0, maximum=100.0)
FACE_QUALITY_MAX_BLUR = _read_float_env("FACE_QUALITY_MAX_BLUR", 0.92, minimum=0.0, maximum=1.0)
FACE_QUALITY_MIN_BLUR_SCORE = _read_float_env("FACE_QUALITY_MIN_BLUR_SCORE", 85.0, minimum=0.0, maximum=100.0)
FACE_BEST_PICK_ENABLED = _read_bool_env("FACE_BEST_PICK_ENABLED", True)
FACE_BEST_PICK_SCORE_WEIGHT = _read_float_env("FACE_BEST_PICK_SCORE_WEIGHT", 0.6, minimum=0.0, maximum=1.0)
FACE_BEST_PICK_BLUR_WEIGHT = _read_float_env("FACE_BEST_PICK_BLUR_WEIGHT", 0.4, minimum=0.0, maximum=1.0)
generation_slots = threading.BoundedSemaphore(value=GENERATION_CONCURRENCY)

class RoleAllocator:
    def __init__(self, professions: List[str], state_file: Path) -> None:
        self._professions = professions
        self._state_file = state_file
        self._lock = threading.Lock()
        self._queue: List[str] = []
        self._assigned: List[str] = []
        self._seed: Optional[int] = None
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

    def _reset_internal(self, seed: Optional[int]) -> None:
        self._seed = seed
        randomizer = random.Random(seed)
        shuffled = self._professions.copy()
        randomizer.shuffle(shuffled)
        self._queue = shuffled
        self._assigned = []
        self._persist()

    def next_role(self, participant_name: str) -> Tuple[str, int, int]:
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

    def status(self) -> Dict[str, int]:
        with self._lock:
            return {
                "assigned": len(self._assigned),
                "remaining": len(self._queue),
                "total": len(self._professions),
            }

    def reset(self, seed: Optional[int]) -> None:
        with self._lock:
            self._reset_internal(seed)


class PredictionHistoryStore:
    def __init__(self, history_file: Path) -> None:
        self._history_file = history_file
        self._lock = threading.Lock()
        self._records: List[Dict[str, str]] = []
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

    def list(self) -> List[Dict[str, str]]:
        with self._lock:
            return list(self._records)

    def add(self, record: Dict[str, str]) -> None:
        with self._lock:
            self._records.insert(0, record)
            if len(self._records) > HISTORY_MAX_RECORDS:
                self._records = self._records[:HISTORY_MAX_RECORDS]
            self._persist()

    def delete_selected(self, prediction_ids: Set[str]) -> List[Dict[str, str]]:
        with self._lock:
            deleted = [record for record in self._records if record.get("prediction_id", "") in prediction_ids]
            self._records = [record for record in self._records if record.get("prediction_id", "") not in prediction_ids]
            self._persist()
            return deleted

    def clear_all(self) -> List[Dict[str, str]]:
        with self._lock:
            deleted = list(self._records)
            self._records = []
            self._persist()
            return deleted


allocator_female = RoleAllocator(get_professions_for_gender("female"), DATA_DIR / "assignment_state_female.json")
allocator_male = RoleAllocator(get_professions_for_gender("male"), DATA_DIR / "assignment_state_male.json")
allocator_default = RoleAllocator(HIGH_END_PROFESSIONS, STATE_FILE)


def _get_allocator_for_gender(gender: str) -> RoleAllocator:
    normalized = (gender or "").strip().lower()
    if normalized == "female":
        return allocator_female
    if normalized == "male":
        return allocator_male
    return allocator_default


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


@app.on_event("startup")
def log_profession_prompt_audit() -> None:
    missing_english = get_professions_missing_english_labels()
    default_scene = get_professions_using_default_scene()
    print(
        "Profession prompt audit:",
        json.dumps(
            {
                "missing_english_count": len(missing_english),
                "missing_english": missing_english,
                "default_scene_count": len(default_scene),
                "default_scene": default_scene,
            },
            ensure_ascii=False,
        ),
    )


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


def _create_access_token(subject: str) -> Tuple[str, int]:
    expire_delta = timedelta(minutes=JWT_EXPIRE_MINUTES)
    expires_at = datetime.now(timezone.utc) + expire_delta
    payload = {
        "sub": subject,
        "exp": expires_at,
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token, int(expire_delta.total_seconds())


def _require_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
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
def assignment_status(_: str = Depends(_require_auth)) -> Dict[str, int]:
    female_status = allocator_female.status()
    male_status = allocator_male.status()
    return {
        "female_assigned": female_status["assigned"],
        "female_remaining": female_status["remaining"],
        "female_total": female_status["total"],
        "male_assigned": male_status["assigned"],
        "male_remaining": male_status["remaining"],
        "male_total": male_status["total"],
    }


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
    last_error: Optional[Exception] = None
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


def _create_aliyun_facebody_client() -> FacebodyClient:
    if not ALIYUN_FACEBODY_ACCESS_KEY_ID or not ALIYUN_FACEBODY_ACCESS_KEY_SECRET:
        raise HTTPException(
            status_code=503,
            detail="未配置阿里云人脸属性识别 AccessKey，请在 backend/.env 中设置 ALIBABA_CLOUD_ACCESS_KEY_ID 和 ALIBABA_CLOUD_ACCESS_KEY_SECRET",
        )

    config = open_api_models.Config()
    config.access_key_id = ALIYUN_FACEBODY_ACCESS_KEY_ID
    config.access_key_secret = ALIYUN_FACEBODY_ACCESS_KEY_SECRET
    config.endpoint = ALIYUN_FACEBODY_ENDPOINT
    return FacebodyClient(config)


def _lookup_key(mapping: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


def _build_face_rectangles(flat_rectangles: Optional[List[int]], face_count: int) -> List[List[int]]:
    rectangles = flat_rectangles or []
    grouped: List[List[int]] = []
    for index in range(face_count):
        start = index * 4
        chunk = rectangles[start : start + 4]
        grouped.append(chunk if len(chunk) == 4 else [])
    return grouped


def _build_face_pose(flat_pose_values: Optional[List[float]], face_count: int) -> List[List[float]]:
    poses = flat_pose_values or []
    grouped: List[List[float]] = []
    for index in range(face_count):
        start = index * 3
        chunk = poses[start : start + 3]
        grouped.append(chunk if len(chunk) == 3 else [])
    return grouped


def _map_gender(value: Optional[int]) -> Dict[str, Any]:
    mapping = {
        0: "female",
        1: "male",
    }
    return {"code": value, "label": mapping.get(value, "unknown")}


def _map_expression(value: Optional[int]) -> Dict[str, Any]:
    mapping = {
        0: "neutral",
        1: "smile",
    }
    return {"code": value, "label": mapping.get(value, "unknown")}


def _map_glasses(value: Optional[int]) -> Dict[str, Any]:
    mapping = {
        0: "none",
        1: "regular_glasses",
        2: "sunglasses",
    }
    return {"code": value, "label": mapping.get(value, "unknown")}


def _map_hat(value: Optional[int]) -> Dict[str, Any]:
    mapping = {
        0: "no_hat",
        1: "hat",
    }
    return {"code": value, "label": mapping.get(value, "unknown")}


def _map_mask(value: Optional[int]) -> Dict[str, Any]:
    mapping = {
        0: "no_mask",
        1: "mask",
        2: "mask_incorrect",
    }
    return {"code": value, "label": mapping.get(value, "unknown")}


def _normalize_facebody_response(raw_response: Dict[str, Any]) -> Dict[str, Any]:
    body = _lookup_key(raw_response, "body", "Body") or {}
    data = _lookup_key(body, "data", "Data") or {}
    face_count = int(_lookup_key(data, "faceCount", "FaceCount") or 0)
    face_rectangles = _build_face_rectangles(_lookup_key(data, "faceRectangles", "FaceRectangles"), face_count)
    pose_groups = _build_face_pose(_lookup_key(data, "poseList", "PoseList"), face_count)
    qualities = _lookup_key(data, "qualities", "Qualities") or {}
    faces: List[Dict[str, Any]] = []

    for index in range(face_count):
        face: Dict[str, Any] = {
            "index": index,
            "age": ((_lookup_key(data, "ageList", "AgeList") or [None] * face_count)[index] if index < len(_lookup_key(data, "ageList", "AgeList") or []) else None),
            "gender": _map_gender((_lookup_key(data, "genderList", "GenderList") or [None] * face_count)[index] if index < len(_lookup_key(data, "genderList", "GenderList") or []) else None),
            "expression": _map_expression((_lookup_key(data, "expressions", "Expressions") or [None] * face_count)[index] if index < len(_lookup_key(data, "expressions", "Expressions") or []) else None),
            "glasses": _map_glasses((_lookup_key(data, "glasses", "Glasses") or [None] * face_count)[index] if index < len(_lookup_key(data, "glasses", "Glasses") or []) else None),
            "hat": _map_hat((_lookup_key(data, "hatList", "HatList") or [None] * face_count)[index] if index < len(_lookup_key(data, "hatList", "HatList") or []) else None),
            "mask": _map_mask((_lookup_key(data, "masks", "Masks") or [None] * face_count)[index] if index < len(_lookup_key(data, "masks", "Masks") or []) else None),
            "beauty": ((_lookup_key(data, "beautyList", "BeautyList") or [None] * face_count)[index] if index < len(_lookup_key(data, "beautyList", "BeautyList") or []) else None),
            "face_probability": ((_lookup_key(data, "faceProbabilityList", "FaceProbabilityList") or [None] * face_count)[index] if index < len(_lookup_key(data, "faceProbabilityList", "FaceProbabilityList") or []) else None),
            "rectangle": face_rectangles[index] if index < len(face_rectangles) else [],
            "pose": pose_groups[index] if index < len(pose_groups) else [],
            "quality": {
                "score": ((_lookup_key(qualities, "scoreList", "ScoreList") or [None] * face_count)[index] if index < len(_lookup_key(qualities, "scoreList", "ScoreList") or []) else None),
                "blur": ((_lookup_key(qualities, "blurList", "BlurList") or [None] * face_count)[index] if index < len(_lookup_key(qualities, "blurList", "BlurList") or []) else None),
                "fnf": ((_lookup_key(qualities, "fnfList", "FnfList") or [None] * face_count)[index] if index < len(_lookup_key(qualities, "fnfList", "FnfList") or []) else None),
                "glass": ((_lookup_key(qualities, "glassList", "GlassList") or [None] * face_count)[index] if index < len(_lookup_key(qualities, "glassList", "GlassList") or []) else None),
                "illumination": ((_lookup_key(qualities, "illuList", "IlluList") or [None] * face_count)[index] if index < len(_lookup_key(qualities, "illuList", "IlluList") or []) else None),
                "mask": ((_lookup_key(qualities, "maskList", "MaskList") or [None] * face_count)[index] if index < len(_lookup_key(qualities, "maskList", "MaskList") or []) else None),
                "noise": ((_lookup_key(qualities, "noiseList", "NoiseList") or [None] * face_count)[index] if index < len(_lookup_key(qualities, "noiseList", "NoiseList") or []) else None),
                "pose": ((_lookup_key(qualities, "poseList", "PoseList") or [None] * face_count)[index] if index < len(_lookup_key(qualities, "poseList", "PoseList") or []) else None),
            },
        }
        faces.append(face)

    return {
        "request_id": _lookup_key(body, "requestId", "RequestId") or "",
        "face_count": face_count,
        "faces": faces,
        "raw": raw_response,
    }

def _parse_image_data_url(image_data: str) -> Tuple[str, bytes]:
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


def _extension_from_mime_type(mime_type: str) -> str:
    normalized = (mime_type or "").strip().lower()
    if normalized == "image/png":
        return "png"
    if normalized == "image/webp":
        return "webp"
    if normalized == "image/gif":
        return "gif"
    return "jpg"


def _save_captured_image(image_data: str, prediction_id: str) -> str:
    mime_type, binary = _parse_image_data_url(image_data)
    extension = _extension_from_mime_type(mime_type)
    filename = f"{prediction_id}-captured.{extension}"
    (GENERATED_DIR / filename).write_bytes(binary)
    return filename


def _recognize_face_attributes(image_data: str, max_face_number: int) -> Dict[str, Any]:
    _, binary = _parse_image_data_url(image_data)
    client = _create_aliyun_facebody_client()
    request_model = facebody_models.RecognizeFaceAdvanceRequest(
        image_urlobject=BytesIO(binary),
        age=True,
        gender=True,
        hat=True,
        glass=True,
        beauty=True,
        expression=True,
        mask=True,
        quality=True,
        max_face_number=max_face_number,
    )
    runtime = util_models.RuntimeOptions()

    try:
        response = client.recognize_face_advance(request_model, runtime)
    except TeaException as error:
        code = getattr(error, "code", "AliyunFacebodyError")
        message = getattr(error, "message", str(error))
        raise HTTPException(status_code=502, detail=f"阿里云人脸属性识别调用失败: {code} - {message}") from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"阿里云人脸属性识别调用失败: {error}") from error

    return _normalize_facebody_response(response.to_map())


def _log_face_attributes(
    *,
    prediction_id: str,
    participant_name: str,
    gender: str,
) -> None:
    print(
        "Aliyun detected gender:",
        json.dumps(
            {
                "prediction_id": prediction_id,
                "participant_name": participant_name,
                "gender": gender,
            },
            ensure_ascii=False,
        ),
    )


def _log_generation_event(event: str, **payload: Any) -> None:
    print(
        "Generation event:",
        json.dumps(
            {
                "event": event,
                **payload,
            },
            ensure_ascii=False,
        ),
    )


def _detect_gender_from_face_attributes(face_attributes: Dict[str, Any]) -> str:
    faces = face_attributes.get("faces") or []
    if not faces:
        return "unknown"

    gender = ((faces[0].get("gender") or {}).get("label") or "unknown").strip().lower()
    if gender in {"female", "male"}:
        return gender
    return "unknown"


def _guess_mime_type(image_binary: bytes) -> str:
    if image_binary.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_binary.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_binary.startswith(b"GIF87a") or image_binary.startswith(b"GIF89a"):
        return "image/gif"
    if image_binary.startswith(b"RIFF") and b"WEBP" in image_binary[:16]:
        return "image/webp"
    return "image/jpeg"


def _build_data_url_from_image_binary(image_binary: bytes) -> str:
    mime_type = _guess_mime_type(image_binary)
    encoded = base64.b64encode(image_binary).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _validate_generated_face_quality(output_path: Path, expected_gender: str = "unknown") -> Tuple[bool, str, float]:
    if not (ALIYUN_FACEBODY_ACCESS_KEY_ID and ALIYUN_FACEBODY_ACCESS_KEY_SECRET):
        _log_generation_event("quality-check-skipped", reason="no-facebody-config")
        return True, "skip-no-facebody-config", 100.0

    try:
        image_binary = output_path.read_bytes()
        image_data = _build_data_url_from_image_binary(image_binary)
        attributes = _recognize_face_attributes(image_data, 1)
    except Exception as error:
        # Quality check should not block normal output when external service is transiently unavailable.
        _log_generation_event("quality-check-skipped", reason="check-error", error=str(error))
        return True, f"skip-check-error:{error}", 100.0

    face_count = int(attributes.get("face_count") or 0)
    if face_count <= 0:
        _log_generation_event("quality-check-failed", reason="no-face-detected")
        return False, "no-face-detected", 0.0

    faces = attributes.get("faces") or []
    if not faces:
        _log_generation_event("quality-check-failed", reason="empty-face-result")
        return False, "empty-face-result", 0.0

    detected_gender = _detect_gender_from_face_attributes(attributes)
    normalized_expected_gender = (expected_gender or "unknown").strip().lower()
    if (
        normalized_expected_gender in {"female", "male"}
        and detected_gender in {"female", "male"}
        and detected_gender != normalized_expected_gender
    ):
        _log_generation_event(
            "quality-check-failed",
            reason="gender-mismatch",
            expected_gender=normalized_expected_gender,
            detected_gender=detected_gender,
        )
        return False, f"gender-mismatch:expected-{normalized_expected_gender}-got-{detected_gender}", 0.0

    first_face = faces[0] or {}
    quality = first_face.get("quality") or {}
    score = quality.get("score")
    blur = quality.get("blur")
    score_value = float(score) if isinstance(score, (int, float)) else 0.0
    blur_score = 0.0

    if isinstance(score, (int, float)) and score_value < FACE_QUALITY_MIN_SCORE:
        _log_generation_event("quality-check-failed", reason="low-face-score", score=score)
        total_weight = FACE_BEST_PICK_SCORE_WEIGHT + FACE_BEST_PICK_BLUR_WEIGHT
        if total_weight <= 0:
            total_weight = 1.0
        candidate_score = (score_value * FACE_BEST_PICK_SCORE_WEIGHT + blur_score * FACE_BEST_PICK_BLUR_WEIGHT) / total_weight
        return False, f"low-face-score:{score}", max(0.0, min(100.0, candidate_score))

    # Official Aliyun RecognizeFace semantics: BlurList is a quality score.
    # Higher is better (less blur), range (0, 100].
    # Some SDK paths may normalize to 0..1, so we scale that back to 0..100.
    if isinstance(blur, (int, float)):
        blur_score = float(blur)
        if 0.0 <= blur_score <= 1.0:
            blur_score = blur_score * 100.0
        if blur_score < FACE_QUALITY_MIN_BLUR_SCORE:
            _log_generation_event("quality-check-failed", reason="low-face-blur-score", blur=blur, blur_score=blur_score)
            total_weight = FACE_BEST_PICK_SCORE_WEIGHT + FACE_BEST_PICK_BLUR_WEIGHT
            if total_weight <= 0:
                total_weight = 1.0
            candidate_score = (score_value * FACE_BEST_PICK_SCORE_WEIGHT + blur_score * FACE_BEST_PICK_BLUR_WEIGHT) / total_weight
            return False, f"low-face-blur-score:{blur_score}", max(0.0, min(100.0, candidate_score))

    total_weight = FACE_BEST_PICK_SCORE_WEIGHT + FACE_BEST_PICK_BLUR_WEIGHT
    if total_weight <= 0:
        total_weight = 1.0
    candidate_score = (score_value * FACE_BEST_PICK_SCORE_WEIGHT + blur_score * FACE_BEST_PICK_BLUR_WEIGHT) / total_weight
    candidate_score = max(0.0, min(100.0, candidate_score))

    _log_generation_event(
        "quality-check-passed",
        expected_gender=normalized_expected_gender,
        detected_gender=detected_gender,
        score=score,
        blur=blur,
        candidate_score=candidate_score,
    )
    return True, "ok", candidate_score


def _next_seed(seed: str, attempt_index: int) -> str:
    if attempt_index <= 0:
        return seed
    try:
        base_seed = int(seed)
    except ValueError:
        base_seed = uuid.uuid4().int % 1_000_000_000
    return str((base_seed + 7919 * attempt_index) % 1_000_000_000)


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
    gender: str = "unknown",
) -> str:
    if not SILICONFLOW_API_KEY:
        raise ValueError("SiliconFlow 未配置 API Key")

    gender_clause = ""
    if gender == "female":
        gender_clause = "The person is female; generate a FEMALE young woman. Do NOT generate a male. "
    elif gender == "male":
        gender_clause = "The person is male; generate a MALE young man. Do NOT generate a female. "

    profession_profile = get_profession_prompt_profile(profession_label)
    profession_label_en = profession_profile["en"]
    scene_prompt = profession_profile["scene"]
    shot_template = profession_profile["shot"]

    reference_prompt = (
        "Preserve the same person identity and facial features from the input image. "
        f"{gender_clause}"
        "Preserve original nationality and ethnicity cues from the reference photo; "
        "do not change race, skin tone family, eye shape, facial structure, or hair texture. "
        f"Create a photorealistic portrait of the same person as a {profession_label_en} ({profession_label}), "
        f"{scene_prompt}, {shot_template}, show profession-specific tools and workplace context, "
        "front-facing portrait, full face visible, both eyes clearly visible, clear eyebrows, clear nose and lips, "
        "no face occlusion, no transparent veil over face, no face reflection, no face overlay, no double exposure, "
        "no distorted facial anatomy, no extra eyes, no extra mouth, no motion blur on face, "
        "age around 20 years old young adult, warm and friendly smile, refined and attractive appearance, "
        "clear natural skin texture, professional styling, formal outfit, soft cinematic studio lighting, "
        "high detail, visually rich immersive background, avoid plain empty backdrop, school-ceremony friendly"
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
    data: Dict[str, Any] = response.json()
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
    last_error: Optional[Exception] = None

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
    failures: List[str] = []

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
    gender: str = "unknown",
) -> str:
    failures: List[str] = []
    best_candidate_score = -1.0
    best_candidate_provider = ""
    best_candidate_reason = ""
    best_candidate_path = output_path.with_suffix(f"{output_path.suffix}.best")
    _log_generation_event("generation-start", plan_b=PLAN_B_ENABLED, expected_gender=gender)

    with httpx.Client(timeout=PROVIDER_HTTP_TIMEOUT_SECONDS) as client:
        for attempt in range(FACE_QUALITY_RETRY_ATTEMPTS + 1):
            attempt_seed = _next_seed(seed, attempt)
            _log_generation_event("generation-attempt", attempt=attempt + 1, seed=attempt_seed)

            if PLAN_B_ENABLED:
                try:
                    provider = _generate_with_siliconflow_reference(
                        client=client,
                        profession_label=profession_label,
                        reference_image_data=reference_image_data,
                        seed=attempt_seed,
                        output_path=output_path,
                        gender=gender,
                    )
                    quality_ok, reason, candidate_score = _validate_generated_face_quality(output_path, expected_gender=gender)
                    if quality_ok:
                        _log_generation_event("generation-success", provider=provider, attempt=attempt + 1)
                        return provider
                    if FACE_BEST_PICK_ENABLED and candidate_score > best_candidate_score:
                        shutil.copy2(output_path, best_candidate_path)
                        best_candidate_score = candidate_score
                        best_candidate_provider = provider
                        best_candidate_reason = reason
                        _log_generation_event(
                            "generation-best-candidate-updated",
                            attempt=attempt + 1,
                            provider=provider,
                            candidate_score=candidate_score,
                            reason=reason,
                        )
                    failures.append(f"plan-b-face-quality(attempt {attempt + 1}): {reason}")
                    continue
                except (httpx.HTTPError, OSError, ValueError) as error:
                    _log_generation_event("generation-provider-error", provider="plan-b", attempt=attempt + 1, error=str(error))
                    failures.append(f"plan-b(attempt {attempt + 1}): {error}")

            try:
                provider = _generate_future_image_with_client(client, prompt, attempt_seed, output_path)
                quality_ok, reason, candidate_score = _validate_generated_face_quality(output_path, expected_gender=gender)
                if quality_ok:
                    _log_generation_event("generation-success", provider=provider, attempt=attempt + 1)
                    return provider
                if FACE_BEST_PICK_ENABLED and candidate_score > best_candidate_score:
                    shutil.copy2(output_path, best_candidate_path)
                    best_candidate_score = candidate_score
                    best_candidate_provider = provider
                    best_candidate_reason = reason
                    _log_generation_event(
                        "generation-best-candidate-updated",
                        attempt=attempt + 1,
                        provider=provider,
                        candidate_score=candidate_score,
                        reason=reason,
                    )
                failures.append(f"fallback-face-quality(attempt {attempt + 1}): {reason}")
            except ValueError as error:
                _log_generation_event("generation-provider-error", provider="fallback", attempt=attempt + 1, error=str(error))
                failures.append(f"fallback(attempt {attempt + 1}): {error}")

    if FACE_BEST_PICK_ENABLED and best_candidate_score > 0 and best_candidate_path.exists():
        shutil.copy2(best_candidate_path, output_path)
        _log_generation_event(
            "generation-best-candidate-selected",
            provider=best_candidate_provider,
            candidate_score=best_candidate_score,
            reason=best_candidate_reason,
        )
        best_candidate_path.unlink(missing_ok=True)
        return best_candidate_provider or "best-candidate"

    if best_candidate_path.exists():
        best_candidate_path.unlink(missing_ok=True)

    _log_generation_event("generation-failed", failures="; ".join(failures))
    raise ValueError("; ".join(failures))


@app.get("/api/providers/probe")
def provider_probe(_: str = Depends(_require_auth)) -> Dict[str, Any]:
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
        "facebody": {
            "configured": bool(ALIYUN_FACEBODY_ACCESS_KEY_ID and ALIYUN_FACEBODY_ACCESS_KEY_SECRET),
            "endpoint": ALIYUN_FACEBODY_ENDPOINT,
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


@app.post("/api/face/attributes", response_model=FaceAttributesResponse)
def recognize_face_attributes(
    payload: FaceAttributesRequest,
    _: str = Depends(_require_auth),
) -> FaceAttributesResponse:
    if not payload.image_data.startswith("data:image"):
        raise HTTPException(status_code=400, detail="请上传有效的照片数据")

    try:
        normalized = _recognize_face_attributes(payload.image_data, payload.max_face_number)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return FaceAttributesResponse(**normalized)


@app.get("/api/admin/history", response_model=HistoryListResponse)
def admin_history(request: Request, _: str = Depends(_require_auth)) -> HistoryListResponse:
    records = history_store.list()
    items = [
        HistoryItem(
            prediction_id=record.get("prediction_id", ""),
            participant_class=record.get("participant_class", ""),
            participant_name=record.get("participant_name", ""),
            profession=record.get("profession", ""),
            generated_image_url=_build_public_image_url(request, record.get("filename", "")),
            captured_image_url=(
                _build_public_image_url(request, record.get("captured_filename", ""))
                if record.get("captured_filename")
                else None
            ),
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
        _remove_generated_image(record.get("captured_filename", ""))

    return {"deleted": len(deleted_records)}


@app.post("/api/admin/history/clear-reset")
def admin_clear_reset(_: str = Depends(_require_auth)) -> dict[str, int]:
    deleted_records = history_store.clear_all()
    for record in deleted_records:
        _remove_generated_image(record.get("filename", ""))
        _remove_generated_image(record.get("captured_filename", ""))

    allocator_female.reset(seed=None)
    allocator_male.reset(seed=None)
    allocator_default.reset(seed=None)
    return {"deleted": len(deleted_records)}


@app.post("/api/predict", response_model=PredictResponse)
def predict_future_profession(
    payload: PredictRequest,
    request: Request,
    _: str = Depends(_require_auth),
) -> PredictResponse:
    participant_class = payload.participant_class.strip()
    participant_name = payload.participant_name.strip()
    if not participant_class:
        raise HTTPException(status_code=400, detail="请输入班级")
    if not CLASS_PATTERN.fullmatch(participant_class):
        raise HTTPException(status_code=400, detail="班级必须是三位数字且中间为0，例如 408")
    if not participant_name:
        raise HTTPException(status_code=400, detail="请输入姓名")
    if not NAME_PATTERN.fullmatch(participant_name):
        raise HTTPException(status_code=400, detail="姓名仅支持中文、英文、空格、连字符和撇号")

    if not payload.image_data.startswith("data:image"):
        raise HTTPException(status_code=400, detail="请上传有效的照片数据")

    try:
        _parse_image_data_url(payload.image_data)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    _acquire_generation_slot()
    try:
        prediction_id = str(uuid.uuid4())
        seed_value = str(uuid.uuid4().int % 1_000_000_000)
        captured_filename = ""

        confirmed_gender = (payload.confirmed_gender or "").strip().lower()
        if confirmed_gender in {"female", "male"}:
            detected_gender = confirmed_gender
        else:
            face_attributes = _recognize_face_attributes(payload.image_data, 1)
            detected_gender = _detect_gender_from_face_attributes(face_attributes)

        allocator = _get_allocator_for_gender(detected_gender)
        try:
            profession, profession_index, total = allocator.next_role(participant_name)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

        profession_label = profession
        profession_profile = get_profession_prompt_profile(profession_label)
        profession_label_en = profession_profile["en"]
        _log_face_attributes(
            prediction_id=prediction_id,
            participant_name=participant_name,
            gender=detected_gender,
        )

        gender_token = ""
        if detected_gender == "female":
            gender_token = "1girl, female, young woman, "
        elif detected_gender == "male":
            gender_token = "1boy, male, young man, "

        scene_prompt = profession_profile["scene"]
        shot_template = profession_profile["shot"]

        image_prompt = (
            f"masterpiece, photorealistic portrait, future career professional, {gender_token}"
            f"{profession_label_en} ({profession_label}), around 20 years old young adult, "
            f"{scene_prompt}, {shot_template}, show clear profession-specific tools, signage, and workplace context, "
            "keep the same person identity from reference photo, "
            "preserve original nationality and ethnicity cues, "
            "do not alter race, skin tone family, facial structure, eye shape, or hair texture, "
            "front-facing portrait, full face visible, both eyes clearly visible, clear eyebrows, clear nose and lips, "
            "no face occlusion, no transparent veil over face, no face reflection, no face overlay, no double exposure, "
            "no distorted facial anatomy, no extra eyes, no extra mouth, no motion blur on face, "
            "warm friendly smile, refined attractive appearance, clean natural skin, "
            "professional formal outfit, soft cinematic lighting, high detail, 85mm lens, "
            "visually rich immersive background, avoid plain or empty background, uplifting and school-ceremony friendly"
        )
        filename = f"{prediction_id}.jpg"
        output_path = GENERATED_DIR / filename
        captured_filename = _save_captured_image(payload.image_data, prediction_id)

        try:
            image_provider = _generate_future_image_plan_b(
                prompt=image_prompt,
                profession_label=profession_label,
                seed=seed_value,
                output_path=output_path,
                reference_image_data=payload.image_data,
                gender=detected_gender,
            )
        except (httpx.HTTPError, OSError, ValueError) as error:
            allocator.rollback_role(profession)
            _remove_generated_image(captured_filename)
            raise HTTPException(status_code=502, detail=f"第三方生图服务暂不可用：{error}") from error

        generated_image_url = _build_public_image_url(request, filename)
        history_store.add(
            {
                "prediction_id": prediction_id,
                "participant_class": participant_class,
                "participant_name": participant_name,
                "profession": profession,
                "filename": filename,
                "captured_filename": captured_filename,
                "image_provider": image_provider,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )

        return PredictResponse(
            prediction_id=prediction_id,
            participant_class=participant_class,
            participant_name=participant_name,
            profession=profession,
            profession_index=profession_index,
            total_professions=total,
            status_text="正在预测未来职业...",
            image_prompt=image_prompt,
            generated_image_url=generated_image_url,
            captured_image_url=_build_public_image_url(request, captured_filename),
            image_provider=image_provider,
        )
    finally:
        _release_generation_slot()


@app.post("/api/admin/reset")
def reset_assignments(payload: ResetRequest, _: str = Depends(_require_auth)) -> dict[str, str]:
    allocator_female.reset(payload.seed)
    allocator_male.reset(payload.seed)
    allocator_default.reset(payload.seed)
    return {"message": "职业池已重置"}
