from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import status
from pydantic import SecretStr
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import APIError
from app.core.security import (
    constant_time_equal,
    generate_opaque_token,
    hmac_sha256,
    require_secret,
)
from app.domains.audit.models import AuditEvent
from app.domains.infra_billing.models import InfraBillingRecord, InfraProvider
from app.domains.licenses.service import enforce_free_node_policy
from app.domains.nodes.models import (
    Node,
    NodeCommand,
    NodeInstallToken,
    NodeMetric,
    NodeProvisioningJob,
)
from app.domains.nodes.schemas import (
    InstallTokenExchangeRequest,
    NodeBulkActionRequest,
    NodeCommandCreateRequest,
    NodeCommandHistoryRecord,
    NodeCommandResultRequest,
    NodeCommandStatusCount,
    NodeCreateRequest,
    NodeEventCreateRequest,
    NodeHeartbeatRequest,
    NodeInfraBillingCurrencyTotal,
    NodeInfraBillingRecord,
    NodeLatestMetricRecord,
    NodeMetricCreateRequest,
    NodeOverviewResponse,
    NodePauseRequest,
    NodeQuarantineRequest,
    NodeReorderRequest,
    NodeResumeRequest,
    NodeStatus,
    NodeTrafficSummary,
    NodeUpdateRequest,
    PreflightStatus,
    PreflightUpdateRequest,
    ProvisioningJobCreateRequest,
    ProvisioningJobStatus,
)

INSTALL_TOKEN_PREFIX = "lumen_it"  # noqa: S105 - public token prefix, not secret material.
NODE_TOKEN_PREFIX = "lumen_node"  # noqa: S105 - public token prefix, not secret material.
TOKEN_PUBLIC_PREFIX_LENGTH = 18
SECRET_FIELD_FRAGMENTS = frozenset(
    {
        "password",
        "private_key",
        "privatekey",
        "secret",
        "token",
        "subscription_url",
        "runtime_config",
    }
)
DOWNLOAD_BYTE_KEYS = frozenset(
    {
        "download_bytes",
        "rx_bytes",
        "bytes_received",
        "inbound_bytes",
        "downlink_bytes",
    }
)
UPLOAD_BYTE_KEYS = frozenset(
    {
        "upload_bytes",
        "tx_bytes",
        "bytes_sent",
        "outbound_bytes",
        "uplink_bytes",
    }
)
SUPPORTED_NODE_COMMAND_TYPES = frozenset(
    {
        "capabilities.report",
        "conflict.scan",
        "desired-state.apply",
        "desired-state.validate",
        "firewall.plan.apply",
        "node.connections.drop",
        "node.pause",
        "node.quarantine",
        "node.resume",
        "node.restart",
        "node.traffic.reset",
        "outbound.apply",
        "outbound.remove",
    }
)


@dataclass(frozen=True)
class IssuedInstallToken:
    token: NodeInstallToken
    plaintext: str


@dataclass(frozen=True)
class ExchangedInstallToken:
    job: NodeProvisioningJob
    node: Node
    node_token: str


def utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def token_public_prefix(token: str) -> str:
    return token[:TOKEN_PUBLIC_PREFIX_LENGTH]


def hash_node_token(token: str, settings: Settings) -> str:
    pepper = settings.node_token_hash_pepper
    require_secret(pepper, name="node_token_hash_pepper")
    return hmac_sha256(token, pepper)


def generate_node_token(*, prefix: str, settings: Settings) -> tuple[str, str, str]:
    plaintext = generate_opaque_token(prefix=prefix)
    return plaintext, token_public_prefix(plaintext), hash_node_token(plaintext, settings)


def ensure_no_inline_secret_keys(values: dict[str, str], *, field_name: str) -> None:
    for key in values:
        normalized = key.replace("-", "_").lower()
        if any(fragment in normalized for fragment in SECRET_FIELD_FRAGMENTS):
            raise APIError(
                code="inline_secret_rejected",
                message="Inline secret-like fields are not accepted for node provisioning.",
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                details=[f"{field_name}.{key}"],
            )


