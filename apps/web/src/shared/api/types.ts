export type ApiSource = 'api' | 'mock'

export type ResourceListResponse<TItem> = {
  generatedAt: string
  items: TItem[]
  source: ApiSource
  total: number
}

export type AuthSession = {
  email: string
  expiresAt: string
  name: string
  role: 'owner' | 'admin' | 'operator' | 'auditor'
  scopes: string[]
  userId: string
}

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

export type NodeStatus = 'healthy' | 'degraded' | 'offline'

export type NodeRecord = {
  activeUsers: number
  id: string
  lastSeenAt: string
  loadPercent: number
  name: string
  region: string
  status: NodeStatus
  transports: string[]
  version: string
}

export type LumenApiClient = {
  getSession: () => Promise<AuthSession | null>
  listApiKeys: () => Promise<ResourceListResponse<ApiKeyRecord>>
  listNodes: () => Promise<ResourceListResponse<NodeRecord>>
  listUsers: () => Promise<ResourceListResponse<AdminUserRecord>>
  readLicense: () => Promise<LicenseSummary | null>
}
