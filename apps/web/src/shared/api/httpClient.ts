import type {
  ApiKeyCreateRequest,
  AuthSession,
  HostCreateRequest,
  LoginRequest,
  LoginApiResponse,
  MfaChallengeVerifyRequest,
  LumenApiClient,
  PortCheckRequest,
  ProtocolProfileCreateRequest,
  ProvisioningJobCreateRequest,
  SettingUpdateRequest,
  SquadCreateRequest,
  TokenPairResponse,
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
    options: { body?: unknown; method?: 'DELETE' | 'GET' | 'POST' | 'PUT' } = {},
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
    createSquad: (payload: SquadCreateRequest) =>
      request('/api/v1/squads', { body: payload, method: 'POST' }),
    listApiKeys: () => request('/api/admin/api-keys'),
    listHosts: () => request('/api/v1/hosts'),
    listNodes: () => request('/api/v1/nodes'),
    listProfiles: () => request('/api/v1/profiles'),
    listProtocolAdapters: () => request('/api/v1/protocols/adapters'),
    listSettings: () => request('/api/v1/settings'),
    listSquads: () => request('/api/v1/squads'),
    listSubscriptions: () => request('/api/v1/subscriptions'),
    listUsers: () => request('/api/admin/users'),
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
      const tokenPair = loginResponse
      return {
        accessToken: tokenPair.access_token,
        email: payload.email,
        expiresAt: tokenPair.expires_at,
        name: payload.email,
        refreshToken: tokenPair.refresh_token,
        role: 'admin',
        scopes: [],
        userId: payload.email,
      }
    },
    readProvisioningJob: (jobId: string) => request(`/api/v1/nodes/provisioning-jobs/${jobId}`),
    readLicense: () => request('/api/admin/license'),
    revokeApiKey: (apiKeyId: string) =>
      request(`/api/v1/api-keys/${apiKeyId}`, { method: 'DELETE' }),
    verifyMfaChallenge: async (payload: MfaChallengeVerifyRequest) => {
      const tokenPair = await request<TokenPairResponse>('/api/v1/auth/mfa/challenge/verify', {
        body: {
          challenge_token: payload.challengeToken,
          code: payload.code,
          method_id: payload.methodId,
        },
        method: 'POST',
      })
      return {
        accessToken: tokenPair.access_token,
        email: 'verified-operator@lumen.local',
        expiresAt: tokenPair.expires_at,
        name: 'Verified operator',
        refreshToken: tokenPair.refresh_token,
        role: 'admin',
        scopes: [],
        userId: 'verified-operator',
      }
    },
    logout: () => request('/api/v1/auth/logout', { method: 'POST' }),
    updateSetting: (key: string, payload: SettingUpdateRequest) =>
      request(`/api/v1/settings/${encodeURIComponent(key)}`, { body: payload, method: 'PUT' }),
  }
}
