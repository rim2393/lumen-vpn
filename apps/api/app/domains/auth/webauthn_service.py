import json
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse
from uuid import UUID

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import APIError
from app.domains.auth.models import WebAuthnChallenge, WebAuthnCredential
from app.domains.auth.social_schemas import WebAuthnCredentialResponse
from app.domains.users.models import User

REGISTER_KIND = "register"
AUTHENTICATE_KIND = "authenticate"


def utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _require_enabled(settings: Settings) -> None:
    if not settings.webauthn_enabled:
        raise APIError(
            code="webauthn_disabled",
            message="WebAuthn / passkeys are not enabled.",
            status_code=status.HTTP_404_NOT_FOUND,
        )


def _rp_id(settings: Settings) -> str:
    if settings.webauthn_rp_id:
        return settings.webauthn_rp_id
    host = urlparse(settings.panel_public_url or "").hostname
    if not host:
        raise APIError(
            code="webauthn_rp_id_missing",
            message="WEBAUTHN_RP_ID or PANEL_PUBLIC_URL must be configured.",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return host


def _origin(settings: Settings) -> str:
    if settings.webauthn_origin:
        return settings.webauthn_origin.rstrip("/")
    base = (settings.panel_public_url or "").rstrip("/")
    if not base:
        raise APIError(
            code="webauthn_origin_missing",
            message="WEBAUTHN_ORIGIN or PANEL_PUBLIC_URL must be configured.",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return base


def _rp_name(settings: Settings) -> str:
    return settings.webauthn_rp_name or settings.app_name


def _import_webauthn():
    try:
        import webauthn
        from webauthn.helpers import base64url_to_bytes, bytes_to_base64url, options_to_json
        from webauthn.helpers.structs import (
            AuthenticatorSelectionCriteria,
            PublicKeyCredentialDescriptor,
            ResidentKeyRequirement,
            UserVerificationRequirement,
        )
    except ImportError as exc:  # pragma: no cover - depends on optional dependency.
        raise APIError(
            code="webauthn_unavailable",
            message="The WebAuthn dependency is not installed on the server.",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        ) from exc
    return {
        "webauthn": webauthn,
        "base64url_to_bytes": base64url_to_bytes,
        "bytes_to_base64url": bytes_to_base64url,
        "options_to_json": options_to_json,
        "AuthenticatorSelectionCriteria": AuthenticatorSelectionCriteria,
        "PublicKeyCredentialDescriptor": PublicKeyCredentialDescriptor,
        "ResidentKeyRequirement": ResidentKeyRequirement,
        "UserVerificationRequirement": UserVerificationRequirement,
    }


async def _store_challenge(
    session: AsyncSession,
    *,
    challenge_b64: str,
    kind: str,
    user_id: UUID | None,
    settings: Settings,
) -> WebAuthnChallenge:
    now = utc_now()
    record = WebAuthnChallenge(
        user_id=user_id,
        challenge=challenge_b64,
        kind=kind,
        created_at=now,
        expires_at=now + timedelta(seconds=settings.webauthn_challenge_ttl_seconds),
    )
    session.add(record)
    await session.flush()
    return record


async def _consume_challenge(
    session: AsyncSession,
    *,
    challenge_id: UUID,
    kind: str,
) -> WebAuthnChallenge:
    record = await session.get(WebAuthnChallenge, challenge_id)
    now = utc_now()
    if (
        record is None
        or record.kind != kind
        or record.used_at is not None
        or ensure_aware(record.expires_at) <= now
    ):
        raise APIError(
            code="webauthn_challenge_invalid",
            message="WebAuthn challenge is invalid, expired, or already used.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    record.used_at = now
    await session.flush()
    return record


async def start_registration(
    session: AsyncSession,
    *,
    user: User,
    settings: Settings,
) -> tuple[dict, UUID]:
    _require_enabled(settings)
    lib = _import_webauthn()
    existing = await list_credentials(session, user_id=user.id)
    exclude = [
        lib["PublicKeyCredentialDescriptor"](id=lib["base64url_to_bytes"](credential.credential_id))
        for credential in existing
    ]
    options = lib["webauthn"].generate_registration_options(
        rp_id=_rp_id(settings),
        rp_name=_rp_name(settings),
        user_id=str(user.id).encode("utf-8"),
        user_name=user.email,
        user_display_name=user.display_name or user.email,
        exclude_credentials=exclude,
        authenticator_selection=lib["AuthenticatorSelectionCriteria"](
            resident_key=lib["ResidentKeyRequirement"].PREFERRED,
            user_verification=lib["UserVerificationRequirement"].PREFERRED,
        ),
    )
    challenge_b64 = lib["bytes_to_base64url"](options.challenge)
    record = await _store_challenge(
        session,
        challenge_b64=challenge_b64,
        kind=REGISTER_KIND,
        user_id=user.id,
        settings=settings,
    )
    return json.loads(lib["options_to_json"](options)), record.id


async def finish_registration(
    session: AsyncSession,
    *,
    user: User,
    challenge_id: UUID,
    credential: dict,
    label: str | None,
    settings: Settings,
) -> WebAuthnCredential:
    _require_enabled(settings)
    lib = _import_webauthn()
    record = await _consume_challenge(session, challenge_id=challenge_id, kind=REGISTER_KIND)
    if record.user_id != user.id:
        raise APIError(
            code="webauthn_challenge_mismatch",
            message="WebAuthn challenge does not belong to this user.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    try:
        verification = lib["webauthn"].verify_registration_response(
            credential=json.dumps(credential),
            expected_challenge=lib["base64url_to_bytes"](record.challenge),
            expected_rp_id=_rp_id(settings),
            expected_origin=_origin(settings),
        )
    except Exception as exc:
        raise APIError(
            code="webauthn_registration_failed",
            message="WebAuthn registration could not be verified.",
            status_code=status.HTTP_400_BAD_REQUEST,
        ) from exc

    credential_id_b64 = lib["bytes_to_base64url"](verification.credential_id)
    duplicate = (
        await session.execute(
            select(WebAuthnCredential).where(
                WebAuthnCredential.credential_id == credential_id_b64
            )
        )
    ).scalar_one_or_none()
    if duplicate is not None:
        raise APIError(
            code="webauthn_credential_exists",
            message="This passkey is already registered.",
            status_code=status.HTTP_409_CONFLICT,
        )

    stored = WebAuthnCredential(
        user_id=user.id,
        credential_id=credential_id_b64,
        public_key=lib["bytes_to_base64url"](verification.credential_public_key),
        sign_count=verification.sign_count,
        transports=_extract_transports(credential),
        aaguid=str(getattr(verification, "aaguid", "")) or None,
        label=label,
    )
    session.add(stored)
    await session.flush()
    return stored


async def start_authentication(
    session: AsyncSession,
    *,
    email: str | None,
    settings: Settings,
) -> tuple[dict, UUID]:
    _require_enabled(settings)
    lib = _import_webauthn()
    user_id: UUID | None = None
    allow_credentials = []
    if email:
        user = (
            await session.execute(select(User).where(User.email == email.strip().lower()))
        ).scalar_one_or_none()
        if user is not None:
            user_id = user.id
            credentials = await list_credentials(session, user_id=user.id)
            allow_credentials = [
                lib["PublicKeyCredentialDescriptor"](
                    id=lib["base64url_to_bytes"](credential.credential_id)
                )
                for credential in credentials
            ]
    options = lib["webauthn"].generate_authentication_options(
        rp_id=_rp_id(settings),
        allow_credentials=allow_credentials or None,
        user_verification=lib["UserVerificationRequirement"].PREFERRED,
    )
    challenge_b64 = lib["bytes_to_base64url"](options.challenge)
    record = await _store_challenge(
        session,
        challenge_b64=challenge_b64,
        kind=AUTHENTICATE_KIND,
        user_id=user_id,
        settings=settings,
    )
    return json.loads(lib["options_to_json"](options)), record.id


async def finish_authentication(
    session: AsyncSession,
    *,
    challenge_id: UUID,
    credential: dict,
    settings: Settings,
) -> User:
    _require_enabled(settings)
    lib = _import_webauthn()
    record = await _consume_challenge(session, challenge_id=challenge_id, kind=AUTHENTICATE_KIND)

    raw_id = credential.get("id") or credential.get("rawId")
    if not raw_id:
        raise APIError(
            code="webauthn_credential_invalid",
            message="WebAuthn assertion is missing a credential id.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    stored = (
        await session.execute(
            select(WebAuthnCredential).where(WebAuthnCredential.credential_id == str(raw_id))
        )
    ).scalar_one_or_none()
    if stored is None:
        raise APIError(
            code="webauthn_credential_unknown",
            message="This passkey is not registered.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    if record.user_id is not None and record.user_id != stored.user_id:
        raise APIError(
            code="webauthn_credential_mismatch",
            message="Passkey does not match the requested account.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    try:
        verification = lib["webauthn"].verify_authentication_response(
            credential=json.dumps(credential),
            expected_challenge=lib["base64url_to_bytes"](record.challenge),
            expected_rp_id=_rp_id(settings),
            expected_origin=_origin(settings),
            credential_public_key=lib["base64url_to_bytes"](stored.public_key),
            credential_current_sign_count=stored.sign_count,
        )
    except Exception as exc:
        raise APIError(
            code="webauthn_authentication_failed",
            message="WebAuthn assertion could not be verified.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        ) from exc

    stored.sign_count = verification.new_sign_count
    stored.last_used_at = utc_now()
    await session.flush()

    user = await session.get(User, stored.user_id)
    if user is None or user.status != "active":
        raise APIError(
            code="webauthn_user_inactive",
            message="The passkey owner is not active.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    return user


async def list_credentials(
    session: AsyncSession,
    *,
    user_id: UUID,
) -> list[WebAuthnCredential]:
    result = await session.execute(
        select(WebAuthnCredential)
        .where(WebAuthnCredential.user_id == user_id)
        .order_by(WebAuthnCredential.created_at.desc())
    )
    return list(result.scalars().all())


async def remove_credential(
    session: AsyncSession,
    *,
    user_id: UUID,
    credential_pk: UUID,
) -> None:
    record = await session.get(WebAuthnCredential, credential_pk)
    if record is None or record.user_id != user_id:
        raise APIError(
            code="webauthn_credential_not_found",
            message="Passkey was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    await session.delete(record)
    await session.flush()


def _extract_transports(credential: dict) -> list[str]:
    response = credential.get("response")
    if isinstance(response, dict):
        transports = response.get("transports")
        if isinstance(transports, list):
            return [str(value) for value in transports]
    return []


def credential_to_response(credential: WebAuthnCredential) -> WebAuthnCredentialResponse:
    return WebAuthnCredentialResponse(
        id=credential.id,
        label=credential.label,
        aaguid=credential.aaguid,
        transports=credential.transports,
        sign_count=credential.sign_count,
        last_used_at=credential.last_used_at,
        created_at=credential.created_at,
    )
