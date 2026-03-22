from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    participant_name: str = Field(default="", max_length=50)
    image_data: str = Field(..., description="Base64 image data URL from frontend camera")


class PredictResponse(BaseModel):
    prediction_id: str
    participant_name: str
    profession: str
    profession_index: int
    total_professions: int
    status_text: str
    image_prompt: str
    generated_image_url: str
    image_provider: str


class ResetRequest(BaseModel):
    seed: int | None = None


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
