import { useState, type FormEvent } from 'react'
import { ExternalLink, RefreshCw, Rss, Save, ShieldX, Smartphone } from 'lucide-react'
import {
  useCreateSubscription,
  useHostsPageData,
  useNodesPageData,
  useProfilesPageData,
  useRevokeSubscription,
  useSubscriptionsPageData,
  useUpdateSubscription,
  useUsersPageData,
} from '../shared/api/resourceHooks'
import type { HostRecord, ProtocolProfileRecord, SubscriptionRecord } from '../shared/api/types'
import { OperatorGuide } from '../shared/components/OperatorGuide'
import {
  FormError,
  ResourceScreen,
  ScreenForm,
  SubmitButton,
} from '../shared/components/ResourceScreen'
import { StatusBadge } from '../shared/components/StatusBadge'
import { sectionSpecs } from '../shared/data/lumenData'
import { useI18n } from '../shared/i18n/I18nProvider'
import { formatDateTime, formatRecord, toneForStatus } from '../shared/utils/resourceFormat'

export function SubscriptionPage() {
  const { t } = useI18n()
  const query = useSubscriptionsPageData()
  const usersQuery = useUsersPageData()
  const nodesQuery = useNodesPageData()
  const profilesQuery = useProfilesPageData()
  const hostsQuery = useHostsPageData()
  const createSubscription = useCreateSubscription()
  const updateSubscription = useUpdateSubscription()
  const revokeSubscription = useRevokeSubscription()
  const subscriptions = query.data?.items ?? []
  const users = usersQuery.data?.items ?? []
  const nodes = nodesQuery.data?.items ?? []
  const activeSubscription = subscriptions.find((subscription) => subscription.status === 'active') ?? subscriptions[0]
  const subscriptionBaseUrl = activeSubscription ? buildSubscriptionUrl(activeSubscription.public_id) : null

  return (
    <ResourceScreen
      caption="Subscription inventory"
      actions={
        <div className="action-cluster">
          {subscriptionBaseUrl ? (
            <>
              <a className="button button--primary" href={subscriptionBaseUrl} target="_blank" rel="noreferrer">
                <Rss size={18} aria-hidden="true" />
                {t('Open subscription page')}
              </a>
              <a className="button button--secondary" href={`${subscriptionBaseUrl}/happ`} target="_blank" rel="noreferrer">
                <Smartphone size={18} aria-hidden="true" />
                Happ
              </a>
            </>
          ) : null}
          <button
            type="button"
            className="button button--secondary"
            aria-label={t('Refresh subscription')}
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={18} aria-hidden="true" />
            {t('Refresh')}
          </button>
        </div>
      }
      columns={['Public ID', 'User', 'Node', 'Delivery profile', 'Expires', 'Config hash', 'Status', 'Actions']}
      emptyDescription="Subscription records will appear after user/license/node bindings are created."
      emptyTitle="No subscriptions"
      error={query.error}
      errorTitle="Subscriptions unavailable"
      isError={query.isError}
      isLoading={query.isLoading}
      isSuccess={query.isSuccess}
      items={subscriptions}
      loadingLabel="Loading subscriptions..."
      onRefresh={() => void query.refetch()}
      renderRow={(subscription) => ({
        cells: [
          subscription.public_id,
          users.find((user) => user.id === subscription.user_id)?.display_name ??
            subscription.user_id,
          nodes.find((node) => node.id === subscription.node_id)?.name ?? subscription.node_id ?? t('All nodes'),
          formatRecord(subscription.delivery_profile),
          subscription.expires_at ? formatDateTime(subscription.expires_at) : t('Not set'),
          subscription.config_hash ?? t('Not generated'),
          <StatusBadge tone={toneForStatus(subscription.status)}>{subscription.status}</StatusBadge>,
          <SubscriptionActions
            subscription={subscription}
            onRevoke={() => void revokeSubscription.mutateAsync(subscription.id)}
            onToggle={() =>
              void updateSubscription.mutateAsync({
                id: subscription.id,
                request: { status: subscription.status === 'active' ? 'disabled' : 'active' },
              })
            }
          />,
        ],
        id: subscription.id,
      })}
      rightPanel={
        <SubscriptionGuide subscription={activeSubscription} />
      }
      createForm={
        <SubscriptionCreateForm
          defaultLicenseId={subscriptions[0]?.license_id ?? ''}
          hosts={hostsQuery.data?.items ?? []}
          nodes={nodes}
          onCreate={async (request) => {
            await createSubscription.mutateAsync(request)
            await query.refetch()
          }}
          pending={createSubscription.isPending}
          profiles={profilesQuery.data?.items ?? []}
          users={users}
        />
      }
      spec={sectionSpecs.subscription}
      tableEyebrow="Public config surface"
      tableTitle="Subscription feed records"
    />
  )
}

