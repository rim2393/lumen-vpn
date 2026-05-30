import base64
import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import APIError
from app.core.security import require_secret
from app.domains.auth.models import OAuthLoginState
from app.domains.auth.social_schemas import OAuthProviderInfo, OAuthStartResponse

OAUTH_STATE_PREFIX = "lumen_os"  # public state prefix, not secret material.
HTTP_TIMEOUT_SECONDS = 10.0

# OIDC discovery documents are cached per issuer for the process lifetime.
_DISCOVERY_CACHE: dict[str, dict[str, str]] = {}


@dataclass(frozen=True)
class ResolvedProvider:
    name: str
    display_name: str
    kind: str  # "oauth2" | "oidc"
    client_id: str
    client_secret: str
    authorization_endpoint: str
    token_endpoint: str
    userinfo_endpoint: str | None
    scope: str
    use_pkce: bool
    emails_endpoint: str | None = None


@dataclass(frozen=True)
class OAuthProfile:
    subject: str
    email: str | None
    email_verified: bool
    display_name: str | None
    raw: dict[str, object]


def utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def provider_infos(settings: Settings) -> list[OAuthProviderInfo]:
    return [
        OAuthProviderInfo(
            provider="google",
            display_name="Google",
            kind="oidc",
            enabled=settings.google_oauth_enabled,
        ),
        OAuthProviderInfo(
            provider="github",
            display_name="GitHub",
            kind="oauth2",
            enabled=settings.github_oauth_enabled,
        ),
        OAuthProviderInfo(
            provider="keycloak",
            display_name="Keycloak",
            kind="oidc",
            enabled=settings.keycloak_oauth_enabled,
        ),
        OAuthProviderInfo(
            provider="pocketid",
            display_name="PocketID",
            kind="oidc",
            enabled=settings.pocketid_oauth_enabled,
        ),
        OAuthProviderInfo(
            provider="telegram",
            display_name="Telegram",
            kind="telegram",
            enabled=settings.telegram_login_enabled,
            bot_username=settings.telegram_bot_username,
        ),
        OAuthProviderInfo(
            provider="webauthn",
            display_name="Passkey",
            kind="webauthn",
            enabled=settings.webauthn_enabled,
        ),
    ]


