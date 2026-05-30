from uuid import UUID

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import APIError
from app.core.rbac import Role
from app.domains.auth.models import UserIdentity
from app.domains.auth.schemas import (
    LoginResponse,
    MfaChallengeResponse,
    TokenPairResponse,
)
from app.domains.auth.service import (
    ACCESS_TOKEN_PREFIX,
    MFA_CHALLENGE_TOKEN_PREFIX,
    REFRESH_TOKEN_PREFIX,
    create_session_token,
    list_mfa_methods,
    mfa_method_response,
    utc_now,
)
from app.domains.auth.social_schemas import LinkedIdentityResponse
from app.domains.users.models import User


async def issue_login_response(
    session: AsyncSession,
    *,
    user: User,
    settings: Settings,
    enforce_mfa: bool = True,
) -> LoginResponse:
    """Issue a session token pair, or an MFA challenge when MFA is active.

    ``enforce_mfa`` is ``False`` for passkey logins, which are themselves a
    strong authentication factor and therefore satisfy MFA on their own.
    """

    if enforce_mfa:
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


async def _active_user_or_error(session: AsyncSession, user_id: UUID) -> User:
    user = await session.get(User, user_id)
    if user is None or user.status != "active":
        raise APIError(
            code="oauth_user_inactive",
            message="The linked account is not active.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    return user


async def find_or_link_oauth_user(
    session: AsyncSession,
    *,
    provider: str,
    subject: str,
    email: str | None,
    email_verified: bool,
    display_name: str | None,
    profile: dict[str, object],
    settings: Settings,
    link_user_id: UUID | None = None,
) -> User:
    """Resolve the Lumen user for an external identity, linking or creating as policy allows."""

    normalized_email = email.strip().lower() if email else None

    existing_identity = (
        await session.execute(
            select(UserIdentity).where(
                UserIdentity.provider == provider,
                UserIdentity.subject == subject,
            )
        )
    ).scalar_one_or_none()
    if existing_identity is not None:
        if link_user_id is not None and link_user_id != existing_identity.user_id:
            raise APIError(
                code="identity_already_linked",
                message="This external account is already linked to a different user.",
                status_code=status.HTTP_409_CONFLICT,
            )
        user = await _active_user_or_error(session, existing_identity.user_id)
        existing_identity.email = normalized_email or existing_identity.email
        existing_identity.display_name = display_name or existing_identity.display_name
        existing_identity.profile_json = profile
        existing_identity.last_login_at = utc_now()
        await session.flush()
        return user

    if link_user_id is not None:
        user = await _active_user_or_error(session, link_user_id)
        await _create_identity(
            session,
            user_id=user.id,
            provider=provider,
            subject=subject,
            email=normalized_email,
            display_name=display_name,
            profile=profile,
        )
        return user

    if normalized_email and email_verified:
        user = (
            await session.execute(select(User).where(User.email == normalized_email))
        ).scalar_one_or_none()
        if user is not None:
            if user.status != "active":
                raise APIError(
                    code="oauth_user_inactive",
                    message="The matched account is not active.",
                    status_code=status.HTTP_401_UNAUTHORIZED,
                )
            await _create_identity(
                session,
                user_id=user.id,
                provider=provider,
                subject=subject,
                email=normalized_email,
                display_name=display_name,
                profile=profile,
            )
            return user

    if settings.oauth_allow_signup and normalized_email:
        existing_user = (
            await session.execute(select(User).where(User.email == normalized_email))
        ).scalar_one_or_none()
        if existing_user is not None:
            raise APIError(
                code="oauth_email_unverified",
                message="An account with this email exists; link it from settings instead.",
                status_code=status.HTTP_409_CONFLICT,
            )
        role = _safe_signup_role(settings.oauth_signup_role)
        user = User(
            email=normalized_email,
            password_hash=None,
            role=role,
            status="active",
            display_name=display_name,
        )
        session.add(user)
        await session.flush()
        await _create_identity(
            session,
            user_id=user.id,
            provider=provider,
            subject=subject,
            email=normalized_email,
            display_name=display_name,
            profile=profile,
        )
        return user

    raise APIError(
        code="oauth_account_not_linked",
        message="No Lumen account is linked to this external identity.",
        status_code=status.HTTP_403_FORBIDDEN,
    )


def _safe_signup_role(role: str) -> str:
    try:
        return Role(role).value
    except ValueError:
        return Role.USER.value


async def _create_identity(
    session: AsyncSession,
    *,
    user_id: UUID,
    provider: str,
    subject: str,
    email: str | None,
    display_name: str | None,
    profile: dict[str, object],
) -> UserIdentity:
    identity = UserIdentity(
        user_id=user_id,
        provider=provider,
        subject=subject,
        email=email,
        display_name=display_name,
        profile_json=profile,
        last_login_at=utc_now(),
    )
    session.add(identity)
    await session.flush()
    return identity


async def list_identities(session: AsyncSession, *, user_id: UUID) -> list[UserIdentity]:
    result = await session.execute(
        select(UserIdentity)
        .where(UserIdentity.user_id == user_id)
        .order_by(UserIdentity.created_at.desc())
    )
    return list(result.scalars().all())


async def remove_identity(session: AsyncSession, *, user_id: UUID, identity_id: UUID) -> None:
    identity = await session.get(UserIdentity, identity_id)
    if identity is None or identity.user_id != user_id:
        raise APIError(
            code="identity_not_found",
            message="Linked identity was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    await session.delete(identity)
    await session.flush()


def identity_to_response(identity: UserIdentity) -> LinkedIdentityResponse:
    return LinkedIdentityResponse(
        id=identity.id,
        provider=identity.provider,
        subject=identity.subject,
        email=identity.email,
        display_name=identity.display_name,
        last_login_at=identity.last_login_at,
        created_at=identity.created_at,
    )
