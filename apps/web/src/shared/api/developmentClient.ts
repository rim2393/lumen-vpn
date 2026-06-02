import {
  apiKeyRecords,
  hostRecords,
  licenseRecords,
  licenseSummary,
  developmentSession,
  nodeRecords,
  profileRecords,
  protocolAdapters,
  settingRecords,
  squadRecords,
  subscriptionRecords,
  userRecords,
} from '../data/developmentFixtures'
import type {
  ApiKeyCreateRequest,
  ApiKeyCreateResponse,
  AuthProviderRecord,
  AuthProviderUpdateRequest,
  HappRoutingResponse,
  HostBulkActionRequest,
  HostCreateRequest,
  HwidInspectorResponse,
  HostListResponse,
  HostRecord,
  InfraBillingRecordCreateRequest,
  InfraBillingRecordRecord,
  InfraProviderCreateRequest,
  InfraProviderRecord,
  LicenseListResponse,
  LumenApiClient,
  MfaMethod,
  NodeBulkActionRequest,
  NodePluginApplyRequest,
  NodePluginCloneRequest,
  NodePluginCreateRequest,
  NodePluginRecord,
  NodePluginReorderRequest,
  NodePluginUpdateRequest,
  NodeCommandCreateRequest,
  NodeCommandRecord,
  NodeListResponse,
  NodeOverviewResponse,
  NodeRecord,
  NodeResponse,
  NodeReorderRequest,
  NodeUpdateRequest,
  PortCheckRequest,
  PortCheckResponse,
  ProtocolAdapterListResponse,
  ProtocolProfileCreateRequest,
  ProtocolProfileListResponse,
  ProtocolProfileRecord,
  ProfileBulkActionRequest,
  ProvisioningJobCreateRequest,
  ProvisioningJobResponse,
  ResponseRuleCreateRequest,
  ResponseRuleRecord,
  ResponseRuleUpdateRequest,
  ResourceListResponse,
  SessionInspectorResponse,
  SettingListResponse,
  SettingGroupListResponse,
  SettingGroupRecord,
  SettingGroupUpdateRequest,
  SettingRecord,
  SettingUpdateRequest,
  SquadCreateRequest,
  SquadDetailResponse,
  SquadListResponse,
  SquadRecord,
  SquadUpdateRequest,
  SquadUserMutationRequest,
  SrhInspectorResponse,
  SubscriptionCreateRequest,
  SubscriptionListResponse,
  SubscriptionRecord,
  SubscriptionTemplateCreateRequest,
  SubscriptionTemplateRecord,
  SubscriptionTemplateUpdateRequest,
  SubscriptionUpdateRequest,
  ToolSummaryResponse,
  TorrentReportResponse,
  UserBulkActionRequest,
  UserCreateRequest,
  UserDetailResponse,
  UserListResponse,
  UserRecord,
  UserUpdateRequest,
  WebAuthnCredentialRecord,
} from './types'

const generatedAt = '2026-05-27T00:00:00Z'

function asListResponse<TItem>(items: TItem[]): ResourceListResponse<TItem> {
  return {
    generatedAt,
    items,
    source: 'development',
    total: items.length,
  }
}

function asNodeResponse(node: NodeRecord): NodeResponse {
  return {
    capabilities: {
      active_users: String(node.activeUsers),
      load_percent: String(node.loadPercent),
      transports: node.transports.join(','),
      version: node.version,
    },
    id: node.id,
    last_seen_at: node.lastSeenAt,
    name: node.name,
    public_address: `${node.name}.lumen.local`,
    region: node.region,
    sort_order: 0,
    status: node.status === 'healthy' ? 'active' : node.status === 'offline' ? 'offline' : 'failed',
  }
}

function asNodeListResponse(): NodeListResponse {
  return {
    items: nodeRecords.map(asNodeResponse),
  }
}

function subscriptionPublicFields(publicId: string, deliveryProfile: Record<string, string>) {
  const renderFormats = readSubscriptionRenderFormats(deliveryProfile)
  return {
    public_manifest_url: `/api/v1/subscriptions/public/${publicId}/manifest`,
    public_page_url: `/sub/${publicId}`,
    public_render_url: `/api/v1/subscriptions/public/${publicId}/render`,
    public_render_urls: Object.fromEntries(
      renderFormats.map((format) => [
        format,
        `/api/v1/subscriptions/public/${publicId}/render?target=${encodeURIComponent(format)}`,
      ]),
    ),
    render_formats: renderFormats,
  }
}

function readSubscriptionRenderFormats(deliveryProfile: Record<string, string>) {
  const formats = [
    deliveryProfile.format,
    deliveryProfile.client,
    deliveryProfile.adapter,
  ].flatMap((value) => String(value ?? '').split(/[,\s/]+/))
  const normalized = new Set<string>()
  for (const format of formats) {
    const value = format.trim().toLowerCase()
    if (!value) {
      continue
    }
    if (value === 'happ' || value === 'hiddify') {
      normalized.add('happ')
      normalized.add('hiddify')
    } else if (value === 'clash' || value === 'clash-meta' || value === 'mihomo') {
      normalized.add('mihomo')
    } else if (value === 'singbox' || value === 'sing-box' || value === 'nekobox') {
      normalized.add('sing-box')
    } else if (value === 'amnezia' || value === 'xray-json') {
      normalized.add('amnezia')
    } else if (['raw-uri', 'v2ray', 'v2ray-base64'].includes(value)) {
      normalized.add(value)
    }
  }
  return Array.from(normalized.size > 0 ? normalized : new Set(['lumen-json']))
}

function buildDevelopmentProfileInbounds(
  profile: ProtocolProfileRecord,
  node: NodeResponse | undefined,
) {
  return profile.port_reservations.map((reservation, index) => ({
    adapter: profile.adapter,
    config_json: profile.config_json,
    credentials_ref: profile.credentials_ref,
    hosts: [],
    listen: String(reservation.address ?? '0.0.0.0'),
    node_id: node?.id ?? profile.node_id,
    node_name: node?.name ?? profile.node_id,
    port: Number(reservation.port),
    profile_id: profile.id,
    profile_name: profile.name,
    protocol: profile.adapter,
    security: String(profile.config_json.security ?? 'none'),
    status: profile.status,
    tag: String(profile.config_json.tag ?? `${profile.adapter}-${index + 1}`),
    transport: String(profile.config_json.transport ?? profile.config_json.network ?? 'tcp'),
  }))
}

function buildDevelopmentProvisioningJob(
  request: ProvisioningJobCreateRequest,
  jobId = `job_${request.idempotency_key}`,
): ProvisioningJobResponse {
  const now = new Date().toISOString()

  return {
    created_at: now,
    error_code: null,
    error_message: null,
    id: jobId,
    idempotency_key: request.idempotency_key,
    kind: request.kind ?? 'node.provision',
    node_id: `node_${request.node.name}`,
    preflight_result: {},
    preflight_status: 'pending',
    requested_capabilities: request.requested_capabilities,
    ssh_credentials_ref: request.ssh.credentials_ref,
    ssh_host: request.ssh.host,
    ssh_port: request.ssh.port,
    ssh_username: request.ssh.username,
    status: 'queued',
    token_exchanged_at: null,
    token_issued_at: null,
    updated_at: now,
  }
}

