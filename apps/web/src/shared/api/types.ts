export type ApiSource = 'api' | 'development'

export type ResourceListResponse<TItem> = {
  generatedAt: string
  items: TItem[]
  source: ApiSource
  total: number
}

export type AuthSession = {
  accessToken?: string
  refreshToken?: string
  email: string
  expiresAt: string
  name: string
  role: 'owner' | 'admin' | 'operator' | 'auditor'
  scopes: string[]
  userId: string
}

export type MfaMethod = {
  confirmed_at: string | null
  id: string
  kind: string
  label: string
  last_used_at: string | null
  status: string
}

export type MfaChallenge = {
  challengeToken: string
  expiresAt: string
  methods: MfaMethod[]
}

export type LoginRequest = {
  email: string
  password: string
}

export type MfaChallengeVerifyRequest = {
  challengeToken: string
  code: string
  methodId: string
}

export type TokenPairResponse = {
  mfa_required?: false
  access_token: string
  expires_at: string
  refresh_token: string
  token_type: 'Bearer'
}

export type MfaChallengeResponse = {
  challenge_token: string
  expires_at: string
  methods: MfaMethod[]
  mfa_required: true
}

export type LoginApiResponse = TokenPairResponse | MfaChallengeResponse

export type ApiKeyStatus = 'active' | 'expiring' | 'revoked'

export type ApiKeyRecord = {
  createdAt: string
  expiresAt: string | null
  fingerprint: string
  id: string
  lastUsedAt: string | null
  name: string
  owner: string
  scopes: string[]
  status: ApiKeyStatus
}

export type LicenseStatus = 'valid' | 'expiring' | 'invalid'

export type LicenseSummary = {
  auditEvents: Array<{
    at: string
    label: string
  }>
  expiresAt: string
  features: string[]
  issuedTo: string
  plan: string
  seatsLimit: number
  seatsUsed: number
  status: LicenseStatus
}

export type UserStatus = 'active' | 'limited' | 'disabled'

export type AdminUserRecord = {
  displayName: string
  email: string
  expiresAt: string
  id: string
  mfaEnabled: boolean
  role: 'owner' | 'admin' | 'operator' | 'user'
  status: UserStatus
  subscription: 'trial' | 'paid' | 'grace' | 'expired'
  trafficUsedGb: number
}

export type UserRecord = {
  created_at: string
  device_limit: number | null
  display_name: string | null
  email: string
  expires_at: string | null
  id: string
  metadata_json: Record<string, unknown>
  role: 'owner' | 'admin' | 'operator' | 'user'
  status: UserStatus | 'revoked' | (string & {})
  tags: string[]
  telegram_id: string | null
  traffic_limit_gb: number | null
  traffic_used_gb: number
  updated_at: string
  username: string | null
}

export type UserCreateRequest = {
  device_limit?: number | null
  display_name?: string | null
  email: string
  expires_at?: string | null
  metadata_json?: Record<string, unknown>
  password?: string | null
  role?: 'owner' | 'admin' | 'operator' | 'user'
  status?: string
  tags?: string[]
  telegram_id?: string | null
  traffic_limit_gb?: number | null
  traffic_used_gb?: number
  username?: string | null
}

export type UserUpdateRequest = Partial<Omit<UserCreateRequest, 'password'>> & {
  password?: string | null
}

export type UserListResponse = {
  items: UserRecord[]
}

export type UserBulkActionRequest = {
  expires_at?: string | null
  status?: string | null
  tags?: string[] | null
  traffic_delta_gb?: number | null
  user_ids: string[]
}

export type UserBulkActionResponse = {
  items: UserRecord[]
  updated: number
}

export type AuditEventRecord = {
  action: string
  actor_email: string | null
  actor_subject: string
  created_at: string
  id: string
  metadata_json: Record<string, string>
  resource_id: string | null
  resource_type: string
}

export type UserDeviceRecord = {
  hwid: string | null
  id: string
  label: string | null
  last_seen_at: string | null
  metadata_json: Record<string, unknown>
  platform: string | null
  status: string
}

export type UserAccessibleNodeRecord = {
  id: string
  name: string
  public_address: string
  region: string
  status: string
}

