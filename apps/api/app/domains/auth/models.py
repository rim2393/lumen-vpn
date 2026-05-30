from datetime import datetime
from uuid import UUID

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UserSession(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "user_sessions"

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    ip_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    user_agent_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserMfaMethod(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "user_mfa_methods"

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="totp", index=True)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    secret_ciphertext: Mapped[str] = mapped_column(String(2048), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserIdentity(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """An external (OAuth/social) identity linked to a Lumen user."""

    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint("provider", "subject", name="uq_user_identity_provider_sub"),
    )

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    profile_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OAuthLoginState(Base, UUIDPrimaryKeyMixin):
    """Short-lived server-side state for an in-flight OAuth authorization code flow."""

    __tablename__ = "oauth_login_states"

    state: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    code_verifier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    nonce: Mapped[str | None] = mapped_column(String(128), nullable=True)
    redirect_uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    client_redirect: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    link_user_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WebAuthnCredential(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A registered WebAuthn (passkey / security key) credential for a user."""

    __tablename__ = "webauthn_credentials"

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    credential_id: Mapped[str] = mapped_column(String(512), nullable=False, unique=True, index=True)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    sign_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    transports: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    aaguid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WebAuthnChallenge(Base, UUIDPrimaryKeyMixin):
    """Short-lived server-side challenge for a WebAuthn registration or assertion ceremony."""

    __tablename__ = "webauthn_challenges"

    user_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True, index=True)
    challenge: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
