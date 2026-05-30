from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import APIError
from app.core.rbac import Permission, Principal, Role
from app.domains.admin_compat.schemas import (
    AdminUserRecord,
    AdminUsersResponse,
    ApiKeyRecord,
    ApiKeysResponse,
    AuthSessionResponse,
    LicenseAuditEvent,
    LicenseSummaryResponse,
)
from app.domains.api_keys.models import ApiKey
from app.domains.auth.models import UserMfaMethod, UserSession
from app.domains.licenses.models import License
from app.domains.subscriptions.models import Subscription
from app.domains.users.models import User

ADMIN_COMPAT_ROLES = frozenset({Role.OWNER, Role.ADMIN})
ADMIN_COMPAT_PERMISSIONS = frozenset(
    {
        Permission.API_KEY_MANAGE,
        Permission.LICENSE_MANAGE,
        Permission.SUBSCRIPTION_MANAGE,
        Permission.USER_MANAGE,
    }
)
API_KEY_EXPIRING_WINDOW = timedelta(days=30)
NO_EXPIRY_SENTINEL = datetime(9999, 12, 31, tzinfo=UTC)


def utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def require_admin_compat_read(principal: Principal) -> None:
    if principal.subject == "bootstrap-admin":
        return
    if principal.roles.intersection(ADMIN_COMPAT_ROLES):
        return
    if principal.permissions.intersection(ADMIN_COMPAT_PERMISSIONS):
        return
    raise APIError(
        code="permission_denied",
        message="The caller is not allowed to read admin compatibility resources.",
        status_code=status.HTTP_403_FORBIDDEN,
    )


async def read_auth_session(
    session: AsyncSession,
    *,
    principal: Principal,
    settings: Settings,
) -> AuthSessionResponse:
    del settings
    user_session, user = await _real_web_session(session, principal=principal)
    email = user.email
    return AuthSessionResponse(
        email=email,
        expires_at=ensure_aware(user_session.expires_at),
        name=user.display_name or _display_name(email, fallback=str(user.id)),
        role=_session_role_from_user(user),
        scopes=sorted(permission.value for permission in principal.permissions),
        user_id=str(user.id),
    )


async def list_admin_users(
    session: AsyncSession,
    *,
    principal: Principal,
) -> AdminUsersResponse:
    require_admin_compat_read(principal)
    generated_at = utc_now()
    users = (
        (await session.execute(select(User).order_by(User.created_at.desc(), User.email.asc())))
        .scalars()
        .all()
    )
    subscriptions_by_user = await _latest_subscriptions_by_user(
        session,
        user_ids=[user.id for user in users],
    )
    mfa_enabled_by_user = await _confirmed_mfa_by_user(
        session,
        user_ids=[user.id for user in users],
    )
    items = [
        _user_record(
            user,
            subscription=subscriptions_by_user.get(user.id),
            mfa_enabled=mfa_enabled_by_user.get(user.id, False),
            generated_at=generated_at,
        )
        for user in users
    ]
    return AdminUsersResponse(
        generated_at=generated_at,
        items=items,
        source="api",
        total=len(items),
    )


async def list_admin_api_keys(
    session: AsyncSession,
    *,
    principal: Principal,
) -> ApiKeysResponse:
    require_admin_compat_read(principal)
    generated_at = utc_now()
    api_keys = (
        (
            await session.execute(
                select(ApiKey).order_by(ApiKey.created_at.desc(), ApiKey.name.asc())
            )
        )
        .scalars()
        .all()
    )
    owners = await _users_by_id(session, user_ids=[api_key.owner_user_id for api_key in api_keys])
    items = [
        _api_key_record(api_key, owner=owners.get(api_key.owner_user_id), generated_at=generated_at)
        for api_key in api_keys
    ]
    return ApiKeysResponse(
        generated_at=generated_at,
        items=items,
        source="api",
        total=len(items),
    )


async def read_license_summary(
    session: AsyncSession,
    *,
    principal: Principal,
) -> LicenseSummaryResponse | None:
    require_admin_compat_read(principal)
    licenses = (
        (await session.execute(select(License).order_by(License.created_at.desc()))).scalars().all()
    )
    if not licenses:
        return None

    generated_at = utc_now()
    license_record = _select_license(licenses, generated_at=generated_at)
    seats_used = await _count_license_seats(
        session,
        license_id=license_record.id,
        generated_at=generated_at,
    )
    return _license_summary(license_record, seats_used=seats_used, generated_at=generated_at)


