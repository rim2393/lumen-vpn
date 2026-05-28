from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

WILDCARD_BIND_ADDRESS = "0.0.0.0"  # noqa: S104 - data value, not a socket bind.
VAULT_REF_PREFIX = "vault://"


def validate_vault_ref(value: str | None) -> str | None:
    if value is None:
        return None
    if not value.startswith(VAULT_REF_PREFIX):
        raise ValueError("credentials_ref must be a vault:// reference")
    return value


class ProtocolAdapterResponse(BaseModel):
    protocol: str
    display_name: str
    status: str
    capabilities: list[str]
    required_credential_refs: list[str]


class ProtocolAdapterListResponse(BaseModel):
    items: list[ProtocolAdapterResponse]


class PortReservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    address: str = Field(default=WILDCARD_BIND_ADDRESS, min_length=1, max_length=64)
    port: int = Field(ge=1, le=65535)
    protocol: Literal["tcp", "udp"] = "tcp"
    exclusive: bool = True


class PortConflict(BaseModel):
    profile_id: UUID
    profile_name: str
    address: str
    port: int
    protocol: str
    suggested_port: int | None
    message: str


class PortCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: UUID
    reservations: list[PortReservation] = Field(min_length=1)
    exclude_profile_id: UUID | None = None


class PortCheckResponse(BaseModel):
    allowed: bool
    conflicts: list[PortConflict]


class ProtocolProfileCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    node_id: UUID
    squad_id: UUID | None = None
    adapter: str = Field(min_length=1, max_length=64)
    status: str = Field(default="active", max_length=32)
    config_json: dict[str, object] = Field(default_factory=dict)
    port_reservations: list[PortReservation] = Field(default_factory=list)
    credentials_ref: str | None = Field(default=None, max_length=512)
    metadata_json: dict[str, object] = Field(default_factory=dict)
    allow_port_conflicts: bool = False

    @field_validator("credentials_ref")
    @classmethod
    def validate_credentials_ref(cls, value: str | None) -> str | None:
        return validate_vault_ref(value)


class ProtocolProfileResponse(BaseModel):
    id: UUID
    name: str
    node_id: UUID
    squad_id: UUID | None
    adapter: str
    status: str
    config_json: dict[str, object]
    port_reservations: list[dict[str, object]]
    credentials_ref: str | None
    metadata_json: dict[str, object]


class ProtocolProfileUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=128)
    node_id: UUID | None = None
    squad_id: UUID | None = None
    adapter: str | None = Field(default=None, min_length=1, max_length=64)
    status: str | None = Field(default=None, max_length=32)
    config_json: dict[str, object] | None = None
    port_reservations: list[PortReservation] | None = None
    credentials_ref: str | None = Field(default=None, max_length=512)
    metadata_json: dict[str, object] | None = None
    allow_port_conflicts: bool = False

    @field_validator("credentials_ref")
    @classmethod
    def validate_credentials_ref(cls, value: str | None) -> str | None:
        return validate_vault_ref(value)


class ProtocolProfileListResponse(BaseModel):
    items: list[ProtocolProfileResponse]


class ProfileComputedNodeResponse(BaseModel):
    id: UUID
    name: str
    region: str
    public_address: str
    status: str
    capabilities: dict[str, str]


class ProfileInboundHostBindingResponse(BaseModel):
    id: UUID
    name: str
    hostname: str
    address: str | None
    port: int | None
    inbound_tag: str | None
    status: str
    tags: list[str]
    remark: str | None


class ProfileInboundResponse(BaseModel):
    profile_id: UUID
    profile_name: str
    node_id: UUID
    node_name: str
    adapter: str
    status: str
    tag: str
    protocol: str
    listen: str
    port: int
    transport: str
    security: str
    credentials_ref: str | None
    hosts: list[ProfileInboundHostBindingResponse]
    config_json: dict[str, object]


class ProfileInboundListResponse(BaseModel):
    items: list[ProfileInboundResponse]


class ProfileComputedConfigResponse(BaseModel):
    profile: ProtocolProfileResponse
    node: ProfileComputedNodeResponse
    inbounds: list[ProfileInboundResponse]
    computed_config: dict[str, object]


class SquadCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    kind: Literal["internal", "external"] = "internal"
    status: str = Field(default="active", max_length=32)
    metadata_json: dict[str, str] = Field(default_factory=dict)


class SquadUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=128)
    kind: Literal["internal", "external"] | None = None
    status: str | None = Field(default=None, max_length=32)
    metadata_json: dict[str, str] | None = None


class SquadResponse(BaseModel):
    id: UUID
    name: str
    kind: str
    status: str
    metadata_json: dict[str, str]


class SquadListResponse(BaseModel):
    items: list[SquadResponse]


class HostCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    hostname: str = Field(min_length=1, max_length=255)
    node_id: UUID
    protocol_profile_id: UUID | None = None
    squad_id: UUID | None = None
    status: str = Field(default="active", max_length=32)
    tags: list[str] = Field(default_factory=list)
    address: str | None = Field(default=None, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    inbound_tag: str | None = Field(default=None, max_length=128)
    remark: str | None = Field(default=None, max_length=255)
    metadata_json: dict[str, object] = Field(default_factory=dict)


class HostResponse(BaseModel):
    id: UUID
    name: str
    hostname: str
    node_id: UUID
    protocol_profile_id: UUID | None
    squad_id: UUID | None
    status: str
    tags: list[str]
    address: str | None
    port: int | None
    inbound_tag: str | None
    remark: str | None
    metadata_json: dict[str, object]


class HostUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=128)
    hostname: str | None = Field(default=None, min_length=1, max_length=255)
    node_id: UUID | None = None
    protocol_profile_id: UUID | None = None
    squad_id: UUID | None = None
    status: str | None = Field(default=None, max_length=32)
    tags: list[str] | None = None
    address: str | None = Field(default=None, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    inbound_tag: str | None = Field(default=None, max_length=128)
    remark: str | None = Field(default=None, max_length=255)
    metadata_json: dict[str, object] | None = None


class HostListResponse(BaseModel):
    items: list[HostResponse]


class HostBulkActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[UUID] = Field(min_length=1)
    inbound_tag: str | None = Field(default=None, max_length=128)
    port: int | None = Field(default=None, ge=1, le=65535)
    status: str | None = Field(default=None, max_length=32)


class HostReorderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[UUID] = Field(min_length=1)


class ResourceBulkActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[UUID] = Field(min_length=1)
    status: str | None = None


class ResourceBulkActionResponse(BaseModel):
    updated: int
