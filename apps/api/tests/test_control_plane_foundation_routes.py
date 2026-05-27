from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.db.models  # noqa: F401
from app.core.config import Settings, get_settings
from app.core.rbac import Permission, Principal, Role, get_current_principal
from app.db.base import Base
from app.db.session import create_engine, get_db_session
from app.domains.audit.models import AuditEvent
from app.domains.auth.service import generate_totp_code
from app.domains.nodes.models import Node
from app.domains.nodes.service import hash_node_token
from app.domains.protocols.schemas import WILDCARD_BIND_ADDRESS
from app.domains.users.models import User
from app.main import create_app

NODE_TOKEN = "lumen_node_test_foundation"  # noqa: S105 - deterministic test token.


@dataclass(frozen=True)
class FoundationRouteApp:
    client: AsyncClient
    principal_ref: dict[str, Principal]
    sessionmaker: async_sessionmaker[AsyncSession]
    settings: Settings


@pytest.fixture
async def foundation_app(tmp_path) -> AsyncIterator[FoundationRouteApp]:
    settings = Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'api.db'}",
        node_token_hash_pepper=SecretStr("test-node-token-pepper"),
        session_hash_pepper=SecretStr("test-session-pepper"),
    )
    engine = create_engine(settings)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessionmaker = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

    async with sessionmaker() as session:
        user = User(
            email="owner@example.com",
            role=Role.OWNER.value,
            status="active",
        )
        node = Node(
            name="foundation-node",
            region="eu",
            public_address="203.0.113.80",
            status="active",
            capabilities={"runtime.xray": "true"},
            agent_token_prefix=NODE_TOKEN[:18],
            agent_token_hash=hash_node_token(NODE_TOKEN, settings),
        )
        session.add_all([user, node])
        await session.commit()
        principal = Principal(
            subject=str(user.id),
            email=user.email,
            roles={Role.OWNER},
            permissions=set(Permission),
        )

    async def override_db_session() -> AsyncIterator[AsyncSession]:
        async with sessionmaker() as session:
            yield session

    principal_ref = {"principal": principal}

    async def override_principal() -> Principal:
        return principal_ref["principal"]

    app = create_app(settings)
    app.dependency_overrides[get_db_session] = override_db_session
    app.dependency_overrides[get_current_principal] = override_principal
    app.dependency_overrides[get_settings] = lambda: settings

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        yield FoundationRouteApp(
            client=client,
            principal_ref=principal_ref,
            sessionmaker=sessionmaker,
            settings=settings,
        )

    app.dependency_overrides.clear()
    await engine.dispose()


async def seeded_node_id(foundation_app: FoundationRouteApp) -> str:
    async with foundation_app.sessionmaker() as session:
        node = (await session.execute(select(Node))).scalar_one()
        return str(node.id)


async def test_totp_mfa_setup_verify_and_list(foundation_app: FoundationRouteApp) -> None:
    setup_response = await foundation_app.client.post(
        "/api/v1/auth/mfa/totp/setup",
        json={"label": "Owner phone"},
    )
    assert setup_response.status_code == 201
    setup_body = setup_response.json()
    assert setup_body["status"] == "pending"
    assert setup_body["otpauth_url"].startswith("otpauth://totp/")

    verify_response = await foundation_app.client.post(
        "/api/v1/auth/mfa/totp/verify",
        json={
            "method_id": setup_body["method_id"],
            "code": generate_totp_code(setup_body["secret"]),
        },
    )
    assert verify_response.status_code == 200
    method = verify_response.json()["items"][0]
    assert method["kind"] == "totp"
    assert method["status"] == "active"
    assert method["confirmed_at"] is not None

    list_response = await foundation_app.client.get("/api/v1/auth/mfa/methods")
    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["label"] == "Owner phone"


async def test_settings_update_records_audit_event(foundation_app: FoundationRouteApp) -> None:
    update_response = await foundation_app.client.put(
        "/api/v1/settings/subscription.display",
        json={"value_json": {"title": "Lumen", "support_url": "https://support.example.test"}},
    )
    assert update_response.status_code == 200
    assert update_response.json()["value_json"]["title"] == "Lumen"

    list_response = await foundation_app.client.get("/api/v1/settings")
    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["key"] == "subscription.display"

    audit_response = await foundation_app.client.get("/api/v1/audit/events")
    assert audit_response.status_code == 200
    event = audit_response.json()["items"][0]
    assert event["action"] == "setting.updated"
    assert event["resource_id"] == "subscription.display"

    async with foundation_app.sessionmaker() as session:
        persisted_event = (await session.execute(select(AuditEvent))).scalar_one()
        assert persisted_event.actor_email == "owner@example.com"