export type UserDetailResponse = {
  accessible_nodes: UserAccessibleNodeRecord[]
  devices: UserDeviceRecord[]
  request_history: AuditEventRecord[]
  subscriptions: SubscriptionRecord[]
  user: UserRecord
}

export type LegacyNodeStatus = 'healthy' | 'degraded' | 'offline'

export type NodeRecord = {
  activeUsers: number
  id: string
  lastSeenAt: string
  loadPercent: number
  name: string
  region: string
  status: LegacyNodeStatus
  transports: string[]
  version: string
}

export type NodeStatus =
  | 'provisioning'
  | 'installing'
  | 'active'
  | 'offline'
  | 'failed'
  | 'deleted'
  | 'license_paused'
  | 'paused'
  | 'quarantined'
  | (string & {})

export type NodeResponse = {
  capabilities: Record<string, string>
  id: string
  last_seen_at: string | null
  name: string
  public_address: string
  region: string
  status: NodeStatus
}

export type NodeListResponse = {
  items: NodeResponse[]
}

export type NodeCommandCreateRequest = {
  command_type: string
  payload_json?: Record<string, unknown>
}

export type NodeCommandRecord = {
  claimed_at: string | null
  command_type: string
  completed_at: string | null
  created_at: string
  error_code: string | null
  error_message: string | null
  id: string
  node_id: string
  payload_json: Record<string, unknown>
  result_json: Record<string, unknown> | null
  status: string
  updated_at: string
}

export type NodeCommandListResponse = {
  items: NodeCommandRecord[]
}

export type NodeMetricRecord = {
  created_at: string
  id: string
  metric_kind: string
  node_id: string
  observed_at: string
  values_json: Record<string, number>
}

export type NodeMetricListResponse = {
  items: NodeMetricRecord[]
}

export type NodePauseRequest = {
  license_enforced?: boolean
  reason?: string | null
}

export type NodeResumeRequest = {
  clear_quarantine?: boolean
  target_status?: NodeStatus
}

export type NodeQuarantineRequest = {
  reason: string
}

export type ProvisioningJobKind = 'node.provision'

export type ProvisioningJobStatus =
  | 'queued'
  | 'preflight_running'
  | 'preflight_passed'
  | 'install_token_issued'
  | 'installing'
  | 'active'
  | 'failed'
  | 'cancelled'
  | (string & {})

export type PreflightStatus = 'pending' | 'running' | 'passed' | 'failed' | (string & {})

export type ProvisioningJobCreateRequest = {
  idempotency_key: string
  kind?: ProvisioningJobKind
  node: {
    name: string
    public_address: string
    region: string
  }
  requested_capabilities: Record<string, string>
  ssh: {
    credentials_ref: string
    host: string
    port: number
    username: string
  }
}

export type ProtocolAdapterRecord = {
  capabilities: string[]
  display_name: string
  protocol: string
  required_credential_refs: string[]
  status: string
}

export type ProtocolAdapterListResponse = {
  items: ProtocolAdapterRecord[]
}

export type PortReservation = {
  address?: string
  exclusive?: boolean
  port: number
  protocol?: 'tcp' | 'udp'
}

export type PortConflict = {
  address: string
  message: string
  port: number
  profile_id: string
  profile_name: string
  protocol: string
  suggested_port: number | null
}

export type PortCheckRequest = {
  exclude_profile_id?: string | null
  node_id: string
  reservations: PortReservation[]
}

export type PortCheckResponse = {
  allowed: boolean
  conflicts: PortConflict[]
}

export type SquadKind = 'internal' | 'external'

export type SquadRecord = {
  id: string
  kind: SquadKind | (string & {})
  metadata_json: Record<string, unknown>
  name: string
  status: string
}

export type SquadCreateRequest = {
  kind?: SquadKind
  metadata_json?: Record<string, unknown>
  name: string
  status?: string
}

export type SquadUpdateRequest = Partial<SquadCreateRequest>

export type SquadListResponse = {
  items: SquadRecord[]
}

export type SquadUserRecord = {
  display_name: string | null
  email: string
  id: string
  status: string
  tags: string[]
  username: string | null
}

export type SquadNodeRecord = {
  id: string
  name: string
  public_address: string
  region: string
  status: string
}

