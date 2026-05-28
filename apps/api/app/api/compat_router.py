from fastapi import APIRouter

from app.domains.admin_compat.router import router as admin_compat_router
from app.domains.api_keys.router import router as api_keys_router
from app.domains.protocols.router import hosts_router, profiles_router, squads_router
from app.domains.subscription_assets.router import response_rules_router, templates_router
from app.domains.tools.router import router as tools_router
from app.domains.users.router import router as users_router

compat_router = APIRouter()
compat_router.include_router(admin_compat_router, tags=["admin-compat"])
compat_router.include_router(users_router, prefix="/api/users", tags=["remna-users-compat"])
compat_router.include_router(hosts_router, prefix="/api/hosts", tags=["remna-hosts-compat"])
compat_router.include_router(
    profiles_router,
    prefix="/api/config-profiles",
    tags=["remna-config-profiles-compat"],
)
compat_router.include_router(
    squads_router,
    prefix="/api/internal-squads",
    tags=["remna-internal-squads-compat"],
)
compat_router.include_router(
    squads_router,
    prefix="/api/external-squads",
    tags=["remna-external-squads-compat"],
)
compat_router.include_router(api_keys_router, prefix="/api/tokens", tags=["remna-tokens-compat"])
compat_router.include_router(
    templates_router,
    prefix="/api/subscription-templates",
    tags=["remna-subscription-templates-compat"],
)
compat_router.include_router(
    response_rules_router,
    prefix="/api/response-rules",
    tags=["remna-response-rules-compat"],
)
compat_router.include_router(tools_router, prefix="/api/tools", tags=["remna-tools-compat"])
