from fastapi import APIRouter

from app.domains.admin_compat.router import router as admin_compat_router

compat_router = APIRouter()
compat_router.include_router(admin_compat_router, tags=["admin-compat"])
