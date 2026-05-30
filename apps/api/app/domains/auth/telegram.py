import hashlib
import hmac
from datetime import UTC, datetime
from uuid import UUID

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import APIError
from app.core.security import constant_time_equal, require_secret
from app.domains.auth.social_schemas import TelegramLoginRequest
from app.domains.users.models import User

TELEGRAM_PROVIDER = "telegram"


def verify_telegram_login(payload: TelegramLoginRequest, settings: Settings) -> None:
    """Validate a Telegram Login Widget payload against the bot token.

    Telegram signs the widget data with ``HMAC-SHA256`` keyed by
    ``SHA256(bot_token)``. We recompute the hash over the sorted data-check
    string and reject anything that does not match or is too old.
    """

    if not settings.telegram_login_enabled:
        raise APIError(
            code="telegram_login_disabled",
            message="Telegram login is not enabled.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    bot_token = require_secret(settings.telegram_bot_token, name="telegram_bot_token")

    fields = payload.model_dump(exclude_none=True)
    provided_hash = str(fields.pop("hash", ""))
    if not provided_hash:
        raise APIError(
            code="telegram_hash_missing",
            message="Telegram login payload is missing the hash field.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    data_check_string = "\n".join(f"{key}={fields[key]}" for key in sorted(fields))
    secret_key = hashlib.sha256(bot_token.encode("utf-8")).digest()
    computed_hash = hmac.new(
        secret_key,
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not constant_time_equal(computed_hash, provided_hash):
        raise APIError(
            code="telegram_hash_invalid",
            message="Telegram login signature is invalid.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    age_seconds = datetime.now(UTC).timestamp() - payload.auth_date
    if age_seconds > settings.telegram_auth_ttl_seconds or age_seconds < -300:
        raise APIError(
            code="telegram_auth_expired",
            message="Telegram login payload has expired.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )


def telegram_display_name(payload: TelegramLoginRequest) -> str | None:
    parts = [part for part in (payload.first_name, payload.last_name) if part]
    if parts:
        return " ".join(parts)
    return payload.username


async def resolve_telegram_user(
    session: AsyncSession,
    *,
    payload: TelegramLoginRequest,
    settings: Settings,
    link_user_id: UUID | None,
) -> User:
    verify_telegram_login(payload, settings)
    telegram_id = str(payload.id)

    if link_user_id is not None:
        owner = (
            await session.execute(select(User).where(User.telegram_id == telegram_id))
        ).scalar_one_or_none()
        if owner is not None and owner.id != link_user_id:
            raise APIError(
                code="telegram_already_linked",
                message="This Telegram account is already linked to another user.",
                status_code=status.HTTP_409_CONFLICT,
            )
        user = await session.get(User, link_user_id)
        if user is None or user.status != "active":
            raise APIError(
                code="telegram_user_inactive",
                message="The account is not active.",
                status_code=status.HTTP_401_UNAUTHORIZED,
            )
        user.telegram_id = telegram_id
        if not user.display_name:
            user.display_name = telegram_display_name(payload)
        await session.flush()
        return user

    user = (
        await session.execute(select(User).where(User.telegram_id == telegram_id))
    ).scalar_one_or_none()
    if user is None:
        raise APIError(
            code="telegram_not_linked",
            message="No Lumen account is linked to this Telegram account.",
            status_code=status.HTTP_403_FORBIDDEN,
        )
    if user.status != "active":
        raise APIError(
            code="telegram_user_inactive",
            message="The linked account is not active.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    return user