export function createDevelopmentLumenApiClient(): LumenApiClient {
  const apiKeys = [...apiKeyRecords]
  const hosts = [...hostRecords]
  const profiles = [...profileRecords]
  const settings = [...settingRecords]
  const squads = [...squadRecords]
  const subscriptions = [...subscriptionRecords]
  const templates: SubscriptionTemplateRecord[] = []
  const responseRules: ResponseRuleRecord[] = []
  const nodePlugins: NodePluginRecord[] = []
  const infraProviders: InfraProviderRecord[] = []
  const infraBillingRecords: InfraBillingRecordRecord[] = []
  const nodeCommands: NodeCommandRecord[] = []
  const mfaMethods: MfaMethod[] = [
    {
      confirmed_at: '2026-05-27T00:00:00Z',
      id: 'dev-mfa-method',
      kind: 'totp',
      label: 'Development authenticator',
      last_used_at: null,
      status: 'active',
    },
  ]
  const webauthnCredentials: WebAuthnCredentialRecord[] = []
  const authProviders: AuthProviderRecord[] = [
    {
      display_name: 'Password',
      enabled: true,
      metadata_json: { mfa_required: true },
      provider: 'password',
      scopes: ['admin:login'],
      status: 'active',
    },
    {
      display_name: 'Passkey',
      enabled: false,
      metadata_json: { webauthn: 'disabled_until_registered' },
      provider: 'passkey',
      scopes: ['admin:login'],
      status: 'unimplemented',
    },
    {
      display_name: 'Telegram',
      enabled: false,
      metadata_json: { bot_binding: 'disabled_until_callback_implemented' },
      provider: 'telegram',
      scopes: ['admin:login'],
      status: 'unimplemented',
    },
    {
      display_name: 'GitHub',
      enabled: false,
      metadata_json: {},
      provider: 'github',
      scopes: ['read:user', 'user:email'],
      status: 'unimplemented',
    },
    {
      display_name: 'Google',
      enabled: false,
      metadata_json: {},
      provider: 'google',
      scopes: ['openid', 'email', 'profile'],
      status: 'unimplemented',
    },
    {
      display_name: 'Pocket ID',
      enabled: false,
      metadata_json: {},
      provider: 'pocketid',
      scopes: ['openid', 'email', 'profile'],
      status: 'unimplemented',
    },
    {
      display_name: 'Keycloak',
      enabled: false,
      metadata_json: {},
      provider: 'keycloak',
      scopes: ['openid', 'email', 'profile'],
      status: 'unimplemented',
    },
    {
      display_name: 'Generic OAuth2',
      enabled: false,
      metadata_json: {},
      provider: 'generic_oauth2',
      scopes: ['openid', 'email', 'profile'],
      status: 'unimplemented',
    },
  ]
  const users = [...userRecords]

  function updateSettingValue(key: string, request: SettingUpdateRequest): SettingRecord {
    const existing = settings.find((setting) => setting.key === key)
    const next: SettingRecord = {
      id: existing?.id ?? `setting_${key}`,
      key,
      updated_at: new Date().toISOString(),
      updated_by: developmentSession.userId,
      value_json: request.value_json,
    }
    if (existing) {
      Object.assign(existing, next)
      return existing
    }
    settings.push(next)
    return next
  }

  const settingGroups: SettingGroupRecord[] = [
    {
      description: 'Product name, documentation links and default locale exposed in the panel.',
      key: 'panel.identity',
      title: 'Panel identity',
      updated_at: null,
      updated_by: null,
      value_json: {
        default_locale: 'ru',
        docs_url: null,
        product_name: 'Lumen',
        support_url: null,
      },
    },
    {
      description: 'Client-facing subscription presentation and update behavior.',
      key: 'subscription.delivery',
      title: 'Subscription delivery',
      updated_at: null,
      updated_by: null,
      value_json: {
        base_json: {},
        custom_remarks: {},
        happ_announce: null,
        profile_page_url: null,
        random_host_order: false,
        response_headers: {},
        routing: {},
        subpage: {},
        support_url: null,
        title: 'Lumen VPN',
        update_interval_hours: 2,
      },
    },
    {
      description: 'Panel-wide MFA, API key and session lifetime policy.',
      key: 'security.policy',
      title: 'Security policy',
      updated_at: null,
      updated_by: null,
      value_json: {
        api_key_max_ttl_days: 90,
        require_mfa_for_admins: false,
        session_ttl_minutes: 720,
      },
    },
    {
      description: 'Default node runtime intervals and operational retention windows.',
      key: 'node.defaults',
      title: 'Node defaults',
      updated_at: null,
      updated_by: null,
      value_json: {
        command_poll_interval_seconds: 30,
        default_region: 'global',
        heartbeat_interval_seconds: 30,
        runtime_metrics_retention_days: 30,
      },
    },
  ]

  function updateSettingGroupValue(
    groupKey: string,
    request: SettingGroupUpdateRequest,
  ): SettingGroupRecord {
    const group = settingGroups.find((item) => item.key === groupKey)
    if (!group) {
      throw new Error('Setting group not found')
    }
    group.value_json = request.value_json
    group.updated_at = new Date().toISOString()
    group.updated_by = developmentSession.userId
    updateSettingValue(groupKey, { value_json: request.value_json })
    return group
  }

  function buildUserDetail(user: UserRecord): UserDetailResponse {
    return {
      accessible_nodes: asNodeListResponse().items.map((node) => ({
        id: node.id,
        name: node.name,
        public_address: node.public_address,
        region: node.region,
        status: node.status,
      })),
      devices: Array.isArray(user.metadata_json.devices)
        ? (user.metadata_json.devices as never[])
        : [],
      request_history: [],
      subscriptions: subscriptions.filter((subscription) => subscription.user_id === user.id),
      user,
    }
  }

  function createDevelopmentNodeCommand(
    nodeId: string,
    request: NodeCommandCreateRequest,
  ): NodeCommandRecord {
    const now = new Date().toISOString()
    const command: NodeCommandRecord = {
      claimed_at: null,
      command_type: request.command_type,
      completed_at: null,
      created_at: now,
      error_code: null,
      error_message: null,
      id: `cmd_${nodeCommands.length + 1}`,
      node_id: nodeId,
      payload_json: request.payload_json ?? {},
      result_json: null,
      status: 'queued',
      updated_at: now,
    }
    nodeCommands.unshift(command)
    return command
  }

  function buildDevelopmentNodeOverview(nodeId: string): NodeOverviewResponse {
    const node = asNodeListResponse().items.find((item) => item.id === nodeId)
    if (!node) {
      throw new Error('Node not found')
    }
    const metric = {
      created_at: generatedAt,
      id: `metric_${nodeId}`,
      metric_kind: 'runtime',
      node_id: nodeId,
      observed_at: generatedAt,
      values_json: { command_polled: 1, rx_bytes: 1024, tx_bytes: 512 },
    }
    const commands = nodeCommands.filter((command) => command.node_id === nodeId)
    const counts = commands.reduce<Record<string, number>>((acc, command) => {
      acc[command.status] = (acc[command.status] ?? 0) + 1
      return acc
    }, {})
    const records = infraBillingRecords.filter((record) => record.node_id === nodeId)
    const totals = records.reduce<Record<string, { currency: string; total: number; records: number }>>(
      (acc, record) => {
        acc[record.currency] ??= { currency: record.currency, records: 0, total: 0 }
        acc[record.currency].records += 1
        acc[record.currency].total += record.amount
        return acc
      },
      {},
    )
    return {
      command_status_counts: Object.entries(counts).map(([status, count]) => ({ count, status })),
      infra_billing_records: records.map((record) => ({
        amount: record.amount,
        currency: record.currency,
        id: record.id,
        note: record.note,
        period: record.period,
        provider_id: record.provider_id,
        provider_name:
          infraProviders.find((provider) => provider.id === record.provider_id)?.name ??
          record.provider_id,
      })),
      infra_billing_totals: Object.values(totals),
      latest_commands: commands.slice(0, 10).map((command) => ({
        claimed_at: command.claimed_at,
        command_type: command.command_type,
        completed_at: command.completed_at,
        created_at: command.created_at,
        error_code: command.error_code,
        id: command.id,
        status: command.status,
      })),
      latest_metrics: [
        {
          metric_kind: metric.metric_kind,
          observed_at: metric.observed_at,
          values_json: metric.values_json,
        },
      ],
      node,
      traffic: {
        download_bytes: metric.values_json.rx_bytes,
        last_observed_at: metric.observed_at,
        metric_samples: 1,
        total_bytes: metric.values_json.rx_bytes + metric.values_json.tx_bytes,
        upload_bytes: metric.values_json.tx_bytes,
      },
    }
  }

  return {
    bulkHosts: async (action: string, request: HostBulkActionRequest) => {
      const selected = hosts.filter((host) => request.ids.includes(host.id))
      if (action === 'delete') {
        for (const host of selected) {
          const index = hosts.findIndex((item) => item.id === host.id)
          if (index >= 0) {
            hosts.splice(index, 1)
          }
        }
        return { updated: selected.length }
      }
      for (const host of selected) {
        if (action === 'enable') {
          host.status = 'active'
        }
        if (action === 'disable') {
          host.status = 'disabled'
        }
        if (action === 'set-inbound') {
          host.inbound_tag = request.inbound_tag ?? null
        }
        if (action === 'set-port') {
          host.port = request.port ?? null
        }
      }
      return { updated: selected.length }
    },
    bulkProfiles: async (action: string, request: ProfileBulkActionRequest) => {
      const selected = profiles.filter((profile) => request.ids.includes(profile.id))
      if (action === 'delete') {
        for (const profile of selected) {
          const index = profiles.findIndex((item) => item.id === profile.id)
          if (index >= 0) {
            profiles.splice(index, 1)
          }
        }
        return { updated: selected.length }
      }
      if (action === 'status') {
        for (const profile of selected) {
          profile.status = request.status || profile.status
        }
      }
      return { updated: selected.length }
    },
    checkPortConflicts: async (request: PortCheckRequest): Promise<PortCheckResponse> => {
      const conflicts = profiles
        .filter((profile) => profile.node_id === request.node_id)
        .flatMap((profile) =>
          request.reservations
            .filter((reservation) =>
              profile.port_reservations.some(
                (existing) =>
                  existing.port === reservation.port &&
                  (existing.protocol ?? 'tcp') === (reservation.protocol ?? 'tcp'),
              ),
            )
            .map((reservation) => ({
              address: reservation.address ?? '0.0.0.0',
              message: `${profile.name} already reserves ${reservation.port}/${reservation.protocol ?? 'tcp'}`,
              port: reservation.port,
              profile_id: profile.id,
              profile_name: profile.name,
              protocol: reservation.protocol ?? 'tcp',
              suggested_port: reservation.port + 1,
            })),
        )
      return { allowed: conflicts.length === 0, conflicts }
    },
    createApiKey: async (request: ApiKeyCreateRequest): Promise<ApiKeyCreateResponse> => {
      const id = `key_${request.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'new'}`
      apiKeys.unshift({
        createdAt: generatedAt.slice(0, 10),
        expiresAt: request.expires_at ?? null,
        fingerprint: `fp_${id.slice(-6).toUpperCase()}`,
        id,
        lastUsedAt: null,
        name: request.name,
        owner: developmentSession.name,
        scopes: request.scopes,
        status: 'active',
      })
      return {
        api_key: 'lumen_key_one_time_value',
        expires_at: request.expires_at ?? null,
        id,
        key_prefix: 'lumen_key_dev',
        name: request.name,
      }
    },
    createHost: async (request: HostCreateRequest): Promise<HostRecord> => {
      const host: HostRecord = {
        address: request.address ?? request.hostname,
        excluded_internal_squad_ids: request.excluded_internal_squad_ids ?? [],
        final_mask: request.final_mask ?? null,
        hidden: request.hidden ?? false,
        hostname: request.hostname,
        id: `host_${request.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        inbound_tag: request.inbound_tag ?? null,
        metadata_json: request.metadata_json ?? {},
        mihomo_x25519_public_key: request.mihomo_x25519_public_key ?? null,
        mux_json: request.mux_json ?? {},
        name: request.name,
        node_id: request.node_id,
        path: request.path ?? null,
        port: request.port ?? null,
        protocol_profile_id: request.protocol_profile_id ?? null,
        remark: request.remark ?? null,
        security: request.security ?? null,
        shuffle_host: request.shuffle_host ?? false,
        sni: request.sni ?? null,
        sockopt_json: request.sockopt_json ?? {},
        squad_id: request.squad_id ?? null,
        status: request.status ?? 'active',
        subscription_excluded: request.subscription_excluded ?? false,
        tags: request.tags ?? [],
        xhttp_json: request.xhttp_json ?? {},
        xray_template_json: request.xray_template_json ?? {},
      }
      hosts.unshift(host)
      return host
    },
    createProfile: async (
      request: ProtocolProfileCreateRequest,
    ): Promise<ProtocolProfileRecord> => {
      const profile: ProtocolProfileRecord = {
        adapter: request.adapter,
        config_json: request.config_json ?? {},
        credentials_ref: request.credentials_ref ?? null,
        id: `profile_${request.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        metadata_json: request.metadata_json ?? {},
        name: request.name,
        node_id: request.node_id,
        port_reservations: request.port_reservations ?? [],
        squad_id: request.squad_id ?? null,
        status: request.status ?? 'active',
      }
      profiles.unshift(profile)
      return profile
    },
    applyProfileToNode: async (profileId: string) => {
      const profile = profiles.find((item) => item.id === profileId)
      if (!profile) {
        throw new Error(`Profile ${profileId} was not found`)
      }
      const command = createDevelopmentNodeCommand(profile.node_id, {
        command_type: 'outbound.apply',
        payload_json: {
          adapter: profile.adapter,
          profileId: profile.id,
        },
      })
      return {
        adapter: profile.adapter,
        command_id: command.id,
        command_type: command.command_type,
        node_id: command.node_id,
        status: command.status,
      }
    },
    createProvisioningJob: async (request) => buildDevelopmentProvisioningJob(request),
    createNodeCommand: async (nodeId: string, request: NodeCommandCreateRequest) =>
      createDevelopmentNodeCommand(nodeId, request),
    updateNode: async (nodeId: string, request: NodeUpdateRequest) => {
      const node = asNodeResponse({ ...nodeRecords[0], id: nodeId })
      return { ...node, ...request, id: nodeId }
    },
    deleteNode: async (nodeId: string) =>
      asNodeResponse({ ...nodeRecords[0], id: nodeId, status: 'offline' }),
    reorderNodes: async (_request: NodeReorderRequest) => asNodeListResponse(),
    bulkNodes: async (_request: NodeBulkActionRequest) => asNodeListResponse(),
    restartNode: async (nodeId: string) =>
      createDevelopmentNodeCommand(nodeId, {
        command_type: 'node.restart',
        payload_json: { reason: 'development client' },
      }),
    restartAllNodes: async () => ({
      items: nodeRecords.map((node) =>
        createDevelopmentNodeCommand(node.id, {
          command_type: 'node.restart',
          payload_json: { reason: 'development client' },
        }),
      ),
    }),
    resetNodeTraffic: async (nodeId: string) =>
      createDevelopmentNodeCommand(nodeId, {
        command_type: 'node.traffic.reset',
        payload_json: { reason: 'development client' },
      }),
    createSquad: async (request: SquadCreateRequest): Promise<SquadRecord> => {
      const squad: SquadRecord = {
        id: `squad_${request.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        kind: request.kind ?? 'internal',
        metadata_json: request.metadata_json ?? {},
        name: request.name,
        status: request.status ?? 'active',
      }
      squads.unshift(squad)
      return squad
    },
    createSubscription: async (request: SubscriptionCreateRequest): Promise<SubscriptionRecord> => {
      const deliveryProfile = request.delivery_profile ?? {}
      const publicId = `sub_pub_${request.user_id}`
      const now = new Date().toISOString()
      const subscription: SubscriptionRecord = {
        config_hash: request.config_hash ?? null,
        created_at: now,
        delivery_profile: deliveryProfile,
        expires_at: request.expires_at ?? null,
        id: `sub_${request.user_id}_${Date.now()}`,
        license_id: request.license_id,
        node_id: request.node_id ?? null,
        public_id: publicId,
        ...subscriptionPublicFields(publicId, deliveryProfile),
        revoked_at: null,
        status: 'active',
        updated_at: now,
        user_id: request.user_id,
      }
      subscriptions.unshift(subscription)
      return subscription
    },
    cloneSubscription: async (subscriptionId: string): Promise<SubscriptionRecord> => {
      const source = subscriptions.find((item) => item.id === subscriptionId)
      if (!source) {
        throw new Error('Subscription not found')
      }
      const publicId = `sub_pub_clone_${Date.now()}`
      const now = new Date().toISOString()
      const clone: SubscriptionRecord = {
        ...source,
        created_at: now,
        id: `sub_clone_${Date.now()}`,
        public_id: publicId,
        ...subscriptionPublicFields(publicId, source.delivery_profile),
        revoked_at: null,
        status: 'active',
        updated_at: now,
      }
      subscriptions.unshift(clone)
      return clone
    },
    createSubscriptionTemplate: async (
      request: SubscriptionTemplateCreateRequest,
    ): Promise<SubscriptionTemplateRecord> => {
      const template: SubscriptionTemplateRecord = {
        content_json: request.content_json ?? {},
        format: request.format,
        id: `tpl_${Date.now()}`,
        name: request.name,
        order: request.order ?? templates.length,
        status: request.status ?? 'active',
      }
      templates.unshift(template)
      return template
    },
    createResponseRule: async (request: ResponseRuleCreateRequest): Promise<ResponseRuleRecord> => {
      const rule: ResponseRuleRecord = {
        body: request.body ?? '',
        enabled: request.enabled ?? true,
        headers: request.headers ?? {},
        id: `rule_${Date.now()}`,
        name: request.name,
        order: request.order ?? responseRules.length,
        status_code: request.status_code ?? 200,
        trigger_status: request.trigger_status,
      }
      responseRules.unshift(rule)
      return rule
    },
    createUser: async (request: UserCreateRequest): Promise<UserRecord> => {
      const now = new Date().toISOString()
      const user: UserRecord = {
        created_at: now,
        device_limit: request.device_limit ?? null,
        display_name: request.display_name ?? request.username ?? null,
        email: request.email,
        expires_at: request.expires_at ?? null,
        id: `user_${request.email.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        metadata_json: request.metadata_json ?? {},
        role: request.role ?? 'user',
        status: request.status ?? 'active',
        tags: request.tags ?? [],
        telegram_id: request.telegram_id ?? null,
        traffic_limit_gb: request.traffic_limit_gb ?? null,
        traffic_used_gb: request.traffic_used_gb ?? 0,
        updated_at: now,
        username: request.username ?? null,
      }
      users.unshift(user)
      return user
    },
    deleteHost: async (hostId: string) => {
      const index = hosts.findIndex((host) => host.id === hostId)
      if (index >= 0) {
        hosts.splice(index, 1)
      }
    },
    deleteProfile: async (profileId: string) => {
      const index = profiles.findIndex((profile) => profile.id === profileId)
      if (index >= 0) {
        profiles.splice(index, 1)
      }
    },
    deleteSquad: async (squadId: string) => {
      const index = squads.findIndex((squad) => squad.id === squadId)
      if (index >= 0) {
        squads.splice(index, 1)
      }
    },
    deleteSubscriptionTemplate: async (templateId: string) => {
      const index = templates.findIndex((template) => template.id === templateId)
      if (index >= 0) {
        templates.splice(index, 1)
      }
    },
    deleteSubscription: async (subscriptionId: string) => {
      const index = subscriptions.findIndex((subscription) => subscription.id === subscriptionId)
      if (index >= 0) {
        subscriptions.splice(index, 1)
      }
    },
    deleteResponseRule: async (ruleId: string) => {
      const index = responseRules.findIndex((rule) => rule.id === ruleId)
      if (index >= 0) {
        responseRules.splice(index, 1)
      }
    },
    deleteUser: async (userId: string) => {
      const index = users.findIndex((user) => user.id === userId)
      if (index >= 0) {
        users.splice(index, 1)
      }
    },
    getUser: async (userId: string): Promise<UserRecord> => {
      const user = users.find((item) => item.id === userId)
      if (!user) {
        throw new Error('User not found')
      }
      return user
    },
    getProfile: async (profileId: string): Promise<ProtocolProfileRecord> => {
      const profile = profiles.find((item) => item.id === profileId)
      if (!profile) {
        throw new Error('Profile not found')
      }
      return profile
    },
    getProfileComputedConfig: async (profileId: string) => {
      const profile = profiles.find((item) => item.id === profileId)
      if (!profile) {
        throw new Error('Profile not found')
      }
      const nodeList = asNodeListResponse().items
      const node = nodeList.find((item) => item.id === profile.node_id) ?? nodeList[0]
      const inbounds = buildDevelopmentProfileInbounds(profile, node)
      return {
        computed_config: {
          ...profile.config_json,
          inbounds,
          log: { loglevel: 'warning' },
          routing: { rules: [] },
        },
        inbounds,
        node: {
          capabilities: node?.capabilities ?? {},
          id: node?.id ?? profile.node_id,
          name: node?.name ?? profile.node_id,
          public_address: node?.public_address ?? '127.0.0.1',
          region: node?.region ?? 'dev',
          status: node?.status ?? 'unknown',
        },
        profile,
      }
    },
    listProfileInbounds: async (profileId: string) => {
      const profile = profiles.find((item) => item.id === profileId)
      if (!profile) {
        throw new Error('Profile not found')
      }
      const nodeList = asNodeListResponse().items
      const node = nodeList.find((item) => item.id === profile.node_id) ?? nodeList[0]
      return { items: buildDevelopmentProfileInbounds(profile, node) }
    },
    listGlobalProfileInbounds: async () => {
      const nodeList = asNodeListResponse().items
      return {
        items: profiles.flatMap((profile) => {
          const node = nodeList.find((item) => item.id === profile.node_id) ?? nodeList[0]
          return buildDevelopmentProfileInbounds(profile, node)
        }),
      }
    },
    getUserDetail: async (userId: string) => {
      const user = users.find((item) => item.id === userId)
      if (!user) {
        throw new Error('User not found')
      }
      return buildUserDetail(user)
    },
    getSquadDetail: async (squadId: string): Promise<SquadDetailResponse> => {
      const squad = squads.find((item) => item.id === squadId)
      if (!squad) {
        throw new Error('Squad not found')
      }
      const memberIds = Array.isArray(squad.metadata_json.user_ids)
        ? squad.metadata_json.user_ids.map(String)
        : []
      const squadProfiles = profiles.filter((profile) => profile.squad_id === squad.id)
      const squadHosts = hosts.filter((host) => host.squad_id === squad.id)
      const nodeIds = new Set([
        ...squadProfiles.map((profile) => profile.node_id),
        ...squadHosts.map((host) => host.node_id),
      ])
      const nodes = asNodeListResponse().items.filter((node) => nodeIds.has(node.id))
      return {
        hosts: squadHosts.map((host) => ({
          hostname: host.hostname,
          id: host.id,
          inbound_tag: host.inbound_tag,
          name: host.name,
          node_id: host.node_id,
          port: host.port,
          protocol_profile_id: host.protocol_profile_id,
          status: host.status,
        })),
        inbound_matrix: squadProfiles.flatMap((profile) =>
          profile.port_reservations.map((reservation, index) => ({
            adapter: profile.adapter,
            config_json: profile.config_json,
            credentials_ref: profile.credentials_ref,
            hosts: squadHosts.filter((host) => host.protocol_profile_id === profile.id),
            listen: String(reservation.address ?? '0.0.0.0'),
            node_id: profile.node_id,
            node_name: nodes.find((node) => node.id === profile.node_id)?.name ?? profile.node_id,
            port: Number(reservation.port),
            profile_id: profile.id,
            profile_name: profile.name,
            protocol: profile.adapter.split('-', 1)[0],
            security: profile.adapter.includes('reality') ? 'reality' : 'none',
            status: profile.status,
            tag: String(profile.config_json.tag ?? `${profile.adapter}-${index}`),
            transport: String(profile.config_json.transport ?? 'tcp'),
          })),
        ),
        nodes: nodes.map((node) => ({
          id: node.id,
          name: node.name,
          public_address: node.public_address,
          region: node.region,
          status: node.status,
        })),
        profiles: squadProfiles.map((profile) => ({
          adapter: profile.adapter,
          id: profile.id,
          inbounds: profile.port_reservations.map((_reservation, index) => `${profile.adapter}-${index}`),
          name: profile.name,
          node_id: profile.node_id,
          status: profile.status,
        })),
        squad,
        users: users
          .filter((user) => memberIds.includes(user.id))
          .map((user) => ({
            display_name: user.display_name,
            email: user.email,
            id: user.id,
            status: user.status,
            tags: user.tags,
            username: user.username,
          })),
      }
    },
    getSession: async () => developmentSession,
    listApiKeys: async () => asListResponse(apiKeys),
    listHosts: async (): Promise<HostListResponse> => ({ items: hosts }),
    listLicenses: async (): Promise<LicenseListResponse> => ({ items: licenseRecords }),
    listNodes: async () => asNodeListResponse(),
    getNodeOverview: async (nodeId: string) => buildDevelopmentNodeOverview(nodeId),
    listNodeCommands: async (nodeId: string) => ({
      items: nodeCommands.filter((command) => command.node_id === nodeId),
    }),
    listNodeMetrics: async (nodeId: string) => ({
      items: [
        {
          created_at: generatedAt,
          id: `metric_${nodeId}`,
          metric_kind: 'runtime',
          node_id: nodeId,
          observed_at: generatedAt,
          values_json: { event_loop_ms: 20.1, ram_mib: 256 },
        },
      ],
    }),
    listProfiles: async (): Promise<ProtocolProfileListResponse> => ({ items: profiles }),
    listProtocolAdapters: async (): Promise<ProtocolAdapterListResponse> => ({
      items: protocolAdapters,
    }),
    listSettings: async (): Promise<SettingListResponse> => ({ items: settings }),
    listSettingGroups: async (): Promise<SettingGroupListResponse> => ({ items: settingGroups }),
    listAuthProviders: async () => ({ items: authProviders }),
    listSquads: async (): Promise<SquadListResponse> => ({ items: squads }),
    listSubscriptions: async (): Promise<SubscriptionListResponse> => ({
      items: subscriptions,
    }),
    lookupSubscriptions: async (query: string): Promise<SubscriptionListResponse> => {
      const normalizedQuery = query.trim().toLowerCase()
      return {
        items: subscriptions.filter((subscription) => {
          const user = users.find((item) => item.id === subscription.user_id)
          return [
            subscription.id,
            subscription.public_id,
            user?.email,
            user?.username,
            user?.display_name,
          ].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery))
        }),
      }
    },
    listSubscriptionDevices: async (subscriptionId: string) => {
      const subscription = subscriptions.find((item) => item.id === subscriptionId)
      const user = users.find((item) => item.id === subscription?.user_id)
      const rawDevices = Array.isArray(user?.metadata_json.devices)
        ? user?.metadata_json.devices
        : []
      return {
        items: rawDevices
          .filter((device): device is Record<string, unknown> => {
            return typeof device === 'object' && device !== null && device.subscription_id === subscriptionId
          })
          .map((device, index) => ({
            hwid: typeof device.hwid === 'string' ? device.hwid : null,
            id: String(device.id ?? device.hwid ?? `device-${index + 1}`),
            label: typeof device.label === 'string' ? device.label : null,
            last_seen_at: typeof device.last_seen_at === 'string' ? device.last_seen_at : null,
            metadata_json: device,
            platform: typeof device.platform === 'string' ? device.platform : null,
            status: String(device.status ?? 'active'),
          })),
      }
    },
    listSubscriptionTemplates: async () => ({ items: templates }),
    listResponseRules: async () => ({ items: responseRules }),
    readToolSummary: async (): Promise<ToolSummaryResponse> => ({
      happ_routes: subscriptions.length,
      hwid_over_limit: users.filter((user) => {
        const devices = Array.isArray(user.metadata_json.devices)
          ? user.metadata_json.devices
          : []
        return user.device_limit !== null && devices.length > user.device_limit
      }).length,
      sessions_active: 1,
      torrent_events: 0,
    }),
    inspectHwid: async (): Promise<HwidInspectorResponse> => ({
      items: users.map((user) => {
        const deviceRecords = Array.isArray(user.metadata_json.devices)
          ? (user.metadata_json.devices as Record<string, unknown>[]).map((device, index) => {
              const id = String(device.id ?? device.hwid ?? `device-${index + 1}`)
              return {
                hwid: device.hwid === undefined ? null : String(device.hwid),
                id,
                label: String(device.label ?? device.hwid ?? id),
                platform: device.platform === undefined ? null : String(device.platform),
                status: String(device.status ?? 'active'),
              }
            })
          : []
        return {
          device_count: deviceRecords.length,
          device_limit: user.device_limit,
          device_records: deviceRecords,
          devices: deviceRecords.map((device) => device.label),
          email: user.email,
          status:
            user.device_limit !== null && deviceRecords.length > user.device_limit
              ? 'over_limit'
              : 'ok',
          user_id: user.id,
          username: user.username,
        }
      }),
    }),
    inspectSrh: async (): Promise<SrhInspectorResponse> => ({
      items: subscriptions.map((subscription) => {
        const parser =
          subscription.delivery_profile.client ?? subscription.delivery_profile.format ?? 'generic'
        return {
          config_hash: subscription.config_hash,
          parser,
          public_id: subscription.public_id,
          response_headers: {
            'Profile-Update-Interval': subscription.delivery_profile.update_interval ?? '24',
            'X-Lumen-Parser': parser,
            'X-Lumen-Subscription-Status': subscription.status,
          },
          status: subscription.status,
          subscription_id: subscription.id,
          user_id: subscription.user_id,
        }
      }),
    }),
    inspectSessions: async (): Promise<SessionInspectorResponse> => ({
      items: users.slice(0, 3).map((user) => ({
        created_at: generatedAt,
        email: user.email,
        expires_at: user.expires_at ?? generatedAt,
        id: `session-${user.id}`,
        ip_fingerprint: null,
        is_current: false,
        revoked_at: null,
        status: 'active',
        updated_at: user.updated_at,
        user_agent_fingerprint: null,
        user_id: user.id,
      })),
    }),
    inspectTorrentReports: async (): Promise<TorrentReportResponse> => ({ items: [] }),
    truncateTorrentReports: async (): Promise<TorrentReportResponse> => ({ items: [] }),
    generateX25519Keypair: async () => ({
      encoding: 'base64url-nopad',
      private_key: 'development-private-key-not-for-production-use',
      public_key: 'development-public-key-not-for-production-use',
    }),
    generateNodeKey: async () => ({
      hash_algorithm: 'hmac-sha256',
      stored: false,
      token: `lumen_node_development_${Date.now()}`,
      token_prefix: 'lumen_node_develop',
    }),
    listToolSnippets: async () => ({
      items: [],
    }),
    createToolSnippet: async (request) => ({
      content: request.content,
      description: request.description ?? null,
      id: `snippet-${Date.now()}`,
      language: request.language ?? 'text',
      name: request.name,
      order: request.order ?? 0,
      updated_at: generatedAt,
      updated_by: developmentSession.userId,
    }),
    updateToolSnippet: async (snippetId, request) => ({
      content: request.content ?? 'updated snippet',
      description: request.description ?? null,
      id: snippetId,
      language: request.language ?? 'text',
      name: request.name ?? 'Updated snippet',
      order: request.order ?? 0,
      updated_at: generatedAt,
      updated_by: developmentSession.userId,
    }),
    deleteToolSnippet: async () => ({
      items: [],
    }),
    revokeToolSession: async (sessionId: string): Promise<SessionInspectorResponse> => ({
      items: users.slice(0, 3).map((user) => ({
        created_at: generatedAt,
        email: user.email,
        expires_at: user.expires_at ?? generatedAt,
        id: `session-${user.id}`,
        ip_fingerprint: null,
        is_current: false,
        revoked_at: `session-${user.id}` === sessionId ? `2026-05-28T00:00:00.000Z` : null,
        status: `session-${user.id}` === sessionId ? 'revoked' : 'active',
        updated_at: user.updated_at,
        user_agent_fingerprint: null,
        user_id: user.id,
      })),
    }),
    inspectHappRouting: async (): Promise<HappRoutingResponse> => ({
      items: subscriptions.map((subscription) => {
        const node = asNodeListResponse().items.find((item) => item.id === subscription.node_id)
        const user = users.find((item) => item.id === subscription.user_id)
        return {
          delivery_profile: subscription.delivery_profile,
          node_id: subscription.node_id,
          node_name: node?.name ?? null,
          node_status: node?.status ?? null,
          public_id: subscription.public_id,
          route_status: subscription.node_id ? 'happ' : 'unassigned',
          subscription_id: subscription.id,
          user_id: subscription.user_id,
          username: user?.username ?? null,
        }
      }),
    }),
    listUsers: async (): Promise<UserListResponse> => ({ items: users }),
    lookupUsers: async (query: string) => {
      const normalizedQuery = query.trim().toLowerCase()
      if (!normalizedQuery) {
        return { items: [], query, strategy: 'none' }
      }
      const tag = normalizedQuery.startsWith('tag:') ? normalizedQuery.slice(4).trim() : normalizedQuery
      const tagMatches = users.filter((user) => user.tags.some((item) => item.toLowerCase() === tag))
      if (tagMatches.length > 0) {
        return { items: tagMatches, query, strategy: 'tag' }
      }
      const items = users.filter((user) => {
        const shortId = user.id.replace(/-/g, '').toLowerCase()
        const numericId = String(user.metadata_json.numeric_id ?? user.metadata_json.id ?? '').toLowerCase()
        return [
          user.id,
          shortId,
          user.email,
          user.username,
          user.display_name,
          user.telegram_id,
          numericId,
        ].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery))
      })
      return { items, query, strategy: items.length === 0 ? 'none' : 'identity' }
    },
    login: async () => ({
      challengeToken: 'dev-mfa-challenge',
      expiresAt: '2026-05-27T00:05:00.000Z',
      methods: [
        {
          confirmed_at: '2026-05-27T00:00:00.000Z',
          id: 'dev-mfa-method',
          kind: 'totp',
          label: 'Authenticator',
          last_used_at: null,
          status: 'active',
        },
      ],
    }),
    listLoginMethods: async () => ({ items: [] }),
    startOAuth: async () => {
      throw new Error('OAuth sign-in is not available in the development client.')
    },
    webauthnAuthenticateOptions: async () => {
      throw new Error('Passkey sign-in is not available in the development client.')
    },
    webauthnAuthenticateVerify: async () => {
      throw new Error('Passkey sign-in is not available in the development client.')
    },
    listMfaMethods: async () => ({ items: mfaMethods }),
    setupTotp: async (label: string) => ({
      method_id: `mfa_${Date.now()}`,
      otpauth_url: `otpauth://totp/Lumen:${encodeURIComponent(label || 'dev@example.com')}?secret=DEVSECRET&issuer=Lumen`,
      secret: 'DEVSECRET',
      status: 'pending' as const,
    }),
    verifyTotpSetup: async (methodId: string, _code: string) => {
      mfaMethods.unshift({
        confirmed_at: new Date().toISOString(),
        id: methodId,
        kind: 'totp',
        label: 'Development authenticator',
        last_used_at: null,
        status: 'active',
      })
      return { items: mfaMethods }
    },
    deleteMfaMethod: async (methodId: string) => {
      const index = mfaMethods.findIndex((item) => item.id === methodId)
      if (index >= 0) {
        mfaMethods.splice(index, 1)
      }
    },
    webauthnRegisterOptions: async () => ({
      challenge_id: 'dev-passkey-challenge',
      options: { challenge: 'ZGV2LWNoYWxsZW5nZQ', rp: { name: 'Lumen' }, user: { id: 'ZGV2', name: 'dev@example.com', displayName: 'Dev' }, pubKeyCredParams: [] },
    }),
    webauthnRegisterVerify: async (_challengeId: string, _credential: Record<string, unknown>, label?: string | null) => {
      const credential = {
        aaguid: null,
        created_at: new Date().toISOString(),
        id: `passkey_${Date.now()}`,
        label: label ?? 'Development passkey',
        last_used_at: null,
        sign_count: 0,
        transports: [],
      }
      webauthnCredentials.unshift(credential)
      return credential
    },
    listWebAuthnCredentials: async () => ({ items: webauthnCredentials }),
    deleteWebAuthnCredential: async (credentialId: string) => {
      const index = webauthnCredentials.findIndex((item) => item.id === credentialId)
      if (index >= 0) {
        webauthnCredentials.splice(index, 1)
      }
    },
    telegramLogin: async () => {
      throw new Error('Telegram sign-in is not available in the development client.')
    },
    logout: async () => undefined,
    readProvisioningJob: async (jobId) =>
      buildDevelopmentProvisioningJob(
        {
          idempotency_key: jobId.replace(/^job_/, '') || 'dev-job',
          kind: 'node.provision',
          node: {
            name: 'dev-node',
            public_address: 'dev-node.lumen.local',
            region: 'development',
          },
          requested_capabilities: {},
          ssh: {
            credentials_ref: 'vault://lumen/nodes/dev-node/ssh',
            host: 'dev-node.lumen.local',
            port: 22,
            username: 'root',
          },
        },
        jobId,
      ),
    pauseNode: async (nodeId: string) =>
      asNodeResponse({ ...nodeRecords[0], id: nodeId, status: 'degraded' }),
    resumeNode: async (nodeId: string) =>
      asNodeResponse({ ...nodeRecords[0], id: nodeId, status: 'healthy' }),
    quarantineNode: async (nodeId: string) =>
      asNodeResponse({ ...nodeRecords[0], id: nodeId, status: 'offline' }),
    readLicense: async () => licenseSummary,
    readPanelIdentity: async () => ({
      default_locale: 'ru',
      docs_url: 'https://docs.lumentech.tel',
      product_name: 'Lumen',
      support_url: 'https://support.lumentech.tel',
    }),
    revokeApiKey: async (apiKeyId: string) => {
      const record = apiKeys.find((key) => key.id === apiKeyId)
      if (record) {
        record.status = 'revoked'
      }
    },
    revokeSubscription: async (subscriptionId: string) => {
      const subscription = subscriptions.find((item) => item.id === subscriptionId)
      if (!subscription) {
        throw new Error('Subscription not found')
      }
      subscription.status = 'revoked'
      subscription.revoked_at = new Date().toISOString()
      return subscription
    },
    addSquadUsers: async (squadId: string, request: SquadUserMutationRequest) => {
      const squad = squads.find((item) => item.id === squadId)
      if (!squad) {
        throw new Error('Squad not found')
      }
      const current = Array.isArray(squad.metadata_json.user_ids)
        ? squad.metadata_json.user_ids.map(String)
        : []
      for (const userId of request.user_ids) {
        if (!current.includes(userId)) {
          current.push(userId)
        }
      }
      squad.metadata_json = { ...squad.metadata_json, user_ids: current }
      return squad
    },
    removeSquadUsers: async (squadId: string, request: SquadUserMutationRequest) => {
      const squad = squads.find((item) => item.id === squadId)
      if (!squad) {
        throw new Error('Squad not found')
      }
      const removeIds = new Set(request.user_ids)
      const current = Array.isArray(squad.metadata_json.user_ids)
        ? squad.metadata_json.user_ids.map(String)
        : []
      squad.metadata_json = {
        ...squad.metadata_json,
        user_ids: current.filter((userId) => !removeIds.has(userId)),
      }
      return squad
    },
    reorderHosts: async (ids: string[]) => {
      const ordered = ids
        .map((id) => hosts.find((host) => host.id === id))
        .filter((host): host is HostRecord => Boolean(host))
      const remainder = hosts.filter((host) => !ids.includes(host.id))
      hosts.splice(0, hosts.length, ...ordered, ...remainder)
      ordered.forEach((host, order) => {
        host.metadata_json = { ...host.metadata_json, order }
      })
      return { updated: ordered.length }
    },
    reorderProfiles: async (ids: string[]) => {
      const ordered = ids
        .map((id) => profiles.find((profile) => profile.id === id))
        .filter((profile): profile is ProtocolProfileRecord => Boolean(profile))
      const remainder = profiles.filter((profile) => !ids.includes(profile.id))
      profiles.splice(0, profiles.length, ...ordered, ...remainder)
      ordered.forEach((profile, order) => {
        profile.metadata_json = { ...profile.metadata_json, order }
      })
      return { updated: ordered.length }
    },
    reorderSquads: async (ids: string[]) => {
      const ordered = ids
        .map((id) => squads.find((squad) => squad.id === id))
        .filter((squad): squad is SquadRecord => Boolean(squad))
      const remainder = squads.filter((squad) => !ids.includes(squad.id))
      squads.splice(0, squads.length, ...ordered, ...remainder)
      ordered.forEach((squad, order) => {
        squad.metadata_json = { ...squad.metadata_json, order }
      })
      return { updated: ordered.length }
    },
    reorderSubscriptionTemplates: async (ids: string[]) => {
      const ordered = ids
        .map((id) => templates.find((template) => template.id === id))
        .filter((template): template is SubscriptionTemplateRecord => Boolean(template))
      const remainder = templates.filter((template) => !ids.includes(template.id))
      templates.splice(0, templates.length, ...ordered, ...remainder)
      ordered.forEach((template, order) => {
        template.order = order
      })
      return { updated: ordered.length }
    },
    reorderResponseRules: async (ids: string[]) => {
      const ordered = ids
        .map((id) => responseRules.find((rule) => rule.id === id))
        .filter((rule): rule is ResponseRuleRecord => Boolean(rule))
      const remainder = responseRules.filter((rule) => !ids.includes(rule.id))
      responseRules.splice(0, responseRules.length, ...ordered, ...remainder)
      ordered.forEach((rule, order) => {
        rule.order = order
      })
      return { updated: ordered.length }
    },
    testResponseRule: async (request) => {
      const rule = responseRules.find(
        (item) => item.enabled && item.trigger_status === request.subscription_status,
      )
      return {
        body: rule?.body ?? '',
        headers: rule?.headers ?? {},
        matched: Boolean(rule),
        rule: rule ?? null,
        status_code: rule?.status_code ?? 200,
      }
    },
    bulkUsers: async (
      action: string,
      request: UserBulkActionRequest,
    ) => {
      const selected = users.filter((user) => request.user_ids.includes(user.id))
      for (const user of selected) {
        if (action === 'reset-traffic') {
          user.traffic_used_gb = 0
        }
        if (action === 'status' && request.status) {
          user.status = request.status
        }
        if (action === 'revoke') {
          user.status = 'revoked'
        }
        if (action === 'tag') {
          user.tags = request.tags ?? []
        }
        if (action === 'extend') {
          user.expires_at = request.expires_at ?? null
        }
        if (action === 'traffic') {
          user.traffic_used_gb = Math.max(0, user.traffic_used_gb + (request.traffic_delta_gb ?? 0))
        }
      }
      if (action === 'delete') {
        for (const user of selected) {
          const index = users.findIndex((item) => item.id === user.id)
          if (index >= 0) {
            users.splice(index, 1)
          }
        }
      }
      if ((action === 'squad-add' || action === 'squad-remove') && request.squad_id) {
        const squad = squads.find((item) => item.id === request.squad_id)
        if (squad) {
          const current = Array.isArray(squad.metadata_json.user_ids)
            ? squad.metadata_json.user_ids.map(String)
            : []
          squad.metadata_json = {
            ...squad.metadata_json,
            user_ids: action === 'squad-add'
              ? Array.from(new Set([...current, ...request.user_ids]))
              : current.filter((userId) => !request.user_ids.includes(userId)),
          }
        }
      }
      return { items: selected, updated: selected.length }
    },
    disableUser: async (userId: string) => {
      const user = users.find((item) => item.id === userId)
      if (!user) {
        throw new Error('User not found')
      }
      user.status = 'disabled'
      return user
    },
    enableUser: async (userId: string) => {
      const user = users.find((item) => item.id === userId)
      if (!user) {
        throw new Error('User not found')
      }
      user.status = 'active'
      return user
    },
    resetUserTraffic: async (userId: string) => {
      const user = users.find((item) => item.id === userId)
      if (!user) {
        throw new Error('User not found')
      }
      user.traffic_used_gb = 0
      return user
    },
    revokeUser: async (userId: string) => {
      const user = users.find((item) => item.id === userId)
      if (!user) {
        throw new Error('User not found')
      }
      user.status = 'revoked'
      return user
    },
    updateHost: async (hostId: string, request) => {
      const host = hosts.find((item) => item.id === hostId)
      if (!host) {
        throw new Error('Host not found')
      }
      Object.assign(host, request)
      return host
    },
    updateProfile: async (profileId: string, request) => {
      const profile = profiles.find((item) => item.id === profileId)
      if (!profile) {
        throw new Error('Profile not found')
      }
      Object.assign(profile, request)
      return profile
    },
    updateSubscription: async (subscriptionId: string, request: SubscriptionUpdateRequest) => {
      const subscription = subscriptions.find((item) => item.id === subscriptionId)
      if (!subscription) {
        throw new Error('Subscription not found')
      }
      Object.assign(subscription, request)
      return subscription
    },
    updateSubscriptionTemplate: async (
      templateId: string,
      request: SubscriptionTemplateUpdateRequest,
    ) => {
      const template = templates.find((item) => item.id === templateId)
      if (!template) {
        throw new Error('Template not found')
      }
      Object.assign(template, request)
      return template
    },
    updateResponseRule: async (ruleId: string, request: ResponseRuleUpdateRequest) => {
      const rule = responseRules.find((item) => item.id === ruleId)
      if (!rule) {
        throw new Error('Response rule not found')
      }
      Object.assign(rule, request)
      return rule
    },
    updateSquad: async (squadId: string, request: SquadUpdateRequest) => {
      const squad = squads.find((item) => item.id === squadId)
      if (!squad) {
        throw new Error('Squad not found')
      }
      Object.assign(squad, request)
      return squad
    },
    updateUser: async (userId: string, request: UserUpdateRequest) => {
      const user = users.find((item) => item.id === userId)
      if (!user) {
        throw new Error('User not found')
      }
      Object.assign(user, request, { updated_at: new Date().toISOString() })
      return user
    },
    listNodePlugins: async (nodeId?: string) => ({
      items: nodePlugins.filter(
        (plugin) => !nodeId || plugin.node_id === nodeId || plugin.node_id === null,
      ),
    }),
    createNodePlugin: async (request: NodePluginCreateRequest): Promise<NodePluginRecord> => {
      const now = new Date().toISOString()
      const plugin: NodePluginRecord = {
        id: `plugin_${Date.now()}`,
        node_id: request.node_id ?? null,
        kind: request.kind,
        name: request.name,
        config_json: request.config_json ?? {},
        enabled: request.enabled ?? true,
        sort_order: request.sort_order ?? nodePlugins.length * 10,
        created_at: now,
        updated_at: now,
      }
      nodePlugins.unshift(plugin)
      return plugin
    },
    cloneNodePlugin: async (
      pluginId: string,
      request: NodePluginCloneRequest,
    ): Promise<NodePluginRecord> => {
      const source = nodePlugins.find((item) => item.id === pluginId)
      if (!source) {
        throw new Error('Node plugin not found')
      }
      const now = new Date().toISOString()
      const plugin: NodePluginRecord = {
        ...source,
        id: `plugin_${Date.now()}`,
        name: request.name ?? `${source.name} copy`,
        node_id: request.node_id ?? source.node_id,
        enabled: request.enabled ?? source.enabled,
        sort_order: nodePlugins.length * 10,
        created_at: now,
        updated_at: now,
      }
      nodePlugins.push(plugin)
      return plugin
    },
    reorderNodePlugins: async (request: NodePluginReorderRequest) => {
      request.items.forEach((item) => {
        const plugin = nodePlugins.find((entry) => entry.id === item.id)
        if (plugin) {
          plugin.sort_order = item.sort_order
          plugin.updated_at = new Date().toISOString()
        }
      })
      nodePlugins.sort((left, right) => left.sort_order - right.sort_order)
      return { items: [...nodePlugins] }
    },
    applyNodePlugins: async (request: NodePluginApplyRequest): Promise<NodeCommandRecord> => {
      const now = new Date().toISOString()
      return {
        id: `cmd_plugin_${Date.now()}`,
        node_id: request.node_id,
        command_type: 'firewall.plan.apply',
        status: 'queued',
        payload_json: {
          nodePolicy: {
            modelVersion: 'lumen.node-policy.v1',
            plugins: nodePlugins
              .filter((plugin) => plugin.enabled && (!plugin.node_id || plugin.node_id === request.node_id))
              .map((plugin) => ({
                id: plugin.id,
                nodeId: plugin.node_id,
                kind: plugin.kind,
                name: plugin.name,
                config: plugin.config_json,
                enabled: plugin.enabled,
                sortOrder: plugin.sort_order,
              })),
          },
          reason: request.reason ?? 'operator applied node plugin policy',
        },
        result_json: null,
        error_code: null,
        error_message: null,
        claimed_at: null,
        completed_at: null,
        created_at: now,
        updated_at: now,
      }
    },
    updateNodePlugin: async (pluginId: string, request: NodePluginUpdateRequest) => {
      const plugin = nodePlugins.find((item) => item.id === pluginId)
      if (!plugin) {
        throw new Error('Node plugin not found')
      }
      Object.assign(plugin, request, { updated_at: new Date().toISOString() })
      return plugin
    },
    deleteNodePlugin: async (pluginId: string) => {
      const index = nodePlugins.findIndex((item) => item.id === pluginId)
      if (index >= 0) {
        nodePlugins.splice(index, 1)
      }
    },
    listInfraProviders: async () => ({ items: infraProviders }),
    createInfraProvider: async (
      request: InfraProviderCreateRequest,
    ): Promise<InfraProviderRecord> => {
      const now = new Date().toISOString()
      const provider: InfraProviderRecord = {
        id: `provider_${Date.now()}`,
        name: request.name,
        login_url: request.login_url ?? null,
        notes: request.notes ?? null,
        created_at: now,
        updated_at: now,
      }
      infraProviders.unshift(provider)
      return provider
    },
    deleteInfraProvider: async (providerId: string) => {
      const index = infraProviders.findIndex((item) => item.id === providerId)
      if (index >= 0) {
        infraProviders.splice(index, 1)
      }
    },
    listInfraBillingRecords: async () => ({ items: infraBillingRecords }),
    createInfraBillingRecord: async (
      request: InfraBillingRecordCreateRequest,
    ): Promise<InfraBillingRecordRecord> => {
      const now = new Date().toISOString()
      const record: InfraBillingRecordRecord = {
        id: `billing_${Date.now()}`,
        provider_id: request.provider_id,
        node_id: request.node_id ?? null,
        amount: request.amount,
        currency: (request.currency ?? 'USD').toUpperCase(),
        period: request.period,
        note: request.note ?? null,
        created_at: now,
        updated_at: now,
      }
      infraBillingRecords.unshift(record)
      return record
    },
    infraBillingSummary: async () => {
      const totals = new Map<string, { total: number; records: number }>()
      for (const record of infraBillingRecords) {
        const current = totals.get(record.currency) ?? { total: 0, records: 0 }
        current.total += record.amount
        current.records += 1
        totals.set(record.currency, current)
      }
      return {
        providers: infraProviders.length,
        records: infraBillingRecords.length,
        totals_by_currency: Array.from(totals.entries()).map(([currency, value]) => ({
          currency,
          total: value.total,
          records: value.records,
        })),
      }
    },
    clearUserDevices: async (userId: string) => {
      const user = users.find((item) => item.id === userId)
      if (!user) {
        throw new Error('User not found')
      }
      user.metadata_json = { ...user.metadata_json, devices: [] }
      return buildUserDetail(user)
    },
    deleteUserDevice: async (userId: string, deviceId: string) => {
      const user = users.find((item) => item.id === userId)
      if (!user) {
        throw new Error('User not found')
      }
      const devices = Array.isArray(user.metadata_json.devices)
        ? (user.metadata_json.devices as Record<string, unknown>[])
        : []
      user.metadata_json = {
        ...user.metadata_json,
        devices: devices.filter(
          (device) => String(device.id ?? '') !== deviceId && String(device.hwid ?? '') !== deviceId,
        ),
      }
      return buildUserDetail(user)
    },
    verifyMfaChallenge: async () => ({
      ...developmentSession,
      accessToken: 'dev-access-token',
      refreshToken: 'dev-refresh-token',
    }),
    updateAuthProvider: async (
      provider: string,
      request: AuthProviderUpdateRequest,
    ): Promise<AuthProviderRecord> => {
      const record = authProviders.find((item) => item.provider === provider)
      if (!record) {
        throw new Error('Auth provider not found')
      }
      if (request.enabled === true && record.status === 'unimplemented') {
        throw new Error('Auth provider is catalog-only until its live login callback is implemented.')
      }
      Object.assign(record, request)
      return record
    },
    updateSetting: async (key: string, request: SettingUpdateRequest) =>
      updateSettingValue(key, request),
    updateSettingGroup: async (groupKey: string, request: SettingGroupUpdateRequest) =>
      updateSettingGroupValue(groupKey, request),
  }
}
