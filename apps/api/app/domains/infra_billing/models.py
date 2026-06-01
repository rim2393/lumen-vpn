from uuid import UUID

from sqlalchemy import Float, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class InfraProvider(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """An infrastructure provider (hosting/VPS vendor) for cost tracking."""

    __tablename__ = "infra_providers"

    name: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    login_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(1024), nullable=True)


class InfraBillingRecord(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A single infrastructure cost line, optionally tied to a node."""

    __tablename__ = "infra_billing_records"

    provider_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("infra_providers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    node_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("nodes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    period: Mapped[str] = mapped_column(String(16), nullable=False)  # e.g. "2026-05"
    note: Mapped[str | None] = mapped_column(String(512), nullable=True)