async def _real_web_session(
    session: AsyncSession,
    *,
    principal: Principal,
) -> tuple[UserSession, User]:
    if principal.session_id is None:
        raise APIError(
            code="web_session_required",
            message="A web session is required for this endpoint.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    user_session = await session.get(UserSession, principal.session_id)
    generated_at = utc_now()
    if user_session is None or user_session.revoked_at is not None:
        raise APIError(
            code="invalid_session",
            message="Session is invalid or has been revoked.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    if ensure_aware(user_session.expires_at) <= generated_at:
        raise APIError(
            code="session_expired",
            message="Session has expired.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    user = await session.get(User, user_session.user_id)
    if user is None or user.status != "active" or principal.subject != str(user.id):
        raise APIError(
            code="session_user_inactive",
            message="Session user is not active.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    return user_session, user


def _display_name(email: str, *, fallback: str) -> str:
    local_part = email.split("@", 1)[0] or fallback
    words = [
        word
        for chunk in local_part.replace("-", ".").replace("_", ".").split(".")
        if (word := chunk.strip())
    ]
    if not words:
        return fallback
    return " ".join(word.capitalize() for word in words)


def _session_role_from_user(user: User) -> str:
    if user.role == Role.OWNER.value:
        return "owner"
    if user.role == Role.ADMIN.value:
        return "admin"
    if user.role == Role.SUPPORT.value:
        return "operator"
    return "auditor"


async def _latest_subscriptions_by_user(
    session: AsyncSession,
    *,
    user_ids: list[UUID],
) -> dict[UUID, Subscription]:
    if not user_ids:
        return {}

    result = await session.execute(
        select(Subscription)
        .where(Subscription.user_id.in_(user_ids))
        .order_by(Subscription.created_at.desc(), Subscription.public_id.asc())
    )
    subscriptions_by_user: dict[UUID, Subscription] = {}
    for subscription in result.scalars():
        subscriptions_by_user.setdefault(subscription.user_id, subscription)
    return subscriptions_by_user


async def _confirmed_mfa_by_user(
    session: AsyncSession,
    *,
    user_ids: list[UUID],
) -> dict[UUID, bool]:
    if not user_ids:
        return {}
    result = await session.execute(
        select(UserMfaMethod.user_id)
        .where(
            UserMfaMethod.user_id.in_(user_ids),
            UserMfaMethod.status == "confirmed",
            UserMfaMethod.confirmed_at.is_not(None),
        )
        .distinct(),
    )
    return {user_id: True for user_id in result.scalars().all()}


async def _users_by_id(
    session: AsyncSession,
    *,
    user_ids: list[UUID],
) -> dict[UUID, User]:
    if not user_ids:
        return {}

    result = await session.execute(select(User).where(User.id.in_(user_ids)))
    return {user.id: user for user in result.scalars()}


def _user_record(
    user: User,
    *,
    subscription: Subscription | None,
    mfa_enabled: bool,
    generated_at: datetime,
) -> AdminUserRecord:
    return AdminUserRecord(
        display_name=_display_name(user.email, fallback=str(user.id)),
        email=user.email,
        expires_at=_user_expires_at(user, subscription=subscription),
        id=str(user.id),
        mfa_enabled=mfa_enabled,
        role=_admin_user_role(user.role),
        status=_admin_user_status(user, subscription=subscription, generated_at=generated_at),
        subscription=_subscription_status(subscription, generated_at=generated_at),
        traffic_used_gb=float(user.traffic_used_gb),
    )


def _user_expires_at(user: User, *, subscription: Subscription | None) -> datetime:
    if subscription is not None and subscription.expires_at is not None:
        return ensure_aware(subscription.expires_at)
    if user.expires_at is not None:
        return ensure_aware(user.expires_at)
    return NO_EXPIRY_SENTINEL


def _admin_user_role(role: str) -> str:
    if role in {"owner", "admin", "user"}:
        return role
    return "operator"


def _admin_user_status(
    user: User,
    *,
    subscription: Subscription | None,
    generated_at: datetime,
) -> str:
    if user.status in {"disabled", "inactive", "suspended"}:
        return "disabled"
    if user.status != "active":
        return "limited"
    if user.expires_at is not None and ensure_aware(user.expires_at) <= generated_at:
        return "limited"
    if subscription is None or subscription.expires_at is None:
        return "active"
    if ensure_aware(subscription.expires_at) <= generated_at:
        return "limited"
    return "active"


def _subscription_status(
    subscription: Subscription | None,
    *,
    generated_at: datetime,
) -> str:
    if subscription is None:
        return "expired"
    if subscription.revoked_at is not None:
        return "expired"
    if (
        subscription.expires_at is not None
        and ensure_aware(subscription.expires_at) <= generated_at
    ):
        return "expired"
    if subscription.status in {"trial", "grace"}:
        return subscription.status
    if subscription.status in {"active", "paid"}:
        return "paid"
    return "expired"


def _api_key_record(
    api_key: ApiKey,
    *,
    owner: User | None,
    generated_at: datetime,
) -> ApiKeyRecord:
    return ApiKeyRecord(
        created_at=ensure_aware(api_key.created_at),
        expires_at=ensure_aware(api_key.expires_at) if api_key.expires_at is not None else None,
        fingerprint=api_key.key_prefix,
        id=str(api_key.id),
        last_used_at=(
            ensure_aware(api_key.last_used_at) if api_key.last_used_at is not None else None
        ),
        name=api_key.name,
        owner=_display_name(owner.email, fallback=str(api_key.owner_user_id))
        if owner is not None
        else str(api_key.owner_user_id),
        scopes=api_key.scopes,
        status=_api_key_status(api_key, generated_at=generated_at),
    )


def _api_key_status(api_key: ApiKey, *, generated_at: datetime) -> str:
    if api_key.revoked_at is not None:
        return "revoked"
    if api_key.expires_at is None:
        return "active"
    if ensure_aware(api_key.expires_at) <= generated_at + API_KEY_EXPIRING_WINDOW:
        return "expiring"
    return "active"


def _select_license(
    licenses: list[License],
    *,
    generated_at: datetime,
) -> License:
    return sorted(
        licenses,
        key=lambda license_record: (
            _license_status(license_record, generated_at=generated_at) == "valid",
            ensure_aware(license_record.expires_at)
            if license_record.expires_at is not None
            else NO_EXPIRY_SENTINEL,
            ensure_aware(license_record.created_at),
        ),
        reverse=True,
    )[0]


async def _count_license_seats(
    session: AsyncSession,
    *,
    license_id: UUID,
    generated_at: datetime,
) -> int:
    subscriptions = (
        await session.execute(
            select(Subscription)
            .where(Subscription.license_id == license_id)
            .where(Subscription.revoked_at.is_(None))
        )
    ).scalars()
    return sum(
        1
        for subscription in subscriptions
        if _subscription_status(subscription, generated_at=generated_at) != "expired"
    )


def _license_summary(
    license_record: License,
    *,
    seats_used: int,
    generated_at: datetime,
) -> LicenseSummaryResponse:
    return LicenseSummaryResponse(
        audit_events=_license_audit_events(license_record),
        expires_at=(
            ensure_aware(license_record.expires_at)
            if license_record.expires_at is not None
            else None
        ),
        features=_license_features(license_record),
        issued_to=license_record.customer_ref,
        plan=_license_plan(license_record),
        seats_limit=license_record.max_devices,
        seats_used=seats_used,
        status=_license_status(license_record, generated_at=generated_at),
    )


def _license_audit_events(license_record: License) -> list[LicenseAuditEvent]:
    events = [
        LicenseAuditEvent(
            at=ensure_aware(license_record.created_at),
            label="License registered",
        )
    ]
    updated_at = ensure_aware(license_record.updated_at)
    if updated_at != ensure_aware(license_record.created_at):
        events.append(LicenseAuditEvent(at=updated_at, label="License updated"))
    return events


def _license_features(license_record: License) -> list[str]:
    raw_features = license_record.metadata_json.get("features")
    if raw_features:
        features = [feature.strip() for feature in raw_features.split(",") if feature.strip()]
        if features:
            return features
    return []


def _license_plan(license_record: License) -> str:
    return (
        license_record.metadata_json.get("plan")
        or license_record.metadata_json.get("tier")
        or "unknown"
    )


def _license_status(license_record: License, *, generated_at: datetime) -> str:
    starts_at = (
        ensure_aware(license_record.starts_at) if license_record.starts_at is not None else None
    )
    expires_at = (
        ensure_aware(license_record.expires_at) if license_record.expires_at is not None else None
    )
    if license_record.status != "active":
        return "unlicensed"
    if starts_at is not None and starts_at > generated_at:
        return "invalid"
    if expires_at is None:
        return "valid"
    if expires_at <= generated_at:
        return "invalid"
    if expires_at <= generated_at + API_KEY_EXPIRING_WINDOW:
        return "expiring"
    return "valid"