def ensure_supported_node_command(request: NodeCommandCreateRequest) -> None:
    if request.command_type not in SUPPORTED_NODE_COMMAND_TYPES:
        raise APIError(
            code="node_command_not_supported",
            message="Node command type is not supported by the live node-agent.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=[request.command_type],
        )
    if request.command_type == "outbound.apply":
        adapter = request.payload_json.get("adapter")
        has_live_payload = (
            isinstance(request.payload_json.get("xrayConfig"), dict)
            or isinstance(request.payload_json.get("hysteria2Config"), dict)
            or isinstance(request.payload_json.get("naiveConfig"), dict)
            or isinstance(request.payload_json.get("openvpnConfig"), dict)
            or isinstance(request.payload_json.get("openvpnShadowsocksConfig"), dict)
            or isinstance(request.payload_json.get("singBoxShadowsocksConfig"), dict)
            or isinstance(request.payload_json.get("shadowsocksPluginConfig"), dict)
            or isinstance(request.payload_json.get("tuicConfig"), dict)
            or isinstance(request.payload_json.get("wireguardConfig"), dict)
            or adapter == "tcp-diagnostic-listener"
        )
        if not has_live_payload:
            raise APIError(
                code="node_command_payload_not_live",
                message=(
                    "outbound.apply requires a live Xray, Hysteria2, NaiveProxy, OpenVPN, "
                    "OpenVPN-over-Shadowsocks, TUIC, or WireGuard config, managed "
                    "sing-box Shadowsocks config, managed Shadowsocks plugin config, "
                    "or a tcp diagnostic listener payload."
                ),
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                details=[
                    "payload_json.xrayConfig",
                    "payload_json.naiveConfig",
                    "payload_json.openvpnConfig",
                    "payload_json.openvpnShadowsocksConfig",
                    "payload_json.singBoxShadowsocksConfig",
                    "payload_json.shadowsocksPluginConfig",
                ],
            )


def _set_pending_control_action(node: Node, command: NodeCommand) -> None:
    capabilities = dict(node.capabilities)
    capabilities["pending_control_command_id"] = str(command.id)
    capabilities["pending_control_command_type"] = command.command_type
    target_status = command.payload_json.get("status") or command.payload_json.get(
        "target_status"
    )
    if target_status:
        capabilities["pending_control_target_status"] = str(target_status)
    node.capabilities = capabilities


def _clear_pending_control_action(node: Node, command: NodeCommand) -> None:
    capabilities = dict(node.capabilities)
    if capabilities.get("pending_control_command_id") == str(command.id):
        for key in (
            "pending_control_command_id",
            "pending_control_command_type",
            "pending_control_target_status",
        ):
            capabilities.pop(key, None)
    node.capabilities = capabilities


def _apply_completed_control_action(node: Node, command: NodeCommand) -> None:
    if node.status == NodeStatus.DELETED.value:
        _clear_pending_control_action(node, command)
        return
    if command.command_type == "node.pause":
        target = command.payload_json.get("status") or NodeStatus.PAUSED.value
        node.status = str(target)
    elif command.command_type == "node.resume":
        target = command.payload_json.get("target_status") or NodeStatus.OFFLINE.value
        node.status = str(target)
    elif command.command_type == "node.quarantine":
        node.status = NodeStatus.QUARANTINED.value
    elif command.command_type == "node.restart":
        node.status = NodeStatus.OFFLINE.value
    _clear_pending_control_action(node, command)


