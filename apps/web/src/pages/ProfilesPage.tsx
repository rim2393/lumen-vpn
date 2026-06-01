import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Ban,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  Edit3,
  Eye,
  FileJson,
  Layers3,
  RotateCcw,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Table2,
  Search,
  ServerCog,
  Server,
  ShieldCheck,
  Check,
  X,
  Trash2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  useCreateProfile,
  useApplyProfileToNode,
  useDeleteProfile,
  useGlobalProfileInbounds,
  useHostsPageData,
  useNodesPageData,
  useProfileComputedConfig,
  useProfileInbounds,
  useProfilesPageData,
  useProtocolAdaptersData,
  useReorderProfiles,
  useSquadsPageData,
  useBulkProfiles,
  useUpdateProfile,
} from '../shared/api/resourceHooks'
import type { HostRecord, PortReservation, ProfileInboundRecord, ProtocolProfileRecord } from '../shared/api/types'
import { useApiClient } from '../shared/api/apiClientContext'
import { EmptyState, ErrorState, LoadingState } from '../shared/components/DataState'
import { DataTable } from '../shared/components/DataTable'
import { FormError, SubmitButton } from '../shared/components/ResourceScreen'
import { OperatorGuide } from '../shared/components/OperatorGuide'
import { PageHeader } from '../shared/components/PageHeader'
import { StatusBadge } from '../shared/components/StatusBadge'
import { sectionSpecs } from '../shared/data/resourceMeta'
import { useI18n } from '../shared/i18n/I18nProvider'
import { toneForStatus } from '../shared/utils/resourceFormat'

type ProfileFormState = {
  adapter: string
  allowPortConflicts: boolean
  credentialsRef: string
  configJson: string
  flow: string
  method: string
  metadataJson: string
  name: string
  network: string
  nodeId: string
  path: string
  port: string
  portProtocol: 'tcp' | 'udp'
  realityDestination: string
  realityShortId: string
  security: string
  serverName: string
  serviceName: string
  squadId: string
  status: string
  tag: string
  transport: string
}