async def test_protocol_profile_port_conflict_and_host_flow(
    foundation_app: FoundationRouteApp,
) -> None:
    node_id = await seeded_node_id(foundation_app)

    squad_response = await foundation_app.client.post(
        "/api/v1/squads",
        json={"name": "Default squad", "kind": "internal"},
    )
    assert squad_response.status_code == 201
    squad_id = squad_response.json()["id"]

    profile_response = await foundation_app.client.post(
        "/api/v1/profiles",
        json={
            "name": "Reality EU",
            "node_id": node_id,
            "squad_id": squad_id,
            "adapter": "vless-reality",
            "credentials_ref": "vault://protocols/reality-eu",
            "port_reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 443, "protocol": "tcp"}
            ],
        },
    )
    assert profile_response.status_code == 201
    profile_id = profile_response.json()["id"]

    conflict_response = await foundation_app.client.post(
        "/api/v1/protocols/port-check",
        json={
            "node_id": node_id,
            "reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 443, "protocol": "tcp"}
            ],
        },
    )
    assert conflict_response.status_code == 200
    conflict_body = conflict_response.json()
    assert conflict_body["allowed"] is False
    assert conflict_body["conflicts"][0]["suggested_port"] == 444

    blocked_response = await foundation_app.client.post(
        "/api/v1/profiles",
        json={
            "name": "Duplicate bind",
            "node_id": node_id,
            "adapter": "vless-tcp-tls",
            "port_reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 443, "protocol": "tcp"}
            ],
        },
    )
    assert blocked_response.status_code == 409
    assert blocked_response.json()["error"]["code"] == "protocol_port_conflict"

    host_response = await foundation_app.client.post(
        "/api/v1/hosts",
        json={
            "name": "Auto WiFi",
            "hostname": "auto.example.test",
            "node_id": node_id,
            "protocol_profile_id": profile_id,
            "squad_id": squad_id,
            "tags": ["auto-wifi"],
        },
    )
    assert host_response.status_code == 201
    assert host_response.json()["hostname"] == "auto.example.test"


async def test_node_command_queue_and_metrics(foundation_app: FoundationRouteApp) -> None:
    node_id = await seeded_node_id(foundation_app)

    command_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/commands",
        json={"command_type": "protocol.apply", "payload_json": {"profile_id": "demo"}},
    )
    assert command_response.status_code == 201
    command_id = command_response.json()["id"]

    claim_response = await foundation_app.client.get(
        f"/api/v1/nodes/{node_id}/commands/next",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
    )
    assert claim_response.status_code == 200
    assert claim_response.json()["status"] == "claimed"

    complete_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/commands/{command_id}/result",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
        json={"status": "succeeded", "result_json": {"applied_at": "now"}},
    )
    assert complete_response.status_code == 200
    assert complete_response.json()["completed_at"] is not None

    skipped_command_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/commands",
        json={"command_type": "outbound.apply", "payload_json": {"outbound_id": "demo"}},
    )
    assert skipped_command_response.status_code == 201
    skipped_command_id = skipped_command_response.json()["id"]

    skipped_claim_response = await foundation_app.client.get(
        f"/api/v1/nodes/{node_id}/commands/next",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
    )
    assert skipped_claim_response.status_code == 200

    skipped_complete_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/commands/{skipped_command_id}/result",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
        json={
            "status": "skipped",
            "result_json": {"reason": "node is paused"},
            "error_code": "command_not_allowed",
        },
    )
    assert skipped_complete_response.status_code == 200
    assert skipped_complete_response.json()["status"] == "skipped"

    empty_claim_response = await foundation_app.client.get(
        f"/api/v1/nodes/{node_id}/commands/next",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
    )
    assert empty_claim_response.status_code == 204

    metric_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/metrics",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
        json={
            "metric_kind": "runtime",
            "values_json": {"ram_mib": 256.0, "event_loop_ms": 20.1},
            "observed_at": datetime(2026, 5, 27, tzinfo=UTC).isoformat(),
        },
    )
    assert metric_response.status_code == 201

    list_metrics_response = await foundation_app.client.get(f"/api/v1/nodes/{node_id}/metrics")
    assert list_metrics_response.status_code == 200
    assert list_metrics_response.json()["items"][0]["values_json"]["ram_mib"] == 256.0


async def test_node_pause_resume_and_quarantine_enqueue_commands(
    foundation_app: FoundationRouteApp,
) -> None:
    node_id = await seeded_node_id(foundation_app)

    pause_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/pause",
        json={"reason": "license expired", "license_enforced": True},
    )
    assert pause_response.status_code == 200
    assert pause_response.json()["status"] == "license_paused"

    resume_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/resume",
        json={"target_status": "offline"},
    )
    assert resume_response.status_code == 200
    assert resume_response.json()["status"] == "offline"

    quarantine_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/quarantine",
        json={"reason": "unexpected config drift"},
    )
    assert quarantine_response.status_code == 200
    assert quarantine_response.json()["status"] == "quarantined"

    commands_response = await foundation_app.client.get(f"/api/v1/nodes/{node_id}/commands")
    assert commands_response.status_code == 200
    command_types = [item["command_type"] for item in commands_response.json()["items"]]
    assert command_types == ["node.quarantine", "node.resume", "node.pause"]


async def test_node_command_result_requires_claimed_command(
    foundation_app: FoundationRouteApp,
) -> None:
    node_id = await seeded_node_id(foundation_app)

    command_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/commands",
        json={"command_type": "node.pause", "payload_json": {"reason": "maintenance"}},
    )
    assert command_response.status_code == 201

    complete_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/commands/{command_response.json()['id']}/result",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
        json={"status": "succeeded", "result_json": {"mode": "paused"}},
    )

    assert complete_response.status_code == 409
    assert complete_response.json()["error"]["code"] == "node_command_not_claimed"