async def get_provisioning_job(
    session: AsyncSession,
    *,
    job_id: UUID,
) -> NodeProvisioningJob:
    job = await session.get(NodeProvisioningJob, job_id)
    if job is None:
        raise APIError(
            code="provisioning_job_not_found",
            message="Provisioning job was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return job


async def create_provisioning_job(
    session: AsyncSession,
    *,
    request: ProvisioningJobCreateRequest,
    settings: Settings,
) -> NodeProvisioningJob:
    ensure_no_inline_secret_keys(
        request.requested_capabilities,
        field_name="requested_capabilities",
    )

    existing_job = (
        await session.execute(
            select(NodeProvisioningJob).where(
                NodeProvisioningJob.idempotency_key == request.idempotency_key
            )
        )
    ).scalar_one_or_none()
    if existing_job is not None:
        return existing_job

    existing_node = (
        await session.execute(select(Node).where(Node.name == request.node.name))
    ).scalar_one_or_none()
    if existing_node is not None:
        raise APIError(
            code="node_name_exists",
            message="A node with this name already exists.",
            status_code=status.HTTP_409_CONFLICT,
        )

    await enforce_free_node_policy(session, settings)
    node = Node(
        name=request.node.name,
        region=request.node.region,
        public_address=request.node.public_address,
        status=NodeStatus.PROVISIONING.value,
        capabilities=request.requested_capabilities,
    )
    session.add(node)
    await session.flush()

    job = NodeProvisioningJob(
        idempotency_key=request.idempotency_key,
        node_id=node.id,
        kind=request.kind.value,
        status=ProvisioningJobStatus.QUEUED.value,
        preflight_status=PreflightStatus.PENDING.value,
        ssh_host=request.ssh.host,
        ssh_port=request.ssh.port,
        ssh_username=request.ssh.username,
        ssh_credentials_ref=request.ssh.credentials_ref,
        requested_capabilities=request.requested_capabilities,
        preflight_result={},
    )
    session.add(job)
    await session.flush()
    return job


async def list_nodes(session: AsyncSession) -> list[Node]:
    return list(
        (
            await session.execute(
                select(Node)
                .where(Node.status != NodeStatus.DELETED.value)
                .order_by(Node.sort_order.asc(), Node.created_at.desc())
            )
        ).scalars()
    )


def _node_response(node: Node):
    from app.domains.nodes.schemas import NodeResponse

    return NodeResponse(
        id=node.id,
        name=node.name,
        region=node.region,
        public_address=node.public_address,
        status=node.status,
        sort_order=node.sort_order,
        capabilities=node.capabilities,
        last_seen_at=node.last_seen_at,
    )


def _sum_first_matching(values: dict[str, float], keys: frozenset[str]) -> float | None:
    normalized = {key.lower(): value for key, value in values.items()}
    for key in keys:
        value = normalized.get(key)
        if value is not None:
            return float(value)
    return None


def _traffic_summary(metrics: list[NodeMetric]) -> NodeTrafficSummary:
    download_total = 0.0
    upload_total = 0.0
    has_download = False
    has_upload = False
    last_observed_at = metrics[0].observed_at if metrics else None

    for metric in metrics:
        download_value = _sum_first_matching(metric.values_json, DOWNLOAD_BYTE_KEYS)
        if download_value is not None:
            download_total += download_value
            has_download = True
        upload_value = _sum_first_matching(metric.values_json, UPLOAD_BYTE_KEYS)
        if upload_value is not None:
            upload_total += upload_value
            has_upload = True

    download_bytes = download_total if has_download else None
    upload_bytes = upload_total if has_upload else None
    total_bytes = (
        (download_bytes or 0.0) + (upload_bytes or 0.0)
        if has_download or has_upload
        else None
    )
    return NodeTrafficSummary(
        download_bytes=download_bytes,
        upload_bytes=upload_bytes,
        total_bytes=total_bytes,
        metric_samples=len(metrics),
        last_observed_at=last_observed_at,
    )


async def get_node_overview(session: AsyncSession, *, node_id: UUID) -> NodeOverviewResponse:
    node = await get_node(session, node_id=node_id)
    metrics = list(
        (
            await session.execute(
                select(NodeMetric)
                .where(NodeMetric.node_id == node_id)
                .order_by(NodeMetric.observed_at.desc())
                .limit(500)
            )
        ).scalars()
    )
    latest_by_kind: dict[str, NodeMetric] = {}
    for metric in metrics:
        latest_by_kind.setdefault(metric.metric_kind, metric)

    command_count_rows = (
        await session.execute(
            select(NodeCommand.status, func.count(NodeCommand.id))
            .where(NodeCommand.node_id == node_id)
            .group_by(NodeCommand.status)
        )
    ).all()
    latest_commands = list(
        (
            await session.execute(
                select(NodeCommand)
                .where(NodeCommand.node_id == node_id)
                .order_by(NodeCommand.created_at.desc())
                .limit(10)
            )
        ).scalars()
    )
    billing_rows = (
        await session.execute(
            select(InfraBillingRecord, InfraProvider.name)
            .join(InfraProvider, InfraBillingRecord.provider_id == InfraProvider.id)
            .where(InfraBillingRecord.node_id == node_id)
            .order_by(InfraBillingRecord.period.desc(), InfraBillingRecord.created_at.desc())
        )
    ).all()

    totals_by_currency: dict[str, NodeInfraBillingCurrencyTotal] = {}
    billing_records: list[NodeInfraBillingRecord] = []
    for record, provider_name in billing_rows:
        billing_records.append(
            NodeInfraBillingRecord(
                id=record.id,
                provider_id=record.provider_id,
                provider_name=provider_name,
                amount=record.amount,
                currency=record.currency,
                period=record.period,
                note=record.note,
            )
        )
        current = totals_by_currency.get(record.currency)
        if current is None:
            totals_by_currency[record.currency] = NodeInfraBillingCurrencyTotal(
                currency=record.currency,
                total=float(record.amount),
                records=1,
            )
        else:
            current.total += float(record.amount)
            current.records += 1

    return NodeOverviewResponse(
        node=_node_response(node),
        latest_metrics=[
            NodeLatestMetricRecord(
                metric_kind=metric.metric_kind,
                values_json=metric.values_json,
                observed_at=metric.observed_at,
            )
            for metric in latest_by_kind.values()
        ],
        traffic=_traffic_summary(metrics),
        command_status_counts=[
            NodeCommandStatusCount(status=status, count=int(count))
            for status, count in command_count_rows
        ],
        latest_commands=[
            NodeCommandHistoryRecord(
                id=command.id,
                command_type=command.command_type,
                status=command.status,
                error_code=command.error_code,
                claimed_at=command.claimed_at,
                completed_at=command.completed_at,
                created_at=command.created_at,
            )
            for command in latest_commands
        ],
        infra_billing_records=billing_records,
        infra_billing_totals=list(totals_by_currency.values()),
    )


async def get_node(session: AsyncSession, *, node_id: UUID) -> Node:
    node = await session.get(Node, node_id)
    if node is None:
        raise APIError(
            code="node_not_found",
            message="Node was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return node


async def create_manual_node(
    session: AsyncSession,
    *,
    request: NodeCreateRequest,
    settings: Settings,
) -> Node:
    ensure_no_inline_secret_keys(request.capabilities, field_name="capabilities")
    existing_node = (
        await session.execute(select(Node).where(Node.name == request.name))
    ).scalar_one_or_none()
    if existing_node is not None:
        raise APIError(
            code="node_name_exists",
            message="A node with this name already exists.",
            status_code=status.HTTP_409_CONFLICT,
        )

    await enforce_free_node_policy(session, settings)
    node = Node(
        name=request.name,
        region=request.region,
        public_address=request.public_address,
        status=NodeStatus.OFFLINE.value,
        sort_order=request.sort_order,
        capabilities=request.capabilities,
    )
    session.add(node)
    await session.flush()
    return node


async def update_node(
    session: AsyncSession,
    *,
    node_id: UUID,
    request: NodeUpdateRequest,
) -> Node:
    node = await get_node(session, node_id=node_id)
    data = request.model_dump(exclude_unset=True)
    if "capabilities" in data and data["capabilities"] is not None:
        ensure_no_inline_secret_keys(data["capabilities"], field_name="capabilities")
    if "name" in data and data["name"] != node.name:
        existing = (
            await session.execute(select(Node).where(Node.name == data["name"]))
        ).scalar_one_or_none()
        if existing is not None and existing.id != node.id:
            raise APIError(
                code="node_name_exists",
                message="A node with this name already exists.",
                status_code=status.HTTP_409_CONFLICT,
            )
    for field, value in data.items():
        if value is not None:
            if field == "status" and isinstance(value, NodeStatus):
                value = value.value
            setattr(node, field, value)
    await session.flush()
    return node


async def reorder_nodes(
    session: AsyncSession,
    *,
    request: NodeReorderRequest,
) -> list[Node]:
    node_ids = [item.id for item in request.items]
    nodes_by_id = {
        node.id: node
        for node in (await session.execute(select(Node).where(Node.id.in_(node_ids))))
        .scalars()
        .all()
    }
    missing = [str(item.id) for item in request.items if item.id not in nodes_by_id]
    if missing:
        raise APIError(
            code="node_not_found",
            message="One or more nodes were not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details=missing,
        )
    for item in request.items:
        nodes_by_id[item.id].sort_order = item.sort_order
    await session.flush()
    return await list_nodes(session)


async def delete_node(session: AsyncSession, *, node_id: UUID, reason: str | None = None) -> Node:
    node = await get_node(session, node_id=node_id)
    if node.status != NodeStatus.DELETED.value:
        command = await enqueue_node_command(
            session,
            node_id=node_id,
            request=NodeCommandCreateRequest(
                command_type="node.pause",
                payload_json={
                    "status": NodeStatus.PAUSED.value,
                    "reason": reason or "operator deleted node",
                    "deleteRequested": True,
                },
            ),
        )
        _set_pending_control_action(node, command)
    node.status = NodeStatus.DELETED.value
    await session.flush()
    return node


async def restart_node(
    session: AsyncSession,
    *,
    node_id: UUID,
    reason: str | None = None,
) -> NodeCommand:
    node = await get_node(session, node_id=node_id)
    command = await enqueue_node_command(
        session,
        node_id=node_id,
        request=NodeCommandCreateRequest(
            command_type="node.restart",
            payload_json={"reason": reason or "operator requested restart"},
        ),
    )
    _set_pending_control_action(node, command)
    await session.flush()
    return command


async def reset_node_traffic(
    session: AsyncSession,
    *,
    node_id: UUID,
    reason: str | None = None,
) -> NodeCommand:
    await get_node(session, node_id=node_id)
    await session.execute(delete(NodeMetric).where(NodeMetric.node_id == node_id))
    command = await enqueue_node_command(
        session,
        node_id=node_id,
        request=NodeCommandCreateRequest(
            command_type="node.traffic.reset",
            payload_json={"reason": reason or "operator reset node traffic counters"},
        ),
    )
    await session.flush()
    return command


async def bulk_node_action(
    session: AsyncSession,
    *,
    request: NodeBulkActionRequest,
) -> list[Node]:
    affected: list[Node] = []
    for node_id in request.ids:
        if request.action == "enable":
            affected.append(
                await update_node(
                    session,
                    node_id=node_id,
                    request=NodeUpdateRequest(status=NodeStatus.OFFLINE),
                )
            )
        elif request.action == "disable":
            affected.append(
                await pause_node(
                    session,
                    node_id=node_id,
                    request=NodePauseRequest(reason=request.reason),
                )
            )
        elif request.action == "pause":
            affected.append(
                await pause_node(
                    session,
                    node_id=node_id,
                    request=NodePauseRequest(reason=request.reason),
                )
            )
        elif request.action == "resume":
            affected.append(
                await resume_node(
                    session,
                    node_id=node_id,
                    request=NodeResumeRequest(
                        target_status=request.target_status or NodeStatus.OFFLINE,
                    ),
                )
            )
        elif request.action == "quarantine":
            affected.append(
                await quarantine_node(
                    session,
                    node_id=node_id,
                    request=NodeQuarantineRequest(
                        reason=request.reason or "operator bulk quarantine",
                    ),
                )
            )
        elif request.action == "restart":
            await restart_node(session, node_id=node_id, reason=request.reason)
            affected.append(await get_node(session, node_id=node_id))
        elif request.action == "reset_traffic":
            await reset_node_traffic(session, node_id=node_id, reason=request.reason)
            affected.append(await get_node(session, node_id=node_id))
        elif request.action == "delete":
            affected.append(await delete_node(session, node_id=node_id, reason=request.reason))
    await session.flush()
    return affected


async def update_preflight_state(
    session: AsyncSession,
    *,
    job_id: UUID,
    request: PreflightUpdateRequest,
) -> NodeProvisioningJob:
    ensure_no_inline_secret_keys(request.checks, field_name="checks")
    job = await get_provisioning_job(session, job_id=job_id)
    job.preflight_status = request.status.value
    job.preflight_result = request.checks
    job.error_code = request.error_code
    job.error_message = request.error_message

    if request.status == PreflightStatus.RUNNING:
        job.status = ProvisioningJobStatus.PREFLIGHT_RUNNING.value
    elif request.status == PreflightStatus.PASSED:
        job.status = ProvisioningJobStatus.PREFLIGHT_PASSED.value
        job.error_code = None
        job.error_message = None
    elif request.status == PreflightStatus.FAILED:
        job.status = ProvisioningJobStatus.FAILED.value
        node = await session.get(Node, job.node_id)
        if node is not None:
            node.status = NodeStatus.FAILED.value
    else:
        job.status = ProvisioningJobStatus.QUEUED.value

    await session.flush()
    return job


async def issue_install_token(
    session: AsyncSession,
    *,
    job_id: UUID,
    settings: Settings,
) -> IssuedInstallToken:
    job = await get_provisioning_job(session, job_id=job_id)
    if job.preflight_status != PreflightStatus.PASSED.value:
        raise APIError(
            code="preflight_not_passed",
            message="Install tokens can only be issued after preflight passes.",
            status_code=status.HTTP_409_CONFLICT,
        )

    existing_token = (
        await session.execute(
            select(NodeInstallToken).where(NodeInstallToken.provisioning_job_id == job.id)
        )
    ).scalar_one_or_none()
    if existing_token is not None:
        raise APIError(
            code="install_token_already_issued",
            message="Install token plaintext is only returned once.",
            status_code=status.HTTP_409_CONFLICT,
        )

    plaintext, token_prefix, token_hash = generate_node_token(
        prefix=INSTALL_TOKEN_PREFIX,
        settings=settings,
    )
    now = utc_now()
    install_token = NodeInstallToken(
        provisioning_job_id=job.id,
        token_prefix=token_prefix,
        token_hash=token_hash,
        expires_at=now + timedelta(seconds=settings.node_install_token_ttl_seconds),
    )
    session.add(install_token)
    job.status = ProvisioningJobStatus.INSTALL_TOKEN_ISSUED.value
    job.token_issued_at = now
    await session.flush()
    return IssuedInstallToken(token=install_token, plaintext=plaintext)


async def exchange_install_token(
    session: AsyncSession,
    *,
    request: InstallTokenExchangeRequest,
    settings: Settings,
) -> ExchangedInstallToken:
    plaintext = request.install_token.get_secret_value()
    token_hash = hash_node_token(plaintext, settings)
    install_token = (
        await session.execute(
            select(NodeInstallToken).where(NodeInstallToken.token_hash == token_hash)
        )
    ).scalar_one_or_none()
    now = utc_now()

    if (
        install_token is None
        or install_token.used_at is not None
        or ensure_aware(install_token.expires_at) <= now
    ):
        raise APIError(
            code="invalid_install_token",
            message="Install token is invalid, expired, or already used.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    job = await get_provisioning_job(session, job_id=install_token.provisioning_job_id)
    node = await session.get(Node, job.node_id)
    if node is None:
        raise APIError(
            code="node_not_found",
            message="Provisioning job node was not found.",
            status_code=status.HTTP_409_CONFLICT,
        )

    node_token, node_token_prefix, node_token_hash = generate_node_token(
        prefix=NODE_TOKEN_PREFIX,
        settings=settings,
    )
    install_token.used_at = now
    job.status = ProvisioningJobStatus.INSTALLING.value
    job.token_exchanged_at = now
    node.status = NodeStatus.INSTALLING.value
    node.enrolled_at = now
    node.agent_token_prefix = node_token_prefix
    node.agent_token_hash = node_token_hash
    await session.flush()
    return ExchangedInstallToken(job=job, node=node, node_token=node_token)


async def record_node_heartbeat(
    session: AsyncSession,
    *,
    node_id: UUID,
    node_token: SecretStr,
    request: NodeHeartbeatRequest,
    settings: Settings,
) -> Node:
    node = await session.get(Node, node_id)
    supplied_hash = hash_node_token(node_token.get_secret_value(), settings)
    if (
        node is None
        or node.agent_token_hash is None
        or not constant_time_equal(supplied_hash, node.agent_token_hash)
    ):
        raise APIError(
            code="invalid_node_token",
            message="Node token is invalid.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    now = utc_now()
    previous_status = NodeStatus(node.status)
    enforced_statuses = {
        NodeStatus.DELETED,
        NodeStatus.PAUSED,
        NodeStatus.LICENSE_PAUSED,
        NodeStatus.QUARANTINED,
    }
    if previous_status in enforced_statuses and request.status != previous_status:
        node.status = previous_status.value
    else:
        node.status = request.status.value
    node.capabilities = request.capabilities
    node.last_seen_at = now

    latest_job = (
        (
            await session.execute(
                select(NodeProvisioningJob)
                .where(NodeProvisioningJob.node_id == node.id)
                .order_by(NodeProvisioningJob.created_at.desc())
            )
        )
        .scalars()
        .first()
    )
    if latest_job is not None and NodeStatus(node.status) == NodeStatus.ACTIVE:
        latest_job.status = ProvisioningJobStatus.ACTIVE.value

    await session.flush()
    return node


async def authenticate_node_token(
    session: AsyncSession,
    *,
    node_id: UUID,
    node_token: SecretStr,
    settings: Settings,
) -> Node:
    node = await session.get(Node, node_id)
    supplied_hash = hash_node_token(node_token.get_secret_value(), settings)
    if (
        node is None
        or node.agent_token_hash is None
        or not constant_time_equal(supplied_hash, node.agent_token_hash)
    ):
        raise APIError(
            code="invalid_node_token",
            message="Node token is invalid.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    return node


async def enqueue_node_command(
    session: AsyncSession,
    *,
    node_id: UUID,
    request: NodeCommandCreateRequest,
) -> NodeCommand:
    await get_node(session, node_id=node_id)
    ensure_no_inline_secret_keys(request.payload_json, field_name="payload_json")
    ensure_supported_node_command(request)
    command = NodeCommand(
        node_id=node_id,
        command_type=request.command_type,
        status="queued",
        payload_json=request.payload_json,
    )
    session.add(command)
    await session.flush()
    return command


async def pause_node(
    session: AsyncSession,
    *,
    node_id: UUID,
    request: NodePauseRequest,
) -> Node:
    node = await get_node(session, node_id=node_id)
    status_value = (
        NodeStatus.LICENSE_PAUSED.value if request.license_enforced else NodeStatus.PAUSED.value
    )
    command = await enqueue_node_command(
        session,
        node_id=node_id,
        request=NodeCommandCreateRequest(
            command_type="node.pause",
            payload_json={
                "status": status_value,
                "reason": request.reason or "",
                "license_enforced": request.license_enforced,
            },
        ),
    )
    _set_pending_control_action(node, command)
    await session.flush()
    return node


async def resume_node(
    session: AsyncSession,
    *,
    node_id: UUID,
    request: NodeResumeRequest,
) -> Node:
    node = await get_node(session, node_id=node_id)
    if request.target_status in {
        NodeStatus.PAUSED,
        NodeStatus.LICENSE_PAUSED,
        NodeStatus.QUARANTINED,
    }:
        raise APIError(
            code="invalid_resume_target_status",
            message="Resume target status must be an operational node status.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    command = await enqueue_node_command(
        session,
        node_id=node_id,
        request=NodeCommandCreateRequest(
            command_type="node.resume",
            payload_json={
                "target_status": request.target_status.value,
                "clearQuarantine": request.clear_quarantine,
            },
        ),
    )
    _set_pending_control_action(node, command)
    await session.flush()
    return node


async def quarantine_node(
    session: AsyncSession,
    *,
    node_id: UUID,
    request: NodeQuarantineRequest,
) -> Node:
    node = await get_node(session, node_id=node_id)
    command = await enqueue_node_command(
        session,
        node_id=node_id,
        request=NodeCommandCreateRequest(
            command_type="node.quarantine",
            payload_json={"reason": request.reason},
        ),
    )
    _set_pending_control_action(node, command)
    await session.flush()
    return node


async def list_node_commands(session: AsyncSession, *, node_id: UUID) -> list[NodeCommand]:
    await get_node(session, node_id=node_id)
    result = await session.execute(
        select(NodeCommand)
        .where(NodeCommand.node_id == node_id)
        .order_by(NodeCommand.created_at.desc())
    )
    return list(result.scalars().all())


async def claim_next_node_command(
    session: AsyncSession,
    *,
    node_id: UUID,
    node_token: SecretStr,
    settings: Settings,
) -> NodeCommand | None:
    await authenticate_node_token(
        session,
        node_id=node_id,
        node_token=node_token,
        settings=settings,
    )
    result = await session.execute(
        select(NodeCommand)
        .where(NodeCommand.node_id == node_id)
        .where(NodeCommand.status == "queued")
        .order_by(NodeCommand.created_at.asc())
        .limit(1)
    )
    command = result.scalar_one_or_none()
    if command is None:
        return None
    command.status = "claimed"
    command.claimed_at = utc_now()
    await session.flush()
    return command


async def complete_node_command(
    session: AsyncSession,
    *,
    node_id: UUID,
    command_id: UUID,
    node_token: SecretStr,
    request: NodeCommandResultRequest,
    settings: Settings,
) -> NodeCommand:
    await authenticate_node_token(
        session,
        node_id=node_id,
        node_token=node_token,
        settings=settings,
    )
    command = await session.get(NodeCommand, command_id)
    if command is None or command.node_id != node_id:
        raise APIError(
            code="node_command_not_found",
            message="Node command was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    if command.status != "claimed":
        raise APIError(
            code="node_command_not_claimed",
            message="Node command must be claimed before it can be completed.",
            status_code=status.HTTP_409_CONFLICT,
        )
    _reject_dry_run_success(command=command, request=request)
    command.status = request.status
    command.result_json = request.result_json
    command.error_code = request.error_code
    command.error_message = request.error_message
    command.completed_at = utc_now()
    node = await session.get(Node, node_id)
    control_command_types = {"node.pause", "node.resume", "node.quarantine"}
    if node is not None and command.command_type in control_command_types:
        if request.status == "succeeded":
            _apply_completed_control_action(node, command)
        elif request.status == "failed":
            _clear_pending_control_action(node, command)
    if command.command_type == "outbound.apply":
        from app.domains.protocols.service import record_outbound_apply_result

        await record_outbound_apply_result(session, command=command)
    await session.flush()
    return command


def _reject_dry_run_success(
    *,
    command: NodeCommand,
    request: NodeCommandResultRequest,
) -> None:
    if request.status != "succeeded":
        return
    outputs = request.result_json.get("outputs")
    if not isinstance(outputs, dict):
        return
    implementation_status = str(outputs.get("implementationStatus") or "")
    dry_run = outputs.get("dryRun")
    is_dry_run_result = dry_run is True or implementation_status.endswith("-dry-run")
    if not is_dry_run_result:
        return
    raise APIError(
        code="node_command_dry_run_success_forbidden",
        message=(
            "Dry-run node command results cannot be completed as succeeded in "
            "production command history."
        ),
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        details=[command.command_type, implementation_status or "dryRun=true"],
    )


async def record_node_metric(
    session: AsyncSession,
    *,
    node_id: UUID,
    node_token: SecretStr,
    request: NodeMetricCreateRequest,
    settings: Settings,
) -> NodeMetric:
    await authenticate_node_token(
        session,
        node_id=node_id,
        node_token=node_token,
        settings=settings,
    )
    metric = NodeMetric(
        node_id=node_id,
        metric_kind=request.metric_kind,
        values_json=request.values_json,
        observed_at=request.observed_at or utc_now(),
    )
    session.add(metric)
    await session.flush()
    return metric


async def record_node_event(
    session: AsyncSession,
    *,
    node_id: UUID,
    node_token: SecretStr,
    request: NodeEventCreateRequest,
    settings: Settings,
) -> AuditEvent:
    await authenticate_node_token(
        session,
        node_id=node_id,
        node_token=node_token,
        settings=settings,
    )
    event = AuditEvent(
        actor_subject=f"node-agent:{node_id}",
        actor_email=None,
        action=request.action,
        resource_type=request.resource_type,
        resource_id=request.resource_id,
        metadata_json={
            **request.metadata_json,
            "node_id": str(node_id),
            "source": "node-agent",
        },
    )
    session.add(event)
    await session.flush()
    return event


async def list_node_metrics(
    session: AsyncSession,
    *,
    node_id: UUID,
    limit: int = 100,
) -> list[NodeMetric]:
    await get_node(session, node_id=node_id)
    result = await session.execute(
        select(NodeMetric)
        .where(NodeMetric.node_id == node_id)
        .order_by(NodeMetric.observed_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())
