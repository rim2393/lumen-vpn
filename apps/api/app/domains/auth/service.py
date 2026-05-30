import base64
import hashlib
import hmac
import os
import time
from datetime import UTC, datetime, timedelta
from uuid import UUID

from cryptography.fernet import Fernet, InvalidToken
from fastapi import status
from pydantic import SecretStr
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import APIError
from app.core.rbac import Role
from app.core.security import (
    generate_opaque_token,
    hmac_sha256,
    require_secret,
    verify_password,
)
from app.domains.auth.models import UserMfaMethod, UserSession
from app.domains.auth.schemas import (
    LoginRequest,
    LoginResponse,
    MfaChallengeResponse,
    MfaMethodResponse,
    TokenPairResponse,
)
from app.domains.users.models import User

ACCESS_TOKEN_PREFIX = "lumen_at"  # noqa: S105 - public token prefix, not secret material.
REFRESH_TOKEN_PREFIX = "lumen_rt"  # noqa: S105 - public token prefix, not secret material.
MFA_CHALLENGE_TOKEN_PREFIX = "lumen_mfa"  # noqa: S105 - public token prefix, not secret material.
TOTP_PERIOD_SECONDS = 30
TOTP_DIGITS = 6


def utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def hash_session_token(token: str, settings: Settings) -> str:
    pepper = settings.session_hash_pepper
    require_secret(pepper, name="session_hash_pepper")
    return hmac_sha256(token, pepper)


async def login_user(
    session: AsyncSession,
    *,
    request: LoginRequest,
    settings: Settings,
) -> LoginResponse:
    require_secret(settings.session_hash_pepper, name="session_hash_pepper")
    result = await session.execute(select(User).where(User.email == request.email.lower()))
    user = result.scalar_one_or_none()
    now = utc_now()

    if user is not None and user.locked_until is not None and ensure_aware(user.locked_until) > now:
        raise APIError(
            code="account_locked",
            message="Account is temporarily locked after repeated failed sign-ins.",
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    password_ok = (
        user is not None
        and user.password_hash is not None
        and user.status == "active"
        and verify_password(request.password, user.password_hash)
    )
    if not password_ok:
        if user is not None:
            await _register_failed_login(session, user=user, settings=settings, now=now)
        raise APIError(
            code="invalid_credentials",
            message="Email or password is incorrect.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    if user.failed_login_count or user.locked_until is not None:
        user.failed_login_count = 0
        user.locked_until = None
        await session.flush()

    active_methods = await list_mfa_methods(session, user_id=user.id, status_filter="active")
    if active_methods:
        challenge_token, challenge_expires_at = await create_session_token(
            session,
            user_id=user.id,
            prefix=MFA_CHALLENGE_TOKEN_PREFIX,
            ttl_seconds=settings.mfa_challenge_ttl_seconds,
            settings=settings,
        )
        user.last_login_at = utc_now()
        await session.flush()
        return MfaChallengeResponse(
            challenge_token=challenge_token,
            expires_at=challenge_expires_at,
            methods=[mfa_method_response(method) for method in active_methods],
        )

    access_token, access_expires_at = await create_session_token(
        session,
        user_id=user.id,
        prefix=ACCESS_TOKEN_PREFIX,
        ttl_seconds=settings.access_token_ttl_seconds,
        settings=settings,
    )
    refresh_token, _ = await create_session_token(
        session,
        user_id=user.id,
        prefix=REFRESH_TOKEN_PREFIX,
        ttl_seconds=settings.refresh_token_ttl_seconds,
        settings=settings,
    )
    user.last_login_at = utc_now()
    await session.flush()
    return TokenPairResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=access_expires_at,
    )


async def _register_failed_login(
    session: AsyncSession,
    *,
    user: User,
    settings: Settings,
    now: datetime,
) -> None:
    """Count a failed sign-in and lock the account once the threshold is reached.

    The increment is committed immediately so it survives the rejected request.
    """

    user.failed_login_count = (user.failed_login_count or 0) + 1
    if user.failed_login_count >= settings.login_max_failed_attempts:
        user.locked_until = now + timedelta(seconds=settings.login_lockout_seconds)
        user.failed_login_count = 0
    await session.flush()
    await session.commit()


async def refresh_session(
    session: AsyncSession,
    *,
    refresh_token: SecretStr,
    settings: Settings,
) -> TokenPairResponse:
    token = refresh_token.get_secret_value()
    if not token.startswith(f"{REFRESH_TOKEN_PREFIX}_"):
        raise APIError(
            code="invalid_refresh_token",
            message="Refresh token is invalid.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    refresh_record, user = await verify_session_token(
        session,
        token=token,
        settings=settings,
        expected_prefix=REFRESH_TOKEN_PREFIX,
    )
    await revoke_session(session, session_id=refresh_record.id)
    access_token, access_expires_at = await create_session_token(
        session,
        user_id=user.id,
        prefix=ACCESS_TOKEN_PREFIX,
        ttl_seconds=settings.access_token_ttl_seconds,
        settings=settings,
    )
    new_refresh_token, _ = await create_session_token(
        session,
        user_id=user.id,
        prefix=REFRESH_TOKEN_PREFIX,
        ttl_seconds=settings.refresh_token_ttl_seconds,
        settings=settings,
    )
    return TokenPairResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        expires_at=access_expires_at,
    )


