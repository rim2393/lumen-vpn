import type {
  ApiKeyCreateRequest,
  HostBulkActionRequest,
  AuthSession,
  AuthProviderUpdateRequest,
  HostCreateRequest,
  HostUpdateRequest,
  LoginRequest,
  LoginApiResponse,
  LoginMethodsResponse,
  MfaChallengeVerifyRequest,
  LumenApiClient,
  NodePluginCreateRequest,
  NodePluginUpdateRequest,
  InfraProviderCreateRequest,
  InfraBillingRecordCreateRequest,
  OAuthStartResponse,
  TelegramLoginPayload,
  WebAuthnOptionsApiResponse,
  NodeCommandCreateRequest,
  NodeBulkActionRequest,
  NodePauseRequest,
  NodeQuarantineRequest,
  NodeReorderRequest,
  NodeResumeRequest,
  NodeUpdateRequest,
  PortCheckRequest,
  ProfileBulkActionRequest,
  ProtocolProfileCreateRequest,
  ProtocolProfileUpdateRequest,
  ProvisioningJobCreateRequest,
  ResponseRuleCreateRequest,
  ResponseRuleUpdateRequest,
  SettingUpdateRequest,
  SquadCreateRequest,
  SquadUpdateRequest,
  SquadUserMutationRequest,
  SubscriptionCreateRequest,
  SubscriptionTemplateCreateRequest,
  SubscriptionTemplateUpdateRequest,
  SubscriptionUpdateRequest,
  ToolSnippetCreateRequest,
  ToolSnippetUpdateRequest,
  TokenPairResponse,
  UserBulkActionRequest,
  UserCreateRequest,
  UserUpdateRequest,
} from './types'

type HttpClientOptions = {
  baseUrl: string
  fetcher?: typeof fetch
  getSession: () => AuthSession | null
}

export class LumenApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'LumenApiError'
    this.status = status
  }
}