export type SquadProfileRecord = {
  adapter: string
  id: string
  inbounds: string[]
  name: string
  node_id: string
  status: string
}

export type SquadHostRecord = {
  hostname: string
  id: string
  inbound_tag: string | null
  name: string
  node_id: string
  port: number | null
  protocol_profile_id: string | null
  status: string
}

export type ProfileInboundRecord = {
  adapter: string
  config_json: Record<string, unknown>
  credentials_ref: string | null
  hosts: Array<Record<string, unknown>>
  listen: string
  node_id: string
  node_name: string
  port: number
  profile_id: string
  profile_name: string
  protocol: string
  security: string
  status: string
  tag: string
  transport: string
}

export type SquadDetailResponse = {
  hosts: SquadHostRecord[]
  inbound_matrix: ProfileInboundRecord[]
  nodes: SquadNodeRecord[]
  profiles: SquadProfileRecord[]
  squad: SquadRecord
  users: SquadUserRecord[]
}

export type SquadUserMutationRequest = {
  user_ids: string[]
}

export type ProtocolProfileRecord = {
  adapter: string
  config_json: Record<string, unknown>
  credentials_ref: string | null
  id: string
  metadata_json: Record<string, unknown>
  name: string
  node_id: string
  port_reservations: Array<Record<string, unknown>>
  squad_id: string | null
  status: string
  created_at?: string | null
}

export type ProtocolProfileCreateRequest = {
  adapter: string
  allow_port_conflicts?: boolean
  config_json?: Record<string, unknown>
  credentials_ref?: string | null
  metadata_json?: Record<string, unknown>
  name: string
  node_id: string
  port_reservations?: PortReservation[]
  squad_id?: string | null
  status?: string
}

export type ProtocolProfileUpdateRequest = Partial<ProtocolProfileCreateRequest>

export type ProtocolProfileListResponse = {
  items: ProtocolProfileRecord[]
}

export type ProfileComputedNodeRecord = {
  capabilities: Record<string, string>
  id: string
  name: string
  public_address: string
  region: string
  status: string
}

export type ProfileComputedConfigResponse = {
  computed_config: Record<string, unknown>
  inbounds: ProfileInboundRecord[]
  node: ProfileComputedNodeRecord
  profile: ProtocolProfileRecord
}

export type ProfileInboundListResponse = {
  items: ProfileInboundRecord[]
}

export type HostRecord = {
  address: string | null
  hostname: string
  id: string
  inbound_tag: string | null
  metadata_json: Record<string, unknown>
  name: string
  node_id: string
  port: number | null
  protocol_profile_id: string | null
  remark: string | null
  squad_id: string | null
  status: string
  tags: string[]
}

export type HostCreateRequest = {
  address?: string | null
  hostname: string
  inbound_tag?: string | null
  metadata_json?: Record<string, unknown>
  name: string
  node_id: string
  port?: number | null
  protocol_profile_id?: string | null
  remark?: string | null
  squad_id?: string | null
  status?: string
  tags?: string[]
}

export type HostUpdateRequest = Partial<HostCreateRequest>

export type HostListResponse = {
  items: HostRecord[]
}

export type HostBulkActionRequest = {
  ids: string[]
  inbound_tag?: string | null
  port?: number | null
  status?: string | null
}

export type ResourceBulkActionResponse = {
  updated: number
}

export type ProfileBulkActionRequest = {
  ids: string[]
  status?: string | null
}

export type SubscriptionRecord = {
  config_hash: string | null
  delivery_profile: Record<string, string>
  expires_at: string | null
  id: string
  license_id: string
  node_id: string | null
  public_id: string
  revoked_at: string | null
  status: string
  user_id: string
}

export type SubscriptionCreateRequest = {
  config_hash?: string | null
  delivery_profile?: Record<string, string>
  expires_at?: string | null
  license_id: string
  node_id?: string | null
  user_id: string
}

export type SubscriptionUpdateRequest = Partial<{
  config_hash: string | null
  delivery_profile: Record<string, string>
  expires_at: string | null
  node_id: string | null
  status: string
}>

export type SubscriptionListResponse = {
  items: SubscriptionRecord[]
}

