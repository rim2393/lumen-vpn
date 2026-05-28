from fastapi import APIRouter

from app.api.v1.routes.health import router as health_router
from app.domains.api_keys.router import router as api_keys_router
from app.domains.audit.router import router as audit_router
from app.domains.auth.router import router as auth_router
from app.domains.licenses.router import router as licenses_router
from app.domains.nodes.router import router as nodes_router
from app.domains.protocols.router import (
    hosts_router,
    profiles_router,
    protocols_router,
    squads_router,
)
from app.domains.settings.router import router as settings_router
from app.domains.subscription_assets.router import (
    response_rules_router,
    templates_router,
)
from app.domains.subscriptions.router import router as subscriptions_router
from app.domains.tools.router import router as tools_router
from app.domains.users.router import router as users_router

api_v1_router = APIRouter()
api_v1_router.include_router(health_router, tags=["health"])
api_v1_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_v1_router.include_router(users_router, prefix="/users", tags=["users"])
api_v1_router.include_router(api_keys_router, prefix="/api-keys", tags=["api-keys"])
api_v1_router.include_router(licenses_router, prefix="/licenses", tags=["licenses"])
api_v1_router.include_router(nodes_router, prefix="/nodes", tags=["nodes"])
api_v1_router.include_router(subscriptions_router, prefix="/subscriptions", tags=["subscriptions"])
api_v1_router.include_router(settings_router, prefix="/settings", tags=["settings"])
api_v1_router.include_router(
    templates_router,
    prefix="/subscription-templates",
    tags=["subscription-templates"],
)
api_v1_router.include_router(
    response_rules_router,
    prefix="/response-rules",
    tags=["response-rules"],
)
api_v1_router.include_router(audit_router, prefix="/audit", tags=["audit"])
api_v1_router.include_router(tools_router, prefix="/tools", tags=["tools"])
api_v1_router.include_router(protocols_router, prefix="/protocols", tags=["protocols"])
api_v1_router.include_router(profiles_router, prefix="/profiles", tags=["profiles"])
api_v1_router.include_router(hosts_router, prefix="/hosts", tags=["hosts"])
api_v1_router.include_router(squads_router, prefix="/squads", tags=["squads"])