export function createHttpLumenApiClient({
  baseUrl,
  fetcher = fetch,
  getSession,
}: HttpClientOptions): LumenApiClient {
  async function request<TResponse>(
    path: string,
    options: { body?: unknown; method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT' } = {},
  ): Promise<TResponse> {
    const session = getSession()
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Lumen-User': session?.userId ?? 'anonymous',
    }

    if (session?.accessToken) {
      headers.Authorization = `Bearer ${session.accessToken}`
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetcher(new URL(path, baseUrl), {
      credentials: 'include',
      headers,
      method: options.method ?? 'GET',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    if (!response.ok) {
      let message = `API request failed with status ${response.status}`

      try {
        const payload = (await response.json()) as { error?: { message?: string } }
        message = payload.error?.message ?? message
      } catch {
        // Keep the status-based fallback when the server does not return JSON.
      }

      throw new LumenApiError(message, response.status)
    }

    if (response.status === 204) {
      return undefined as TResponse
    }

    return (await response.json()) as TResponse
  }

  return {
    bulkHosts: (action: string, payload: HostBulkActionRequest) =>
      request(`/api/v1/hosts/bulk/${encodeURIComponent(action)}`, {
        body: payload,
        method: 'POST',
      }),
    bulkProfiles: (action: string, payload: ProfileBulkActionRequest) =>
      request(
        `/api/v1/profiles/bulk/${action === 'delete' ? 'delete' : action === 'status' ? 'status' : encodeURIComponent(action)}`,
        {
          body: payload,
          method: 'POST',
        },
      ),
    bulkUsers: (action: string, payload: UserBulkActionRequest) =>
      request(`/api/v1/users/bulk/${encodeURIComponent(action)}`, {
        body: payload,
        method: 'POST',
      }),
    checkPortConflicts: (payload: PortCheckRequest) =>
      request('/api/v1/protocols/port-check', { body: payload, method: 'POST' }),
    createApiKey: (payload: ApiKeyCreateRequest) =>
      request('/api/v1/api-keys', { body: payload, method: 'POST' }),
    createHost: (payload: HostCreateRequest) =>
      request('/api/v1/hosts', { body: payload, method: 'POST' }),
    createProfile: (payload: ProtocolProfileCreateRequest) =>
      request('/api/v1/profiles', { body: payload, method: 'POST' }),
    createProvisioningJob: (payload: ProvisioningJobCreateRequest) =>
      request('/api/v1/nodes/provisioning-jobs', { body: payload, method: 'POST' }),
    createNodeCommand: (nodeId: string, payload: NodeCommandCreateRequest) =>
      request(`/api/v1/nodes/${nodeId}/commands`, { body: payload, method: 'POST' }),
    updateNode: (nodeId: string, payload: NodeUpdateRequest) =>
      request(`/api/v1/nodes/${nodeId}`, { body: payload, method: 'PATCH' }),
    deleteNode: (nodeId: string) => request(`/api/v1/nodes/${nodeId}`, { method: 'DELETE' }),
    reorderNodes: (payload: NodeReorderRequest) =>
      request('/api/v1/nodes/reorder', { body: payload, method: 'POST' }),
    bulkNodes: (payload: NodeBulkActionRequest) =>
      request('/api/v1/nodes/bulk', { body: payload, method: 'POST' }),
    restartNode: (nodeId: string) =>
      request(`/api/v1/nodes/${nodeId}/restart`, { method: 'POST' }),
    restartAllNodes: () => request('/api/v1/nodes/restart-all', { method: 'POST' }),
    resetNodeTraffic: (nodeId: string) =>
      request(`/api/v1/nodes/${nodeId}/reset-traffic`, { method: 'POST' }),
    createSquad: (payload: SquadCreateRequest) =>
      request('/api/v1/squads', { body: payload, method: 'POST' }),
    createSubscription: (payload: SubscriptionCreateRequest) =>
      request('/api/v1/subscriptions', { body: payload, method: 'POST' }),
    createSubscriptionTemplate: (payload: SubscriptionTemplateCreateRequest) =>
      request('/api/v1/subscription-templates', { body: payload, method: 'POST' }),
    createResponseRule: (payload: ResponseRuleCreateRequest) =>
      request('/api/v1/response-rules', { body: payload, method: 'POST' }),
    createUser: (payload: UserCreateRequest) =>
      request('/api/v1/users', { body: payload, method: 'POST' }),
    deleteHost: (hostId: string) => request(`/api/v1/hosts/${hostId}`, { method: 'DELETE' }),
    deleteProfile: (profileId: string) =>
      request(`/api/v1/profiles/${profileId}`, { method: 'DELETE' }),
    deleteSquad: (squadId: string) => request(`/api/v1/squads/${squadId}`, { method: 'DELETE' }),
    deleteSubscriptionTemplate: (templateId: string) =>
      request(`/api/v1/subscription-templates/${templateId}`, { method: 'DELETE' }),
    deleteResponseRule: (ruleId: string) =>
      request(`/api/v1/response-rules/${ruleId}`, { method: 'DELETE' }),
    deleteUser: (userId: string) => request(`/api/v1/users/${userId}`, { method: 'DELETE' }),
    clearUserDevices: (userId: string) =>
      request(`/api/v1/users/${userId}/devices`, { method: 'DELETE' }),
    deleteUserDevice: (userId: string, deviceId: string) =>
      request(`/api/v1/users/${userId}/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
      }),
    revokeToolSession: (sessionId: string) =>
      request(`/api/v1/tools/sessions/${sessionId}`, { method: 'DELETE' }),
    getUser: (userId: string) => request(`/api/v1/users/${userId}`),
    getUserDetail: (userId: string) => request(`/api/v1/users/${userId}/detail`),
    getProfile: (profileId: string) => request(`/api/v1/profiles/${profileId}`),
    getProfileComputedConfig: (profileId: string) =>
      request(`/api/v1/profiles/${profileId}/computed-config`),
    listProfileInbounds: (profileId: string) => request(`/api/v1/profiles/${profileId}/inbounds`),
    listGlobalProfileInbounds: () => request('/api/v1/profiles/inbounds'),
    getSquadDetail: (squadId: string) => request(`/api/v1/squads/${squadId}/detail`),
    listApiKeys: () => request('/api/admin/api-keys'),
    listHosts: () => request('/api/v1/hosts'),
    listNodes: () => request('/api/v1/nodes'),
    listNodeCommands: (nodeId: string) => request(`/api/v1/nodes/${nodeId}/commands`),
    listNodeMetrics: (nodeId: string) => request(`/api/v1/nodes/${nodeId}/metrics`),
    listProfiles: () => request('/api/v1/profiles'),
    listProtocolAdapters: () => request('/api/v1/protocols/adapters'),
    listSettings: () => request('/api/v1/settings'),
    listAuthProviders: () => request('/api/v1/settings/auth/providers'),
    listSquads: () => request('/api/v1/squads'),
    listSubscriptions: () => request('/api/v1/subscriptions'),
    listSubscriptionTemplates: () => request('/api/v1/subscription-templates'),
    listResponseRules: () => request('/api/v1/response-rules'),
    readToolSummary: () => request('/api/v1/tools/summary'),
    inspectHwid: () => request('/api/v1/tools/hwid-inspector'),
    inspectSrh: () => request('/api/v1/tools/srh-inspector'),
    inspectSessions: () => request('/api/v1/tools/sessions'),
    inspectTorrentReports: () => request('/api/v1/tools/torrent-blocker-reports'),
    inspectHappRouting: () => request('/api/v1/tools/happ-routing'),
    truncateTorrentReports: () =>
      request('/api/v1/tools/torrent-blocker-reports', { method: 'DELETE' }),
    generateX25519Keypair: () => request('/api/v1/tools/x25519-keypair', { method: 'POST' }),
    generateNodeKey: () => request('/api/v1/tools/node-key', { method: 'POST' }),
    listToolSnippets: () => request('/api/v1/tools/snippets'),
    createToolSnippet: (payload: ToolSnippetCreateRequest) =>
      request('/api/v1/tools/snippets', { body: payload, method: 'POST' }),
    updateToolSnippet: (snippetId: string, payload: ToolSnippetUpdateRequest) =>
      request(`/api/v1/tools/snippets/${snippetId}`, { body: payload, method: 'PATCH' }),
    deleteToolSnippet: (snippetId: string) =>
      request(`/api/v1/tools/snippets/${snippetId}`, { method: 'DELETE' }),
    listUsers: () => request('/api/v1/users'),
    getSession: async () => {
      try {
        return await request('/api/auth/session')
      } catch (error) {
        if (!(error instanceof LumenApiError) || error.status !== 401) {
          throw error
        }
      }

      await request<TokenPairResponse>('/api/v1/auth/refresh', { method: 'POST' })
      return request('/api/auth/session')
    },
    login: async (payload: LoginRequest) => {
      const loginResponse = await request<LoginApiResponse>('/api/v1/auth/login', {
        body: payload,
        method: 'POST',
      })
      if ('mfa_required' in loginResponse && loginResponse.mfa_required) {
        return {
          challengeToken: loginResponse.challenge_token,
          expiresAt: loginResponse.expires_at,
          methods: loginResponse.methods,
        }
      }
      return readSessionAfterTokenIssue(loginResponse)
    },
    listLoginMethods: () => request<LoginMethodsResponse>('/api/v1/auth/providers'),
    startOAuth: (provider: string, redirect?: string) => {
      const query = redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''
      return request<OAuthStartResponse>(
        `/api/v1/auth/oauth/${encodeURIComponent(provider)}/start${query}`,
      )
    },
    webauthnAuthenticateOptions: (email?: string) =>
      request<WebAuthnOptionsApiResponse>('/api/v1/auth/webauthn/authenticate/options', {
        body: { email: email ?? null },
        method: 'POST',
      }),
    webauthnAuthenticateVerify: async (
      challengeId: string,
      credential: Record<string, unknown>,
    ) => {
      const result = await request<LoginApiResponse>(
        '/api/v1/auth/webauthn/authenticate/verify',
        { body: { challenge_id: challengeId, credential }, method: 'POST' },
      )
      if ('mfa_required' in result && result.mfa_required) {
        return {
          challengeToken: result.challenge_token,
          expiresAt: result.expires_at,
          methods: result.methods,
        }
      }
      return readSessionAfterTokenIssue(result)
    },
    telegramLogin: async (payload: TelegramLoginPayload) => {
      const result = await request<LoginApiResponse>('/api/v1/auth/oauth/telegram/callback', {
        body: payload,
        method: 'POST',
      })
      if ('mfa_required' in result && result.mfa_required) {
        return {
          challengeToken: result.challenge_token,
          expiresAt: result.expires_at,
          methods: result.methods,
        }
      }
      return readSessionAfterTokenIssue(result)
    },
    readProvisioningJob: (jobId: string) => request(`/api/v1/nodes/provisioning-jobs/${jobId}`),
    pauseNode: (nodeId: string, payload: NodePauseRequest) =>
      request(`/api/v1/nodes/${nodeId}/pause`, { body: payload, method: 'POST' }),
    resumeNode: (nodeId: string, payload: NodeResumeRequest) =>
      request(`/api/v1/nodes/${nodeId}/resume`, { body: payload, method: 'POST' }),
    quarantineNode: (nodeId: string, payload: NodeQuarantineRequest) =>
      request(`/api/v1/nodes/${nodeId}/quarantine`, { body: payload, method: 'POST' }),
    readLicense: () => request('/api/admin/license'),
    revokeApiKey: (apiKeyId: string) =>
      request(`/api/v1/api-keys/${apiKeyId}`, { method: 'DELETE' }),
    revokeSubscription: (subscriptionId: string) =>
      request(`/api/v1/subscriptions/${subscriptionId}/revoke`, { method: 'POST' }),
    addSquadUsers: (squadId: string, payload: SquadUserMutationRequest) =>
      request(`/api/v1/squads/${squadId}/users`, { body: payload, method: 'POST' }),
    removeSquadUsers: (squadId: string, payload: SquadUserMutationRequest) =>
      request(`/api/v1/squads/${squadId}/users/remove`, { body: payload, method: 'POST' }),
    reorderHosts: (ids: string[]) =>
      request('/api/v1/hosts/actions/reorder', { body: { ids }, method: 'POST' }),
    reorderSquads: (ids: string[]) =>
      request('/api/v1/squads/actions/reorder', { body: { ids }, method: 'POST' }),
    reorderSubscriptionTemplates: (ids: string[]) =>
      request('/api/v1/subscription-templates/actions/reorder', { body: { ids }, method: 'POST' }),
    reorderResponseRules: (ids: string[]) =>
      request('/api/v1/response-rules/actions/reorder', { body: { ids }, method: 'POST' }),
    testResponseRule: (payload) =>
      request('/api/v1/response-rules/test', { body: payload, method: 'POST' }),
    updateHost: (hostId: string, payload: HostUpdateRequest) =>
      request(`/api/v1/hosts/${hostId}`, { body: payload, method: 'PATCH' }),
    updateProfile: (profileId: string, payload: ProtocolProfileUpdateRequest) =>
      request(`/api/v1/profiles/${profileId}`, { body: payload, method: 'PATCH' }),
    updateSubscription: (subscriptionId: string, payload: SubscriptionUpdateRequest) =>
      request(`/api/v1/subscriptions/${subscriptionId}`, { body: payload, method: 'PATCH' }),
    updateSubscriptionTemplate: (
      templateId: string,
      payload: SubscriptionTemplateUpdateRequest,
    ) => request(`/api/v1/subscription-templates/${templateId}`, { body: payload, method: 'PATCH' }),
    updateResponseRule: (ruleId: string, payload: ResponseRuleUpdateRequest) =>
      request(`/api/v1/response-rules/${ruleId}`, { body: payload, method: 'PATCH' }),
    verifyMfaChallenge: async (payload: MfaChallengeVerifyRequest) => {
      const tokenPair = await request<TokenPairResponse>('/api/v1/auth/mfa/challenge/verify', {
        body: {
          challenge_token: payload.challengeToken,
          code: payload.code,
          method_id: payload.methodId,
        },
        method: 'POST',
      })
      return readSessionAfterTokenIssue(tokenPair)
    },
    logout: () => request('/api/v1/auth/logout', { method: 'POST' }),
    updateAuthProvider: (provider: string, payload: AuthProviderUpdateRequest) =>
      request(`/api/v1/settings/auth/providers/${encodeURIComponent(provider)}`, {
        body: payload,
        method: 'PATCH',
      }),
    updateSetting: (key: string, payload: SettingUpdateRequest) =>
      request(`/api/v1/settings/${encodeURIComponent(key)}`, { body: payload, method: 'PUT' }),
    updateSquad: (squadId: string, payload: SquadUpdateRequest) =>
      request(`/api/v1/squads/${squadId}`, { body: payload, method: 'PATCH' }),
    updateUser: (userId: string, payload: UserUpdateRequest) =>
      request(`/api/v1/users/${userId}`, { body: payload, method: 'PATCH' }),
    listNodePlugins: (nodeId?: string) =>
      request(`/api/v1/node-plugins${nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : ''}`),
    createNodePlugin: (payload: NodePluginCreateRequest) =>
      request('/api/v1/node-plugins', { body: payload, method: 'POST' }),
    updateNodePlugin: (pluginId: string, payload: NodePluginUpdateRequest) =>
      request(`/api/v1/node-plugins/${pluginId}`, { body: payload, method: 'PATCH' }),
    deleteNodePlugin: (pluginId: string) =>
      request(`/api/v1/node-plugins/${pluginId}`, { method: 'DELETE' }),
    listInfraProviders: () => request('/api/v1/infra-billing/providers'),
    createInfraProvider: (payload: InfraProviderCreateRequest) =>
      request('/api/v1/infra-billing/providers', { body: payload, method: 'POST' }),
    deleteInfraProvider: (providerId: string) =>
      request(`/api/v1/infra-billing/providers/${providerId}`, { method: 'DELETE' }),
    listInfraBillingRecords: () => request('/api/v1/infra-billing/records'),
    createInfraBillingRecord: (payload: InfraBillingRecordCreateRequest) =>
      request('/api/v1/infra-billing/records', { body: payload, method: 'POST' }),
    infraBillingSummary: () => request('/api/v1/infra-billing/summary'),
  }

  async function readSessionAfterTokenIssue(tokenPair: TokenPairResponse): Promise<AuthSession> {
    const session = await request<AuthSession>('/api/auth/session')
    return {
      ...session,
      accessToken: tokenPair.access_token,
      refreshToken: tokenPair.refresh_token,
    }
  }
}
