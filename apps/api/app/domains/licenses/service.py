import base64
import json
from datetime import UTC, datetime
from hashlib import sha256
from typing import Literal
from uuid import UUID

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import status
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import APIError
from app.domains.licenses.models import License
from app.domains.licenses.schemas import LicenseCreateRequest, LicenseUpdateRequest
from app.domains.nodes.models import Node

SIGNED_ENTITLEMENT_METADATA_KEY = "signed_entitlement"


class SignedLicenseEntitlementClaims(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    license_key_hash: str = Field(min_length=32, max_length=128)
    customer_ref: str | None = Field(default=None, max_length=128)
    status: str = Field(min_length=1, max_length=32)
    max_devices: int = Field(ge=1, le=10000)
    starts_at: datetime | None = None
    expires_at: datetime | None = None
    issued_at: datetime
    key_id: str = Field(min_length=1, max_length=128)


def utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def verify_signed_entitlement(
    token: str,
    *,
    public_key_b64: str,
) -> SignedLicenseEntitlementClaims:
    payload, signature = token.split(".", maxsplit=1)
    payload_bytes = _b64url_decode(payload)
    signature_bytes = _b64url_decode(signature)
    public_key = Ed25519PublicKey.from_public_bytes(_b64url_decode(public_key_b64))
    try:
        public_key.verify(signature_bytes, payload_bytes)
    except InvalidSignature as exc:
        raise ValueError("invalid license entitlement signature") from exc
    return SignedLicenseEntitlementClaims.model_validate_json(payload_bytes)


def verified_license_entitlement(
    license_record: License,
    *,
    settings: Settings,
    now: datetime | None = None,
) -> SignedLicenseEntitlementClaims | None:
    public_key = settings.central_license_public_key_b64
    token = license_record.metadata_json.get(SIGNED_ENTITLEMENT_METADATA_KEY)
    if not public_key or not isinstance(token, str) or token == "":
        return None
    try:
        entitlement = verify_signed_entitlement(token, public_key_b64=public_key)
    except (InvalidSignature, TypeError, ValueError, ValidationError, json.JSONDecodeError):
        return None
    if entitlement.license_key_hash != license_record.license_key_hash:
        return None
    if entitlement.customer_ref is not None and license_record.customer_ref is not None:
        if entitlement.customer_ref != license_record.customer_ref:
            return None
    checked_at = now or utc_now()
    starts_at = ensure_aware(entitlement.starts_at) if entitlement.starts_at is not None else None
    expires_at = (
        ensure_aware(entitlement.expires_at) if entitlement.expires_at is not None else None
    )
    if entitlement.status != "active":
        return None
    if starts_at is not None and starts_at > checked_at:
        return None
    if expires_at is not None and expires_at <= checked_at:
        return None
    return entitlement


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}")


def hash_license_key(license_key: str) -> str:
    return sha256(license_key.encode("utf-8")).hexdigest()


async def list_licenses(session: AsyncSession) -> list[License]:
    result = await session.execute(select(License).order_by(License.created_at.desc()))
    return list(result.scalars())


async def get_license(session: AsyncSession, *, license_id: UUID) -> License:
    license_record = await session.get(License, license_id)
    if license_record is None:
        raise APIError(
            code="license_not_found",
            message="License was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return license_record


async def create_license(
    session: AsyncSession,
    *,
    request: LicenseCreateRequest,
) -> License:
    license_key_hash = hash_license_key(request.license_key.get_secret_value())
    existing_license = (
        await session.execute(select(License).where(License.license_key_hash == license_key_hash))
    ).scalar_one_or_none()
    if existing_license is not None:
        raise APIError(
            code="license_key_exists",
            message="A license with this key already exists.",
            status_code=status.HTTP_409_CONFLICT,
        )

    license_record = License(
        license_key_hash=license_key_hash,
        customer_ref=request.customer_ref,
        status="pending_sync",
        max_devices=0,
        starts_at=request.starts_at,
        expires_at=request.expires_at,
        metadata_json={
            **request.metadata_json,
            "sync_status": "pending",
        },
    )
    session.add(license_record)
    await session.flush()
    return license_record


async def update_license(
    session: AsyncSession,
    *,
    license_id: UUID,
    request: LicenseUpdateRequest,
) -> License:
    license_record = await get_license(session, license_id=license_id)
    fields = request.model_fields_set
    if "customer_ref" in fields:
        license_record.customer_ref = request.customer_ref
    if "status" in fields and request.status is not None:
        license_record.status = request.status
    if "max_devices" in fields and request.max_devices is not None:
        license_record.max_devices = request.max_devices
    if "starts_at" in fields:
        license_record.starts_at = request.starts_at
    if "expires_at" in fields:
        license_record.expires_at = request.expires_at
    if "metadata_json" in fields and request.metadata_json is not None:
        license_record.metadata_json = request.metadata_json
    await session.flush()
    return license_record


async def get_effective_node_limit(session: AsyncSession, settings: Settings) -> int:
    result = await session.execute(select(License))
    active_limits = [
        entitlement.max_devices
        for license_record in result.scalars()
        if (entitlement := verified_license_entitlement(license_record, settings=settings))
    ]
    return max([settings.free_license_node_limit, *active_limits])


async def count_policy_nodes(session: AsyncSession) -> int:
    result = await session.execute(
        select(func.count()).select_from(Node).where(Node.status != "deleted")
    )
    return result.scalar_one()


async def enforce_free_node_policy(
    session: AsyncSession,
    settings: Settings,
    *,
    requested_nodes: int = 1,
) -> None:
    current_nodes = await count_policy_nodes(session)
    effective_limit = await get_effective_node_limit(session, settings)
    if current_nodes + requested_nodes > effective_limit:
        raise APIError(
            code="license_node_limit_exceeded",
            message="The current license policy does not allow more nodes.",
            status_code=status.HTTP_403_FORBIDDEN,
            details=[
                f"current_nodes={current_nodes}",
                f"requested_nodes={requested_nodes}",
                f"effective_limit={effective_limit}",
            ],
        )