export type SubscriptionTemplateFormat =
  | 'xray_json'
  | 'mihomo'
  | 'stash'
  | 'sing_box'
  | 'clash'
  | 'raw_uri'

export type SubscriptionTemplateRecord = {
  content_json: Record<string, unknown>
  format: SubscriptionTemplateFormat
  id: string
  name: string
  order: number
  status: string
}

export type SubscriptionTemplateCreateRequest = {
  content_json?: Record<string, unknown>
  format: SubscriptionTemplateFormat
  name: string
  order?: number | null
  status?: string
}

export type SubscriptionTemplateUpdateRequest = Partial<SubscriptionTemplateCreateRequest>

export type SubscriptionTemplateListResponse = {
  items: SubscriptionTemplateRecord[]
}

export type ResponseRuleRecord = {
  body: string
  enabled: boolean
  headers: Record<string, string>
  id: string
  name: string
  order: number
  status_code: number
  trigger_status: string
}

export type ResponseRuleCreateRequest = {
  body?: string
  enabled?: boolean
  headers?: Record<string, string>
  name: string
  order?: number | null
  status_code?: number
  trigger_status: string
}

export type ResponseRuleUpdateRequest = Partial<ResponseRuleCreateRequest>

export type ResponseRuleListResponse = {
  items: ResponseRuleRecord[]
}

export type ResponseRuleTestRequest = {
  subscription_status: string
}

export type ResponseRuleTestResponse = {
  body: string
  headers: Record<string, string>
  matched: boolean
  rule: ResponseRuleRecord | null
  status_code: number
}

export type HwidInspectorRow = {
  device_count: number
  device_limit: number | null
  device_records: Array<{
    hwid: string | null
    id: string
    label: string
    platform: string | null
    status: string
  }>
  devices: string[]
  email: string
  status: string
  user_id: string
  username: string | null
}

export type HwidInspectorResponse = {
  items: HwidInspectorRow[]
}

export type SrhInspectorRow = {
  config_hash: string | null
  parser: string
  public_id: string
  response_headers: Record<string, string>
  status: string
  subscription_id: string
  user_id: string
}

export type SrhInspectorResponse = {
  items: SrhInspectorRow[]
}

export type SessionInspectorRow = {
  created_at: string
  email: string | null
  expires_at: string
  id: string
  ip_fingerprint: string | null
  is_current: boolean
  revoked_at: string | null
  status: string
  updated_at: string
  user_agent_fingerprint: string | null
  user_id: string
}

export type SessionInspectorResponse = {
  items: SessionInspectorRow[]
}

export type TorrentReportRow = {
  action: string
  actor_email: string | null
  created_at: string
  id: string
  metadata_json: Record<string, string>
  resource_id: string | null
}

export type TorrentReportResponse = {
  items: TorrentReportRow[]
}

export type HappRoutingRow = {
  delivery_profile: Record<string, string>
  node_id: string | null
  node_name: string | null
  node_status: string | null
  public_id: string
  route_status: string
  subscription_id: string
  user_id: string
  username: string | null
}

export type HappRoutingResponse = {
  items: HappRoutingRow[]
}

export type ToolSummaryResponse = {
  happ_routes: number
  hwid_over_limit: number
  sessions_active: number
  torrent_events: number
}

export type X25519KeypairResponse = {
  encoding: string
  private_key: string
  public_key: string
}

export type NodeKeyResponse = {
  hash_algorithm: string
  stored: boolean
  token: string
  token_prefix: string
}

export type ToolSnippetRecord = {
  content: string
  description: string | null
  id: string
  language: string
  name: string
  order: number
  updated_at: string
  updated_by: string | null
}

export type ToolSnippetCreateRequest = {
  content: string
  description?: string | null
  language?: string
  name: string
  order?: number | null
}

export type ToolSnippetUpdateRequest = Partial<ToolSnippetCreateRequest>

export type ToolSnippetListResponse = {
  items: ToolSnippetRecord[]
}

export type SettingRecord = {
  id?: string
  key: string
  updated_at: string
  updated_by: string | null
  value_json: Record<string, unknown>
}

export type SettingListResponse = {
  items: SettingRecord[]
}

export type SettingUpdateRequest = {
  value_json: Record<string, unknown>
}

