import {
  BadgeCheck,
  Cable,
  Fingerprint,
  KeyRound,
  RadioTower,
  Rss,
  ServerCog,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import type {
  ApiKeyRecord,
  AuthSession,
  HostRecord,
  LicenseSummary,
  NodeRecord,
  ProtocolAdapterRecord,
  ProtocolProfileRecord,
  SettingRecord,
  SquadRecord,
  SubscriptionRecord,
  UserRecord,
} from '../api/types'

export type MetricTone = 'danger' | 'good' | 'info' | 'neutral' | 'watch'

export type DashboardMetric = {
  label: string
  value: string
  detail: string
  tone: MetricTone
  icon: LucideIcon
}

export type SectionSpec = {
  title: string
  eyebrow: string
  description: string
  status: string
  primaryAction: string
  icon: LucideIcon
  items: string[]
}

export const sectionSpecs: Record<string, SectionSpec> = {
  users: {
    title: 'Users',
    eyebrow: 'Identity registry',
    description: 'Provision accounts, inspect subscription state, and prepare traffic policies.',
    status: 'API backed',
    primaryAction: 'New user',
    icon: UsersRound,
    items: ['Search, segment, and bulk actions', 'Usage limits and expiry controls', 'MFA and portal access flags'],
  },
  nodes: {
    title: 'Nodes',
    eyebrow: 'Infrastructure mesh',
    description: 'Register relay nodes, track health probes, and coordinate safe config rollout.',
    status: 'Live telemetry',
    primaryAction: 'Register node',
    icon: ServerCog,
    items: ['Health, load, and version status', 'Inbound transport inventory', 'Drain and maintenance workflows'],
  },
  hosts: {
    title: 'Hosts',
    eyebrow: 'Ingress hosts',
    description: 'Map domains and certificates to delivery groups without exposing secrets.',
    status: 'DNS mapped',
    primaryAction: 'Add host',
    icon: Cable,
    items: ['SNI and public endpoint labels', 'Certificate expiry timeline', 'Host-to-node assignment plan'],
  },
  profiles: {
    title: 'Profiles',
    eyebrow: 'Client delivery',
    description: 'Shape subscription profiles, transport defaults, and user-facing config bundles.',
    status: 'Profile builder',
    primaryAction: 'New profile',
    icon: Fingerprint,
    items: ['Protocol and transport defaults', 'Template versioning', 'Client-safe subscription output'],
  },
  squads: {
    title: 'Squads',
    eyebrow: 'Access groups',
    description: 'Group users and nodes into operational lanes with staged policy changes.',
    status: 'Policy groups',
    primaryAction: 'Create squad',
    icon: RadioTower,
    items: ['Membership and inherited limits', 'Route and node affinity', 'Release channels for testing'],
  },
  subscription: {
    title: 'Subscription',
    eyebrow: 'Public config surface',
    description: 'Control subscription endpoint behavior, cache windows, and client metadata.',
    status: 'Endpoint active',
    primaryAction: 'Configure feed',
    icon: Rss,
    items: ['Safe URL rendering with no secrets logged', 'Client compatibility switches', 'Cache purge and import checks'],
  },
  license: {
    title: 'License',
    eyebrow: 'Instance entitlement',
    description: 'Expose license health, renewal windows, and seat pressure without storing keys in UI.',
    status: 'Entitlement status',
    primaryAction: 'Check status',
    icon: BadgeCheck,
    items: ['License summary and expiry', 'Feature gates and limits', 'Audit trail for entitlement checks'],
  },
  apiKeys: {
    title: 'API keys',
    eyebrow: 'Automation access',
    description: 'Prepare scoped token management for integrations and admin automation.',
    status: 'Scoped tokens',
    primaryAction: 'Create key',
    icon: KeyRound,
    items: ['Scoped permissions matrix', 'Last-used metadata', 'One-time reveal flow'],
  },
}

export const developmentSession: AuthSession = {
  email: 'operator@lumen.local',
  expiresAt: '2026-05-27T23:59:59Z',
  name: 'Control Plane Operator',
  role: 'admin',
  scopes: ['users:read', 'nodes:read', 'license:read', 'api-keys:read'],
  userId: 'usr_dev_operator',
}

export const apiKeyRecords: ApiKeyRecord[] = [
  {
    createdAt: '2026-05-13',
    expiresAt: '2026-08-13',
    fingerprint: 'fp_6C91_AUDIT',
    id: 'key_audit_export',
    lastUsedAt: '2026-05-27T00:12:00Z',
    name: 'Audit export worker',
    owner: 'Control Plane Operator',
    scopes: ['audit:read', 'api-keys:read'],
    status: 'active',
  },
  {
    createdAt: '2026-04-22',
    expiresAt: '2026-06-01',
    fingerprint: 'fp_2F44_ROTATE',
    id: 'key_rotation_probe',
    lastUsedAt: '2026-05-26T22:36:00Z',
    name: 'Rotation probe',
    owner: 'SRE automation',
    scopes: ['nodes:read'],
    status: 'expiring',
  },
]

export const licenseSummary: LicenseSummary = {
  auditEvents: [
    { at: '2026-05-27T00:04:00Z', label: 'Entitlement check succeeded' },
    { at: '2026-05-26T18:45:00Z', label: 'Seat pressure recalculated' },
  ],
  expiresAt: '2026-09-30',
  features: ['Guard admin shell', 'Node health telemetry', 'Scoped automation keys'],
  issuedTo: 'Lumen production instance',
  plan: 'Business mesh',
  seatsLimit: 25000,
  seatsUsed: 18420,
  status: 'valid',
}

export const userRecords: UserRecord[] = [
  {
    created_at: '2026-05-27T00:00:00Z',
    device_limit: 5,
    display_name: 'Mira Volkova',
    email: 'mira@lumen.local',
    expires_at: '2026-08-31T00:00:00Z',
    id: 'usr_mira',
    metadata_json: {},
    role: 'owner',
    status: 'active',
    tags: ['owner'],
    telegram_id: null,
    traffic_limit_gb: 300,
    traffic_used_gb: 184,
    updated_at: '2026-05-27T00:00:00Z',
    username: 'mira',
  },
  {
    created_at: '2026-05-27T00:00:00Z',
    device_limit: 2,
    display_name: 'Nikolai Orlov',
    email: 'nikolai@lumen.local',
    expires_at: '2026-06-15T00:00:00Z',
    id: 'usr_nikolai',
    role: 'admin',
    metadata_json: {},
    status: 'limited',
    tags: ['grace'],
    telegram_id: null,
    traffic_limit_gb: 500,
    traffic_used_gb: 512,
    updated_at: '2026-05-27T00:00:00Z',
    username: 'nikolai',
  },
  {
    created_at: '2026-05-27T00:00:00Z',
    device_limit: 1,
    display_name: 'Beta Squad Relay',
    email: 'beta-relay@lumen.local',
    expires_at: '2026-07-01T00:00:00Z',
    id: 'usr_beta_relay',
    metadata_json: {},
    role: 'user',
    status: 'active',
    tags: ['trial'],
    telegram_id: null,
    traffic_limit_gb: 100,
    traffic_used_gb: 48,
    updated_at: '2026-05-27T00:00:00Z',
    username: 'beta-relay',
  },
]

export const nodeRecords: NodeRecord[] = [
  {
    activeUsers: 912,
    id: 'node_mow_02',
    lastSeenAt: '2026-05-27T00:28:00Z',
    loadPercent: 63,
    name: 'moscow-edge-02',
    region: 'MOW',
    status: 'healthy',
    transports: ['xhttp', 'grpc'],
    version: '2026.05.2',
  },
  {
    activeUsers: 641,
    id: 'node_fra_01',
    lastSeenAt: '2026-05-27T00:25:00Z',
    loadPercent: 78,
    name: 'frankfurt-relay-01',
    region: 'FRA',
    status: 'degraded',
    transports: ['ws', 'grpc'],
    version: '2026.04.8',
  },
  {
    activeUsers: 0,
    id: 'node_ams_03',
    lastSeenAt: '2026-05-26T22:02:00Z',
    loadPercent: 0,
    name: 'amsterdam-drain-03',
    region: 'AMS',
    status: 'offline',
    transports: ['xhttp'],
    version: '2026.04.8',
  },
]

export const protocolAdapters: ProtocolAdapterRecord[] = [
  {
    capabilities: ['tcp', 'tls', 'reality', 'xhttp'],
    display_name: 'VLESS Reality',
    protocol: 'vless',
    required_credential_refs: ['client.uuid', 'reality.private_key'],
    status: 'ready',
  },
  {
    capabilities: ['tcp', 'tls', 'websocket'],
    display_name: 'Trojan TLS',
    protocol: 'trojan',
    required_credential_refs: ['password'],
    status: 'ready',
  },
  {
    capabilities: ['native', '2022-blake3'],
    display_name: 'Shadowsocks Native',
    protocol: 'shadowsocks',
    required_credential_refs: ['method', 'password'],
    status: 'catalog',
  },
]

export const squadRecords: SquadRecord[] = [
  {
    id: 'squad_default',
    kind: 'internal',
    metadata_json: { channel: 'stable', hwid_limit: '5' },
    name: 'Default-Squad',
    status: 'active',
  },
  {
    id: 'squad_external_trial',
    kind: 'external',
    metadata_json: { channel: 'trial', hwid_limit: '2' },
    name: 'External trial',
    status: 'active',
  },
]

export const profileRecords: ProtocolProfileRecord[] = [
  {
    adapter: 'vless',
    config_json: { flow: 'xtls-rprx-vision', transport: 'tcp', security: 'reality' },
    credentials_ref: 'vault://lumen/profiles/stealconfig',
    id: 'profile_stealconfig',
    metadata_json: {},
    name: 'StealConfig',
    node_id: 'node_mow_02',
    port_reservations: [{ address: '0.0.0.0', exclusive: true, port: 443, protocol: 'tcp' }],
    squad_id: 'squad_default',
    status: 'active',
  },
  {
    adapter: 'trojan',
    config_json: { transport: 'xhttp', security: 'tls' },
    credentials_ref: 'vault://lumen/profiles/trojanxhttp',
    id: 'profile_trojan_xhttp',
    metadata_json: {},
    name: 'Trojan XHTTP TLS',
    node_id: 'node_fra_01',
    port_reservations: [{ address: '0.0.0.0', exclusive: true, port: 8443, protocol: 'tcp' }],
    squad_id: 'squad_external_trial',
    status: 'active',
  },
]

export const hostRecords: HostRecord[] = [
  {
    address: 'auto.lumen.local',
    hostname: 'auto.lumen.local',
    id: 'host_auto_wifi',
    inbound_tag: 'AUTO_WIFI',
    metadata_json: {},
    name: 'Auto WiFi',
    node_id: 'node_mow_02',
    port: 443,
    protocol_profile_id: 'profile_stealconfig',
    remark: 'Default host',
    squad_id: 'squad_default',
    status: 'active',
    tags: ['auto-wifi', 'balancer'],
  },
  {
    address: 'de.lumen.local',
    hostname: 'de.lumen.local',
    id: 'host_germany_wifi',
    inbound_tag: 'DE_WIFI',
    metadata_json: {},
    name: 'Germany WiFi',
    node_id: 'node_fra_01',
    port: 8443,
    protocol_profile_id: 'profile_trojan_xhttp',
    remark: 'Germany host',
    squad_id: 'squad_external_trial',
    status: 'active',
    tags: ['lte', 'reality'],
  },
]

export const subscriptionRecords: SubscriptionRecord[] = [
  {
    config_hash: 'sha256:subscription-fixture',
    delivery_profile: {
      client: 'happ',
      hwid_limit: '5',
      traffic_limit_gb: '300',
    },
    expires_at: '2026-09-30T00:00:00Z',
    id: 'sub_default',
    license_id: 'license_business',
    node_id: 'node_mow_02',
    public_id: 'sub_pub_default',
    revoked_at: null,
    status: 'active',
    user_id: 'usr_mira',
  },
]

export const settingRecords: SettingRecord[] = [
  {
    id: 'setting_subscription_info',
    key: 'subscription.info',
    updated_at: '2026-05-27T00:00:00Z',
    updated_by: developmentSession.userId,
    value_json: {
      auto_update_hours: '2',
      support_url: 'https://t.me/lumentech_support_bot',
      title: 'LUMEN',
    },
  },
  {
    id: 'setting_auth_providers',
    key: 'auth.providers',
    updated_at: '2026-05-27T00:00:00Z',
    updated_by: developmentSession.userId,
    value_json: {
      generic_oauth2: 'disabled',
      github: 'disabled',
      google: 'disabled',
      passkey: 'disabled_until_registered',
      telegram: 'disabled',
    },
  },
]
