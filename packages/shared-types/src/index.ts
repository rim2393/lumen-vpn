export type UUID = string;
export type ISODateTime = string;

export type Role = "owner" | "admin" | "support" | "node" | "user";

export type Permission =
  | "api_key:manage"
  | "license:manage"
  | "node:manage"
  | "subscription:read"
  | "subscription:manage"
  | "user:manage";

export interface ErrorPayload {
  code: string;
  message: string;
  details: string[];
}

export interface ErrorEnvelope {
  error: ErrorPayload;
}

export interface HealthResponse {
  status: "ok";
  checked_at: ISODateTime;
}

export interface ReadinessResponse {
  status: "ok" | "degraded";
  dependencies: Record<string, string>;
}

export interface TokenPairResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_at: ISODateTime;
}

export interface PrincipalResponse {
  subject: string;
  email: string | null;
  roles: Role[];
  permissions: Permission[];
}

export interface UserResponse {
  id: UUID;
  email: string;
  role: Role;
  status: string;
  created_at: ISODateTime;
}

export interface ApiKeyResponse {
  id: UUID;
  name: string;
  key_prefix: string;
  scopes: string[];
  expires_at: ISODateTime | null;
  revoked_at: ISODateTime | null;
  last_used_at: ISODateTime | null;
}

export interface LicenseResponse {
  id: UUID;
  customer_ref: string | null;
  status: string;
  max_devices: number;
  starts_at: ISODateTime | null;
  expires_at: ISODateTime | null;
}

export interface NodeResponse {
  id: UUID;
  name: string;
  region: string;
  public_address: string;
  status: string;
  capabilities: Record<string, string>;
  last_seen_at: ISODateTime | null;
}

export interface NodeCommandResponse {
  id: UUID;
  node_id: UUID;
  command_type: string;
  status: string;
  payload_json: Record<string, unknown>;
  result_json: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  claimed_at: ISODateTime | null;
  completed_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface NodeMetricResponse {
  id: UUID;
  node_id: UUID;
  metric_kind: string;
  values_json: Record<string, number>;
  observed_at: ISODateTime;
  created_at: ISODateTime;
}

export interface SubscriptionResponse {
  id: UUID;
  public_id: string;
  user_id: UUID;
  license_id: UUID;
  node_id: UUID | null;
  status: string;
  delivery_profile: Record<string, string>;
  expires_at: ISODateTime | null;
  revoked_at: ISODateTime | null;
}

export interface MfaMethodResponse {
  id: UUID;
  kind: string;
  label: string;
  status: string;
  confirmed_at: ISODateTime | null;
  last_used_at: ISODateTime | null;
}

export interface SettingResponse {
  id: UUID;
  key: string;
  value_json: Record<string, string>;
  updated_by: string | null;
  updated_at: ISODateTime;
}

export interface ProtocolAdapterResponse {
  protocol: string;
  display_name: string;
  status: string;
  capabilities: string[];
  required_credential_refs: string[];
}

export interface PortConflict {
  profile_id: UUID;
  profile_name: string;
  address: string;
  port: number;
  protocol: string;
  suggested_port: number | null;
  message: string;
}

export interface ProtocolProfileResponse {
  id: UUID;
  name: string;
  node_id: UUID;
  squad_id: UUID | null;
  adapter: string;
  status: string;
  config_json: Record<string, unknown>;
  port_reservations: Array<Record<string, unknown>>;
  credentials_ref: string | null;
}

export interface SquadResponse {
  id: UUID;
  name: string;
  kind: string;
  status: string;
  metadata_json: Record<string, string>;
}

export interface HostResponse {
  id: UUID;
  name: string;
  hostname: string;
  node_id: UUID;
  protocol_profile_id: UUID | null;
  squad_id: UUID | null;
  status: string;
  tags: string[];
}
