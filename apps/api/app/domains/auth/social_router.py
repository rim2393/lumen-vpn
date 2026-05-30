from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.rbac import Principal, get_current_principal
from app.db.session import get_db_session
from app.domains.auth import oauth as oauth_flow
from app.domains.auth import webauthn_service
from app.domains.auth.router import _set_session_cookies
from app.domains.auth.schemas import LoginResponse, TokenPairResponse
from app.domains.auth.social_schemas import (
    LinkedIdentityListResponse,
    OAuthProviderListResponse,
    OAuthStartResponse,
    TelegramLoginRequest,
    WebAuthnAuthenticateOptionsRequest,
    WebAuthnAuthenticateVerifyRequest,
    WebAuthnCredentialListResponse,
    WebAuthnCredentialResponse,
    WebAuthnOptionsResponse,
    WebAuthnRegisterVerifyRequest,
)
from app.domains.auth.social_service import (
    find_or_link_oauth_user,
    identity_to_response,
    issue_login_response,
    list_identities,
    remove_identity,
)
from app.domains.auth.telegram import resolve_telegram_user

router = APIRouter()
CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def _principal_user_id(principal: Principal) -> UUID:
    return UUID(principal.subject)


def _set_cookies_if_token_pair(
    response: Response,
    *,
    login_response: LoginResponse,
    settings: Settings,
) -> None:
    if isinstance(login_response, TokenPairResponse):
        _set_session_cookies(response, token_pair=login_response, settings=settings)


# -- provider discovery --------------------------------------------------------


@router.get("/providers", response_model=OAuthProviderListResponse)
async def list_oauth_providers(settings: AppSettings) -> OAuthProviderListResponse:
    return OAuthProviderListResponse(items=oauth_flow.provider_infos(settings))


# -- OAuth login flow ----------------------------------------------------------


@router.get("/oauth/{provider}/start", response_model=OAuthStartResponse)
async def start_oauth_login(
    provider: str,
    session: DbSession,
    settings: AppSettings,
    redirect: Annotated[str | None, Query()] = None,
) -> OAuthStartResponse:
    result = await oauth_flow.begin_oauth(
        session,
        provider=provider,
        settings=settings,
        client_redirect=redirect,
        link_user_id=None,
    )
    await session.commit()
    return result


@router.get("/oauth/{provider}/callback", response_model=None)
async def oauth_callback(
    provider: str,
    response: Response,
    session: DbSession,
    settings: AppSettings,
    code: Annotated[str, Query()],
    state: Annotated[str, Query()],
):
    profile, login_state = await oauth_flow.consume_oauth_callback(
        session,
        provider=provider,
        code=code,
        state=state,
        settings=settings,
    )
    user = await find_or_link_oauth_user(
        session,
        provider=provider,
        subject=profile.subject,
        email=profile.email,
        email_verified=profile.email_verified,
        display_name=profile.display_name,
        profile=profile.raw,
        settings=settings,
        link_user_id=login_state.link_user_id,
    )

    if login_state.link_user_id is not None:
        await session.commit()
        if login_state.client_redirect:
            return RedirectResponse(
                login_state.client_redirect, status_code=status.HTTP_303_SEE_OTHER
            )
        return {"status": "linked", "provider": provider}

    login_response = await issue_login_response(session, user=user, settings=settings)
    await session.commit()

    if login_state.client_redirect:
        redirect_response = RedirectResponse(
            login_state.client_redirect,
            status_code=status.HTTP_303_SEE_OTHER,
        )
        _set_cookies_if_token_pair(
            redirect_response, login_response=login_response, settings=settings
        )
        return redirect_response

    _set_cookies_if_token_pair(response, login_response=login_response, settings=settings)
    return login_response


# -- OAuth account linking (authenticated) -------------------------------------


@router.post("/identities/oauth/{provider}/link/start", response_model=OAuthStartResponse)
async def start_oauth_link(
    provider: str,
    principal: CurrentPrincipal,
    session: DbSession,
    settings: AppSettings,
    redirect: Annotated[str | None, Query()] = None,
) -> OAuthStartResponse:
    result = await oauth_flow.begin_oauth(
        session,
        provider=provider,
        settings=settings,
        client_redirect=redirect,
        link_user_id=_principal_user_id(principal),
    )
    await session.commit()
    return result


@router.get("/identities", response_model=LinkedIdentityListResponse)
async def list_linked_identities(
    principal: CurrentPrincipal,
    session: DbSession,
) -> LinkedIdentityListResponse:
    identities = await list_identities(session, user_id=_principal_user_id(principal))
    return LinkedIdentityListResponse(
        items=[identity_to_response(identity) for identity in identities]
    )


