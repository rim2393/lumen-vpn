from uuid import UUID

from sqlalchemy import JSON, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Squad(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "squads"

    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="internal", index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    metadata_json: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)


class ProtocolProfile(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "protocol_profiles"

    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    node_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    squad_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("squads.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    adapter: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    config_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    port_reservations: Mapped[list[dict[str, object]]] = mapped_column(
        JSON,
        nullable=False,
        default=list,
    )
    credentials_ref: Mapped[str | None] = mapped_column(String(512), nullable=True)


class Host(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "hosts"

    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    hostname: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    node_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    protocol_profile_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("protocol_profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    squad_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("squads.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