const defaultForm: ProfileFormState = {
  adapter: 'vless-reality',
  allowPortConflicts: false,
  credentialsRef: '',
  configJson: JSON.stringify({}, null, 2),
  flow: '',
  method: 'aes-256-gcm',
  metadataJson: JSON.stringify({}, null, 2),
  name: '',
  network: 'tcp,udp',
  nodeId: '',
  path: '/',
  port: '443',
  portProtocol: 'tcp',
  realityDestination: '',
  realityShortId: '',
  security: 'reality',
  serverName: '',
  serviceName: 'lumen',
  squadId: '',
  status: 'active',
  tag: '',
  transport: 'tcp',
}
export function ProfilesPage() {
  const { t } = useI18n()
  const apiClient = useApiClient()
  const profilesQuery = useProfilesPageData()
  const adaptersQuery = useProtocolAdaptersData()
  const nodesQuery = useNodesPageData()
  const squadsQuery = useSquadsPageData()
  const hostsQuery = useHostsPageData()
  const globalInboundsQuery = useGlobalProfileInbounds()
  const createProfile = useCreateProfile()
  const updateProfile = useUpdateProfile()
  const deleteProfile = useDeleteProfile()
  const bulkProfiles = useBulkProfiles()
  const reorderProfiles = useReorderProfiles()
  const applyProfileToNode = useApplyProfileToNode()
  const profiles = profilesQuery.data?.items ?? []
  const adapters = adaptersQuery.data?.items ?? []
  const nodes = nodesQuery.data?.items ?? []
  const squads = squadsQuery.data?.items ?? []
  const hosts = hostsQuery.data?.items ?? []
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set())
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all')
  const [adapterFilter, setAdapterFilter] = useState<'all' | string>('all')
  const [nodeFilter, setNodeFilter] = useState<'all' | string>('all')
  const [sortMode, setSortMode] = useState<'manual' | 'name-asc' | 'name-desc' | 'node' | 'created'>('manual')
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table')
  const [form, setForm] = useState<ProfileFormState>(defaultForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [portCheckMessage, setPortCheckMessage] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [focusedInboundProfileId, setFocusedInboundProfileId] = useState<string | null>(null)
  const navigate = useNavigate()
  const isMutating =
    createProfile.isPending ||
    updateProfile.isPending ||
    deleteProfile.isPending ||
    bulkProfiles.isPending ||
    applyProfileToNode.isPending ||
    reorderProfiles.isPending
  const selectionBusy = isMutating
  const confirmDanger = (message: string) => window.confirm(message)
  const profileHosts = useMemo(() => groupHostsByProfile(hosts), [hosts])
  const filteredProfiles = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const matched = profiles.filter((profile) => {
      const node = nodes.find((item) => item.id === profile.node_id)
      const squad = squads.find((item) => item.id === profile.squad_id)
      const hostnames = profileHosts.get(profile.id) ?? []
      const haystack = [
        profile.name,
        profile.adapter,
        profile.status,
        node?.name,
        squad?.name,
        portsLabel(profile, t),
        ...hostnames.map((host) => host.hostname),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      const matchesSearch = !needle || haystack.includes(needle) || profile.id.toLowerCase().includes(needle)
      const matchesStatus = statusFilter === 'all' || profile.status === statusFilter
      const matchesAdapter = adapterFilter === 'all' || profile.adapter === adapterFilter
      const matchesNode = nodeFilter === 'all' || profile.node_id === nodeFilter
      return matchesSearch && matchesStatus && matchesAdapter && matchesNode
    })

    switch (sortMode) {
      case 'manual':
        return matched
      case 'name-desc':
        return matched.sort((a, b) => b.name.localeCompare(a.name))
      case 'node':
        return matched.sort((a, b) => {
          const aNode = nodes.find((node) => node.id === a.node_id)?.name ?? a.node_id
          const bNode = nodes.find((node) => node.id === b.node_id)?.name ?? b.node_id
          return aNode.localeCompare(bNode) || a.name.localeCompare(b.name)
        })
      case 'created':
        return matched.sort((a, b) => {
          const aTs = Date.parse(a.created_at ?? '')
          const bTs = Date.parse(b.created_at ?? '')
          if (Number.isNaN(aTs) && Number.isNaN(bTs)) {
            return a.name.localeCompare(b.name)
          }
          if (Number.isNaN(aTs)) {
            return 1
          }
          if (Number.isNaN(bTs)) {
            return -1
          }
          return bTs - aTs
        })
      case 'name-asc':
      default:
        return matched.sort((a, b) => a.name.localeCompare(b.name))
    }
  }, [profiles, search, nodes, profileHosts, squads, sortMode, statusFilter, adapterFilter, nodeFilter, t])
  const selectedProfile = useMemo(() => {
    if (profiles.length === 0) {
      return undefined
    }
    if (!selectedProfileId) {
      return filteredProfiles[0] ?? profiles[0]
    }
    return filteredProfiles.find((profile) => profile.id === selectedProfileId) ?? undefined
  }, [filteredProfiles, profiles, selectedProfileId])
  const computedQuery = useProfileComputedConfig(selectedProfile?.id)
  const inboundsQuery = useProfileInbounds(selectedProfile?.id)
  const selectedProfileHosts = useMemo(
    () => (selectedProfile ? profileHosts.get(selectedProfile.id) ?? [] : []),
    [selectedProfile?.id, profileHosts],
  )
  const selectedCount = selectedProfileIds.size
  const areAllFilteredSelected =
    filteredProfiles.length > 0 && filteredProfiles.every((item) => selectedProfileIds.has(item.id))

  function toggleSelectedProfile(profileId: string) {
    setSelectedProfileIds((current) => {
      const next = new Set(current)
      if (next.has(profileId)) {
        next.delete(profileId)
      } else {
        next.add(profileId)
      }
      return next
    })
  }

  function toggleAllFiltered() {
    setSelectedProfileIds((current) => {
      if (areAllFilteredSelected) {
        const next = new Set(current)
        for (const profile of filteredProfiles) {
          next.delete(profile.id)
        }
        return next
      }
      const next = new Set(current)
      for (const profile of filteredProfiles) {
        next.add(profile.id)
      }
      return next
    })
  }

  function clearSelectedProfiles() {
    setSelectedProfileIds(new Set())
  }

  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedProfileId('')
      return
    }
    if (!selectedProfileId) {
      setSelectedProfileId((filteredProfiles[0] ?? profiles[0])?.id ?? '')
      return
    }
    if (!profiles.find((item) => item.id === selectedProfileId)) {
      setSelectedProfileId((filteredProfiles[0] ?? profiles[0])?.id ?? '')
    }
  }, [filteredProfiles, profiles, selectedProfileId])

  useEffect(() => {
    if (filteredProfiles.length > 0 && selectedProfileId && !filteredProfiles.find((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId('')
    }
  }, [filteredProfiles, selectedProfileId])
  useEffect(() => {
    setSelectedProfileIds((current) => {
      const available = new Set(profiles.map((profile) => profile.id))
      const next = new Set<string>()
      for (const id of current) {
        if (available.has(id)) {
          next.add(id)
        }
      }
      return next
    })
  }, [profiles])

  const selectedAdapter = adapters.find((adapter) => adapter.protocol === form.adapter)

  useEffect(() => {
    if (adapters.length > 0 && !adapters.some((item) => item.protocol === form.adapter)) {
      setForm((current) => ({ ...current, adapter: adapters[0].protocol }))
    }
  }, [adapters, form.adapter])
  useEffect(() => {
    if (!selectedAdapter) {
      return
    }
    setForm((current) => {
      if (current.adapter !== selectedAdapter.protocol) {
        return current
      }
      const allowedTransports = getAllowedTransportOptions(selectedAdapter.capabilities)
      const allowedSecurity = getAllowedSecurityOptions(selectedAdapter.capabilities)
      const transport = allowedTransports.includes(current.transport) ? current.transport : allowedTransports[0] ?? 'tcp'
      const security = allowedSecurity.includes(current.security) ? current.security : allowedSecurity[0] ?? 'none'
      const portProtocol =
        selectedAdapter.capabilities.includes('udp') && !selectedAdapter.capabilities.includes('tcp')
          ? 'udp'
          : current.portProtocol
      const next: ProfileFormState = {
        ...current,
        flow: selectedAdapter.capabilities.includes('reality') ? current.flow : '',
        method: selectedAdapter.capabilities.includes('shadowsocks') ? current.method || defaultCipherMethod(current.adapter) : current.method,
        portProtocol,
        transport,
        security,
      }
      if (
        next.transport === current.transport &&
        next.security === current.security &&
        next.flow === current.flow &&
        next.method === current.method &&
        next.portProtocol === current.portProtocol
      ) {
        return current
      }
      return next
    })
  }, [selectedAdapter])

  useEffect(() => {
    if (!form.nodeId && nodes[0]) {
      setForm((current) => ({ ...current, nodeId: nodes[0].id }))
    }
  }, [form.nodeId, nodes])

  const selectedNode = nodes.find((node) => node.id === selectedProfile?.node_id)
  const selectedSquad = squads.find((squad) => squad.id === selectedProfile?.squad_id)
  const isLoading =
    profilesQuery.isLoading ||
    adaptersQuery.isLoading ||
    nodesQuery.isLoading ||
    squadsQuery.isLoading ||
    hostsQuery.isLoading ||
    globalInboundsQuery.isLoading
  const error =
    profilesQuery.error ??
    adaptersQuery.error ??
    nodesQuery.error ??
    squadsQuery.error ??
    hostsQuery.error ??
    globalInboundsQuery.error
  const profileStats = {
    active: profiles.filter((profile) => profile.status === 'active').length,
    disabled: profiles.filter((profile) => profile.status !== 'active').length,
    hosts: hosts.filter((host) => host.protocol_profile_id).length,
    ports: profiles.reduce((total, profile) => total + profile.port_reservations.length, 0),
  }
  const inboundsByProfile = useMemo(() => {
    const map = new Map<string, ProfileInboundRecord[]>()
    for (const inbound of globalInboundsQuery.data?.items ?? []) {
      const list = map.get(inbound.profile_id) ?? []
      list.push(inbound)
      map.set(inbound.profile_id, list)
    }
    return map
  }, [globalInboundsQuery.data?.items])
  const globalInbounds = globalInboundsQuery.data?.items ?? []
  const focusedProfileName = focusedInboundProfileId
    ? profiles.find((profile) => profile.id === focusedInboundProfileId)?.name ?? null
    : null
  const focusedInbounds = useMemo(
    () => (focusedInboundProfileId ? inboundsByProfile.get(focusedInboundProfileId) ?? [] : globalInbounds),
    [focusedInboundProfileId, globalInbounds, inboundsByProfile],
  )
  const isFiltered = search.length > 0 || statusFilter !== 'all' || adapterFilter !== 'all' || nodeFilter !== 'all'
  const adapterFilterOptions = useMemo(() => {
    const all = new Set(adapters.map((adapter) => adapter.protocol))
    return ['all', ...Array.from(all).sort()]
  }, [adapters])
  const nodeFilterOptions = useMemo(() => {
    const all = new Set(nodes.map((node) => node.id))
    return ['all', ...Array.from(all).sort()]
  }, [nodes])

  const profileWorkflowSteps = [
    {
      label: t('Attach node'),
      detail: t('Attach the profile to a healthy node before sharing subscriptions.'),
      to: '/nodes',
    },
    {
      label: t('Select protocol, port, and client transport.'),
      detail: t('Reserve an available port and keep exclusive protocols isolated.'),
    },
    {
      label: t('Share subscription'),
      detail: t('Use tags for client-facing grouping, filters, and routing rules.'),
      to: '/subscription',
    },
  ]

  function openNode(nodeId: string) {
    if (!nodeId) {
      return
    }
    navigate(`/nodes?focus=${encodeURIComponent(nodeId)}`)
  }

  function startEdit(profile: ProtocolProfileRecord) {
    setEditingProfileId(profile.id)
    setShowEditor(true)
    setSelectedProfileId(profile.id)
    setForm(profileToForm(profile))
    setFormError(null)
    setPortCheckMessage(null)
    setActionMessage(null)
  }

  function startClone(profile: ProtocolProfileRecord) {
    const cloneForm = {
      ...profileToForm(profile),
      name: `${profile.name} ${t('Copy')}`,
    }
    setEditingProfileId(null)
    setShowEditor(true)
    setSelectedProfileId(profile.id)
    setForm(cloneForm)
    setFormError(null)
    setPortCheckMessage(null)
    setActionMessage(null)
  }

  function setProfileSelected(profileId: string) {
    setSelectedProfileId(profileId)
  }

  function setProfileForInboundFocus(profileId: string) {
    setFocusedInboundProfileId(profileId)
  }

  function clearInboundFocus() {
    setFocusedInboundProfileId(null)
  }

  async function runBulk(action: string, status?: string) {
    if (selectedProfileIds.size === 0) {
      setFormError(t('Select at least one profile first.'))
      return
    }
    if (action === 'delete' && !confirmDanger(t('Delete selected profiles confirmation', { count: selectedProfileIds.size }))) {
      return
    }
    setFormError(null)
    try {
      await bulkProfiles.mutateAsync({
        action,
        request: {
          ids: Array.from(selectedProfileIds),
          status,
        },
      })
      clearSelectedProfiles()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('Profile bulk action failed.'))
    }
  }

  async function handleMoveProfile(profile: ProtocolProfileRecord, direction: -1 | 1) {
    const currentIds = profiles.map((item) => item.id)
    const currentIndex = currentIds.indexOf(profile.id)
    const targetIndex = currentIndex + direction
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= currentIds.length) {
      return
    }
    const nextIds = [...currentIds]
    ;[nextIds[currentIndex], nextIds[targetIndex]] = [nextIds[targetIndex], nextIds[currentIndex]]
    setFormError(null)
    try {
      await reorderProfiles.mutateAsync(nextIds)
      setSortMode('manual')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('Profile reorder failed.'))
    }
  }

  function canMoveProfile(profile: ProtocolProfileRecord, direction: -1 | 1) {
    const currentIndex = profiles.findIndex((item) => item.id === profile.id)
    const targetIndex = currentIndex + direction
    return currentIndex >= 0 && targetIndex >= 0 && targetIndex < profiles.length
  }

  function openCreateProfile() {
    setEditingProfileId(null)
    setShowEditor(true)
    setForm({
      ...defaultForm,
      adapter: adapters[0]?.protocol ?? defaultForm.adapter,
      nodeId: nodes[0]?.id ?? '',
    })
    setFormError(null)
    setPortCheckMessage(null)
    setActionMessage(null)
  }

  function closeProfileEditor() {
    setShowEditor(false)
    setEditingProfileId(null)
    setFormError(null)
    setPortCheckMessage(null)
  }

  async function checkPorts(reservations: PortReservation[]) {
    if (!form.nodeId) {
      throw new Error(t('Node is required.'))
    }
    const response = await apiClient.checkPortConflicts({
      exclude_profile_id: editingProfileId,
      node_id: form.nodeId,
      reservations,
    })
    if (!response.allowed && !form.allowPortConflicts) {
      const conflict = response.conflicts[0]
      const suggestion = conflict?.suggested_port ? ` ${t('Suggested port')}: ${conflict.suggested_port}.` : ''
      throw new Error(`${conflict?.message ?? t('Port conflict detected.')}${suggestion}`)
    }
    setPortCheckMessage(
      response.allowed
        ? t('Port check passed.')
        : `${t('Port conflict acknowledged')}: ${response.conflicts[0]?.message ?? t('conflict')}`,
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setPortCheckMessage(null)
    try {
      const request = formToRequest(form, selectedAdapter?.capabilities ?? [], t)
      await checkPorts(request.port_reservations)
      if (editingProfileId) {
        await updateProfile.mutateAsync({ id: editingProfileId, request })
      } else {
        const created = await createProfile.mutateAsync(request)
        setSelectedProfileId(created.id)
      }
      closeProfileEditor()
      await profilesQuery.refetch()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('Profile could not be saved.'))
    }
  }

  async function copyJson(value: unknown) {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2))
  }

  function downloadJson(filename: string, value: unknown) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(href)
  }

  function handleDelete(profile: ProtocolProfileRecord) {
    if (window.confirm(t('Delete profile confirmation', { name: profile.name }))) {
      void deleteProfile.mutateAsync(profile.id)
    }
  }

  async function handleApplyProfileToNode(profile: ProtocolProfileRecord) {
    setFormError(null)
    setActionMessage(null)
    try {
      const response = await applyProfileToNode.mutateAsync(profile.id)
      setActionMessage(
        t('Profile apply command queued', {
          command: response.command_id,
          node: response.node_id,
        }),
      )
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('Profile apply command failed.'))
    }
  }

  return (
    <section className="page">
      <PageHeader
        eyebrow={sectionSpecs.profiles.eyebrow}
        title={sectionSpecs.profiles.title}
        description={t('Build Xray protocol profiles, reserve real node ports, inspect generated inbounds, and attach delivery squads.')}
        actions={
          <div className="inline-actions">
            <button
              type="button"
              className="button button--secondary"
              aria-label={t('Refresh profiles')}
              onClick={() => {
                void profilesQuery.refetch()
                void hostsQuery.refetch()
                void globalInboundsQuery.refetch()
                void inboundsQuery.refetch()
                void computedQuery.refetch()
              }}
            >
              <RefreshCw size={18} aria-hidden="true" />
              {t('Refresh')}
            </button>
            <button type="button" className="button button--primary" onClick={openCreateProfile}>
              <Plus size={18} aria-hidden="true" />
              {t('Create profile')}
            </button>
          </div>
        }
      />

      {isLoading ? <LoadingState label={t('Loading profiles...')} /> : null}
      {error ? <ErrorState title={t('Profiles unavailable')} error={error} /> : null}
      {!isLoading && !error ? (
        <>
          <section className="summary-grid" aria-label={t('Profile summary')}>
            <div>
              <span>{t('Total profiles')}</span>
              <strong>{profiles.length}</strong>
            </div>
            <div>
              <span>{t('Active')}</span>
              <strong>{profileStats.active}</strong>
            </div>
            <div>
              <span>{t('Reserved ports')}</span>
              <strong>{profileStats.ports}</strong>
            </div>
            <div>
              <span>{t('Bound hosts')}</span>
              <strong>{profileStats.hosts}</strong>
            </div>
            <div>
              <span>{t('Disabled')}</span>
              <strong>{profileStats.disabled}</strong>
            </div>
          </section>

          <section className="resource-layout">
            <article className="panel profile-inventory">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">{t('Client delivery')}</p>
                  <h2>{t('Profiles')}</h2>
                </div>
                <div className="profile-toolbar">
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={toggleAllFiltered}
                      disabled={filteredProfiles.length === 0 || isMutating}
                    >
                      <CheckCircle2 size={16} aria-hidden="true" />
                      {areAllFilteredSelected ? t('Unselect filtered') : t('Select filtered')}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={clearSelectedProfiles}
                      disabled={selectedCount === 0 || isMutating}
                    >
                      <RotateCcw size={16} aria-hidden="true" />
                      {t('Clear selection')}
                    </button>
                    <StatusBadge tone={selectedCount > 0 ? 'good' : 'neutral'}>
                      {t('Selected: {count}', { count: selectedCount })}
                    </StatusBadge>
                  </div>

                  <div className="inline-actions inline-actions--compact">
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => void runBulk('status', 'active')}
                      disabled={selectedCount === 0 || isMutating}
                    >
                      <Check size={16} aria-hidden="true" />
                      {t('Enable selected')}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => void runBulk('status', 'disabled')}
                      disabled={selectedCount === 0 || isMutating}
                    >
                      <Ban size={16} aria-hidden="true" />
                      {t('Disable selected')}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => void runBulk('delete')}
                      disabled={selectedCount === 0 || isMutating}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                      {t('Delete selected')}
                    </button>
                  </div>

                  <div className="inline-actions">
                    <label className="toolbar-search" htmlFor="profile-search">
                      <Search size={16} aria-hidden="true" />
                      <input
                        id="profile-search"
                        value={search}
                        placeholder={t('Search profiles')}
                        onChange={(event) => setSearch(event.target.value)}
                        disabled={isMutating}
                      />
                    </label>
                    <label>
                      <select
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'disabled')}
                        disabled={isMutating}
                      >
                        <option value="all">{t('All statuses')}</option>
                        <option value="active">{t('Active')}</option>
                        <option value="disabled">{t('Disabled')}</option>
                      </select>
                    </label>
                    <label>
                      <select
                        value={adapterFilter}
                        onChange={(event) => setAdapterFilter(event.target.value)}
                        disabled={isMutating}
                      >
                        {adapterFilterOptions.map((adapter) => (
                          <option key={adapter} value={adapter}>
                            {adapter === 'all' ? t('All adapters') : adapter}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <select
                        value={nodeFilter}
                        onChange={(event) => setNodeFilter(event.target.value)}
                        disabled={isMutating}
                      >
                        {nodeFilterOptions.map((id) => (
                          <option key={id} value={id}>
                            {id === 'all'
                              ? t('All nodes')
                              : nodes.find((node) => node.id === id)?.name ?? id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <select
                        value={sortMode}
                        onChange={(event) =>
                          setSortMode(event.target.value as 'manual' | 'name-asc' | 'name-desc' | 'node' | 'created')
                        }
                        disabled={isMutating}
                      >
                        <option value="manual">{t('Manual order')}</option>
                        <option value="name-asc">{t('Sort by name (A-Z)')}</option>
                        <option value="name-desc">{t('Sort by name (Z-A)')}</option>
                        <option value="node">{t('Sort by node')}</option>
                        <option value="created">{t('Sort by created')}</option>
                      </select>
                    </label>
                  </div>

                  <div className="inline-actions">
                    <div className="inline-actions inline-actions--compact">
                      <button
                        type="button"
                        className={`button ${viewMode === 'table' ? 'button--primary' : 'button--secondary'}`}
                        onClick={() => setViewMode('table')}
                        disabled={isMutating}
                      >
                        <Table2 size={16} aria-hidden="true" />
                        {t('Table')}
                      </button>
                      <button
                        type="button"
                        className={`button ${viewMode === 'cards' ? 'button--primary' : 'button--secondary'}`}
                        onClick={() => setViewMode('cards')}
                        disabled={isMutating}
                      >
                        <Settings2 size={16} aria-hidden="true" />
                        {t('Cards')}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => {
                        setSearch('')
                        setStatusFilter('all')
                        setAdapterFilter('all')
                        setNodeFilter('all')
                        setSortMode('manual')
                      }}
                      disabled={isMutating || !isFiltered}
                    >
                      <X size={16} aria-hidden="true" />
                      {t('Reset')}
                    </button>
                    <StatusBadge tone="info">{t('Live API')}</StatusBadge>
                  </div>
                </div>
              </div>
              <div className="profile-toolbar-meta">
                <p>
                  {t('Showing')} {filteredProfiles.length} {t('of')} {profiles.length} {t('Profiles')}
                </p>
              </div>
              {actionMessage ? <p className="auth-card__note">{actionMessage}</p> : null}
              {formError && !showEditor ? <FormError message={formError} /> : null}
              {profiles.length === 0 ? (
                <EmptyState
                  title={t('No profiles created')}
                  description={t('Create the first profile after registering a node.')}
                />
              ) : (
                <>
              <div className={viewMode === 'table' ? 'profile-inventory-view' : 'profile-inventory-view is-hidden'}>
                    <ProfileInventoryTable
                      hostsByProfile={profileHosts}
                      inboundsByProfile={inboundsByProfile}
                      onFocusInbounds={setProfileForInboundFocus}
                      canMoveDown={(profile) => canMoveProfile(profile, 1)}
                      canMoveUp={(profile) => canMoveProfile(profile, -1)}
                      nodeNameFor={(profile) =>
                        nodes.find((node) => node.id === profile.node_id)?.name ?? profile.node_id
                      }
                      onDelete={handleDelete}
                      onEdit={startEdit}
                      onMove={handleMoveProfile}
                      onDuplicate={startClone}
                      onExport={(profile) => downloadJson(`${profile.name}-profile.json`, profileExport(profile))}
                      onApply={handleApplyProfileToNode}
                      onSelect={setProfileSelected}
                      onSelectRow={toggleSelectedProfile}
                      selectionBusy={selectionBusy}
                      selectedProfileIds={selectedProfileIds}
                      onToggle={(item) =>
                        void updateProfile.mutateAsync({
                          id: item.id,
                          request: { status: item.status === 'active' ? 'disabled' : 'active' },
                        })
                      }
                      profiles={filteredProfiles}
                      selectedProfileId={selectedProfile?.id}
                      squadNameFor={(profile) =>
                        squads.find((squad) => squad.id === profile.squad_id)?.name ?? t('None')
                      }
                      onGoToNode={openNode}
                      t={t}
                    />
                  </div>
                  <div
                    className={
                      viewMode === 'cards' ? 'profile-card-grid' : 'profile-card-grid is-hidden'
                    }
                  >
                    {filteredProfiles.map((profile) => (
                      <ProfileCard
                        key={profile.id}
                        hosts={profileHosts.get(profile.id) ?? []}
                        inbounds={inboundsByProfile.get(profile.id)?.length ?? 0}
                        nodeName={nodes.find((node) => node.id === profile.node_id)?.name ?? profile.node_id}
                        onDelete={handleDelete}
                        onEdit={startEdit}
                        onDuplicate={startClone}
                        onExport={() => downloadJson(`${profile.name}-profile.json`, profileExport(profile))}
                        onApply={handleApplyProfileToNode}
                        canMoveDown={canMoveProfile(profile, 1)}
                        canMoveUp={canMoveProfile(profile, -1)}
                        onMove={handleMoveProfile}
                        onSelect={setProfileSelected}
                        onSelectRow={toggleSelectedProfile}
                        onFocusInbounds={setProfileForInboundFocus}
                        onGoToNode={openNode}
                        selected={selectedProfileIds.has(profile.id)}
                        isCurrent={profile.id === selectedProfile?.id}
                        selectionBusy={selectionBusy}
                        onToggle={(item) =>
                          void updateProfile.mutateAsync({
                            id: item.id,
                            request: { status: item.status === 'active' ? 'disabled' : 'active' },
                          })
                        }
                        profile={profile}
                        t={t}
                      />
                    ))}
                  </div>
                </>
              )}
              {profiles.length > 0 && filteredProfiles.length === 0 ? (
                <EmptyState title={t('No matches')} description={t('No profiles match the current search.')} />
              ) : null}
            </article>

            <div className="side-stack">
              {showEditor ? (
                <ProfileEditor
                  adapters={adapters}
                  editing={Boolean(editingProfileId)}
                  error={formError}
                  form={form}
                  onCancel={closeProfileEditor}
                  onChange={setForm}
                  onSubmit={handleSubmit}
                  pending={createProfile.isPending || updateProfile.isPending}
                  portCheckMessage={portCheckMessage}
                  selectedAdapterCapabilities={selectedAdapter?.capabilities ?? []}
                  selectedAdapterRequiredCredentialRefs={selectedAdapter?.required_credential_refs ?? []}
                  nodes={nodes}
                  squads={squads}
                  t={t}
                />
              ) : (
                <OperatorGuide
                  title={t('Profile workflow')}
                  status={filteredProfiles.length > 0 ? 'active' : 'live'}
                  steps={profileWorkflowSteps}
                />
              )}

              <ProfileDetailPanel
                computedConfig={computedQuery.data?.computed_config}
                copyJson={copyJson}
                downloadJson={downloadJson}
                hosts={selectedProfileHosts}
                inbounds={inboundsQuery.data?.items ?? []}
                isComputedLoading={computedQuery.isLoading}
                nodeName={selectedNode?.name ?? selectedProfile?.node_id ?? null}
                onDelete={handleDelete}
                onEdit={startEdit}
                onApply={handleApplyProfileToNode}
                onToggle={(profile) =>
                  void updateProfile.mutateAsync({
                    id: profile.id,
                    request: { status: profile.status === 'active' ? 'disabled' : 'active' },
                  })
                }
                onGoToNode={() => openNode(selectedProfile?.node_id ?? '')}
                profile={selectedProfile}
                squadName={selectedSquad?.name ?? null}
                t={t}
              />

              <GlobalInboundRegistry
                inbounds={focusedInbounds}
                focusedProfileId={focusedInboundProfileId}
                focusedProfileName={focusedProfileName}
                onClearFocus={clearInboundFocus}
                onGoToNode={(nodeId) => openNode(nodeId)}
                onSelectProfile={setProfileForInboundFocus}
                t={t}
              />
            </div>
          </section>
        </>
      ) : null}
    </section>
  )
}

function ProfileInventoryTable({
  hostsByProfile,
  inboundsByProfile,
  nodeNameFor,
  canMoveDown,
  canMoveUp,
  onDelete,
  onEdit,
  onMove,
  onDuplicate,
  onExport,
  onFocusInbounds,
  onApply,
  onSelect,
  onSelectRow,
  selectionBusy,
  selectedProfileIds,
  onToggle,
  onGoToNode,
  profiles,
  selectedProfileId,
  squadNameFor,
  t,
}: {
  hostsByProfile: Map<string, HostRecord[]>
  inboundsByProfile: Map<string, ProfileInboundRecord[]>
  nodeNameFor: (profile: ProtocolProfileRecord) => string
  canMoveDown: (profile: ProtocolProfileRecord) => boolean
  canMoveUp: (profile: ProtocolProfileRecord) => boolean
  onDelete: (profile: ProtocolProfileRecord) => void
  onEdit: (profile: ProtocolProfileRecord) => void
  onMove: (profile: ProtocolProfileRecord, direction: -1 | 1) => void
  onDuplicate: (profile: ProtocolProfileRecord) => void
  onExport: (profile: ProtocolProfileRecord) => void
  onFocusInbounds: (profileId: string) => void
  onApply: (profile: ProtocolProfileRecord) => void
  onSelect: (profileId: string) => void
  onSelectRow: (profileId: string) => void
  selectionBusy: boolean
  selectedProfileIds: Set<string>
  onToggle: (profile: ProtocolProfileRecord) => void
  onGoToNode: (nodeId: string) => void
  profiles: ProtocolProfileRecord[]
  selectedProfileId: string | undefined
  squadNameFor: (profile: ProtocolProfileRecord) => string
  t: (value: string, params?: Record<string, string | number>) => string
}) {
  return (
    <DataTable
      caption={t('Profile inventory')}
      columns={[
        t('Select'),
        t('Name'),
        t('Adapter'),
        t('Node'),
        t('Squad'),
        t('Ports'),
        t('Hosts'),
        t('Inbounds'),
        t('Config'),
        t('Runtime'),
        t('Status'),
        t('Actions'),
      ]}
      rows={profiles.map((profile) => ({
        id: profile.id,
        cells: [
          <input
            aria-label={t('Select {name}', { name: profile.name })}
            checked={selectedProfileIds.has(profile.id)}
            type="checkbox"
            onChange={() => onSelectRow(profile.id)}
            disabled={selectionBusy}
          />,
          <button
            key="name"
            type="button"
            className="table-link-button"
            aria-current={profile.id === selectedProfileId ? 'true' : undefined}
            onClick={() => onSelect(profile.id)}
            disabled={selectionBusy}
          >
            {profile.name}
          </button>,
          profile.adapter,
          <button
            type="button"
            className="text-link--button"
            onClick={() => onGoToNode(profile.node_id)}
            disabled={selectionBusy}
          >
            {nodeNameFor(profile)}
          </button>,
          squadNameFor(profile),
          portsLabel(profile, t),
          t('profile.hosts.count', { count: hostsByProfile.get(profile.id)?.length ?? 0 }),
          <div key="inbounds" className="inline-actions inline-actions--compact">
            <button
              type="button"
              className="icon-button"
              aria-label={t('Show inbounds for {name}', { name: profile.name })}
              onClick={() => onFocusInbounds(profile.id)}
              disabled={selectionBusy}
            >
              <Eye size={15} aria-hidden="true" />
            </button>
            <StatusBadge tone="neutral">
              {t('inbounds.count', { count: inboundsByProfile.get(profile.id)?.length ?? 0 })}
            </StatusBadge>
          </div>,
          <code key="config">{configSummary(profile)}</code>,
          <RuntimeSyncBadge key="runtime" status={runtimeSyncStatus(profile)} />,
          <StatusBadge key="status" tone={toneForStatus(profile.status)}>
            {t(profile.status)}
          </StatusBadge>,
          <div key="actions" className="inline-actions inline-actions--compact">
            <button
              type="button"
              className="button button--secondary"
              aria-label={t('Move {name} up', { name: profile.name })}
              onClick={() => onMove(profile, -1)}
              disabled={selectionBusy || !canMoveUp(profile)}
            >
              <ArrowUp size={16} aria-hidden="true" />
              {t('Up')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              aria-label={t('Move {name} down', { name: profile.name })}
              onClick={() => onMove(profile, 1)}
              disabled={selectionBusy || !canMoveDown(profile)}
            >
              <ArrowDown size={16} aria-hidden="true" />
              {t('Down')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              aria-label={t('Edit {name}', { name: profile.name })}
              onClick={() => onEdit(profile)}
              disabled={selectionBusy}
            >
              <Edit3 size={16} aria-hidden="true" />
              {t('Edit')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              aria-label={t('Apply {name} to node', { name: profile.name })}
              onClick={() => onApply(profile)}
              disabled={selectionBusy || profile.status !== 'active'}
            >
              <Send size={16} aria-hidden="true" />
              {t('Apply')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              aria-label={t('Export {name}', { name: profile.name })}
              onClick={() => onExport(profile)}
              disabled={selectionBusy}
            >
              <FileJson size={16} aria-hidden="true" />
              {t('Export')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              aria-label={t('Duplicate {name}', { name: profile.name })}
              onClick={() => onDuplicate(profile)}
              disabled={selectionBusy}
            >
              <Copy size={16} aria-hidden="true" />
              {t('Copy')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              aria-label={profile.status === 'active' ? t('Disable {name}', { name: profile.name }) : t('Enable {name}', { name: profile.name })}
              onClick={() => onToggle(profile)}
              disabled={selectionBusy}
            >
              {profile.status === 'active' ? (
                <>
                  <Ban size={16} aria-hidden="true" /> {t('Disable')}
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} aria-hidden="true" /> {t('Enable')}
                </>
              )}
            </button>
            <button
              type="button"
              className="button button--secondary"
              aria-label={t('Delete {name}', { name: profile.name })}
              onClick={() => onDelete(profile)}
              disabled={selectionBusy}
            >
              <Trash2 size={16} aria-hidden="true" />
              {t('Delete')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => onGoToNode(profile.node_id)}
              disabled={selectionBusy}
            >
              <Server size={16} aria-hidden="true" />
              {t('Node')}
            </button>
          </div>,
        ],
      }))}
    />
  )
}

function ProfileCard({
  hosts,
  inbounds,
  nodeName,
  canMoveDown,
  canMoveUp,
  onDelete,
  onEdit,
  onDuplicate,
  onExport,
  onApply,
  onMove,
  onSelect,
  onSelectRow,
  onToggle,
  onFocusInbounds,
  onGoToNode,
  isCurrent,
  profile,
  selected,
  selectionBusy,
  t,
}: {
  hosts: HostRecord[]
  inbounds: number
  nodeName: string
  canMoveDown: boolean
  canMoveUp: boolean
  onDelete: (profile: ProtocolProfileRecord) => void
  onEdit: (profile: ProtocolProfileRecord) => void
  onExport: () => void
  onApply: (profile: ProtocolProfileRecord) => void
  onMove: (profile: ProtocolProfileRecord, direction: -1 | 1) => void
  onDuplicate: (profile: ProtocolProfileRecord) => void
  onSelect: (profileId: string) => void
  onSelectRow: (profileId: string) => void
  onToggle: (profile: ProtocolProfileRecord) => void
  onFocusInbounds: (profileId: string) => void
  onGoToNode: (nodeId: string) => void
  isCurrent: boolean
  profile: ProtocolProfileRecord
  selected: boolean
  selectionBusy: boolean
  t: (value: string, params?: Record<string, string | number>) => string
}) {
  return (
    <article className={isCurrent ? 'profile-card profile-card--selected' : 'profile-card'}>
      <button
        type="button"
        className="profile-card__select"
        aria-label={t('Select {name}', { name: profile.name })}
        onClick={() => onSelect(profile.id)}
      >
        <span className="profile-card__icon">
          <ShieldCheck size={20} aria-hidden="true" />
        </span>
        <span className="profile-card__body">
          <strong>{profile.name}</strong>
          <small>{profile.adapter}</small>
          <small>{nodeName}</small>
        </span>
      </button>
      <div className="profile-card__badges">
        <StatusBadge tone="info">{portsLabel(profile, t)}</StatusBadge>
        <StatusBadge tone="good">{t('profile.hosts.count', { count: hosts.length })}</StatusBadge>
        <StatusBadge tone="neutral">{t('inbounds.count', { count: inbounds })}</StatusBadge>
        <RuntimeSyncBadge status={runtimeSyncStatus(profile)} />
        <div className="inline-actions inline-actions--compact">
          <RuntimeSyncBadge status={runtimeSyncStatus(profile)} />
          <StatusBadge tone={toneForStatus(profile.status)}>{t(profile.status)}</StatusBadge>
        </div>
      </div>
      <div className="profile-card__actions">
        <button
          type="button"
          className="button button--secondary"
          aria-label={t('Move {name} up', { name: profile.name })}
          onClick={() => onMove(profile, -1)}
          disabled={selectionBusy || !canMoveUp}
        >
          <ArrowUp size={16} aria-hidden="true" />
          {t('Up')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          aria-label={t('Move {name} down', { name: profile.name })}
          onClick={() => onMove(profile, 1)}
          disabled={selectionBusy || !canMoveDown}
        >
          <ArrowDown size={16} aria-hidden="true" />
          {t('Down')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          aria-label={t('Show inbounds for {name}', { name: profile.name })}
          onClick={() => onFocusInbounds(profile.id)}
          disabled={selectionBusy}
        >
          <Eye size={16} aria-hidden="true" />
          {t('Inbounds')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          aria-label={t('Select {name}', { name: profile.name })}
          aria-pressed={selected}
          onClick={() => onSelectRow(profile.id)}
          disabled={selectionBusy}
        >
          <CheckCircle2 size={16} aria-hidden="true" />
          {selected ? t('Selected') : t('Select')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => onEdit(profile)}
          disabled={selectionBusy}
        >
          <Edit3 size={16} aria-hidden="true" />
          {t('Edit')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          aria-label={t('Apply {name} to node', { name: profile.name })}
          onClick={() => onApply(profile)}
          disabled={selectionBusy || profile.status !== 'active'}
        >
          <Send size={16} aria-hidden="true" />
          {t('Apply')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          aria-label={t('Export {name}', { name: profile.name })}
          onClick={onExport}
          disabled={selectionBusy}
        >
          <FileJson size={16} aria-hidden="true" />
          {t('Export')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          aria-label={t('Duplicate {name}', { name: profile.name })}
          onClick={() => onDuplicate(profile)}
          disabled={selectionBusy}
        >
          <Copy size={16} aria-hidden="true" />
          {t('Copy')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          aria-label={profile.status === 'active' ? t('Disable {name}', { name: profile.name }) : t('Enable {name}', { name: profile.name })}
          onClick={() => onToggle(profile)}
          disabled={selectionBusy}
        >
          {profile.status === 'active' ? (
            <>
              <Ban size={16} aria-hidden="true" /> {t('Disable')}
            </>
          ) : (
            <>
              <CheckCircle2 size={16} aria-hidden="true" /> {t('Enable')}
            </>
          )}
        </button>
        <button
          type="button"
          className="button button--secondary"
          aria-label={t('Delete {name}', { name: profile.name })}
          onClick={() => onDelete(profile)}
          disabled={selectionBusy}
        >
          <Trash2 size={16} aria-hidden="true" />
          {t('Delete')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => onGoToNode(profile.node_id)}
          disabled={selectionBusy}
        >
          <Server size={16} aria-hidden="true" />
          {t('Node')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => onSelect(profile.id)}
          disabled={selectionBusy}
        >
          <Eye size={16} aria-hidden="true" />
          {t('Inspect')}
        </button>
      </div>
    </article>
  )
}

function RuntimeSyncBadge({ status }: { status: { label: string; tone: 'danger' | 'good' | 'info' | 'neutral' | 'watch' } }) {
  return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
}

function ProfileDetailPanel({
  computedConfig,
  copyJson,
  downloadJson,
  hosts,
  inbounds,
  isComputedLoading,
  nodeName,
  onDelete,
  onEdit,
  onApply,
  onToggle,
  onGoToNode,
  profile,
  squadName,
  t,
}: {
  computedConfig: Record<string, unknown> | undefined
  copyJson: (value: unknown) => Promise<void>
  downloadJson: (filename: string, value: unknown) => void
  hosts: HostRecord[]
  inbounds: Array<{
    hosts: Array<Record<string, unknown>>
    listen: string
    port: number
    security: string
    tag: string
    transport: string
  }>
  isComputedLoading: boolean
  nodeName: string | null
  onDelete: (profile: ProtocolProfileRecord) => void
  onEdit: (profile: ProtocolProfileRecord) => void
  onApply: (profile: ProtocolProfileRecord) => void
  onToggle: (profile: ProtocolProfileRecord) => void
  onGoToNode: () => void
  profile: ProtocolProfileRecord | undefined
  squadName: string | null
  t: (value: string, params?: Record<string, string | number>) => string
}) {
  if (!profile) {
    return (
      <article className="panel">
        <EmptyState title={t('No profile selected')} description={t('Create or select a profile to inspect it.')} />
      </article>
    )
  }

  const rawProfileExport = profileExport(profile)
  const hostRows = hosts.map((host) => ({
    id: host.id,
    cells: [
      host.hostname,
      host.name ?? "\u2014",
      host.inbound_tag ?? "\u2014",
      String(host.port ?? "\u2014"),
      host.status,
      <button
        key={`copy-host-${host.id}`}
        type="button"
        className="button button--secondary"
        onClick={() => void copyJson(host)}
      >
        <Copy size={14} aria-hidden="true" />
        {t('Copy')}
      </button>,
    ],
  }))
  const inboundRows = inbounds.map((inbound) => ({
    id: `${inbound.tag}-${inbound.port}`,
    cells: [inbound.tag, inbound.listen, String(inbound.port), inbound.transport, inbound.security, String(inbound.hosts.length)],
  }))
  const portRows = formatPortReservations(profile.port_reservations, t)

  return (
    <article className="panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{t('Selected profile')}</p>
          <h2>{profile.name}</h2>
        </div>
        <StatusBadge tone={toneForStatus(profile.status)}>{t(profile.status)}</StatusBadge>
      </div>
      <div className="inline-actions">
        <button type="button" className="button button--secondary" onClick={() => onEdit(profile)}>
          <Edit3 size={16} aria-hidden="true" />
          {t('Edit')}
        </button>
        <button type="button" className="button button--secondary" onClick={() => onToggle(profile)}>
          <Ban size={16} aria-hidden="true" />
          {profile.status === 'active' ? t('Disable') : t('Enable')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={profile.status !== 'active'}
          onClick={() => onApply(profile)}
        >
          <Send size={16} aria-hidden="true" />
          {t('Apply')}
        </button>
        <button type="button" className="button button--secondary" onClick={() => void copyJson(rawProfileExport)}>
          <FileJson size={16} aria-hidden="true" />
          {t('Copy profile')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={!computedConfig || isComputedLoading}
          onClick={() => computedConfig && downloadJson(`${profile.name}-computed.json`, computedConfig)}
        >
          <Download size={16} aria-hidden="true" />
          {t('Export computed')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          aria-label={t('Delete {name}', { name: profile.name })}
          onClick={() => onDelete(profile)}
        >
          <Trash2 size={16} aria-hidden="true" />
          {t('Delete')}
        </button>
        <button type="button" className="button button--secondary" onClick={onGoToNode}>
          <Server size={16} aria-hidden="true" />
          {t('Open node')}
        </button>
      </div>

      <dl className="profile-facts">
        <div>
          <dt>{t('Profile ID')}</dt>
          <dd><span className="mono-value">{profile.id}</span></dd>
        </div>
        <div>
          <dt>{t('Adapter')}</dt>
          <dd>{profile.adapter}</dd>
        </div>
        <div>
          <dt>{t('Node')}</dt>
          <dd>{nodeName ?? profile.node_id}</dd>
        </div>
        <div>
          <dt>{t('Squad')}</dt>
          <dd>{squadName ?? t('None')}</dd>
        </div>
        <div>
          <dt>{t('Vault ref')}</dt>
          <dd>{profile.credentials_ref ?? t('None')}</dd>
        </div>
        <div>
          <dt>{t('Created')}</dt>
          <dd>{formatTimestamp(profile.created_at)}</dd>
        </div>
        <div>
          <dt>{t('Port reservations')}</dt>
          <dd>{portRows.length === 0 ? t('None') : portRows.join(', ')}</dd>
        </div>
      </dl>

      <details className="details-card" open>
        <summary>
          <ServerCog size={16} aria-hidden="true" />
          {t('Profile inbounds')}
        </summary>
        <DataTable
          caption={t('Profile inbounds')}
          columns={[t('Tag'), t('Listen'), t('Port'), t('Transport'), t('Security'), t('Hosts')]}
          rows={inboundRows}
        />
      </details>
      {inbounds.length === 0 ? (
        <p className="auth-card__note">{t('No generated inbounds for this profile yet.')}</p>
      ) : null}

      <details className="details-card">
        <summary>
          <Server size={16} aria-hidden="true" />
          {t('Bound hosts')}
        </summary>
        {hosts.length === 0 ? (
          <p className="auth-card__note">{t('No hosts bound to this profile yet.')}</p>
        ) : (
          <DataTable
            caption={t('Bound hosts')}
            columns={[t('Hostname'), t('Name'), t('Inbound tag'), t('Port'), t('Status'), t('Actions')]}
            rows={hostRows}
          />
        )}
      </details>

      <details className="details-card">
        <summary>
          <Code2 size={16} aria-hidden="true" />
          {t('Raw profile JSON')}
        </summary>
        <div className="inline-actions">
          <button type="button" className="button button--secondary" onClick={() => void copyJson(rawProfileExport)}>
            <Copy size={16} aria-hidden="true" />
            {t('Copy JSON')}
          </button>
          <button type="button" className="button button--secondary" onClick={() => downloadJson(`${profile.name}-profile.json`, rawProfileExport)}>
            <Download size={16} aria-hidden="true" />
            {t('Download JSON')}
          </button>
        </div>
        <pre className="code-block">{JSON.stringify(rawProfileExport, null, 2)}</pre>
      </details>

      <details className="details-card">
        <summary>
          <Code2 size={16} aria-hidden="true" />
          {t('Xray computed config')}
        </summary>
        <div className="inline-actions">
          <button
            type="button"
            className="button button--secondary"
            disabled={!computedConfig || isComputedLoading}
            onClick={() => computedConfig && void copyJson(computedConfig)}
          >
            <Copy size={16} aria-hidden="true" />
            {t('Copy JSON')}
          </button>
        </div>
        <pre className="code-block">
          {computedConfig ? JSON.stringify(computedConfig, null, 2) : t('Computed config unavailable.')}
        </pre>
      </details>
    </article>
  )
}

function GlobalInboundRegistry({
  inbounds,
  focusedProfileId,
  focusedProfileName,
  onClearFocus,
  onSelectProfile,
  onGoToNode,
  t,
}: {
  inbounds: ProfileInboundRecord[]
  focusedProfileId: string | null
  focusedProfileName: string | null
  onClearFocus: () => void
  onSelectProfile: (profileId: string) => void
  onGoToNode: (nodeId: string) => void
  t: (value: string, params?: Record<string, string | number>) => string
}) {
  return (
    <article className="panel panel--wide">
      <div className="panel__header">
        <div>
          <p className="eyebrow">
            <Layers3 size={14} aria-hidden="true" /> {t('Global registry')}
          </p>
          <h2>
            {focusedProfileName ? (
              <>
                {t('Inbound registry')} — {focusedProfileName}
              </>
            ) : (
              t('Inbound registry')
            )}
          </h2>
        </div>
        <div className="inline-actions">
          <StatusBadge tone={inbounds.length > 0 ? 'good' : 'neutral'}>
            {t('inbounds.count', { count: inbounds.length })}
          </StatusBadge>
          {focusedProfileId && (
            <button type="button" className="button button--secondary" onClick={onClearFocus}>
              <Search size={16} aria-hidden="true" />
              {t('Show all')}
            </button>
          )}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => onGoToNode(inbounds[0]?.node_id ?? '')}
          >
            <Server size={16} aria-hidden="true" />
            {t('Open node')}
          </button>
        </div>
      </div>
      {inbounds.length === 0 ? (
        <EmptyState
          title={t('No generated inbounds')}
          description={t('Create a profile with a real node and reserved port to generate inbounds.')}
        />
      ) : (
        <DataTable
          caption={t('Global profile inbounds')}
          columns={[t('Tag'), t('Profile'), t('Node'), t('Listen'), t('Port'), t('Protocol'), t('Transport'), t('Security'), t('Hosts'), t('Actions')]}
          rows={inbounds.map((inbound) => ({
            id: `${inbound.profile_id}-${inbound.tag}`,
            cells: [
              inbound.tag,
              inbound.profile_name,
              inbound.node_name,
              inbound.listen,
              String(inbound.port),
              inbound.protocol,
              inbound.transport,
              inbound.security,
              String(inbound.hosts.length),
              <button
                type="button"
                className="button button--secondary"
                onClick={() => onSelectProfile(inbound.profile_id)}
              >
                <Eye size={14} aria-hidden="true" />
                {t('Profile')}
              </button>,
              <button
                type="button"
                className="button button--secondary"
                onClick={() => onGoToNode(inbound.node_id)}
              >
                <Server size={14} aria-hidden="true" />
                {t('Node')}
              </button>,
            ],
          }))}
        />
      )}
    </article>
  )
}

function ProfileEditor({
  adapters,
  editing,
  error,
  form,
  nodes,
  onCancel,
  onChange,
  onSubmit,
  pending,
  portCheckMessage,
  selectedAdapterCapabilities,
  selectedAdapterRequiredCredentialRefs,
  squads,
  t,
}: {
  adapters: Array<{ capabilities: string[]; display_name: string; protocol: string; status: string }>
  editing: boolean
  error: string | null
  form: ProfileFormState
  nodes: Array<{ id: string; name: string; status: string }>
  onCancel: () => void
  onChange: (state: ProfileFormState) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  pending: boolean
  portCheckMessage: string | null
  selectedAdapterCapabilities: string[]
  selectedAdapterRequiredCredentialRefs: string[]
  squads: Array<{ id: string; name: string }>
  t: (value: string) => string
}) {
  const patch = (partial: Partial<ProfileFormState>) => onChange({ ...form, ...partial })
  const transportOptions = getTransportOptions(selectedAdapterCapabilities, form.transport)
  const securityOptions = getSecurityOptions(selectedAdapterCapabilities, form.security)
  const isRealityOriented = selectedAdapterCapabilities.includes('reality')
  const usesServerName =
    selectedAdapterCapabilities.some((capability) =>
      ['tls', 'reality', 'hysteria2', 'tuic', 'naiveproxy'].includes(capability),
    ) || form.security === 'tls' || form.security === 'reality'
  const usesPath = ['ws', 'xhttp', 'httpupgrade', 'splithttp'].includes(form.transport)
  const usesGrpcService = form.transport === 'grpc'
  const usesShadowsocks = selectedAdapterCapabilities.includes('shadowsocks')
  const builderConfig = buildProfileConfigFromForm(form, selectedAdapterCapabilities)

  return (
    <form className="auth-card auth-card--wide" onSubmit={onSubmit}>
      <div>
        <p className="eyebrow">{editing ? t('Edit profile') : t('Create profile')}</p>
        <h2>{editing ? t('Edit profile') : t('Create profile')}</h2>
        <p>{t('All fields are persisted through the profile API and validated before save.')}</p>
      </div>
      <div className="profile-form-grid">
        <label htmlFor="profile-name">
          {t('Name')}
          <input
            id="profile-name"
            required
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </label>
        <label htmlFor="profile-adapter">
          {t('Adapter')}
          <select
            id="profile-adapter"
            value={form.adapter}
            onChange={(event) => patch({ adapter: event.target.value })}
          >
            {adapters.map((adapter) => (
              <option
                key={adapter.protocol}
                value={adapter.protocol}
                disabled={adapter.status !== 'active' && form.status === 'active'}
              >
                {adapter.display_name} {adapter.status === 'active' ? '' : `(${t('Unavailable')})`}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="profile-node">
          {t('Node')}
          <select
            id="profile-node"
            required
            value={form.nodeId}
            onChange={(event) => patch({ nodeId: event.target.value })}
          >
            <option value="">{t('Select node')}</option>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name} • {t(node.status)}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="profile-squad">
          {t('Squad')}
          <select
            id="profile-squad"
            value={form.squadId}
            onChange={(event) => patch({ squadId: event.target.value })}
          >
            <option value="">{t('None')}</option>
            {squads.map((squad) => (
              <option key={squad.id} value={squad.id}>
                {squad.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="profile-status">
          {t('Status')}
          <select
            id="profile-status"
            value={form.status}
            onChange={(event) => patch({ status: event.target.value })}
          >
            {['active', 'disabled'].map((status) => (
              <option key={status} value={status}>
                {t(status)}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="profile-port">
          {t('Port')}
          <input
            id="profile-port"
            inputMode="numeric"
            required
            value={form.port}
            onChange={(event) => patch({ port: event.target.value })}
          />
        </label>
        <label htmlFor="profile-port-protocol">
          {t('Port protocol')}
          <select
            id="profile-port-protocol"
            value={form.portProtocol}
            onChange={(event) => patch({ portProtocol: event.target.value as 'tcp' | 'udp' })}
          >
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
          </select>
        </label>
        <label htmlFor="profile-transport">
          {t('Transport')}
          <select
            id="profile-transport"
            value={form.transport}
            onChange={(event) => patch({ transport: event.target.value })}
          >
            {transportOptions.map((transport) => (
              <option key={transport} value={transport}>
                {transport}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="profile-security">
          {t('Security')}
          <select
            id="profile-security"
            value={form.security}
            onChange={(event) => patch({ security: event.target.value })}
          >
            {securityOptions.map((security) => (
              <option key={security} value={security}>
                {security}
              </option>
            ))}
          </select>
        </label>
        {isRealityOriented ? (
          <label htmlFor="profile-flow">
            {t('Flow')}
            <input id="profile-flow" value={form.flow} onChange={(event) => patch({ flow: event.target.value })} />
          </label>
        ) : null}
        {usesServerName ? (
          <label htmlFor="profile-server-name">
            {t('Server name')}
            <input
              id="profile-server-name"
              value={form.serverName}
              onChange={(event) => patch({ serverName: event.target.value })}
              placeholder="front.example.com"
            />
          </label>
        ) : null}
        {isRealityOriented ? (
          <>
            <label htmlFor="profile-reality-destination">
              {t('Reality destination')}
              <input
                id="profile-reality-destination"
                value={form.realityDestination}
                onChange={(event) => patch({ realityDestination: event.target.value })}
                placeholder="front.example.com:443"
              />
            </label>
            <label htmlFor="profile-reality-short-id">
              {t('Reality short ID')}
              <input
                id="profile-reality-short-id"
                value={form.realityShortId}
                onChange={(event) => patch({ realityShortId: event.target.value })}
              />
            </label>
          </>
        ) : null}
        {usesPath ? (
          <label htmlFor="profile-path">
            {t('Path')}
            <input id="profile-path" value={form.path} onChange={(event) => patch({ path: event.target.value })} />
          </label>
        ) : null}
        {usesGrpcService ? (
          <label htmlFor="profile-service-name">
            {t('gRPC service name')}
            <input
              id="profile-service-name"
              value={form.serviceName}
              onChange={(event) => patch({ serviceName: event.target.value })}
            />
          </label>
        ) : null}
        {usesShadowsocks ? (
          <>
            <label htmlFor="profile-method">
              {t('Cipher method')}
              <input id="profile-method" value={form.method} onChange={(event) => patch({ method: event.target.value })} />
            </label>
            <label htmlFor="profile-network">
              {t('Network')}
              <select id="profile-network" value={form.network} onChange={(event) => patch({ network: event.target.value })}>
                <option value="tcp,udp">tcp,udp</option>
                <option value="tcp">tcp</option>
                <option value="udp">udp</option>
              </select>
            </label>
          </>
        ) : null}
        <label htmlFor="profile-tag">
          {t('Inbound tag')}
          <input id="profile-tag" value={form.tag} onChange={(event) => patch({ tag: event.target.value })} />
        </label>
        <label htmlFor="profile-credentials-ref" className="profile-form-grid__wide">
          {t('Credentials ref')}
          <input
            id="profile-credentials-ref"
            value={form.credentialsRef}
            onChange={(event) => patch({ credentialsRef: event.target.value })}
          />
        </label>
        <label htmlFor="profile-config-json" className="profile-form-grid__wide">
          {t('Profile config JSON')}
          <textarea
            id="profile-config-json"
            spellCheck={false}
            value={form.configJson}
            onChange={(event) => patch({ configJson: event.target.value })}
          />
        </label>
        <div className="profile-form-grid__wide inline-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => patch({ configJson: JSON.stringify(builderConfig, null, 2) })}
          >
            <Code2 size={16} aria-hidden="true" />
            {t('Build JSON from protocol fields')}
          </button>
          <StatusBadge tone="info">{t('Protocol builder writes real config_json')}</StatusBadge>
        </div>
        <label htmlFor="profile-metadata-json" className="profile-form-grid__wide">
          {t('Profile metadata JSON')}
          <textarea
            id="profile-metadata-json"
            spellCheck={false}
            value={form.metadataJson}
            onChange={(event) => patch({ metadataJson: event.target.value })}
          />
        </label>
        <label className="toggle-row profile-form-grid__wide" htmlFor="profile-allow-conflicts">
          <input
            id="profile-allow-conflicts"
            type="checkbox"
            checked={form.allowPortConflicts}
            onChange={(event) => patch({ allowPortConflicts: event.target.checked })}
          />
          {t('Allow saving with acknowledged port conflicts')}
        </label>
      </div>
      <div className="resource-list">
        <div className="resource-list__item">
          <span>
            <Server size={16} aria-hidden="true" /> {t('Adapter capabilities')}
          </span>
          <small>{selectedAdapterCapabilities.join(', ') || t('No capabilities reported')}</small>
        </div>
        <div className="resource-list__item">
          <span>
            <Layers3 size={16} aria-hidden="true" /> {t('Required credential refs')}
          </span>
          <small>
            {selectedAdapterRequiredCredentialRefs.length === 0
              ? t('No required credential refs')
              : selectedAdapterRequiredCredentialRefs.join(', ')}
          </small>
        </div>
        {portCheckMessage ? (
          <div className="resource-list__item">
            <span>
              <CheckCircle2 size={16} aria-hidden="true" /> {t('Port validation')}
            </span>
            <small>{portCheckMessage}</small>
          </div>
        ) : null}
      </div>
      <FormError message={error} />
      <div className="inline-actions">
        <SubmitButton pending={pending}>{editing ? t('Save profile') : t('Create profile')}</SubmitButton>
        <button type="button" className="button button--secondary" onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  )
}

function profileToForm(profile: ProtocolProfileRecord): ProfileFormState {
  const reservation = profile.port_reservations[0] ?? {}
  const security = profile.config_json.security
  const securityObject = security && typeof security === 'object' && !Array.isArray(security)
    ? (security as Record<string, unknown>)
    : {}
  return {
    adapter: profile.adapter,
    allowPortConflicts: false,
    configJson: JSON.stringify(profile.config_json, null, 2),
    credentialsRef: profile.credentials_ref ?? '',
    flow: String(profile.config_json.flow ?? ''),
    method: String(profile.config_json.method ?? 'aes-256-gcm'),
    metadataJson: JSON.stringify(profile.metadata_json, null, 2),
    name: profile.name,
    network: String(profile.config_json.network ?? 'tcp,udp'),
    nodeId: profile.node_id,
    path: String(profile.config_json.path ?? '/'),
    port: String(reservation.port ?? ''),
    portProtocol: reservation.protocol === 'udp' ? 'udp' : 'tcp',
    realityDestination: String(securityObject.dest ?? ''),
    realityShortId: String(securityObject.shortId ?? securityObject.short_id ?? ''),
    security: String(securityObject.type ?? profile.config_json.security ?? 'reality'),
    serverName: String(securityObject.serverName ?? securityObject.server_name ?? profile.config_json.host ?? profile.config_json.serverName ?? ''),
    serviceName: String(profile.config_json.serviceName ?? profile.config_json.service_name ?? profile.config_json.grpc_service_name ?? 'lumen'),
    squadId: profile.squad_id ?? '',
    status: profile.status,
    tag: String(profile.config_json.tag ?? ''),
    transport: String(profile.config_json.transport ?? profile.config_json.network ?? 'tcp'),
  }
}

function getTransportOptions(capabilities: string[], selected: string): string[] {
  const transportSet = new Set<string>(getAllowedTransportOptions(capabilities))
  transportSet.add(selected)
  return Array.from(transportSet).sort((a, b) => a.localeCompare(b))
}

function getSecurityOptions(capabilities: string[], selected: string): string[] {
  const securitySet = new Set<string>(getAllowedSecurityOptions(capabilities))
  securitySet.add(selected)
  return Array.from(securitySet).sort((a, b) => a.localeCompare(b))
}

function getAllowedTransportOptions(capabilities: string[]): string[] {
  const transportSet = new Set<string>()

  if (capabilities.includes('tcp') || capabilities.includes('http') || capabilities.includes('https') || capabilities.includes('socks')) {
    transportSet.add('tcp')
  }
  if (capabilities.includes('udp') || capabilities.includes('wireguard') || capabilities.includes('hysteria2') || capabilities.includes('tuic')) {
    transportSet.add('udp')
  }
  if (capabilities.includes('grpc')) {
    transportSet.add('grpc')
  }
  if (capabilities.includes('websocket')) {
    transportSet.add('ws')
  }
  if (capabilities.includes('xhttp')) {
    transportSet.add('xhttp')
  }
  if (capabilities.includes('httpupgrade')) {
    transportSet.add('httpupgrade')
  }
  if (capabilities.includes('splithttp')) {
    transportSet.add('splithttp')
  }
  if (capabilities.includes('quic')) {
    transportSet.add('quic')
  }
  if (transportSet.size === 0) {
    transportSet.add('tcp')
  }
  return Array.from(transportSet).sort((a, b) => a.localeCompare(b))
}

function getAllowedSecurityOptions(capabilities: string[]): string[] {
  const securitySet = new Set<string>()

  if (capabilities.includes('reality')) {
    securitySet.add('reality')
  }
  if (capabilities.includes('tls') || capabilities.includes('hysteria2') || capabilities.includes('tuic') || capabilities.includes('https')) {
    securitySet.add('tls')
  }
  if (securitySet.size === 0) {
    securitySet.add('none')
  }
  return Array.from(securitySet).sort((a, b) => a.localeCompare(b))
}

function formToRequest(
  form: ProfileFormState,
  adapterCapabilities: string[],
  t: (value: string) => string,
) {
  const port = Number(form.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(t('Port must be an integer between 1 and 65535.'))
  }
  if (!form.nodeId) {
    throw new Error(t('Node is required.'))
  }
  if (!form.name.trim()) {
    throw new Error(t('Name is required.'))
  }
  const config_json = mergeProfileConfig(
    parseProfileConfigJson(form.configJson, t),
    buildProfileConfigFromForm(form, adapterCapabilities),
  )
  const metadata_json = parseProfileMetadataJson(form.metadataJson, t)
  if (adapterCapabilities.includes('reality') && form.flow.trim()) {
    config_json.flow = form.flow.trim()
  } else {
    delete config_json.flow
  }
  if (form.tag.trim()) {
    config_json.tag = form.tag.trim()
  } else {
    delete config_json.tag
  }
  return {
    adapter: form.adapter,
    allow_port_conflicts: form.allowPortConflicts,
    config_json,
    credentials_ref: form.credentialsRef.trim() || null,
    metadata_json,
    name: form.name.trim(),
    node_id: form.nodeId,
    port_reservations: [{ address: '0.0.0.0', exclusive: true, port, protocol: form.portProtocol }],
    squad_id: form.squadId || null,
    status: form.status,
  }
}

function buildProfileConfigFromForm(
  form: ProfileFormState,
  adapterCapabilities: string[],
): Record<string, unknown> {
  const security = buildSecurityConfig(form)
  const config: Record<string, unknown> = {
    transport: form.transport,
    security,
  }

  if (form.tag.trim()) {
    config.tag = form.tag.trim()
  }
  if (form.flow.trim() && adapterCapabilities.includes('reality')) {
    config.flow = form.flow.trim()
  }
  if (['ws', 'xhttp', 'httpupgrade', 'splithttp'].includes(form.transport)) {
    config.path = normalizedPath(form.path)
    if (form.serverName.trim()) {
      config.host = form.serverName.trim()
    }
  }
  if (form.transport === 'grpc') {
    config.serviceName = form.serviceName.trim() || 'lumen'
  }
  if (adapterCapabilities.includes('shadowsocks')) {
    config.method = form.method.trim() || defaultCipherMethod(form.adapter)
    config.network = form.network.trim() || 'tcp,udp'
  }
  if (form.adapter === 'shadowsocks-v2ray-plugin') {
    config.plugin = 'v2ray-plugin'
    config.plugin_opts = form.serverName.trim()
      ? `server;tls;host=${form.serverName.trim()};path=${normalizedPath(form.path)}`
      : `server;path=${normalizedPath(form.path)}`
  }
  if (form.adapter === 'shadowsocks-obfs') {
    config.plugin = 'obfs-server'
    config.plugin_opts = form.serverName.trim()
      ? `obfs=tls;obfs-host=${form.serverName.trim()}`
      : 'obfs=http'
  }
  if (adapterCapabilities.includes('wireguard')) {
    config.mtu = 1420
    config.persistent_keepalive = 25
  }
  if (adapterCapabilities.includes('hysteria2')) {
    config.tls = form.serverName.trim() ? { serverName: form.serverName.trim() } : {}
    if (adapterCapabilities.includes('obfs')) {
      config.obfs = { type: 'salamander' }
    }
  }
  if (adapterCapabilities.includes('tuic')) {
    config.congestion_control = 'bbr'
    if (form.serverName.trim()) {
      config.server_name = form.serverName.trim()
    }
  }
  if (adapterCapabilities.includes('naiveproxy')) {
    config.tls = form.serverName.trim() ? { serverName: form.serverName.trim() } : {}
  }
  if (adapterCapabilities.includes('openvpn')) {
    config.dev = form.portProtocol === 'udp' ? 'tun' : 'tun'
    config.proto = form.portProtocol
  }
  return compactProfileConfig(config)
}

function buildSecurityConfig(form: ProfileFormState): string | Record<string, unknown> {
  if (form.security === 'reality') {
    const serverName = form.serverName.trim() || 'www.cloudflare.com'
    return compactProfileConfig({
      type: 'reality',
      serverName,
      dest: form.realityDestination.trim() || `${serverName}:443`,
      shortId: form.realityShortId.trim(),
    })
  }
  if (form.security === 'tls') {
    return compactProfileConfig({
      type: 'tls',
      serverName: form.serverName.trim(),
    })
  }
  return form.security
}

function mergeProfileConfig(
  rawConfig: Record<string, unknown>,
  builderConfig: Record<string, unknown>,
): Record<string, unknown> {
  return deepMergeProfileConfig(rawConfig, builderConfig)
}

function deepMergeProfileConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key]
    if (isPlainProfileObject(existing) && isPlainProfileObject(value)) {
      merged[key] = deepMergeProfileConfig(existing, value)
    } else {
      merged[key] = value
    }
  }
  return compactProfileConfig(merged)
}

function compactProfileConfig<T extends Record<string, unknown>>(value: T): T {
  const compacted: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || child === null || child === '') {
      continue
    }
    if (Array.isArray(child) && child.length === 0) {
      continue
    }
    if (isPlainProfileObject(child)) {
      const nested = compactProfileConfig(child)
      if (Object.keys(nested).length === 0) {
        continue
      }
      compacted[key] = nested
      continue
    }
    compacted[key] = child
  }
  return compacted as T
}

function isPlainProfileObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedPath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return '/'
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function defaultCipherMethod(adapter: string): string {
  return adapter === 'shadowsocks-2022' ? '2022-blake3-aes-128-gcm' : 'aes-256-gcm'
}

function parseProfileConfigJson(value: string, t: (value: string) => string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(t('Profile config JSON must be valid JSON.'))
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(t('Profile config JSON must be an object.'))
  }
  return { ...(parsed as Record<string, unknown>) }
}

function parseProfileMetadataJson(value: string, t: (value: string) => string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value || '{}')
  } catch {
    throw new Error(t('Profile metadata JSON must be valid JSON.'))
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(t('Profile metadata JSON must be an object.'))
  }
  return { ...(parsed as Record<string, unknown>) }
}

function groupHostsByProfile(hosts: HostRecord[]) {
  const groups = new Map<string, HostRecord[]>()
  for (const host of hosts) {
    if (!host.protocol_profile_id) {
      continue
    }
    const items = groups.get(host.protocol_profile_id) ?? []
    items.push(host)
    groups.set(host.protocol_profile_id, items)
  }
  return groups
}

function profileExport(profile: ProtocolProfileRecord) {
  return {
    adapter: profile.adapter,
    config_json: profile.config_json,
    credentials_ref: profile.credentials_ref,
    id: profile.id,
    metadata_json: profile.metadata_json,
    name: profile.name,
    node_id: profile.node_id,
    port_reservations: profile.port_reservations,
    squad_id: profile.squad_id,
    status: profile.status,
  }
}

function configSummary(profile: ProtocolProfileRecord): string {
  const transport = String(profile.config_json.transport ?? profile.config_json.network ?? 'transport?')
  const security = String(profile.config_json.security ?? 'security?')
  const smoke = profile.config_json.smoke === true ? ', smoke=true' : ''
  return `transport=${transport}, security=${security}${smoke}`
}

function runtimeSyncStatus(profile: ProtocolProfileRecord): { label: string; tone: 'danger' | 'good' | 'info' | 'neutral' | 'watch' } {
  const status = profile.runtime_sync?.status ?? 'never_applied'
  if (status === 'applied') {
    return { label: 'Runtime applied', tone: 'good' }
  }
  if (status === 'apply_queued') {
    return { label: 'Apply queued', tone: 'info' }
  }
  if (status === 'apply_failed') {
    return { label: 'Apply failed', tone: 'danger' }
  }
  if (profile.runtime_sync?.pending_apply || status === 'pending_apply') {
    return { label: 'Pending apply', tone: 'watch' }
  }
  return { label: 'Never applied', tone: 'neutral' }
}

function portsLabel(profile: ProtocolProfileRecord, t: (value: string) => string): string {
  if (profile.port_reservations.length === 0) {
    return t('no ports')
  }
  return profile.port_reservations
    .map((reservation) => `${String(reservation.port)}/${String(reservation.protocol ?? 'tcp')}`)
    .join(', ')
}

function formatPortReservations(
  reservations: Array<Record<string, unknown>>,
  t: (value: string) => string,
) {
  return reservations
    .map((reservation) => {
      const portValue = Number(reservation.port)
      const port = Number.isFinite(portValue) ? portValue : null
      const protocol =
        typeof reservation.protocol === 'string' && reservation.protocol ? reservation.protocol : 'tcp'
      const address =
        typeof reservation.address === 'string' && reservation.address.trim() ? reservation.address : '0.0.0.0'
      if (port === null) {
        return t('No ports')
      }
      return `${address}:${port}/${protocol}`
    })
    .filter(Boolean)
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return '—'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
