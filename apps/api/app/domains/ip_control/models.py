from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

# Rule scopes, ordered most-specific first when resolving the effective rule.
SCOPE_USER = "user"
SCOPE_SQUAD = "squad"
SCOPE_GLOBAL = "global"
SCOPES = (SCOPE_USER, SCOPE_SQUAD, SCOPE_GLOBAL)

ACTION_BLOCK = "block"
ACTION_NOTIFY = "notify"
ACTIONS = (ACTION_BLOCK, ACTION_NOTIFY)


class IpControlRule(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Anti-abuse rule limiting how many distinct IPs may use one account."""

    __tablename__ = "ip_control_rules"

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    scope: Mapped[str] = mapped_column(String(16), nullable=False, default=SCOPE_GLOBAL)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    max_active_ips: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    action: Mapped[str] = mapped_column(String(16), nullable=False, default=ACTION_BLOCK)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class IpControlEvent(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Audit trail of IP-limit evaluations that tripped a rule."""

    __tablename__ = "ip_control_events"

    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    ip: Mapped[str] = mapped_column(String(64), nullable=False)
    active_ip_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ip_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    decision: Mapped[str] = mapped_column(String(16), nullable=False, default="allowed")