export type AuthProviderRecord = {
  display_name: string
  enabled: boolean
  metadata_json: Record<string, unknown>
  provider: string
  scopes: string[]
  status: string
}

export type AuthProviderUpdateRequest = Partial<{
  display_name: string
  enabled: boolean
  metadata_json: Record<string, unknown>
  scopes: string[]
  status: string
}>

export type AuthProviderListResponse = {
  items: AuthProviderRecord[]
}

export type ApiKeyCreateRequest = {
  expires_at?: string | null
  name: string
  owner_user_id?: string | null
  scopes: string[]
}

export type ApiKeyCreateResponse = {
  api_key: string
  expires_at: string | null
  id: string
  key_prefix: string
  name: string
}

export type ProvisioningJobResponse = {
  created_at: string
  error_code: string | null
  error_message: string | null
  id: string
  idempotency_key: string
  kind: ProvisioningJobKind
  node_id: string
  preflight_result: Record<string, string>
  preflight_status: PreflightStatus
  requested_capabilities: Record<string, string>
  ssh_credentials_ref: string
  ssh_host: string
  ssh_port: number
  ssh_username: string
  status: ProvisioningJobStatus
  token_exchanged_at: string | null
  token_issued_at: string | null
  updated_at: string
}

export type InstallTokenIssueResponse = {
  expires_at: string
  install_token: string
  provisioning_job_id: string
  token_prefix: string
}

export type InstallTokenExchangeResponse = {
  heartbeat_path: string
  node_id: string
  node_token: string
  node_token_prefix: string
  provisioning_job_id: string
}

export type NodePluginRecord = {
  id: string
  node_id: string | null
  kind: string
  name: string
  config_json: Record<string, unknown>
  enabled: boolean
  created_at: string
  updated_at: string
}

export type NodePluginListResponse = { items: NodePluginRecord[] }

export type NodePluginCreateRequest = {
  node_id?: string | null
  kind: string
  name: string
  config_json?: Record<string, unknown>
  enabled?: boolean
}

export type NodePluginUpdateRequest = {
  node_id?: string | null
  kind?: string
  name?: string
  config_json?: Record<string, unknown>
  enabled?: boolean
}