function SubscriptionActions({
  onRevoke,
  onToggle,
  subscription,
}: {
  onRevoke: () => void
  onToggle: () => void
  subscription: SubscriptionRecord
}) {
  const { t } = useI18n()
  const baseUrl = buildSubscriptionUrl(subscription.public_id)

  return (
    <div className="inline-actions" aria-label={t('Subscription actions')}>
      <button type="button" className="text-link text-link--button" onClick={onToggle}>
        <Save size={14} aria-hidden="true" />
        {subscription.status === 'active' ? t('Disable') : t('Enable')}
      </button>
      <button type="button" className="text-link text-link--button" onClick={onRevoke}>
        <ShieldX size={14} aria-hidden="true" />
        {t('Revoke')}
      </button>
      <a className="text-link" href={baseUrl} target="_blank" rel="noreferrer">
        {t('Page')}
      </a>
      <a className="text-link" href={`${baseUrl}/happ`} target="_blank" rel="noreferrer">
        Happ
      </a>
      <a className="text-link" href={`${baseUrl}/mihomo`} target="_blank" rel="noreferrer">
        Mihomo
      </a>
    </div>
  )
}

function SubscriptionCreateForm({
  defaultLicenseId,
  hosts,
  nodes,
  onCreate,
  pending,
  profiles,
  users,
}: {
  defaultLicenseId: string
  hosts: HostRecord[]
  nodes: Array<{ id: string; name: string }>
  onCreate: (request: {
    delivery_profile: Record<string, string>
    license_id: string
    node_id: string
    user_id: string
  }) => Promise<void>
  pending: boolean
  profiles: ProtocolProfileRecord[]
  users: Array<{ email: string; id: string; username: string | null }>
}) {
  const { t } = useI18n()
  const [userId, setUserId] = useState(users[0]?.id ?? '')
  const [licenseId, setLicenseId] = useState(defaultLicenseId)
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? '')
  const [profileId, setProfileId] = useState('')
  const [hostId, setHostId] = useState('')
  const [clientPreset, setClientPreset] = useState('happ')
  const [deliveryProfile, setDeliveryProfile] = useState(
    [
      'protocol=vless-tcp-tls',
      'adapter=vless-tcp-tls',
      'format=happ',
      'profile_title=Lumen',
      'security=tls',
      'server_name=panel.89-185-85-184.sslip.io',
      'alpn=h2,http/1.1',
      'traffic_limit_gb=500',
    ].join(', '),
  )
  const [formError, setFormError] = useState<string | null>(null)
  const profilesForNode = profiles.filter((profile) => !nodeId || profile.node_id === nodeId)
  const hostsForNode = hosts.filter((host) => !nodeId || host.node_id === nodeId)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    try {
      if (!userId || !licenseId.trim() || !nodeId) {
        setFormError(t('User, license, and node are required.'))
        return
      }
      const parsedDeliveryProfile = parseDeliveryProfile(deliveryProfile)
      parsedDeliveryProfile.format = clientPreset
      if (profileId) {
        parsedDeliveryProfile.profile_id = profileId
      }
      if (hostId) {
        parsedDeliveryProfile.host_id = hostId
      }
      await onCreate({
        delivery_profile: parsedDeliveryProfile,
        license_id: licenseId.trim(),
        node_id: nodeId,
        user_id: userId,
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('Subscription could not be created.'))
    }
  }

  return (
    <ScreenForm onSubmit={handleSubmit}>
      <div>
        <p className="eyebrow">{t('Create subscription')}</p>
        <h2>{t('Client access')}</h2>
        <p>{t('Creates a real backend subscription record for the selected user.')}</p>
      </div>
      <label htmlFor="subscription-user">
        {t('User')}
        <select id="subscription-user" required value={userId} onChange={(event) => setUserId(event.target.value)}>
          <option value="">{t('Select user')}</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.username ?? user.email}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="subscription-license">
        {t('License ID')}
        <input id="subscription-license" required value={licenseId} onChange={(event) => setLicenseId(event.target.value)} />
      </label>
      <label htmlFor="subscription-node">
        {t('Node')}
        <select
          id="subscription-node"
          required
          value={nodeId}
          onChange={(event) => {
            setNodeId(event.target.value)
            setProfileId('')
            setHostId('')
          }}
        >
          <option value="">{t('Select node')}</option>
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="subscription-profile">
        {t('Protocol profile')}
        <select id="subscription-profile" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
          <option value="">{t('Use delivery profile fields')}</option>
          {profilesForNode.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} · {profile.adapter}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="subscription-host">
        {t('Host')}
        <select id="subscription-host" value={hostId} onChange={(event) => setHostId(event.target.value)}>
          <option value="">{t('Use node public address')}</option>
          {hostsForNode.map((host) => (
            <option key={host.id} value={host.id}>
              {host.name} · {host.hostname}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="subscription-client-preset">
        {t('Default client format')}
        <select id="subscription-client-preset" value={clientPreset} onChange={(event) => setClientPreset(event.target.value)}>
          <option value="happ">Happ / Hiddify / raw URI</option>
          <option value="v2ray-base64">v2ray base64</option>
          <option value="mihomo">Mihomo / Clash Meta</option>
          <option value="sing-box">Sing-box / NekoBox</option>
          <option value="amnezia">Amnezia / Xray JSON</option>
        </select>
      </label>
      <label htmlFor="subscription-delivery">
        {t('Delivery profile')}
        <textarea
          id="subscription-delivery"
          rows={4}
          value={deliveryProfile}
          onChange={(event) => setDeliveryProfile(event.target.value)}
        />
      </label>
      <FormError message={formError} />
      <SubmitButton pending={pending}>{t('Create subscription')}</SubmitButton>
    </ScreenForm>
  )
}

function parseDeliveryProfile(value: string): Record<string, string> {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((profile, entry) => {
      const separator = entry.indexOf('=')
      if (separator <= 0) {
        throw new Error('Delivery profile must use key=value pairs.')
      }
      const key = entry.slice(0, separator).trim()
      const parsedValue = entry.slice(separator + 1).trim()
      if (!key) {
        throw new Error('Delivery profile contains an empty key.')
      }
      profile[key] = parsedValue
      return profile
    }, {})
}

function SubscriptionGuide({ subscription }: { subscription: SubscriptionRecord | undefined }) {
  const { t } = useI18n()
  const baseUrl = subscription ? buildSubscriptionUrl(subscription.public_id) : null

  return (
    <div className="side-stack">
      <OperatorGuide
        title="What to configure"
        steps={[
          { detail: 'Create or inspect the customer account.', label: 'Users', to: '/users' },
          { detail: 'Check the relay node heartbeat and install state.', label: 'Nodes', to: '/nodes' },
          { detail: 'Select protocol, port, and client transport.', label: 'Profiles', to: '/profiles' },
          { detail: 'Bind the public domain to the node/profile.', label: 'Hosts', to: '/hosts' },
          { detail: 'Give the customer one import page.', label: 'Subscription Page', to: '/subscription-page' },
        ]}
      />

      <article className="panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">{t('Client import')}</p>
            <h2>{subscription ? subscription.public_id : t('No active subscription')}</h2>
          </div>
          <ExternalLink size={20} aria-hidden="true" />
        </div>
        {baseUrl ? (
          <div className="client-link-grid">
            {[
              ['Page', baseUrl],
              ['Happ', `${baseUrl}/happ`],
              ['Hiddify', `${baseUrl}/hiddify`],
              ['Mihomo', `${baseUrl}/mihomo`],
              ['Sing-box', `${baseUrl}/sing-box`],
              ['Amnezia', `${baseUrl}/amnezia`],
            ].map(([label, href]) => (
              <a key={href} className="client-link" href={href} target="_blank" rel="noreferrer">
                <span>{t(label)}</span>
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            ))}
          </div>
        ) : (
          <p className="empty-inline">{t('Create a subscription before sharing client links.')}</p>
        )}
      </article>
    </div>
  )
}

function buildSubscriptionUrl(publicId: string) {
  if (typeof window === 'undefined') {
    return `/sub/${publicId}`
  }
  const host = window.location.host.replace(/^panel\./, 'sub.')
  return `${window.location.protocol}//${host}/sub/${publicId}`
}
