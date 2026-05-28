import {
  apiKeyRecords,
  hostRecords,
  licenseSummary,
  developmentSession,
  nodeRecords,
  profileRecords,
  protocolAdapters,
  settingRecords,
  squadRecords,
  subscriptionRecords,
  userRecords,
} from '../data/lumenData'
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
  LumenApiClient,
  NodeCommandCreateRequest,
  NodeCommandRecord,
  NodeListResponse,
  NodeRecord,
  NodeResponse,
  PortCheckRequest,
  PortCheckResponse,
  ProtocolAdapterListResponse,
  ProtocolProfileCreateRequest,
  ProtocolProfileListResponse,
  ProtocolProfileRecord,
  ProvisioningJobCreateRequest,
  ProvisioningJobResponse,
  ResponseRuleCreateRequest,
  ResponseRuleRecord,
  ResponseRuleUpdateRequest,
  ResourceListResponse,
  SessionInspectorResponse,
  SettingListResponse,
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
  UserListResponse,
  UserRecord,
  UserUpdateRequest,
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
    status: node.status === 'healthy' ? 'active' : node.status === 'offline' ? 'offline' : 'failed',
  }
}

function asNodeListResponse(): NodeListResponse {
  return {
    items: nodeRecords.map(asNodeResponse),
  }
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
  const nodeCommands: NodeCommandRecord[] = []
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
      status: 'configured',
    },
    {
      display_name: 'Telegram',
      enabled: false,
      metadata_json: { bot_binding: 'api-key' },
      provider: 'telegram',
      scopes: ['admin:login', 'bot:manage'],
      status: 'disabled',
    },
    {
      display_name: 'GitHub',
      enabled: false,
      metadata_json: {},
      provider: 'github',
      scopes: ['read:user', 'user:email'],
      status: 'disabled',
    },
    {
      display_name: 'Google',
      enabled: false,
      metadata_json: {},
      provider: 'google',
      scopes: ['openid', 'email', 'profile'],
      status: 'disabled',
    },
    {
      display_name: 'Keycloak',
      enabled: false,
      metadata_json: {},
      provider: 'keycloak',
      scopes: ['openid', 'email', 'profile'],
      status: 'disabled',
    },
    {
      display_name: 'Generic OAuth2',
      enabled: false,
      metadata_json: {},
      provider: 'generic_oauth2',
      scopes: ['openid', 'email', 'profile'],
      status: 'disabled',
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
        hostname: request.hostname,
        id: `host_${request.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        inbound_tag: request.inbound_tag ?? null,
        metadata_json: request.metadata_json ?? {},
        name: request.name,
        node_id: request.node_id,
        port: request.port ?? null,
        protocol_profile_id: request.protocol_profile_id ?? null,
        remark: request.remark ?? null,
        squad_id: request.squad_id ?? null,
        status: request.status ?? 'active',
        tags: request.tags ?? [],
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
    createProvisioningJob: async (request) => buildDevelopmentProvisioningJob(request),
    createNodeCommand: async (nodeId: string, request: NodeCommandCreateRequest) => {
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
    },
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
      const subscription: SubscriptionRecord = {
        config_hash: request.config_hash ?? null,
        delivery_profile: request.delivery_profile ?? {},
        expires_at: request.expires_at ?? null,
        id: `sub_${request.user_id}_${Date.now()}`,
        license_id: request.license_id,
        node_id: request.node_id ?? null,
        public_id: `sub_pub_${request.user_id}`,
        revoked_at: null,
        status: 'active',
        user_id: request.user_id,
      }
      subscriptions.unshift(subscription)
      return subscription
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
    getUserDetail: async (userId: string) => {
      const user = users.find((item) => item.id === userId)
      if (!user) {
        throw new Error('User not found')
      }
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
    listNodes: async () => asNodeListResponse(),
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
    listAuthProviders: async () => ({ items: authProviders }),
    listSquads: async (): Promise<SquadListResponse> => ({ items: squads }),
    listSubscriptions: async (): Promise<SubscriptionListResponse> => ({
      items: subscriptions,
    }),
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
        const devices = Array.isArray(user.metadata_json.devices)
          ? user.metadata_json.devices.map((device) => String(device))
          : []
        return {
          device_count: devices.length,
          device_limit: user.device_limit,
          devices,
          email: user.email,
          status:
            user.device_limit !== null && devices.length > user.device_limit
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
        status: 'active',
        updated_at: user.updated_at,
        user_agent_fingerprint: null,
        user_id: user.id,
      })),
    }),
    inspectTorrentReports: async (): Promise<TorrentReportResponse> => ({ items: [] }),
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
      }
      return { items: selected, updated: selected.length }
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
      Object.assign(record, request)
      return record
    },
    updateSetting: async (key: string, request: SettingUpdateRequest) =>
      updateSettingValue(key, request),
  }
}