export type InfraProviderRecord = {
  id: string
  name: string
  login_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type InfraProviderListResponse = { items: InfraProviderRecord[] }

export type InfraProviderCreateRequest = {
  name: string
  login_url?: string | null
  notes?: string | null
}

export type InfraBillingRecordRecord = {
  id: string
  provider_id: string
  node_id: string | null
  amount: number
  currency: string
  period: string
  note: string | null
  created_at: string
  updated_at: string
}

export type InfraBillingRecordListResponse = { items: InfraBillingRecordRecord[] }

export type InfraBillingRecordCreateRequest = {
  provider_id: string
  node_id?: string | null
  amount: number
  currency?: string
  period: string
  note?: string | null
}

export type InfraBillingCurrencyTotal = {
  currency: string
  total: number
  records: number
}

export type InfraBillingSummaryResponse = {
  providers: number
  records: number
  totals_by_currency: InfraBillingCurrencyTotal[]
}

export type LumenApiClient = {
  bulkUsers: (
    action: string,
    request: UserBulkActionRequest,
  ) => Promise<UserBulkActionResponse>
  bulkProfiles: (
    action: string,
    request: ProfileBulkActionRequest,
  ) => Promise<ResourceBulkActionResponse>
  bulkHosts: (
    action: string,
    request: HostBulkActionRequest,
  ) => Promise<ResourceBulkActionResponse>
  checkPortConflicts: (request: PortCheckRequest) => Promise<PortCheckResponse>
  createApiKey: (request: ApiKeyCreateRequest) => Promise<ApiKeyCreateResponse>
  createHost: (request: HostCreateRequest) => Promise<HostRecord>
  createProfile: (request: ProtocolProfileCreateRequest) => Promise<ProtocolProfileRecord>
  createProvisioningJob: (
    request: ProvisioningJobCreateRequest,
  ) => Promise<ProvisioningJobResponse>
  createNodeCommand: (
    nodeId: string,
    request: NodeCommandCreateRequest,
  ) => Promise<NodeCommandRecord>
  createSquad: (request: SquadCreateRequest) => Promise<SquadRecord>
  createSubscription: (request: SubscriptionCreateRequest) => Promise<SubscriptionRecord>
  createSubscriptionTemplate: (
    request: SubscriptionTemplateCreateRequest,
  ) => Promise<SubscriptionTemplateRecord>
  createResponseRule: (request: ResponseRuleCreateRequest) => Promise<ResponseRuleRecord>
  createUser: (request: UserCreateRequest) => Promise<UserRecord>
  deleteHost: (hostId: string) => Promise<void>
  deleteProfile: (profileId: string) => Promise<void>
  deleteSquad: (squadId: string) => Promise<void>
  deleteSubscriptionTemplate: (templateId: string) => Promise<void>
  deleteResponseRule: (ruleId: string) => Promise<void>
  deleteUser: (userId: string) => Promise<void>
  clearUserDevices: (userId: string) => Promise<UserDetailResponse>
  deleteUserDevice: (userId: string, deviceId: string) => Promise<UserDetailResponse>
  revokeToolSession: (sessionId: string) => Promise<SessionInspectorResponse>
  getSession: () => Promise<AuthSession | null>
  getUser: (userId: string) => Promise<UserRecord>
  getUserDetail: (userId: string) => Promise<UserDetailResponse>
  getProfile: (profileId: string) => Promise<ProtocolProfileRecord>
  getProfileComputedConfig: (profileId: string) => Promise<ProfileComputedConfigResponse>
  listProfileInbounds: (profileId: string) => Promise<ProfileInboundListResponse>
  listGlobalProfileInbounds: () => Promise<ProfileInboundListResponse>
  listApiKeys: () => Promise<ResourceListResponse<ApiKeyRecord>>
  listHosts: () => Promise<HostListResponse>
  listNodes: () => Promise<NodeListResponse>
  listNodeCommands: (nodeId: string) => Promise<NodeCommandListResponse>
  listNodeMetrics: (nodeId: string) => Promise<NodeMetricListResponse>
  listProfiles: () => Promise<ProtocolProfileListResponse>
  listProtocolAdapters: () => Promise<ProtocolAdapterListResponse>
  listSettings: () => Promise<SettingListResponse>
  listAuthProviders: () => Promise<AuthProviderListResponse>
  listSquads: () => Promise<SquadListResponse>
  listSubscriptions: () => Promise<SubscriptionListResponse>
  listSubscriptionTemplates: () => Promise<SubscriptionTemplateListResponse>
  listResponseRules: () => Promise<ResponseRuleListResponse>
  readToolSummary: () => Promise<ToolSummaryResponse>
  inspectHwid: () => Promise<HwidInspectorResponse>
  inspectSrh: () => Promise<SrhInspectorResponse>
  inspectSessions: () => Promise<SessionInspectorResponse>
  inspectTorrentReports: () => Promise<TorrentReportResponse>
  inspectHappRouting: () => Promise<HappRoutingResponse>
  truncateTorrentReports: () => Promise<TorrentReportResponse>
  generateX25519Keypair: () => Promise<X25519KeypairResponse>
  generateNodeKey: () => Promise<NodeKeyResponse>
  listToolSnippets: () => Promise<ToolSnippetListResponse>
  createToolSnippet: (request: ToolSnippetCreateRequest) => Promise<ToolSnippetRecord>
  updateToolSnippet: (
    snippetId: string,
    request: ToolSnippetUpdateRequest,
  ) => Promise<ToolSnippetRecord>
  deleteToolSnippet: (snippetId: string) => Promise<ToolSnippetListResponse>
  listUsers: () => Promise<UserListResponse>
  login: (request: LoginRequest) => Promise<AuthSession | MfaChallenge>
  listLoginMethods: () => Promise<LoginMethodsResponse>
  startOAuth: (provider: string, redirect?: string) => Promise<OAuthStartResponse>
  webauthnAuthenticateOptions: (email?: string) => Promise<WebAuthnOptionsApiResponse>
  webauthnAuthenticateVerify: (
    challengeId: string,
    credential: Record<string, unknown>,
  ) => Promise<AuthSession | MfaChallenge>
  telegramLogin: (payload: TelegramLoginPayload) => Promise<AuthSession | MfaChallenge>
  logout: () => Promise<void>
  readProvisioningJob: (jobId: string) => Promise<ProvisioningJobResponse>
  pauseNode: (nodeId: string, request: NodePauseRequest) => Promise<NodeResponse>
  resumeNode: (nodeId: string, request: NodeResumeRequest) => Promise<NodeResponse>
  quarantineNode: (nodeId: string, request: NodeQuarantineRequest) => Promise<NodeResponse>
  readLicense: () => Promise<LicenseSummary | null>
  revokeApiKey: (apiKeyId: string) => Promise<void>
  revokeSubscription: (subscriptionId: string) => Promise<SubscriptionRecord>
  addSquadUsers: (
    squadId: string,
    request: SquadUserMutationRequest,
  ) => Promise<SquadRecord>
  getSquadDetail: (squadId: string) => Promise<SquadDetailResponse>
  removeSquadUsers: (
    squadId: string,
    request: SquadUserMutationRequest,
  ) => Promise<SquadRecord>
  reorderHosts: (ids: string[]) => Promise<ResourceBulkActionResponse>
  reorderSquads: (ids: string[]) => Promise<ResourceBulkActionResponse>
  reorderSubscriptionTemplates: (ids: string[]) => Promise<ResourceBulkActionResponse>
  reorderResponseRules: (ids: string[]) => Promise<ResourceBulkActionResponse>
  testResponseRule: (request: ResponseRuleTestRequest) => Promise<ResponseRuleTestResponse>
  updateHost: (hostId: string, request: HostUpdateRequest) => Promise<HostRecord>
  updateProfile: (
    profileId: string,
    request: ProtocolProfileUpdateRequest,
  ) => Promise<ProtocolProfileRecord>
  updateSubscription: (
    subscriptionId: string,
    request: SubscriptionUpdateRequest,
  ) => Promise<SubscriptionRecord>
  updateSubscriptionTemplate: (
    templateId: string,
    request: SubscriptionTemplateUpdateRequest,
  ) => Promise<SubscriptionTemplateRecord>
  updateResponseRule: (
    ruleId: string,
    request: ResponseRuleUpdateRequest,
  ) => Promise<ResponseRuleRecord>
  verifyMfaChallenge: (request: MfaChallengeVerifyRequest) => Promise<AuthSession>
  updateAuthProvider: (
    provider: string,
    request: AuthProviderUpdateRequest,
  ) => Promise<AuthProviderRecord>
  updateSetting: (key: string, request: SettingUpdateRequest) => Promise<SettingRecord>
  updateSquad: (squadId: string, request: SquadUpdateRequest) => Promise<SquadRecord>
  updateUser: (userId: string, request: UserUpdateRequest) => Promise<UserRecord>
  listNodePlugins: (nodeId?: string) => Promise<NodePluginListResponse>
  createNodePlugin: (request: NodePluginCreateRequest) => Promise<NodePluginRecord>
  updateNodePlugin: (
    pluginId: string,
    request: NodePluginUpdateRequest,
  ) => Promise<NodePluginRecord>
  deleteNodePlugin: (pluginId: string) => Promise<void>
  listInfraProviders: () => Promise<InfraProviderListResponse>
  createInfraProvider: (request: InfraProviderCreateRequest) => Promise<InfraProviderRecord>
  deleteInfraProvider: (providerId: string) => Promise<void>
  listInfraBillingRecords: () => Promise<InfraBillingRecordListResponse>
  createInfraBillingRecord: (
    request: InfraBillingRecordCreateRequest,
  ) => Promise<InfraBillingRecordRecord>
  infraBillingSummary: () => Promise<InfraBillingSummaryResponse>
}

export type LoginMethod = {
  provider: string
  display_name: string
  kind: string
  enabled: boolean
  bot_username?: string | null
}

export type LoginMethodsResponse = {
  items: LoginMethod[]
}

export type OAuthStartResponse = {
  provider: string
  authorization_url: string
  state: string
}

export type WebAuthnOptionsApiResponse = {
  options: Record<string, unknown>
  challenge_id: string
}

export type TelegramLoginPayload = {
  id: number
  auth_date: number
  hash: string
  first_name?: string
  last_name?: string
  username?: string
  photo_url?: string
}
