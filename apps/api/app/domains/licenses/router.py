from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.licenses.models import License
from app.domains.licenses.schemas import (
    LicenseCreateRequest,
    LicenseListResponse,
    LicenseResponse,
    LicenseUpdateRequest,
)
from app.domains.licenses.service import (
    create_license as create_license_record,
)
from app.domains.licenses.service import (
    get_license as get_license_record,
)
from app.domains.licenses.service import (
    list_licenses as list_license_records,
)
from app.domains.licenses.service import (
    update_license as update_license_record,
)

router = APIRouter()
LicenseManager = Annotated[Principal, Depends(require_permission(Permission.LICENSE_MANAGE))]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]


def license_response(license_record: License) -> LicenseResponse:
    return LicenseResponse(
        id=license_record.id,
        customer_ref=license_record.customer_ref,
        status=license_record.status,
        max_devices=license_record.max_devices,
        starts_at=license_record.starts_at,
        expires_at=license_record.expires_at,
        metadata_json=license_record.metadata_json,
    )


@router.get("", response_model=LicenseListResponse)
async def list_licenses(
    _: LicenseManager,
    session: DatabaseSession,
) -> LicenseListResponse:
    licenses = await list_license_records(session)
    return LicenseListResponse(
        items=[license_response(license_record) for license_record in licenses]
    )


@router.post("", response_model=LicenseResponse, status_code=status.HTTP_201_CREATED)
async def create_license(
    request: LicenseCreateRequest,
    _: LicenseManager,
    session: DatabaseSession,
) -> LicenseResponse:
    license_record = await create_license_record(session, request=request)
    await session.commit()
    return license_response(license_record)


@router.get("/{license_id}", response_model=LicenseResponse)
async def get_license(
    license_id: UUID,
    _: LicenseManager,
    session: DatabaseSession,
) -> LicenseResponse:
    license_record = await get_license_record(session, license_id=license_id)
    return license_response(license_record)


@router.patch("/{license_id}", response_model=LicenseResponse)
async def update_license(
    license_id: UUID,
    request: LicenseUpdateRequest,
    _: LicenseManager,
    session: DatabaseSession,
) -> LicenseResponse:
    license_record = await update_license_record(
        session,
        license_id=license_id,
        request=request,
    )
    await session.commit()
    return license_response(license_record)