async def create_session_token(
    session: AsyncSession,
    *,
    user_id: UUID,
    prefix: str,
    ttl_seconds: int,
    settings: Settings,
) -> tuple[str, datetime]:
    token = generate_opaque_token(prefix=prefix)
    expires_at = utc_now() + timedelta(seconds=ttl_seconds)
    session.add(
        UserSession(
            user_id=user_id,
            token_hash=hash_session_token(token, settings),
            expires_at=expires_at,
        )
    )
    await session.flush()
    return token, expires_at


async def verify_session_token(
    session: AsyncSession,
    *,
    token: str,
    settings: Settings,
    expected_prefix: str = ACCESS_TOKEN_PREFIX,
) -> tuple[UserSession, User]:
    if not token.startswith(f"{expected_prefix}_"):
        raise APIError(
            code="invalid_session",
            message="Session is invalid or has been revoked.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    token_hash = hash_session_token(token, settings)
    result = await session.execute(select(UserSession).where(UserSession.token_hash == token_hash))
    user_session = result.scalar_one_or_none()
    now = utc_now()
    if user_session is None or user_session.revoked_at is not None:
        raise APIError(
            code="invalid_session",
            message="Session is invalid or has been revoked.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    if ensure_aware(user_session.expires_at) <= now:
        raise APIError(
            code="session_expired",
            message="Session has expired.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    user = await session.get(User, user_session.user_id)
    if user is None or user.status != "active":
        raise APIError(
            code="session_user_inactive",
            message="Session user is not active.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    Role(user.role)
    return user_session, user


async def verify_mfa_challenge(
    session: AsyncSession,
    *,
    challenge_token: SecretStr,
    method_id: UUID,
    code: SecretStr,
    settings: Settings,
) -> TokenPairResponse:
    challenge_record, user = await verify_session_token(
        session,
        token=challenge_token.get_secret_value(),
        settings=settings,
        expected_prefix=MFA_CHALLENGE_TOKEN_PREFIX,
    )
    await verify_totp_method(
        session,
        user_id=user.id,
        method_id=method_id,
        code=code,
        settings=settings,
    )
    await revoke_session(session, session_id=challenge_record.id)
    access_token, access_expires_at = await create_session_token(
        session,
        user_id=user.id,
        prefix=ACCESS_TOKEN_PREFIX,
        ttl_seconds=settings.access_token_ttl_seconds,
        settings=settings,
    )
    refresh_token, _ = await create_session_token(
        session,
        user_id=user.id,
        prefix=REFRESH_TOKEN_PREFIX,
        ttl_seconds=settings.refresh_token_ttl_seconds,
        settings=settings,
    )
    return TokenPairResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=access_expires_at,
    )


async def revoke_session(session: AsyncSession, *, session_id: UUID) -> UserSession:
    record = await session.get(UserSession, session_id)
    if record is None:
        raise APIError(
            code="session_not_found",
            message="Session was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    if record.revoked_at is None:
        record.revoked_at = utc_now()
        await session.flush()
    return record


async def revoke_all_user_sessions(session: AsyncSession, *, user_id: UUID) -> None:
    await session.execute(
        update(UserSession)
        .where(UserSession.user_id == user_id)
        .where(UserSession.revoked_at.is_(None))
        .values(revoked_at=utc_now())
    )


def _fernet(settings: Settings) -> Fernet:
    secret = require_secret(settings.session_hash_pepper, name="session_hash_pepper")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_mfa_secret(secret: str, settings: Settings) -> str:
    return _fernet(settings).encrypt(secret.encode("utf-8")).decode("utf-8")


def decrypt_mfa_secret(ciphertext: str, settings: Settings) -> str:
    try:
        return _fernet(settings).decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise APIError(
            code="mfa_secret_unreadable",
            message="MFA secret could not be decrypted.",
            status_code=status.HTTP_409_CONFLICT,
        ) from exc


def generate_totp_secret() -> str:
    return base64.b32encode(os.urandom(20)).decode("ascii").rstrip("=")


def _normalize_totp_secret(secret: str) -> bytes:
    padding = "=" * ((8 - len(secret) % 8) % 8)
    return base64.b32decode((secret + padding).upper())


def generate_totp_code(secret: str, *, counter: int | None = None) -> str:
    resolved_counter = int(time.time() // TOTP_PERIOD_SECONDS) if counter is None else counter
    digest = hmac.new(
        _normalize_totp_secret(secret),
        resolved_counter.to_bytes(8, "big"),
        hashlib.sha1,
    ).digest()
    offset = digest[-1] & 0x0F
    truncated = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    return str(truncated % (10**TOTP_DIGITS)).zfill(TOTP_DIGITS)


def verify_totp_code(secret: str, code: str, *, window: int = 1) -> bool:
    if not code.isdigit() or len(code) != TOTP_DIGITS:
        return False
    current_counter = int(time.time() // TOTP_PERIOD_SECONDS)
    for counter in range(current_counter - window, current_counter + window + 1):
        if hmac.compare_digest(generate_totp_code(secret, counter=counter), code):
            return True
    return False


async def setup_totp_method(
    session: AsyncSession,
    *,
    user_id: UUID,
    label: str,
    settings: Settings,
) -> tuple[UserMfaMethod, str]:
    secret = generate_totp_secret()
    method = UserMfaMethod(
        user_id=user_id,
        kind="totp",
        label=label,
        secret_ciphertext=encrypt_mfa_secret(secret, settings),
        status="pending",
    )
    session.add(method)
    await session.flush()
    return method, secret


async def verify_totp_method(
    session: AsyncSession,
    *,
    user_id: UUID,
    method_id: UUID,
    code: SecretStr,
    settings: Settings,
) -> UserMfaMethod:
    method = await session.get(UserMfaMethod, method_id)
    if method is None or method.user_id != user_id or method.kind != "totp":
        raise APIError(
            code="mfa_method_not_found",
            message="MFA method was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    secret = decrypt_mfa_secret(method.secret_ciphertext, settings)
    if not verify_totp_code(secret, code.get_secret_value()):
        raise APIError(
            code="invalid_mfa_code",
            message="MFA code is invalid.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    now = utc_now()
    method.status = "active"
    method.confirmed_at = method.confirmed_at or now
    method.last_used_at = now
    await session.flush()
    return method


async def list_mfa_methods(
    session: AsyncSession,
    *,
    user_id: UUID,
    status_filter: str | None = None,
) -> list[UserMfaMethod]:
    statement = select(UserMfaMethod).where(UserMfaMethod.user_id == user_id)
    if status_filter is not None:
        statement = statement.where(UserMfaMethod.status == status_filter)
    result = await session.execute(statement.order_by(UserMfaMethod.created_at.desc()))
    return list(result.scalars().all())


def mfa_method_response(method: UserMfaMethod) -> MfaMethodResponse:
    return MfaMethodResponse(
        id=method.id,
        kind=method.kind,
        label=method.label,
        status=method.status,
        confirmed_at=method.confirmed_at,
        last_used_at=method.last_used_at,
    )
