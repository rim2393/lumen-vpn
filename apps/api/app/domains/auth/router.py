from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.rbac import Principal, get_current_principal
from app.db.session import get_db_session
from app.domains.auth.schemas import (
    LoginRequest,
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
    verify_totp_method,
)

router = APIRouter()
CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]


@router.post("/login", response_model=TokenPairResponse)
async def login(
    request: LoginRequest,
    session: DbSession,
    settings: AppSettings,
) -> TokenPairResponse:
    token_pair = await login_user(session, request=request, settings=settings)
    await session.commit()
    return token_pair


@router.post("/refresh", response_model=TokenPairResponse)
async def refresh(
    request: RefreshRequest,
    session: DbSession,
    settings: AppSettings,
) -> TokenPairResponse:
    token_pair = await refresh_session(
        session,
        refresh_token=request.refresh_token,
        settings=settings,
    )
    await session.commit()
    return token_pair


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    principal: CurrentPrincipal,
    session: DbSession,
) -> Response:
    if principal.session_id is not None:
        await revoke_session(session, session_id=principal.session_id)
        await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
