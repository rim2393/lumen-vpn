from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import APIError
from app.core.rbac import Permission
from app.core.security import generate_opaque_token, hmac_sha256, require_secret
from app.domains.api_keys.models import ApiKey
from app.domains.api_keys.schemas import ApiKeyCreateRequest, ApiKeyResponse

API_KEY_TOKEN_PREFIX = "lumen_sk"  # noqa: S105 - public token prefix, not secret material.
API_KEY_PUBLIC_PREFIX_LENGTH = 18


@dataclass(frozen=True)
class GeneratedApiKey:
    plaintext: str
    key_prefix: str
    key_hash: str


def utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def api_key_public_prefix(api_key: str) -> str:
    return api_key[:API_KEY_PUBLIC_PREFIX_LENGTH]


def hash_api_key(api_key: str, settings: Settings) -> str:
    pepper = settings.api_key_hash_pepper
    require_secret(pepper, name="api_key_hash_pepper")
    return hmac_sha256(api_key, pepper)


def generate_api_key(settings: Settings) -> GeneratedApiKey:
    plaintext = generate_opaque_token(prefix=API_KEY_TOKEN_PREFIX)
    return GeneratedApiKey(
        plaintext=plaintext,
        key_prefix=api_key_public_prefix(plaintext),
        key_hash=hash_api_key(plaintext, settings),
    )


def normalize_scopes(scopes: Iterable[str | Permission]) -> list[str]:
    normalized: list[str] = []
    for scope in scopes:
        try:
            permission = scope if isinstance(scope, Permission) else Permission(scope)
        except ValueError as exc:
            raise APIError(
                code="invalid_api_key_scope",
                message="API key scope is not recognized.",
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                details=[str(scope)],
            ) from exc
        normalized.append(permission.value)
    return sorted(set(normalized))


async def create_api_key(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    request: ApiKeyCreateRequest,
    settings: Settings,
) -> tuple[ApiKey, str]:
    generated = generate_api_key(settings)
    api_key = ApiKey(
        owner_user_id=owner_user_id,
        name=request.name,
        key_prefix=generated.key_prefix,
        key_hash=generated.key_hash,
        scopes=normalize_scopes(request.scopes),
        expires_at=request.expires_at,
    )
    session.add(api_key)
    await session.flush()
    return api_key, generated.plaintext


async def list_api_keys(
    session: AsyncSession,
    *,
    owner_user_id: UUID | None = None,
) -> list[ApiKey]:
    statement = select(ApiKey).order_by(ApiKey.created_at.desc())
    if owner_user_id is not None:
        statement = statement.where(ApiKey.owner_user_id == owner_user_id)
    result = await session.execute(statement)
    return list(result.scalars().all())


async def verify_api_key(
    session: AsyncSession,
    *,
    api_key: str,
    settings: Settings,
    required_scopes: Iterable[Permission] = (),
) -> ApiKey:
    key_hash = hash_api_key(api_key, settings)
    result = await session.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
    record = result.scalar_one_or_none()
    now = utc_now()

    if record is None or record.revoked_at is not None:
        raise APIError(
            code="invalid_api_key",
            message="API key is invalid or has been revoked.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    if record.expires_at is not None and ensure_aware(record.expires_at) <= now:
        raise APIError(
            code="api_key_expired",
            message="API key has expired.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    granted_scopes = {Permission(scope) for scope in record.scopes}
    missing_scopes = [scope.value for scope in required_scopes if scope not in granted_scopes]
    if missing_scopes:
        raise APIError(
            code="api_key_scope_denied",
            message="API key does not include the required scope.",
            status_code=status.HTTP_403_FORBIDDEN,
            details=missing_scopes,
        )

    record.last_used_at = now
    await session.flush()
    return record


async def revoke_api_key(session: AsyncSession, *, api_key_id: UUID) -> ApiKey:
    record = await session.get(ApiKey, api_key_id)
    if record is None:
        raise APIError(
            code="api_key_not_found",
            message="API key was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    if record.revoked_at is None:
        record.revoked_at = utc_now()
        await session.flush()
    return record


def api_key_to_response(api_key: ApiKey) -> ApiKeyResponse:
    now = utc_now()
    status_value = "active"
    if api_key.revoked_at is not None:
        status_value = "revoked"
    elif api_key.expires_at is not None:
        expires_at = ensure_aware(api_key.expires_at)
        if expires_at <= now:
            status_value = "expired"
        elif expires_at <= now + timedelta(days=30):
            status_value = "expiring"

    return ApiKeyResponse(
        id=api_key.id,
        owner_user_id=api_key.owner_user_id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        scopes=api_key.scopes,
        status=status_value,
        created_at=api_key.created_at,
        expires_at=api_key.expires_at,
        revoked_at=api_key.revoked_at,
        last_used_at=api_key.last_used_at,
    )
