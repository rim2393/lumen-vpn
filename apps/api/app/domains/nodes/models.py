from datetime import datetime
from uuid import UUID

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Node(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "nodes"

    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    region: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    public_address: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="provisioning")
    capabilities: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    enrolled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    agent_token_prefix: Mapped[str | None] = mapped_column(String(24), nullable=True, index=True)
    agent_token_hash: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        unique=True,
        index=True,
    )


class NodeProvisioningJob(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "node_provisioning_jobs"

    idempotency_key: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        unique=True,
        index=True,
    )
    node_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False, default="node.provision")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued", index=True)
    preflight_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    ssh_host: Mapped[str] = mapped_column(String(255), nullable=False)
    ssh_port: Mapped[int] = mapped_column(Integer, nullable=False, default=22)
    ssh_username: Mapped[str] = mapped_column(String(128), nullable=False)
    ssh_credentials_ref: Mapped[str] = mapped_column(String(512), nullable=False)
    requested_capabilities: Mapped[dict[str, str]] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
    )
    preflight_result: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(512), nullable=True)
    token_issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    token_exchanged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )


class NodeInstallToken(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "node_install_tokens"

    provisioning_job_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("node_provisioning_jobs.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    token_prefix: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NodeCommand(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "node_commands"

    node_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    command_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued", index=True)
    payload_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    result_json: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(512), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NodeMetric(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "node_metrics"

    node_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    metric_kind: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    values_json: Mapped[dict[str, float]] = mapped_column(JSON, nullable=False, default=dict)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
