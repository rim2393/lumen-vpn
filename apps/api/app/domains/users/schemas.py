from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, SecretStr

from app.core.rbac import Role


class UserCreateRequest(BaseModel):
    email: EmailStr
    password: SecretStr | None = Field(default=None, min_length=8)
    role: Role = Role.USER
    status: str = Field(default="active", examples=["active"])


class UserResponse(BaseModel):
    id: UUID
    email: EmailStr
    role: Role
    status: str = Field(examples=["active"])
    created_at: datetime


class UserListResponse(BaseModel):
    items: list[UserResponse]
