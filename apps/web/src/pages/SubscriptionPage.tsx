import { useEffect, useState, type FormEvent } from 'react'
import { Copy, ExternalLink, KeyRound, RefreshCw, Rss, Save, Search, ShieldX, Smartphone, Trash2 } from 'lucide-react'
import {
  useCloneSubscription,
  useCreateSubscription,
  useDeleteSubscription,
  useHostsPageData,
  useLicensesPageData,
  useLookupSubscriptions,
  useNodesPageData,
  useProfilesPageData,
  useRevokeSubscription,
  useSubscriptionDevices,
  useSubscriptionsPageData,
  useUpdateSubscription,
  useUsersPageData,
} from '../shared/api/resourceHooks'
import type { HostRecord, LicenseRecord, ProtocolProfileRecord, SubscriptionCreateRequest, SubscriptionRecord } from '../shared/api/types'
import { OperatorGuide } from '../shared/components/OperatorGuide'
import {
  FormError,
  ResourceScreen,
  ScreenForm,
  SubmitButton,
} from '../shared/components/ResourceScreen'
import { StatusBadge } from '../shared/components/StatusBadge'
import { sectionSpecs } from '../shared/data/resourceMeta'
import { useI18n } from '../shared/i18n/I18nProvider'
import { formatDateTime, formatRecord, toneForStatus } from '../shared/utils/resourceFormat'

