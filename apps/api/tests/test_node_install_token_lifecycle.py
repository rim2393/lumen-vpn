from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.config import Settings
from app.core.errors import APIError
from app.db.base import Base
from app.db.models import Node, NodeInstallToken, NodeProvisioningJob
from app.db.session import create_engine
from app.domains.nodes.schemas import InstallTokenExchangeRequest
from app.domains.nodes.service import (
    exchange_install_token,
    hash_node_token,
    issue_install_token,
)


def _settings(database_url: str) -> Settings:
    return Settings(
        database_url=database_url,
        node_token_hash_pepper=SecretStr("test-node-token-pepper"),
    )


async def _create_expired_install_token(
    session,
    settings: Settings,
) -> tuple[NodeProvisioningJob, NodeInstallToken, str]:
    job_id = uuid4()
    node = Node(
        id=uuid4(),
        name="expired-token-node",
        region="test",
        public_address="127.0.0.1",
        status="provisioning",
    )
    job = NodeProvisioningJob(
        id=job_id,
        idempotency_key="expired-token-job",
        node_id=node.id,
        kind="node.provision",
        status="install_token_issued",
        preflight_status="passed",
        ssh_host="127.0.0.1",
        ssh_port=22,
        ssh_username="root",
        ssh_credentials_ref="secret-store://node/test",
        requested_capabilities={},
        preflight_result={},
        token_issued_at=datetime(2026, 6, 13, tzinfo=UTC) - timedelta(hours=1),
    )
    plaintext = "lumen_it_expired_test_token"
    token = NodeInstallToken(
        provisioning_job_id=job_id,
        token_prefix=plaintext[:18],
        token_hash=hash_node_token(plaintext, settings),
        expires_at=datetime(2026, 6, 13, tzinfo=UTC) - timedelta(minutes=1),
    )
    session.add_all([node, job, token])
    await session.flush()
    return job, token, plaintext


@pytest.mark.asyncio
async def test_issue_install_token_marks_expired_existing_token_failed(tmp_path):
    settings = _settings(f"sqlite+aiosqlite:///{tmp_path / 'api.db'}")
    engine = create_engine(settings)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    sessionmaker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    try:
        async with sessionmaker() as session:
            job, token, _ = await _create_expired_install_token(session, settings)

            with pytest.raises(APIError) as error:
                await issue_install_token(session, job_id=job.id, settings=settings)

            assert error.value.code == "install_token_expired"
            assert job.status == "failed"
            assert job.error_code == "install_token_expired"
            assert token.used_at is not None
            node = await session.get(Node, job.node_id)
            assert node is not None
            assert node.status == "failed"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_exchange_install_token_marks_expired_token_failed(tmp_path):
    settings = _settings(f"sqlite+aiosqlite:///{tmp_path / 'api.db'}")
    engine = create_engine(settings)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    sessionmaker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    try:
        async with sessionmaker() as session:
            job, token, plaintext = await _create_expired_install_token(session, settings)

            with pytest.raises(APIError) as error:
                await exchange_install_token(
                    session,
                    request=InstallTokenExchangeRequest(install_token=SecretStr(plaintext)),
                    settings=settings,
                )

            assert error.value.code == "invalid_install_token"
            assert job.status == "failed"
            assert job.error_code == "install_token_expired"
            assert token.used_at is not None
            node = await session.get(Node, job.node_id)
            assert node is not None
            assert node.status == "failed"
    finally:
        await engine.dispose()
