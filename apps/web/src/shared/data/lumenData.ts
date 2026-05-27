import {
  Activity,
  BadgeCheck,
  Cable,
  Fingerprint,
  Gauge,
  KeyRound,
  Network,
  RadioTower,
  Rss,
  ServerCog,
  ShieldCheck,
  TriangleAlert,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import type {
  AdminUserRecord,
  ApiKeyRecord,
  AuthSession,
  LicenseSummary,
  NodeRecord,
} from '../api/types'

export type MetricTone = 'danger' | 'good' | 'info' | 'neutral' | 'watch'

export type DashboardMetric = {
  label: string
  value: string
  detail: string
  tone: MetricTone
  icon: LucideIcon
}

export type ActivityEvent = {
  label: string
  meta: string
  tone: MetricTone
}

export type PlaceholderSpec = {
  title: string
  eyebrow: string
  description: string
  status: string
  primaryAction: string
  icon: LucideIcon
  items: string[]
}

export const dashboardMetrics: DashboardMetric[] = [
  {
    label: 'Active users',
    value: '18,420',
    detail: '+8.1% this week',
    tone: 'good',
    icon: UsersRound,
  },
  {
    label: 'Healthy nodes',
    value: '42 / 45',
    detail: '3 nodes need attention',
    tone: 'watch',
    icon: Network,
  },
  {
    label: 'Ingress traffic',
    value: '9.8 Tb',
    detail: 'rolling 24h',
    tone: 'neutral',
    icon: Activity,
  },
  {
    label: 'Guard posture',
    value: 'MFA 96%',
    detail: '4 privileged accounts pending',
    tone: 'watch',
    icon: ShieldCheck,
  },
]

export const activityFeed: ActivityEvent[] = [
  { label: 'Moscow edge-02 rotated inbound certificate', meta: '8 min ago', tone: 'good' },
  { label: 'Two users exceeded profile burst limit', meta: '17 min ago', tone: 'watch' },
  { label: 'API key audit export finished', meta: '31 min ago', tone: 'neutral' },
  { label: 'Subscription ruleset staged for beta squad', meta: '44 min ago', tone: 'good' },
]

export const placeholderSpecs: Record<string, PlaceholderSpec> = {
  users: {
    title: 'Users',
    eyebrow: 'Identity registry',
    description: 'Provision accounts, inspect subscription state, and prepare traffic policies.',
    status: 'CRUD pending',
    primaryAction: 'New user',
    icon: UsersRound,
    items: ['Search, segment, and bulk actions', 'Usage limits and expiry controls', 'MFA and portal access flags'],
  },
  nodes: {
    title: 'Nodes',
    eyebrow: 'Infrastructure mesh',
    description: 'Register relay nodes, track health probes, and coordinate safe config rollout.',
    status: 'Telemetry pending',
    primaryAction: 'Register node',
    icon: ServerCog,
    items: ['Health, load, and version status', 'Inbound transport inventory', 'Drain and maintenance workflows'],
  },
  hosts: {
    title: 'Hosts',
    eyebrow: 'Ingress hosts',
    description: 'Map domains and certificates to delivery groups without exposing secrets.',
    status: 'DNS pending',
    primaryAction: 'Add host',
    icon: Cable,
    items: ['SNI and public endpoint labels', 'Certificate expiry timeline', 'Host-to-node assignment plan'],
  },
  profiles: {
    title: 'Profiles',
    eyebrow: 'Client delivery',
    description: 'Shape subscription profiles, transport defaults, and user-facing config bundles.',
    status: 'Builder pending',
    primaryAction: 'New profile',
    icon: Fingerprint,
    items: ['Protocol and transport defaults', 'Template versioning', 'Preview-safe subscription output'],
  },
  squads: {
    title: 'Squads',
    eyebrow: 'Access groups',
    description: 'Group users and nodes into operational lanes with staged policy changes.',
    status: 'Rules pending',
    primaryAction: 'Create squad',
    icon: RadioTower,
    items: ['Membership and inherited limits', 'Route and node affinity', 'Release channels for testing'],
  },
  subscription: {
    title: 'Subscription',
    eyebrow: 'Public config surface',
    description: 'Control subscription endpoint behavior, cache windows, and client metadata.',
    status: 'Endpoint pending',
    primaryAction: 'Configure feed',
    icon: Rss,
    items: ['Safe URL rendering with no secrets logged', 'Client compatibility switches', 'Cache purge and preview hooks'],
  },
  license: {
    title: 'License',
    eyebrow: 'Instance entitlement',
    description: 'Expose license health, renewal windows, and seat pressure without storing keys in UI.',
    status: 'Read-only pending',
    primaryAction: 'Check status',
    icon: BadgeCheck,
    items: ['License summary and expiry', 'Feature gates and limits', 'Audit trail for entitlement checks'],
  },
  apiKeys: {
    title: 'API keys',
    eyebrow: 'Automation access',
    description: 'Prepare scoped token management for integrations and admin automation.',
    status: 'Vault pending',
    primaryAction: 'Create key',
    icon: KeyRound,
    items: ['Scoped permissions matrix', 'Last-used metadata', 'One-time reveal flow placeholder'],
  },
}

export const mockSession: AuthSession = {
  email: 'operator@lumen.local',
  expiresAt: '2026-05-27T23:59:59Z',
  name: 'Control Plane Operator',
  role: 'admin',
  scopes: ['users:read', 'nodes:read', 'license:read', 'api-keys:read'],
  userId: 'usr_mock_operator',
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

export const userRecords: AdminUserRecord[] = [
  {
    displayName: 'Mira Volkova',
    email: 'mira@lumen.local',
    expiresAt: '2026-08-31',
    id: 'usr_mira',
    mfaEnabled: true,
    role: 'owner',
    status: 'active',
    subscription: 'paid',
    trafficUsedGb: 184,
  },
  {
    displayName: 'Nikolai Orlov',
    email: 'nikolai@lumen.local',
    expiresAt: '2026-06-15',
    id: 'usr_nikolai',
    mfaEnabled: true,
    role: 'admin',
    status: 'limited',
    subscription: 'grace',
    trafficUsedGb: 512,
  },
  {
    displayName: 'Beta Squad Relay',
    email: 'beta-relay@lumen.local',
    expiresAt: '2026-07-01',
    id: 'usr_beta_relay',
    mfaEnabled: false,
    role: 'user',
    status: 'active',
    subscription: 'trial',
    trafficUsedGb: 48,
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

export async function getDashboardOverview() {
  return {
    activityFeed,
    metrics: dashboardMetrics,
    riskItems: [
      { label: 'Node pool drift', value: '3 outdated', icon: TriangleAlert },
      { label: 'Capacity headroom', value: '72%', icon: Gauge },
    ],
  }
}