def callback_redirect_uri(provider: str, settings: Settings) -> str:
    base = (settings.panel_public_url or "").rstrip("/")
    if not base:
        raise APIError(
            code="oauth_public_url_missing",
            message="PANEL_PUBLIC_URL must be configured to build OAuth redirect URIs.",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return f"{base}/api/v1/auth/oauth/{provider}/callback"


async def resolve_provider(provider: str, settings: Settings) -> ResolvedProvider:
    if provider == "google":
        _require_enabled(settings.google_oauth_enabled, provider)
        return ResolvedProvider(
            name="google",
            display_name="Google",
            kind="oidc",
            client_id=_require_value(settings.google_oauth_client_id, provider, "client_id"),
            client_secret=require_secret(
                settings.google_oauth_client_secret, name="google_oauth_client_secret"
            ),
            authorization_endpoint="https://accounts.google.com/o/oauth2/v2/auth",
            token_endpoint="https://oauth2.googleapis.com/token",  # noqa: S106 - public URL.
            userinfo_endpoint="https://openidconnect.googleapis.com/v1/userinfo",
            scope="openid email profile",
            use_pkce=True,
        )
    if provider == "github":
        _require_enabled(settings.github_oauth_enabled, provider)
        return ResolvedProvider(
            name="github",
            display_name="GitHub",
            kind="oauth2",
            client_id=_require_value(settings.github_oauth_client_id, provider, "client_id"),
            client_secret=require_secret(
                settings.github_oauth_client_secret, name="github_oauth_client_secret"
            ),
            authorization_endpoint="https://github.com/login/oauth/authorize",
            token_endpoint="https://github.com/login/oauth/access_token",  # noqa: S106 - URL.
            userinfo_endpoint="https://api.github.com/user",
            scope="read:user user:email",
            use_pkce=False,
            emails_endpoint="https://api.github.com/user/emails",
        )
    if provider in {"keycloak", "pocketid"}:
        return await _resolve_oidc_provider(provider, settings)
    raise APIError(
        code="oauth_provider_unknown",
        message="OAuth provider is not supported.",
        status_code=status.HTTP_404_NOT_FOUND,
        details=[provider],
    )


async def begin_oauth(
    session: AsyncSession,
    *,
    provider: str,
    settings: Settings,
    client_redirect: str | None,
    link_user_id: UUID | None,
) -> OAuthStartResponse:
    resolved = await resolve_provider(provider, settings)
    redirect_uri = callback_redirect_uri(provider, settings)
    state = f"{OAUTH_STATE_PREFIX}_{secrets.token_urlsafe(32)}"
    nonce = secrets.token_urlsafe(16)
    code_verifier = secrets.token_urlsafe(64)[:128] if resolved.use_pkce else None
    now = utc_now()

    session.add(
        OAuthLoginState(
            state=state,
            provider=provider,
            code_verifier=code_verifier,
            nonce=nonce,
            redirect_uri=redirect_uri,
            client_redirect=_safe_client_redirect(client_redirect),
            link_user_id=link_user_id,
            created_at=now,
            expires_at=now + timedelta(seconds=settings.oauth_state_ttl_seconds),
        )
    )
    await session.flush()

    params = {
        "client_id": resolved.client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": resolved.scope,
        "state": state,
    }
    if resolved.kind == "oidc":
        params["nonce"] = nonce
    if resolved.use_pkce and code_verifier is not None:
        params["code_challenge"] = _pkce_challenge(code_verifier)
        params["code_challenge_method"] = "S256"
    authorization_url = f"{resolved.authorization_endpoint}?{httpx.QueryParams(params)}"
    return OAuthStartResponse(provider=provider, authorization_url=authorization_url, state=state)


async def consume_oauth_callback(
    session: AsyncSession,
    *,
    provider: str,
    code: str,
    state: str,
    settings: Settings,
) -> tuple[OAuthProfile, OAuthLoginState]:
    login_state = (
        await session.execute(select(OAuthLoginState).where(OAuthLoginState.state == state))
    ).scalar_one_or_none()
    now = utc_now()
    if (
        login_state is None
        or login_state.used_at is not None
        or login_state.provider != provider
        or ensure_aware(login_state.expires_at) <= now
    ):
        raise APIError(
            code="oauth_state_invalid",
            message="OAuth state is invalid, expired, or already used.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    login_state.used_at = now
    await session.flush()

    resolved = await resolve_provider(provider, settings)
    access_token = await _exchange_code(
        resolved,
        code=code,
        redirect_uri=login_state.redirect_uri,
        code_verifier=login_state.code_verifier,
    )
    profile = await _fetch_profile(resolved, access_token=access_token)
    return profile, login_state


# -- internal helpers ----------------------------------------------------------


async def _resolve_oidc_provider(provider: str, settings: Settings) -> ResolvedProvider:
    if provider == "keycloak":
        _require_enabled(settings.keycloak_oauth_enabled, provider)
        issuer = _require_value(settings.keycloak_oauth_issuer, provider, "issuer")
        client_id = _require_value(settings.keycloak_oauth_client_id, provider, "client_id")
        client_secret = require_secret(
            settings.keycloak_oauth_client_secret, name="keycloak_oauth_client_secret"
        )
        display_name = "Keycloak"
    else:
        _require_enabled(settings.pocketid_oauth_enabled, provider)
        issuer = _require_value(settings.pocketid_oauth_issuer, provider, "issuer")
        client_id = _require_value(settings.pocketid_oauth_client_id, provider, "client_id")
        client_secret = require_secret(
            settings.pocketid_oauth_client_secret, name="pocketid_oauth_client_secret"
        )
        display_name = "PocketID"

    discovery = await _discover_oidc(issuer)
    return ResolvedProvider(
        name=provider,
        display_name=display_name,
        kind="oidc",
        client_id=client_id,
        client_secret=client_secret,
        authorization_endpoint=discovery["authorization_endpoint"],
        token_endpoint=discovery["token_endpoint"],
        userinfo_endpoint=discovery.get("userinfo_endpoint"),
        scope="openid email profile",
        use_pkce=True,
    )


async def _discover_oidc(issuer: str) -> dict[str, str]:
    normalized = issuer.rstrip("/")
    if normalized in _DISCOVERY_CACHE:
        return _DISCOVERY_CACHE[normalized]
    url = f"{normalized}/.well-known/openid-configuration"
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as http_client:
            response = await http_client.get(url)
            response.raise_for_status()
            document = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise APIError(
            code="oauth_discovery_failed",
            message="Could not load the OpenID Connect discovery document.",
            status_code=status.HTTP_502_BAD_GATEWAY,
        ) from exc
    if "authorization_endpoint" not in document or "token_endpoint" not in document:
        raise APIError(
            code="oauth_discovery_invalid",
            message="OpenID Connect discovery document is missing required endpoints.",
            status_code=status.HTTP_502_BAD_GATEWAY,
        )
    _DISCOVERY_CACHE[normalized] = document
    return document


async def _exchange_code(
    resolved: ResolvedProvider,
    *,
    code: str,
    redirect_uri: str,
    code_verifier: str | None,
) -> str:
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": resolved.client_id,
        "client_secret": resolved.client_secret,
    }
    if code_verifier:
        data["code_verifier"] = code_verifier
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as http_client:
            response = await http_client.post(
                resolved.token_endpoint,
                data=data,
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise APIError(
            code="oauth_token_exchange_failed",
            message="Failed to exchange the authorization code.",
            status_code=status.HTTP_502_BAD_GATEWAY,
        ) from exc
    access_token = payload.get("access_token")
    if not access_token:
        raise APIError(
            code="oauth_token_missing",
            message="The OAuth provider did not return an access token.",
            status_code=status.HTTP_502_BAD_GATEWAY,
        )
    return str(access_token)


async def _fetch_profile(resolved: ResolvedProvider, *, access_token: str) -> OAuthProfile:
    if resolved.userinfo_endpoint is None:
        raise APIError(
            code="oauth_userinfo_unavailable",
            message="The OAuth provider has no userinfo endpoint configured.",
            status_code=status.HTTP_502_BAD_GATEWAY,
        )
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as http_client:
            response = await http_client.get(resolved.userinfo_endpoint, headers=headers)
            response.raise_for_status()
            userinfo = response.json()
            if resolved.name == "github":
                email, email_verified = await _github_primary_email(
                    http_client, headers=headers, resolved=resolved, userinfo=userinfo
                )
            else:
                email = userinfo.get("email")
                email_verified = bool(userinfo.get("email_verified", False))
    except (httpx.HTTPError, ValueError) as exc:
        raise APIError(
            code="oauth_userinfo_failed",
            message="Failed to load the user profile from the OAuth provider.",
            status_code=status.HTTP_502_BAD_GATEWAY,
        ) from exc

    subject = _subject_from_userinfo(resolved, userinfo)
    display_name = (
        userinfo.get("name")
        or userinfo.get("preferred_username")
        or userinfo.get("login")
    )
    return OAuthProfile(
        subject=subject,
        email=str(email) if email else None,
        email_verified=email_verified,
        display_name=str(display_name) if display_name else None,
        raw=dict(userinfo),
    )


async def _github_primary_email(
    http_client: httpx.AsyncClient,
    *,
    headers: dict[str, str],
    resolved: ResolvedProvider,
    userinfo: dict[str, object],
) -> tuple[str | None, bool]:
    if resolved.emails_endpoint is None:
        return (userinfo.get("email"), False)  # type: ignore[return-value]
    response = await http_client.get(resolved.emails_endpoint, headers=headers)
    response.raise_for_status()
    emails = response.json()
    if isinstance(emails, list):
        for entry in emails:
            if isinstance(entry, dict) and entry.get("primary") and entry.get("verified"):
                return (str(entry.get("email")), True)
        for entry in emails:
            if isinstance(entry, dict) and entry.get("verified"):
                return (str(entry.get("email")), True)
    return (userinfo.get("email"), False)  # type: ignore[return-value]


def _subject_from_userinfo(resolved: ResolvedProvider, userinfo: dict[str, object]) -> str:
    subject = userinfo.get("sub") or userinfo.get("id")
    if subject is None:
        raise APIError(
            code="oauth_subject_missing",
            message="The OAuth provider did not return a stable subject identifier.",
            status_code=status.HTTP_502_BAD_GATEWAY,
        )
    return f"{resolved.name}:{subject}"


def _pkce_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _safe_client_redirect(client_redirect: str | None) -> str | None:
    """Only allow same-origin relative paths to prevent open-redirect abuse."""

    if not client_redirect:
        return None
    if client_redirect.startswith("/") and not client_redirect.startswith("//"):
        return client_redirect
    return None


def _require_enabled(enabled: bool, provider: str) -> None:
    if not enabled:
        raise APIError(
            code="oauth_provider_disabled",
            message="This OAuth provider is not enabled.",
            status_code=status.HTTP_404_NOT_FOUND,
            details=[provider],
        )


def _require_value(value: str | None, provider: str, field: str) -> str:
    if not value:
        raise APIError(
            code="oauth_provider_misconfigured",
            message=f"OAuth provider {provider} is missing required configuration: {field}.",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return value
