from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import status
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import APIError
from app.core.security import (
    constant_time_equal,
    generate_opaque_token,
    hmac_sha256,
    require_secret,
)
from app.domains.licenses.service import enforce_free_node_policy
from app.domains.nodes.models import Node, NodeInstallToken, NodeProvisioningJob
from app.domains.nodes.schemas import (
    InstallTokenExchangeRequest,
    NodeCreateRequest,
    NodeHeartbeatRequest,
    NodeStatus,
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
    return list((await session.execute(select(Node).order_by(Node.created_at.desc()))).scalars())


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
        capabilities=request.capabilities,
    )
    session.add(node)
    await session.flush()
    return node


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
    node.status = request.status.value
    node.capabilities = request.capabilities
    node.last_seen_at = now

    latest_job = (
        await session.execute(
            select(NodeProvisioningJob)
            .where(NodeProvisioningJob.node_id == node.id)
            .order_by(NodeProvisioningJob.created_at.desc())
        )
    ).scalars().first()
    if latest_job is not None and request.status == NodeStatus.ACTIVE:
        latest_job.status = ProvisioningJobStatus.ACTIVE.value

    await session.flush()
    return node


def not_implemented() -> APIError:
    return APIError(
        code="nodes_not_implemented",
        message="Node service is not implemented yet.",
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
    )
