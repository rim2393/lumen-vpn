import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.rbac import Role
from app.core.security import hash_password
from app.domains.users.models import User

logger = logging.getLogger(__name__)


async def bootstrap_first_admin(session: AsyncSession, settings: Settings) -> bool:
    email = (settings.first_admin_email or "").strip().lower()
    username = (settings.first_admin_username or "").strip() or None
    password = settings.first_admin_password
    if not email and password is None:
        return False
    if not email or password is None or not password.get_secret_value():
        logger.warning("FIRST_ADMIN_* bootstrap is incomplete; skipping first admin creation")
        return False

    existing_count = await session.scalar(select(func.count()).select_from(User))
    if existing_count and existing_count > 0:
        logger.info("first admin bootstrap skipped because users already exist")
        return False

    user = User(
        email=email,
        username=username,
        display_name=username or email,
        password_hash=hash_password(password),
        role=Role.OWNER.value,
        status="active",
    )
    session.add(user)
    await session.flush()
    logger.info("first admin bootstrap created owner account", extra={"admin_email": email})
    return True
