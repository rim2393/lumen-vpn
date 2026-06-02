from collections.abc import AsyncIterator

import pytest
from pydantic import SecretStr, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.db.models  # noqa: F401
from app.core.config import Settings
from app.core.errors import APIError
from app.db.base import Base
from app.db.session import create_engine, create_sessionmaker
from app.domains.nodes.models import Node, NodeInstallToken, NodeProvisioningJob
from app.domains.nodes.schemas import (
    InstallTokenExchangeRequest,
    NodeCommandCreateRequest,
    NodeHeartbeatRequest,
    NodeStatus,
    PreflightStatus,
    PreflightUpdateRequest,
    ProvisioningJobCreateRequest,
    SSHCredentialReference,
)
from app.domains.nodes.service import (
    create_provisioning_job,
    ensure_supported_node_command,
    exchange_install_token,
    issue_install_token,
    record_node_heartbeat,
    update_preflight_state,
)


@pytest.fixture
async def db_session(tmp_path) -> AsyncIterator[tuple[AsyncSession, Settings]]:
    settings = Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'api.db'}",
        node_token_hash_pepper=SecretStr("test-node-token-pepper"),
    )
    engine = create_engine(settings)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    sessionmaker = create_sessionmaker(settings)
    async with sessionmaker() as session:
        yield session, settings

    await engine.dispose()


def build_job_request(
    *,
    idempotency_key: str = "provision-node-001",
) -> ProvisioningJobCreateRequest:
    return ProvisioningJobCreateRequest(
        idempotency_key=idempotency_key,
        node={
            "name": "edge-1",
            "region": "eu",
            "public_address": "203.0.113.10",
        },
        ssh={
            "host": "203.0.113.10",
            "port": 22,
            "username": "root",
            "credentials_ref": "vault://lumen/nodes/edge-1/ssh",
        },
        requested_capabilities={"service_manager": "systemd"},
    )


def test_outbound_apply_accepts_openvpn_live_payload() -> None:
    ensure_supported_node_command(
        NodeCommandCreateRequest(
            command_type="outbound.apply",
            payload_json={
                "adapter": "openvpn-udp",
                "openvpnConfig": {
                    "listen_port": 1194,
                    "proto": "udp",
                    "network": "10.88.0.0/24",
                    "pki": {
                        "ca_cert": "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
                        "server_cert": (
                            "-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----"
                        ),
                        "server_key": (
                            "-----BEGIN PRIVATE KEY-----\nserver\n-----END PRIVATE KEY-----"
                        ),
                    },
                    "users": [{"username": "lumen_sub_live", "password": "pass"}],
                },
            },
        )
    )


def test_outbound_apply_accepts_openvpn_shadowsocks_live_payload() -> None:
    ensure_supported_node_command(
        NodeCommandCreateRequest(
            command_type="outbound.apply",
            payload_json={
                "adapter": "openvpn-shadowsocks",
                "openvpnShadowsocksConfig": {
                    "openvpn": {
                        "listen_port": 24194,
                        "proto": "tcp-server",
                        "local_address": "127.0.0.1",
                        "network": "10.89.0.0/24",
                        "pki": {
                            "ca_cert": "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
                            "server_cert": (
                                "-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----"
                            ),
                            "server_key": (
                                "-----BEGIN PRIVATE KEY-----\nserver\n-----END PRIVATE KEY-----"
                            ),
                        },
                        "users": [{"username": "lumen_sub_live", "password": "pass"}],
                    },
                    "shadowsocks": {
                        "listen_port": 28443,
                        "method": "aes-256-gcm",
                        "password": "pass",
                    },
                },
            },
        )
    )


def test_outbound_apply_accepts_wireguard_native_live_payload() -> None:
    ensure_supported_node_command(
        NodeCommandCreateRequest(
            command_type="outbound.apply",
            payload_json={
                "adapter": "wireguard-native",
                "wireguardConfig": {
                    "interface": {
                        "private_key": "server-private-key",
                        "address": "10.66.0.1/24",
                        "listen_port": 51820,
                    },
                    "peers": [{"public_key": "client-public-key", "allowed_ips": "10.66.0.2/32"}],
                },
            },
        )
    )


def test_outbound_apply_accepts_amneziawg_live_payload() -> None:
    ensure_supported_node_command(
        NodeCommandCreateRequest(
            command_type="outbound.apply",
            payload_json={
                "adapter": "wireguard-amneziawg",
                "wireguardReloadMode": "awg-quick",
                "wireguardConfig": {
                    "interface": {
                        "private_key": "server-private-key",
                        "address": "10.77.0.1/24",
                        "listen_port": 51821,
                        "Jc": 4,
                        "S1": 60,
                    },
                    "peers": [{"public_key": "client-public-key", "allowed_ips": "10.77.0.2/32"}],
                },
            },
        )
    )


