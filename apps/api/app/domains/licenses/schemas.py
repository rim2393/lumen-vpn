from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr


class LicenseCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    license_key: SecretStr = Field(min_length=1)
    customer_ref: str | None = Field(default=None, max_length=128)
    max_devices: int = Field(default=1, ge=1)
    starts_at: datetime | None = None
    expires_at: datetime | None = None
    metadata_json: dict[str, str] = Field(default_factory=dict)


class LicenseResponse(BaseModel):
    id: UUID
    customer_ref: str | None
    status: str
    max_devices: int
    starts_at: datetime | None
    expires_at: datetime | None
    metadata_json: dict[str, str]


class LicenseListResponse(BaseModel):
    items: list[LicenseResponse]
