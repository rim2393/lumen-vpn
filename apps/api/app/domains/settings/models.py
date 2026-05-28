from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PanelSetting(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "panel_settings"

    key: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    value_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    updated_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
