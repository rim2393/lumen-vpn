from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.rbac import Role
from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class User(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(512), nullable=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default=Role.USER.value)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    username: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        unique=True,
        index=True,
    )
    display_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    telegram_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    traffic_limit_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    traffic_used_gb: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    device_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    metadata_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_login_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