export function SubscriptionPage() {
  const { t } = useI18n()
  const query = useSubscriptionsPageData()
  const usersQuery = useUsersPageData()
  const licensesQuery = useLicensesPageData()
  const nodesQuery = useNodesPageData()
  const profilesQuery = useProfilesPageData()
  const hostsQuery = useHostsPageData()
  const createSubscription = useCreateSubscription()
  const cloneSubscription = useCloneSubscription()
  const deleteSubscription = useDeleteSubscription()
  const lookupSubscriptions = useLookupSubscriptions()
  const updateSubscription = useUpdateSubscription()
  const revokeSubscription = useRevokeSubscription()
  const [lookupQuery, setLookupQuery] = useState('')
  const [lookupResults, setLookupResults] = useState<SubscriptionRecord[] | null>(null)
  const [selectedDeviceSubscriptionId, setSelectedDeviceSubscriptionId] = useState<string | null>(null)
  const deviceQuery = useSubscriptionDevices(selectedDeviceSubscriptionId)
  const subscriptions = query.data?.items ?? []
  const users = usersQuery.data?.items ?? []
  const licenses = licensesQuery.data?.items ?? []
  const nodes = nodesQuery.data?.items ?? []
  const activeSubscription = subscriptions.find((subscription) => subscription.status === 'active') ?? subscriptions[0]
  const activeRenderability = activeSubscription ? getSubscriptionRenderability(activeSubscription) : null
  const subscriptionBaseUrl =
    activeSubscription && activeRenderability?.canOpenBasePage
      ? buildPublicUrl(activeSubscription.public_page_url)
      : null

  return (
    <ResourceScreen
      caption="Subscription inventory"
      actions={
        <div className="action-cluster">
          <form
            className="inline-actions"
            onSubmit={(event) => {
              event.preventDefault()
              const normalized = lookupQuery.trim()
              if (!normalized) {
                setLookupResults(null)
                return
              }
              void lookupSubscriptions.mutateAsync(normalized).then((result) => {
                setLookupResults(result.items)
              })
            }}
          >
            <label className="sr-only" htmlFor="subscription-lookup">{t('Find subscription')}</label>
            <input
              id="subscription-lookup"
              placeholder={t('Public ID, UUID, username, email')}
              value={lookupQuery}
              onChange={(event) => setLookupQuery(event.target.value)}
            />
            <button className="button button--secondary" type="submit" disabled={lookupSubscriptions.isPending}>
              <Search size={18} aria-hidden="true" />
              {t('Find')}
            </button>
          </form>
          {subscriptionBaseUrl ? (
            <>
              <a className="button button--primary" href={subscriptionBaseUrl} target="_blank" rel="noreferrer">
                <Rss size={18} aria-hidden="true" />
                {t('Open subscription page')}
              </a>
              {activeRenderability?.formats.includes('happ') ? (
                <a
                  className="button button--secondary"
                  href={buildPublicUrl(activeSubscription.public_render_urls.happ ?? `${activeSubscription.public_page_url}/happ`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Smartphone size={18} aria-hidden="true" />
                  Happ
                </a>
              ) : null}
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
      columns={['Public ID', 'User', 'Node', 'Delivery profile', 'Formats', 'Expires', 'Config hash', 'Status', 'Actions']}
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
          subscription.render_formats.join(', ') || t('Not declared'),
          subscription.expires_at ? formatDateTime(subscription.expires_at) : t('Not set'),
          subscription.config_hash ?? t('Not generated'),
          <StatusBadge tone={toneForStatus(subscription.status)}>{subscription.status}</StatusBadge>,
          <SubscriptionActions
            subscription={subscription}
            onClone={() => void cloneSubscription.mutateAsync(subscription.id)}
            onDelete={() => {
              if (window.confirm(t('Delete this subscription record?'))) {
                void deleteSubscription.mutateAsync(subscription.id)
              }
            }}
            onDevices={() => setSelectedDeviceSubscriptionId(subscription.id)}
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
        <SubscriptionSidePanel
          deviceSubscription={subscriptions.find((subscription) => subscription.id === selectedDeviceSubscriptionId)}
          devices={deviceQuery.data?.items ?? []}
          devicesError={deviceQuery.error}
          devicesLoading={deviceQuery.isLoading}
          lookupResults={lookupResults}
          subscription={activeSubscription}
        />
      }
      createForm={
        <SubscriptionCreateForm
          defaultLicenseId={licenses[0]?.id ?? subscriptions[0]?.license_id ?? ''}
          hosts={hostsQuery.data?.items ?? []}
          licenses={licenses}
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
  onClone,
  onDelete,
  onDevices,
  onRevoke,
  onToggle,
  subscription,
}: {
  onClone: () => void
  onDelete: () => void
  onDevices: () => void
  onRevoke: () => void
  onToggle: () => void
  subscription: SubscriptionRecord
}) {
  const { t } = useI18n()
  const baseUrl = buildPublicUrl(subscription.public_page_url)
  const renderability = getSubscriptionRenderability(subscription)

  return (
    <div className="inline-actions" aria-label={t('Subscription actions')}>
      <button type="button" className="text-link text-link--button" onClick={onToggle}>
        <Save size={14} aria-hidden="true" />
        {subscription.status === 'active' ? t('Disable') : t('Enable')}
      </button>
      <button type="button" className="text-link text-link--button" onClick={onClone}>
        <Copy size={14} aria-hidden="true" />
        {t('Clone')}
      </button>
      <button type="button" className="text-link text-link--button" onClick={onDevices}>
        <KeyRound size={14} aria-hidden="true" />
        {t('Devices')}
      </button>
      <button type="button" className="text-link text-link--button" onClick={onRevoke}>
        <ShieldX size={14} aria-hidden="true" />
        {t('Revoke')}
      </button>
      <button type="button" className="text-link text-link--button" onClick={onDelete}>
        <Trash2 size={14} aria-hidden="true" />
        {t('Delete')}
      </button>
      {renderability.canOpenBasePage ? (
        <a className="text-link" href={baseUrl} target="_blank" rel="noreferrer">
          {t('Page')}
        </a>
      ) : (
        <StatusBadge tone="watch">{t(renderability.reason)}</StatusBadge>
      )}
      {renderability.formats.includes('happ') ? (
        <a className="text-link" href={buildPublicUrl(subscription.public_render_urls.happ ?? `${subscription.public_page_url}/happ`)} target="_blank" rel="noreferrer">
          Happ
        </a>
      ) : null}
      {renderability.formats.includes('mihomo') ? (
        <a className="text-link" href={buildPublicUrl(subscription.public_render_urls.mihomo ?? `${subscription.public_page_url}/mihomo`)} target="_blank" rel="noreferrer">
          Mihomo
        </a>
      ) : null}
      <a className="text-link" href={buildAdminRenderUrl(subscription.id, 'raw-uri')} target="_blank" rel="noreferrer">
        Raw
      </a>
    </div>
  )
}

function SubscriptionCreateForm({
  defaultLicenseId,
  hosts,
  licenses,
  nodes,
  onCreate,
  pending,
  profiles,
  users,
}: {
  defaultLicenseId: string
  hosts: HostRecord[]
  licenses: LicenseRecord[]
  nodes: Array<{ id: string; name: string; public_address: string }>
  onCreate: (request: SubscriptionCreateRequest) => Promise<void>
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
  const [expiresAt, setExpiresAt] = useState('')
  const [configHash, setConfigHash] = useState('')
  const [clientPreset, setClientPreset] = useState('happ')
  const [deliveryProfile, setDeliveryProfile] = useState(
    [
      'protocol=vless-tcp-tls',
      'adapter=vless-tcp-tls',
      'format=happ',
      'profile_title=Lumen',
      'security=tls',
      'alpn=h2,http/1.1',
      'traffic_limit_gb=500',
    ].join(', '),
  )
  const [formError, setFormError] = useState<string | null>(null)
  const profilesForNode = profiles.filter((profile) => !nodeId || profile.node_id === nodeId)
  const hostsForNode = hosts.filter((host) => !nodeId || host.node_id === nodeId)

  useEffect(() => {
    if (!userId && users[0]?.id) {
      setUserId(users[0].id)
    }
  }, [userId, users])

  useEffect(() => {
    const fallbackLicenseId = licenses[0]?.id ?? defaultLicenseId
    if (fallbackLicenseId && (!licenseId || !licenses.some((license) => license.id === licenseId))) {
      setLicenseId(fallbackLicenseId)
    }
  }, [defaultLicenseId, licenseId, licenses])

  useEffect(() => {
    if (!nodeId && nodes[0]?.id) {
      setNodeId(nodes[0].id)
    }
  }, [nodeId, nodes])

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
      const selectedHost = hosts.find((host) => host.id === hostId)
      const selectedNode = nodes.find((node) => node.id === nodeId)
      if (!parsedDeliveryProfile.server_name) {
        parsedDeliveryProfile.server_name = selectedHost?.hostname ?? selectedNode?.public_address ?? ''
      }
      if (!parsedDeliveryProfile.server_name) {
        throw new Error(t('Subscription server name could not be derived.'))
      }
      await onCreate({
        config_hash: configHash.trim() || null,
        delivery_profile: parsedDeliveryProfile,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
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
        {t('License')}
        <select id="subscription-license" required value={licenseId} onChange={(event) => setLicenseId(event.target.value)}>
          <option value="">{t('Select license')}</option>
          {licenses.map((license) => (
            <option key={license.id} value={license.id}>
              {formatLicenseOption(license)}
            </option>
          ))}
        </select>
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
      <label htmlFor="subscription-expires-at">
        {t('Expires at')}
        <input
          id="subscription-expires-at"
          type="datetime-local"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
        />
      </label>
      <label htmlFor="subscription-config-hash">
        {t('Config hash')}
        <input
          id="subscription-config-hash"
          value={configHash}
          onChange={(event) => setConfigHash(event.target.value)}
        />
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
    .split(/,\s*(?=[A-Za-z0-9_.-]+=)/)
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

function formatLicenseOption(license: LicenseRecord) {
  const customer = license.customer_ref ?? license.id
  const expiry = license.expires_at ? `expires ${formatDateTime(license.expires_at)}` : 'no expiry'
  return `${customer} · ${license.status} · ${license.max_devices} devices · ${expiry}`
}

function SubscriptionSidePanel({
  deviceSubscription,
  devices,
  devicesError,
  devicesLoading,
  lookupResults,
  subscription,
}: {
  deviceSubscription: SubscriptionRecord | undefined
  devices: Array<{
    hwid: string | null
    id: string
    label: string | null
    last_seen_at: string | null
    platform: string | null
    status: string
  }>
  devicesError: unknown
  devicesLoading: boolean
  lookupResults: SubscriptionRecord[] | null
  subscription: SubscriptionRecord | undefined
}) {
  const { t } = useI18n()

  return (
    <div className="side-stack">
      {lookupResults ? (
        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('Lookup')}</p>
              <h2>{t('Matched subscriptions')}</h2>
            </div>
            <StatusBadge tone={lookupResults.length > 0 ? 'info' : 'neutral'}>
              {String(lookupResults.length)}
            </StatusBadge>
          </div>
          {lookupResults.length > 0 ? (
            <div className="client-link-grid">
              {lookupResults.map((item) => (
                <a key={item.id} className="client-link" href={buildPublicUrl(item.public_page_url)} target="_blank" rel="noreferrer">
                  <span>{item.public_id}</span>
                  <StatusBadge tone={toneForStatus(item.status)}>{item.status}</StatusBadge>
                </a>
              ))}
            </div>
          ) : (
            <p className="empty-inline">{t('No subscriptions matched this query.')}</p>
          )}
        </article>
      ) : null}
      {deviceSubscription ? (
        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{t('Connection keys')}</p>
              <h2>{deviceSubscription.public_id}</h2>
            </div>
            <KeyRound size={20} aria-hidden="true" />
          </div>
          {devicesLoading ? (
            <p className="empty-inline">{t('Loading devices...')}</p>
          ) : devicesError ? (
            <p className="empty-inline">{t('Device registry unavailable.')}</p>
          ) : devices.length > 0 ? (
            <div className="client-link-grid">
              {devices.map((device) => (
                <div key={device.id} className="client-link">
                  <span>{device.label ?? device.id}</span>
                  <span>{device.hwid ?? device.platform ?? t('unknown platform')}</span>
                  <StatusBadge tone={toneForStatus(device.status)}>{device.status}</StatusBadge>
                  <span>{device.last_seen_at ? formatDateTime(device.last_seen_at) : t('Not recorded')}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-inline">{t('No devices are registered for this subscription yet.')}</p>
          )}
        </article>
      ) : null}
      <SubscriptionGuide subscription={subscription} />
    </div>
  )
}

function SubscriptionGuide({ subscription }: { subscription: SubscriptionRecord | undefined }) {
  const { t } = useI18n()
  const renderability = subscription ? getSubscriptionRenderability(subscription) : null
  const baseUrl = subscription && renderability?.canOpenBasePage ? buildPublicUrl(subscription.public_page_url) : null

  return (
    <>
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
        {subscription && baseUrl && renderability ? (
          <div className="client-link-grid">
            <StatusBadge tone="good">{t('Renderable')}</StatusBadge>
            {buildRenderableLinks(subscription, baseUrl, renderability.formats).map(([label, href]) => (
              <a key={href} className="client-link" href={href} target="_blank" rel="noreferrer">
                <span>{t(label)}</span>
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            ))}
          </div>
        ) : (
          <p className="empty-inline">
            {subscription ? t(renderability?.reason ?? 'Subscription not active') : t('Create a subscription before sharing client links.')}
          </p>
        )}
      </article>
    </>
  )
}

function buildRenderableLinks(subscription: SubscriptionRecord, baseUrl: string, formats: string[]): Array<[string, string]> {
  const links: Array<[string, string]> = [['Page', baseUrl]]
  if (formats.includes('happ')) {
    links.push(['Happ', buildPublicUrl(subscription.public_render_urls.happ ?? `${subscription.public_page_url}/happ`)])
  }
  if (formats.includes('hiddify')) {
    links.push(['Hiddify', buildPublicUrl(subscription.public_render_urls.hiddify ?? `${subscription.public_page_url}/hiddify`)])
  }
  if (formats.includes('mihomo')) {
    links.push(['Mihomo', buildPublicUrl(subscription.public_render_urls.mihomo ?? `${subscription.public_page_url}/mihomo`)])
  }
  if (formats.includes('sing-box')) {
    links.push(['Sing-box', buildPublicUrl(subscription.public_render_urls['sing-box'] ?? `${subscription.public_page_url}/sing-box`)])
  }
  if (formats.includes('amnezia')) {
    links.push(['Amnezia', buildPublicUrl(subscription.public_render_urls.amnezia ?? `${subscription.public_page_url}/amnezia`)])
  }
  return links
}

function getSubscriptionRenderability(subscription: SubscriptionRecord) {
  if (subscription.revoked_at) {
    return { canOpenBasePage: false, formats: [], reason: 'Subscription revoked' }
  }
  if (subscription.status !== 'active') {
    return { canOpenBasePage: false, formats: [], reason: 'Subscription not active' }
  }
  return {
    canOpenBasePage: true,
    formats: subscription.render_formats.length > 0 ? subscription.render_formats : readDeclaredFormats(subscription),
    reason: 'Base endpoint inferred from active subscription',
  }
}

function readDeclaredFormats(subscription: SubscriptionRecord): string[] {
  const declared = [
    subscription.delivery_profile.format,
    subscription.delivery_profile.client,
    subscription.delivery_profile.adapter,
  ]
    .flatMap((value) => String(value ?? '').split(/[,\s/]+/))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  return Array.from(new Set(declared))
}

function buildPublicUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl
  }
  if (typeof window === 'undefined') {
    return pathOrUrl
  }
  const host = window.location.host.replace(/^panel\./, 'sub.')
  return `${window.location.protocol}//${host}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`
}

function buildAdminRenderUrl(subscriptionId: string, target: string) {
  return `/api/v1/subscriptions/${subscriptionId}/render?target=${encodeURIComponent(target)}`
}
