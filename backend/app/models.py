from typing import List, Optional
from typing import Any, Dict

from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    participant_class: str = Field(..., min_length=1, max_length=40)
    participant_name: str = Field(..., min_length=1, max_length=50)
    confirmed_gender: Optional[str] = Field(default=None, description="Confirmed gender from preview step: female/male")
    image_data: str = Field(..., description="Base64 image data URL from frontend camera")


class FaceAttributesRequest(BaseModel):
    image_data: str = Field(..., description="Base64 image data URL from frontend camera")
    max_face_number: int = Field(default=1, ge=1, le=10)


class FaceAttributesResponse(BaseModel):
    request_id: str
    face_count: int
    faces: List[Dict[str, Any]] = Field(default_factory=list)
    raw: Dict[str, Any] = Field(default_factory=dict)


class PredictResponse(BaseModel):
    prediction_id: str
    participant_class: str
    participant_name: str
    profession: str
    profession_index: int
    total_professions: int
    status_text: str
    image_prompt: str
    generated_image_url: str
    captured_image_url: Optional[str] = None
    image_provider: str


class ResetRequest(BaseModel):
    seed: Optional[int] = None


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class HistoryItem(BaseModel):
    prediction_id: str
    participant_class: str = ""
    participant_name: str
    profession: str
    generated_image_url: str
    captured_image_url: Optional[str] = None
    image_provider: str
    created_at: str


class HistoryListResponse(BaseModel):
    items: List[HistoryItem]
    count: int


class DeleteSelectedRequest(BaseModel):
    prediction_ids: List[str] = Field(default_factory=list)
