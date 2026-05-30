from uuid import UUID

from fastapi import status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.rbac import Principal, Role, can_manage_role
from app.core.security import hash_password
from app.domains.audit.models import AuditEvent
from app.domains.audit.service import audit_event_response
from app.domains.nodes.models import Node
from app.domains.subscriptions.service import list_subscriptions_for_user, subscription_to_response
from app.domains.users.models import User
from app.domains.users.schemas import (
    UserAccessibleNodeRecord,
    UserBulkActionRequest,
    UserCreateRequest,
    UserDetailResponse,
    UserDeviceRecord,
    UserResponse,
    UserTagListResponse,
    UserUpdateRequest,
)


async def list_users(session: AsyncSession) -> list[User]:
    result = await session.execute(select(User).order_by(User.created_at.desc()))
    return list(result.scalars().all())


async def get_user(session: AsyncSession, user_id: UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise APIError(
            code="user_not_found",
            message="User was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return user


async def get_user_by_username(session: AsyncSession, username: str) -> User:
    return await _get_single_user(
        session,
        select(User).where(User.username == username),
        detail=username,
    )


async def get_user_by_email(session: AsyncSession, email: str) -> User:
    return await _get_single_user(
        session,
        select(User).where(User.email == email.lower()),
        detail=email,
    )


async def get_user_by_telegram_id(session: AsyncSession, telegram_id: str) -> User:
    return await _get_single_user(
        session,
        select(User).where(User.telegram_id == telegram_id),
        detail=telegram_id,
    )


async def get_user_by_short_uuid(session: AsyncSession, short_uuid: str) -> User:
    normalized = short_uuid.strip().lower()
    if len(normalized) < 4:
        raise APIError(
            code="user_lookup_too_short",
            message="Short UUID lookup requires at least four characters.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    users = await list_users(session)
    matches = [user for user in users if str(user.id).replace("-", "").startswith(normalized)]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise _user_not_found(normalized)
    raise APIError(
        code="user_lookup_ambiguous",
        message="Short UUID lookup matched more than one user.",
        status_code=status.HTTP_409_CONFLICT,
        details=[str(user.id) for user in matches],
    )


async def get_user_by_numeric_id(session: AsyncSession, numeric_id: int) -> User:
    users = await list_users(session)
    for user in users:
        metadata = user.metadata_json
        if metadata.get("numeric_id") == numeric_id or metadata.get("id") == numeric_id:
            return user
    raise _user_not_found(str(numeric_id))


async def resolve_user(session: AsyncSession, query: str) -> User:
    normalized = query.strip()
    if not normalized:
        raise APIError(
            code="user_lookup_empty",
            message="User lookup query cannot be empty.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    try:
        return await get_user(session, UUID(normalized))
    except ValueError:
        pass
    except APIError as exc:
        if exc.code != "user_not_found":
            raise
    if "@" in normalized:
        return await get_user_by_email(session, normalized)
    if normalized.isdigit():
        try:
            return await get_user_by_numeric_id(session, int(normalized))
        except APIError as exc:
            if exc.code != "user_not_found":
                raise
    result = await session.execute(
        select(User).where(
            or_(
                User.username == normalized,
                User.telegram_id == normalized,
            )
        )
    )
    user = result.scalars().first()
    if user is not None:
        return user
    return await get_user_by_short_uuid(session, normalized)


async def list_user_tags(session: AsyncSession) -> UserTagListResponse:
    users = await list_users(session)
    tags = sorted({tag for user in users for tag in user.tags})
    return UserTagListResponse(items=tags)


async def list_users_by_tag(session: AsyncSession, tag: str) -> list[User]:
    users = await list_users(session)
    return [user for user in users if tag in user.tags]


async def get_user_detail(session: AsyncSession, user_id: UUID) -> UserDetailResponse:
    user = await get_user(session, user_id)
    subscriptions = await list_subscriptions_for_user(session, user_id=user.id)
    nodes = await _list_accessible_nodes(session, subscriptions=subscriptions)
    request_history = await _list_user_audit_events(session, user_id=user.id)
    return UserDetailResponse(
        user=user_to_response(user),
        subscriptions=[subscription_to_response(subscription) for subscription in subscriptions],
        devices=_user_devices_from_metadata(user.metadata_json),
        accessible_nodes=[
            UserAccessibleNodeRecord(
                id=node.id,
                name=node.name,
                region=node.region,
                public_address=node.public_address,
                status=node.status,
            )
            for node in nodes
        ],
        request_history=[audit_event_response(event) for event in request_history],
    )


async def create_user(
    session: AsyncSession,
    *,
    request: UserCreateRequest,
    principal: Principal,
) -> User:
    email = request.email.lower()
    requested_role = _requested_role_for_user_create(request)
    _ensure_actor_can_create_role(
        principal=principal,
        requested_role=requested_role,
    )
    await _ensure_unique_identity(session, email=email, username=request.username)
    user = User(
        email=email,
        password_hash=hash_password(request.password) if request.password is not None else None,
        role=requested_role.value,
        status=request.status,
        username=request.username,
        display_name=request.display_name,
        telegram_id=request.telegram_id,
        traffic_limit_gb=request.traffic_limit_gb,
        traffic_used_gb=request.traffic_used_gb,
        device_limit=request.device_limit,
        expires_at=request.expires_at,
        tags=request.tags,
        metadata_json=request.metadata_json,
    )
    session.add(user)
    await session.flush()
    return user


async def update_user(
    session: AsyncSession,
    *,
    user_id: UUID,
    principal: Principal,
    request: UserUpdateRequest,
) -> User:
    user = await get_user(session, user_id)
    _ensure_actor_can_manage_user(principal=principal, user=user)
    data = request.model_dump(exclude_unset=True)
    if "email" in data and data["email"] is not None:
        email = str(data.pop("email")).lower()
        await _ensure_unique_identity(session, email=email, username=None, exclude_user_id=user.id)
        user.email = email
    if "username" in data:
        username = data["username"]
        if username is not None:
            await _ensure_unique_identity(
                session,
                email=None,
                username=username,
                exclude_user_id=user.id,
            )
        user.username = username
        data.pop("username")
    if "password" in data:
        password = data.pop("password")
        _ensure_not_self_privilege_edit(principal=principal, target_user=user)
        if password is not None:
            user.password_hash = hash_password(password)
    if "role" in data and data["role"] is not None:
        requested_role = data["role"]
        data.pop("role")
        _ensure_actor_can_assign_role(
            principal=principal,
            actor_target=user,
            requested_role=requested_role,
        )
        user.role = requested_role.value
    for field, value in data.items():
        setattr(user, field, value)
    await session.flush()
    return user


async def delete_user(session: AsyncSession, *, user_id: UUID, principal: Principal) -> None:
    user = await get_user(session, user_id)
    _ensure_actor_can_manage_user(principal=principal, user=user)
    await session.delete(user)
    await session.flush()


async def delete_user_device(
    session: AsyncSession,
    *,
    user_id: UUID,
    device_id: str,
    principal: Principal,
) -> User:
    user = await get_user(session, user_id)
    _ensure_actor_can_manage_user(principal=principal, user=user)
    metadata = dict(user.metadata_json)
    devices = metadata.get("devices")
    if not isinstance(devices, list):
        raise APIError(
            code="user_device_not_found",
            message="Device was not found for this user.",
            status_code=status.HTTP_404_NOT_FOUND,
            details=[device_id],
        )

    remaining: list[object] = []
    removed = False
    for device in devices:
        if isinstance(device, dict) and _device_matches(device, device_id):
            removed = True
            continue
        remaining.append(device)

    if not removed:
        raise APIError(
            code="user_device_not_found",
            message="Device was not found for this user.",
            status_code=status.HTTP_404_NOT_FOUND,
            details=[device_id],
        )

    metadata["devices"] = remaining
    user.metadata_json = metadata
    await session.flush()
    return user


async def clear_user_devices(session: AsyncSession, *, user_id: UUID, principal: Principal) -> User:
    user = await get_user(session, user_id)
    _ensure_actor_can_manage_user(principal=principal, user=user)
    metadata = dict(user.metadata_json)
    metadata["devices"] = []
    user.metadata_json = metadata
    await session.flush()
    return user


async def apply_bulk_user_action(
    session: AsyncSession,
    *,
    request: UserBulkActionRequest,
    action: str,
    principal: Principal,
) -> list[User]:
    users = await _get_users_by_ids(session, request.user_ids)
    for user in users:
        _ensure_actor_can_manage_user(principal=principal, user=user)
    for user in users:
        if action == "status":
            if request.status is None:
                raise APIError(
                    code="bulk_status_required",
                    message="status is required for status bulk action.",
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            user.status = request.status
        elif action == "reset-traffic":
            user.traffic_used_gb = 0.0
        elif action == "extend":
            if request.expires_at is None:
                raise APIError(
                    code="bulk_expires_at_required",
                    message="expires_at is required for extend bulk action.",
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            user.expires_at = request.expires_at
        elif action == "revoke":
            user.status = "revoked"
        elif action == "tag":
            user.tags = request.tags or []
        elif action == "traffic":
            user.traffic_used_gb = max(
                0.0,
                user.traffic_used_gb + (request.traffic_delta_gb or 0.0),
            )
        else:
            raise APIError(
                code="bulk_action_unknown",
                message="Bulk user action is not supported.",
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                details=[action],
            )
    await session.flush()
    return users


async def _ensure_unique_identity(
    session: AsyncSession,
    *,
    email: str | None,
    username: str | None,
    exclude_user_id: UUID | None = None,
) -> None:
    if email is not None:
        result = await session.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()
        if existing is not None and existing.id != exclude_user_id:
            raise APIError(
                code="user_email_already_exists",
                message="A user with this email already exists.",
                status_code=status.HTTP_409_CONFLICT,
            )
    if username is not None:
        result = await session.execute(select(User).where(User.username == username))
        existing = result.scalar_one_or_none()
        if existing is not None and existing.id != exclude_user_id:
            raise APIError(
                code="user_username_already_exists",
                message="A user with this username already exists.",
                status_code=status.HTTP_409_CONFLICT,
            )


async def _get_users_by_ids(session: AsyncSession, user_ids: list[UUID]) -> list[User]:
    result = await session.execute(select(User).where(User.id.in_(user_ids)))
    users = list(result.scalars().all())
    if len(users) != len(set(user_ids)):
        found = {user.id for user in users}
        missing = [str(user_id) for user_id in user_ids if user_id not in found]
        raise APIError(
            code="user_not_found",
            message="One or more users were not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details=missing,
        )
    return users


async def _get_single_user(session: AsyncSession, statement, *, detail: str) -> User:
    result = await session.execute(statement)
    user = result.scalar_one_or_none()
    if user is None:
        raise _user_not_found(detail)
    return user


def _user_not_found(detail: str) -> APIError:
    return APIError(
        code="user_not_found",
        message="User was not found.",
        status_code=status.HTTP_404_NOT_FOUND,
        details=[detail],
    )


def user_to_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        role=user.role,
        status=user.status,
        username=user.username,
        display_name=user.display_name,
        telegram_id=user.telegram_id,
        traffic_limit_gb=user.traffic_limit_gb,
        traffic_used_gb=user.traffic_used_gb,
        device_limit=user.device_limit,
        expires_at=user.expires_at,
        tags=user.tags,
        metadata_json=user.metadata_json,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


async def _list_accessible_nodes(
    session: AsyncSession,
    *,
    subscriptions,
) -> list[Node]:
    node_ids = {
        subscription.node_id
        for subscription in subscriptions
        if subscription.node_id is not None
    }
    if not node_ids:
        return []
    result = await session.execute(
        select(Node)
        .where(Node.id.in_(node_ids), Node.status != "deleted")
        .order_by(Node.name),
    )
    return list(result.scalars().all())


async def _list_user_audit_events(session: AsyncSession, *, user_id: UUID) -> list[AuditEvent]:
    result = await session.execute(
        select(AuditEvent)
        .where(AuditEvent.resource_type == "user", AuditEvent.resource_id == str(user_id))
        .order_by(AuditEvent.created_at.desc())
        .limit(100)
    )
    return list(result.scalars().all())


def _user_devices_from_metadata(metadata: dict[str, object]) -> list[UserDeviceRecord]:
    raw_devices = metadata.get("devices", [])
    if not isinstance(raw_devices, list):
        return []
    devices: list[UserDeviceRecord] = []
    for index, raw_device in enumerate(raw_devices):
        if not isinstance(raw_device, dict):
            continue
        device_id = raw_device.get("id") or raw_device.get("hwid") or f"device-{index + 1}"
        last_seen = raw_device.get("last_seen_at")
        devices.append(
            UserDeviceRecord(
                id=str(device_id),
                label=_optional_str(raw_device.get("label")),
                hwid=_optional_str(raw_device.get("hwid")),
                platform=_optional_str(raw_device.get("platform")),
                status=str(raw_device.get("status") or "active"),
                last_seen_at=last_seen if hasattr(last_seen, "isoformat") else None,
                metadata_json={str(key): value for key, value in raw_device.items()},
            )
        )
    return devices


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    return str(value)


def _device_matches(device: dict[object, object], device_id: str) -> bool:
    candidates = [device.get("id"), device.get("hwid")]
    return any(str(candidate) == device_id for candidate in candidates if candidate is not None)


def _requested_role_for_user_create(request: UserCreateRequest) -> Role:
    if "role" in request.model_fields_set:
        return request.role
    return Role.USER


def _ensure_actor_can_assign_role(
    *,
    principal: Principal,
    actor_target: User,
    requested_role: Role,
) -> None:
    _ensure_not_self_privilege_edit(principal=principal, target_user=actor_target)
    if not can_manage_role(principal=principal, role=requested_role):
        raise APIError(
            code="user_role_escalation_forbidden",
            message="Cannot assign a role above the caller's permission level.",
            status_code=status.HTTP_403_FORBIDDEN,
        )


def _ensure_actor_can_create_role(
    *,
    principal: Principal,
    requested_role: Role,
) -> None:
    if not can_manage_role(principal=principal, role=requested_role):
        raise APIError(
            code="user_role_escalation_forbidden",
            message="Cannot assign a role above the caller's permission level.",
            status_code=status.HTTP_403_FORBIDDEN,
        )


def _ensure_actor_can_manage_user(*, principal: Principal, user: User) -> None:
    current_role = Role(user.role)
    if not can_manage_role(principal=principal, role=current_role):
        raise APIError(
            code="user_modify_forbidden",
            message="The caller is not allowed to modify this user.",
            status_code=status.HTTP_403_FORBIDDEN,
        )


def _ensure_not_self_privilege_edit(*, principal: Principal, target_user: User) -> None:
    if principal.subject == str(target_user.id):
        raise APIError(
            code="user_self_management_forbidden",
            message="Updating own privileged account state is not allowed.",
            status_code=status.HTTP_403_FORBIDDEN,
        )
