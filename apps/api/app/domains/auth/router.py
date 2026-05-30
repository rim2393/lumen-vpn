from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response, status
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.rbac import Principal, get_current_principal
from app.db.session import get_db_session
from app.domains.auth.schemas import (
    LoginRequest,
    LoginResponse,
    MfaChallengeVerifyRequest,
    MfaMethodListResponse,
    PrincipalResponse,
    RefreshRequest,
    TokenPairResponse,
    TotpSetupRequest,
    TotpSetupResponse,
    TotpVerifyRequest,
)
from app.domains.auth.service import (
    list_mfa_methods,
    login_user,
    mfa_method_response,
    refresh_session,
    revoke_session,
    setup_totp_method,
    verify_mfa_challenge,
    verify_totp_method,
)

router = APIRouter()
CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]
ACCESS_COOKIE_NAME = "lumen_access_token"
REFRESH_COOKIE_NAME = "lumen_refresh_token"


@router.post("/login", response_model=LoginResponse)
async def login(
    request: LoginRequest,
    response: Response,
    session: DbSession,
    settings: AppSettings,
) -> LoginResponse:
    token_pair = await login_user(session, request=request, settings=settings)
    await session.commit()
    if isinstance(token_pair, TokenPairResponse):
        _set_session_cookies(response, token_pair=token_pair, settings=settings)
    return token_pair


@router.post("/mfa/challenge/verify", response_model=TokenPairResponse)
async def verify_mfa_login_challenge(
    request: MfaChallengeVerifyRequest,
    response: Response,
    session: DbSession,
    settings: AppSettings,
) -> TokenPairResponse:
    token_pair = await verify_mfa_challenge(
        session,
        challenge_token=request.challenge_token,
        method_id=request.method_id,
        code=request.code,
        settings=settings,
    )
    await session.commit()
    _set_session_cookies(response, token_pair=token_pair, settings=settings)
    return token_pair


@router.post("/refresh", response_model=TokenPairResponse)
async def refresh(
    response: Response,
    session: DbSession,
    settings: AppSettings,
    request: RefreshRequest | None = None,
    refresh_cookie: Annotated[str | None, Cookie(alias=REFRESH_COOKIE_NAME)] = None,
) -> TokenPairResponse:
    refresh_token = request.refresh_token if request is not None else None
    if refresh_token is None and refresh_cookie is not None:
        refresh_token = SecretStr(refresh_cookie)
    if refresh_token is None:
        from app.core.errors import APIError

        raise APIError(
            code="refresh_token_required",
            message="Refresh token is required.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    token_pair = await refresh_session(
        session,
        refresh_token=refresh_token,
        settings=settings,
    )
    await session.commit()
    _set_session_cookies(response, token_pair=token_pair, settings=settings)
    return token_pair


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    principal: CurrentPrincipal,
    session: DbSession,
    response: Response,
) -> Response:
    if principal.session_id is not None:
        await revoke_session(session, session_id=principal.session_id)
        await session.commit()
    _clear_session_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=PrincipalResponse)
async def me(principal: CurrentPrincipal) -> PrincipalResponse:
    return PrincipalResponse(
        subject=principal.subject,
        email=principal.email,
        roles=principal.roles,
        permissions=principal.permissions,
    )


@router.get("/mfa/methods", response_model=MfaMethodListResponse)
async def list_my_mfa_methods(
    principal: CurrentPrincipal,
    session: DbSession,
) -> MfaMethodListResponse:
    methods = await list_mfa_methods(session, user_id=_principal_user_id(principal))
    return MfaMethodListResponse(items=[mfa_method_response(method) for method in methods])


@router.post(
    "/mfa/totp/setup",
    response_model=TotpSetupResponse,
    status_code=status.HTTP_201_CREATED,
)
async def setup_totp(
    request: TotpSetupRequest,
    principal: CurrentPrincipal,
    session: DbSession,
    settings: AppSettings,
) -> TotpSetupResponse:
    method, secret = await setup_totp_method(
        session,
        user_id=_principal_user_id(principal),
        label=request.label,
        settings=settings,
    )
    await session.commit()
    issuer = settings.app_name.replace(" ", "%20")
    account = (principal.email or principal.subject).replace(" ", "%20")
    return TotpSetupResponse(
        method_id=method.id,
        secret=secret,
        otpauth_url=(
            f"otpauth://totp/{issuer}:{account}?secret={secret}&issuer={issuer}&digits=6&period=30"
        ),
        status="pending",
    )


@router.post("/mfa/totp/verify", response_model=MfaMethodListResponse)
async def verify_totp(
    request: TotpVerifyRequest,
    principal: CurrentPrincipal,
    session: DbSession,
    settings: AppSettings,
) -> MfaMethodListResponse:
    await verify_totp_method(
        session,
        user_id=_principal_user_id(principal),
        method_id=request.method_id,
        code=request.code,
        settings=settings,
    )
    await session.commit()
    methods = await list_mfa_methods(session, user_id=_principal_user_id(principal))
    return MfaMethodListResponse(items=[mfa_method_response(method) for method in methods])


def _principal_user_id(principal: Principal):
    from uuid import UUID

    return UUID(principal.subject)


def _set_session_cookies(
    response: Response,
    *,
    token_pair: TokenPairResponse,
    settings: Settings,
) -> None:
    cookie_options = {
        "httponly": True,
        "path": "/",
        "samesite": "lax",
        "secure": settings.environment != "development",
    }
    response.set_cookie(
        ACCESS_COOKIE_NAME,
        token_pair.access_token,
        max_age=settings.access_token_ttl_seconds,
        **cookie_options,
    )
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        token_pair.refresh_token,
        max_age=settings.refresh_token_ttl_seconds,
        **cookie_options,
    )


def _clear_session_cookies(response: Response) -> None:
    for cookie_name in (ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME):
        response.delete_cookie(cookie_name, path="/", samesite="lax")
