from uuid import UUID

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Squad(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "squads"

    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="internal", index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    metadata_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)


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
    metadata_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)


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
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    inbound_tag: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    sni: Mapped[str | None] = mapped_column(String(255), nullable=True)
    security: Mapped[str | None] = mapped_column(String(64), nullable=True)
    xray_template_json: Mapped[dict[str, object]] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
    )
    mux_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    sockopt_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    xhttp_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    subscription_excluded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    excluded_internal_squad_ids: Mapped[list[str]] = mapped_column(
        JSON,
        nullable=False,
        default=list,
    )
    shuffle_host: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    final_mask: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mihomo_x25519_public_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
