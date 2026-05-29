from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr


class NodeCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    region: str = Field(min_length=1, max_length=64)
    public_address: str = Field(min_length=1, max_length=255)
    capabilities: dict[str, str] = Field(default_factory=dict)


class NodeResponse(BaseModel):
    id: UUID
    name: str
    region: str
    public_address: str
    status: str
    capabilities: dict[str, str]
    last_seen_at: datetime | None


class NodeListResponse(BaseModel):
    items: list[NodeResponse]


class NodeStatus(StrEnum):
    PROVISIONING = "provisioning"
    INSTALLING = "installing"
    ACTIVE = "active"
    OFFLINE = "offline"
    FAILED = "failed"
    DELETED = "deleted"
    PAUSED = "paused"
    LICENSE_PAUSED = "license_paused"
    QUARANTINED = "quarantined"


class ProvisioningJobKind(StrEnum):
    NODE_PROVISION = "node.provision"


class ProvisioningJobStatus(StrEnum):
    QUEUED = "queued"
    PREFLIGHT_RUNNING = "preflight_running"
    PREFLIGHT_PASSED = "preflight_passed"
    INSTALL_TOKEN_ISSUED = "install_token_issued"  # noqa: S105 - status value, not a secret.
    INSTALLING = "installing"
    ACTIVE = "active"
    FAILED = "failed"
    CANCELLED = "cancelled"


class PreflightStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"


class NodeProvisioningTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    region: str = Field(min_length=1, max_length=64)
    public_address: str = Field(min_length=1, max_length=255)


class SSHCredentialReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=22, ge=1, le=65535)
    username: str = Field(min_length=1, max_length=128)
    credentials_ref: str = Field(min_length=1, max_length=512)


class ProvisioningJobCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    idempotency_key: str = Field(min_length=8, max_length=128)
    kind: ProvisioningJobKind = ProvisioningJobKind.NODE_PROVISION
    node: NodeProvisioningTarget
    ssh: SSHCredentialReference
    requested_capabilities: dict[str, str] = Field(default_factory=dict)


class PreflightUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: PreflightStatus
    checks: dict[str, str] = Field(default_factory=dict)
    error_code: str | None = Field(default=None, max_length=64)
    error_message: str | None = Field(default=None, max_length=512)


class InstallTokenExchangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    install_token: SecretStr = Field(min_length=1)


class NodeHeartbeatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: NodeStatus = NodeStatus.ACTIVE
    capabilities: dict[str, str] = Field(default_factory=dict)


class NodeCommandCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_type: str = Field(min_length=1, max_length=64)
    payload_json: dict[str, object] = Field(default_factory=dict)


class NodePauseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=512)
    license_enforced: bool = False


class NodeResumeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_status: NodeStatus = NodeStatus.OFFLINE
    clear_quarantine: bool = False


class NodeQuarantineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=512)


class NodeCommandResultRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(pattern="^(succeeded|failed|cancelled|skipped)$")
    result_json: dict[str, object] = Field(default_factory=dict)
    error_code: str | None = Field(default=None, max_length=64)
    error_message: str | None = Field(default=None, max_length=512)


class NodeCommandResponse(BaseModel):
    id: UUID
    node_id: UUID
    command_type: str
    status: str
    payload_json: dict[str, object]
    result_json: dict[str, object] | None
    error_code: str | None
    error_message: str | None
    claimed_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class NodeCommandListResponse(BaseModel):
    items: list[NodeCommandResponse]


class NodeMetricCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric_kind: str = Field(min_length=1, max_length=64)
    values_json: dict[str, float] = Field(default_factory=dict)
    observed_at: datetime | None = None


class NodeMetricResponse(BaseModel):
    id: UUID
    node_id: UUID
    metric_kind: str
    values_json: dict[str, float]
    observed_at: datetime
    created_at: datetime


class NodeMetricListResponse(BaseModel):
    items: list[NodeMetricResponse]


class ProvisioningJobResponse(BaseModel):
    id: UUID
    idempotency_key: str
    node_id: UUID
    kind: ProvisioningJobKind
    status: ProvisioningJobStatus
    preflight_status: PreflightStatus
    ssh_host: str
    ssh_port: int
    ssh_username: str
    ssh_credentials_ref: str
    requested_capabilities: dict[str, str]
    preflight_result: dict[str, str]
    error_code: str | None
    error_message: str | None
    token_issued_at: datetime | None
    token_exchanged_at: datetime | None
    created_at: datetime
    updated_at: datetime


class InstallTokenIssueResponse(BaseModel):
    provisioning_job_id: UUID
    token_prefix: str
    install_token: str
    expires_at: datetime


class InstallTokenExchangeResponse(BaseModel):
    provisioning_job_id: UUID
    node_id: UUID
    node_token_prefix: str
    node_token: str
    heartbeat_path: str