@router.delete("/identities/{identity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_identity(
    identity_id: UUID,
    principal: CurrentPrincipal,
    session: DbSession,
) -> None:
    await remove_identity(session, user_id=_principal_user_id(principal), identity_id=identity_id)
    await session.commit()


# -- Telegram login widget -----------------------------------------------------


@router.post("/oauth/telegram/callback", response_model=LoginResponse)
async def telegram_login(
    request: TelegramLoginRequest,
    response: Response,
    session: DbSession,
    settings: AppSettings,
) -> LoginResponse:
    user = await resolve_telegram_user(
        session,
        payload=request,
        settings=settings,
        link_user_id=None,
    )
    login_response = await issue_login_response(session, user=user, settings=settings)
    await session.commit()
    _set_cookies_if_token_pair(response, login_response=login_response, settings=settings)
    return login_response


@router.post("/identities/telegram/link", status_code=status.HTTP_204_NO_CONTENT)
async def telegram_link(
    request: TelegramLoginRequest,
    principal: CurrentPrincipal,
    session: DbSession,
    settings: AppSettings,
) -> None:
    await resolve_telegram_user(
        session,
        payload=request,
        settings=settings,
        link_user_id=_principal_user_id(principal),
    )
    await session.commit()


# -- WebAuthn / passkeys -------------------------------------------------------


@router.post("/webauthn/register/options", response_model=WebAuthnOptionsResponse)
async def webauthn_register_options(
    principal: CurrentPrincipal,
    session: DbSession,
    settings: AppSettings,
) -> WebAuthnOptionsResponse:
    from app.domains.users.service import get_user

    user = await get_user(session, _principal_user_id(principal))
    options, challenge_id = await webauthn_service.start_registration(
        session, user=user, settings=settings
    )
    await session.commit()
    return WebAuthnOptionsResponse(options=options, challenge_id=challenge_id)


@router.post(
    "/webauthn/register/verify",
    response_model=WebAuthnCredentialResponse,
    status_code=status.HTTP_201_CREATED,
)
async def webauthn_register_verify(
    request: WebAuthnRegisterVerifyRequest,
    principal: CurrentPrincipal,
    session: DbSession,
    settings: AppSettings,
) -> WebAuthnCredentialResponse:
    from app.domains.users.service import get_user

    user = await get_user(session, _principal_user_id(principal))
    credential = await webauthn_service.finish_registration(
        session,
        user=user,
        challenge_id=request.challenge_id,
        credential=request.credential,
        label=request.label,
        settings=settings,
    )
    await session.commit()
    return webauthn_service.credential_to_response(credential)


@router.post("/webauthn/authenticate/options", response_model=WebAuthnOptionsResponse)
async def webauthn_authenticate_options(
    request: WebAuthnAuthenticateOptionsRequest,
    session: DbSession,
    settings: AppSettings,
) -> WebAuthnOptionsResponse:
    options, challenge_id = await webauthn_service.start_authentication(
        session, email=request.email, settings=settings
    )
    await session.commit()
    return WebAuthnOptionsResponse(options=options, challenge_id=challenge_id)


@router.post("/webauthn/authenticate/verify", response_model=LoginResponse)
async def webauthn_authenticate_verify(
    request: WebAuthnAuthenticateVerifyRequest,
    response: Response,
    session: DbSession,
    settings: AppSettings,
) -> LoginResponse:
    user = await webauthn_service.finish_authentication(
        session,
        challenge_id=request.challenge_id,
        credential=request.credential,
        settings=settings,
    )
    login_response = await issue_login_response(
        session, user=user, settings=settings, enforce_mfa=False
    )
    await session.commit()
    _set_cookies_if_token_pair(response, login_response=login_response, settings=settings)
    return login_response


@router.get("/webauthn/credentials", response_model=WebAuthnCredentialListResponse)
async def webauthn_list_credentials(
    principal: CurrentPrincipal,
    session: DbSession,
) -> WebAuthnCredentialListResponse:
    credentials = await webauthn_service.list_credentials(
        session, user_id=_principal_user_id(principal)
    )
    return WebAuthnCredentialListResponse(
        items=[webauthn_service.credential_to_response(item) for item in credentials]
    )


@router.delete("/webauthn/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
async def webauthn_delete_credential(
    credential_id: UUID,
    principal: CurrentPrincipal,
    session: DbSession,
) -> None:
    await webauthn_service.remove_credential(
        session, user_id=_principal_user_id(principal), credential_pk=credential_id
    )
    await session.commit()