async def test_create_provisioning_job_is_idempotent_and_stores_credential_reference_only(
    db_session: tuple[AsyncSession, Settings],
) -> None:
    session, settings = db_session
    request = build_job_request()

    created = await create_provisioning_job(session, request=request, settings=settings)
    repeated = await create_provisioning_job(session, request=request, settings=settings)

    assert repeated.id == created.id
    assert created.status == "queued"
    assert created.preflight_status == "pending"
    assert created.ssh_credentials_ref == "vault://lumen/nodes/edge-1/ssh"

    nodes = (await session.execute(select(Node))).scalars().all()
    jobs = (await session.execute(select(NodeProvisioningJob))).scalars().all()
    assert len(nodes) == 1
    assert len(jobs) == 1
    assert "password" not in vars(created)
    assert "private_key" not in vars(created)


async def test_create_provisioning_job_rejects_inline_secret_like_fields(
    db_session: tuple[AsyncSession, Settings],
) -> None:
    session, settings = db_session

    with pytest.raises(ValidationError):
        SSHCredentialReference.model_validate(
            {
                "host": "203.0.113.10",
                "username": "root",
                "credentials_ref": "vault://lumen/nodes/edge-1/ssh",
                "password": "plaintext",
            }
        )

    with pytest.raises(APIError) as secret_error:
        await create_provisioning_job(
            session,
            request=ProvisioningJobCreateRequest(
                idempotency_key="provision-node-002",
                node={
                    "name": "edge-2",
                    "region": "eu",
                    "public_address": "203.0.113.11",
                },
                ssh={
                    "host": "203.0.113.11",
                    "port": 22,
                    "username": "root",
                    "credentials_ref": "vault://lumen/nodes/edge-2/ssh",
                },
                requested_capabilities={"admin_password": "plaintext"},
            ),
            settings=settings,
        )

    assert secret_error.value.code == "inline_secret_rejected"
    assert secret_error.value.status_code == 422


async def test_install_token_exchange_is_one_time_and_heartbeat_updates_node(
    db_session: tuple[AsyncSession, Settings],
) -> None:
    session, settings = db_session
    job = await create_provisioning_job(session, request=build_job_request(), settings=settings)

    with pytest.raises(APIError) as preflight_error:
        await issue_install_token(session, job_id=job.id, settings=settings)
    assert preflight_error.value.code == "preflight_not_passed"

    await update_preflight_state(
        session,
        job_id=job.id,
        request=PreflightUpdateRequest(
            status=PreflightStatus.PASSED,
            checks={"ssh": "ok", "ports": "ok"},
        ),
    )
    issued = await issue_install_token(session, job_id=job.id, settings=settings)

    assert issued.plaintext.startswith("lumen_it_")
    persisted_install_token = (await session.execute(select(NodeInstallToken))).scalar_one()
    assert persisted_install_token.token_hash != issued.plaintext
    assert persisted_install_token.token_prefix == issued.plaintext[:18]

    exchanged = await exchange_install_token(
        session,
        request=InstallTokenExchangeRequest(install_token=SecretStr(issued.plaintext)),
        settings=settings,
    )
    assert exchanged.node_token.startswith("lumen_node_")
    assert exchanged.node.agent_token_hash != exchanged.node_token
    assert exchanged.job.status == "installing"

    with pytest.raises(APIError) as reused_error:
        await exchange_install_token(
            session,
            request=InstallTokenExchangeRequest(install_token=SecretStr(issued.plaintext)),
            settings=settings,
        )
    assert reused_error.value.code == "invalid_install_token"
    assert reused_error.value.status_code == 401

    node = await record_node_heartbeat(
        session,
        node_id=exchanged.node.id,
        node_token=SecretStr(exchanged.node_token),
        request=NodeHeartbeatRequest(
            status=NodeStatus.ACTIVE,
            capabilities={"service_manager": "systemd", "tun": "available"},
        ),
        settings=settings,
    )
    assert node.status == "active"
    assert node.last_seen_at is not None
    assert node.capabilities["tun"] == "available"
    assert exchanged.job.status == "active"

    with pytest.raises(APIError) as heartbeat_error:
        await record_node_heartbeat(
            session,
            node_id=exchanged.node.id,
            node_token=SecretStr("wrong"),
            request=NodeHeartbeatRequest(),
            settings=settings,
        )
    assert heartbeat_error.value.code == "invalid_node_token"


async def test_heartbeat_cannot_clear_license_pause(
    db_session: tuple[AsyncSession, Settings],
) -> None:
    session, settings = db_session
    job = await create_provisioning_job(session, request=build_job_request(), settings=settings)
    await update_preflight_state(
        session,
        job_id=job.id,
        request=PreflightUpdateRequest(status=PreflightStatus.PASSED, checks={"ssh": "ok"}),
    )
    issued = await issue_install_token(session, job_id=job.id, settings=settings)
    exchanged = await exchange_install_token(
        session,
        request=InstallTokenExchangeRequest(install_token=SecretStr(issued.plaintext)),
        settings=settings,
    )
    exchanged.node.status = NodeStatus.LICENSE_PAUSED.value

    node = await record_node_heartbeat(
        session,
        node_id=exchanged.node.id,
        node_token=SecretStr(exchanged.node_token),
        request=NodeHeartbeatRequest(
            status=NodeStatus.ACTIVE,
            capabilities={"service_manager": "systemd"},
        ),
        settings=settings,
    )

    assert node.status == NodeStatus.LICENSE_PAUSED.value
    assert node.last_seen_at is not None
