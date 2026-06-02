import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApiClient } from './apiClientContext'
import type {
  ApiKeyCreateRequest,
  AuthProviderUpdateRequest,
  HostBulkActionRequest,
  HostCreateRequest,
  HostUpdateRequest,
  InfraBillingRecordCreateRequest,
  InfraProviderCreateRequest,
  NodeBulkActionRequest,
  NodePluginApplyRequest,
  NodePluginCloneRequest,
  NodePluginCreateRequest,
  NodePluginReorderRequest,
  NodePluginUpdateRequest,
  NodeCommandCreateRequest,
  NodePauseRequest,
  NodeQuarantineRequest,
  NodeReorderRequest,
  NodeResumeRequest,
  NodeUpdateRequest,
  ProtocolProfileCreateRequest,
  ProtocolProfileUpdateRequest,
  ProfileBulkActionRequest,
  ProvisioningJobCreateRequest,
  ResponseRuleCreateRequest,
  ResponseRuleTestRequest,
  ResponseRuleUpdateRequest,
  SettingUpdateRequest,
  SettingGroupUpdateRequest,
  SquadCreateRequest,
  SquadUpdateRequest,
  SquadUserMutationRequest,
  SubscriptionCreateRequest,
  SubscriptionPageConfigCloneRequest,
  SubscriptionPageConfigCreateRequest,
  SubscriptionPageConfigUpdateRequest,
  SubscriptionTemplateCreateRequest,
  SubscriptionTemplateUpdateRequest,
  SubscriptionUpdateRequest,
  ToolSnippetCreateRequest,
  ToolSnippetUpdateRequest,
  UserBulkActionRequest,
  UserCreateRequest,
  UserUpdateRequest,
} from './types'

export const resourceQueryKeys = {
  apiKeys: ['resource', 'api-keys'] as const,
  hosts: ['resource', 'hosts'] as const,
  license: ['resource', 'license'] as const,
  licenses: ['resource', 'licenses'] as const,
  nodes: ['resource', 'nodes'] as const,
  nodeCommands: (nodeId: string) => ['resource', 'nodes', nodeId, 'commands'] as const,
  nodeMetrics: (nodeId: string) => ['resource', 'nodes', nodeId, 'metrics'] as const,
  nodeOverview: (nodeId: string) => ['resource', 'nodes', nodeId, 'overview'] as const,
  profiles: ['resource', 'profiles'] as const,
  profileGlobalInbounds: ['resource', 'profiles', 'inbounds'] as const,
  profileComputedConfig: (profileId: string) =>
    ['resource', 'profiles', profileId, 'computed-config'] as const,
  profileInbounds: (profileId: string) => ['resource', 'profiles', profileId, 'inbounds'] as const,
  protocolAdapters: ['resource', 'protocol-adapters'] as const,
  provisioningJob: (jobId: string) => ['resource', 'nodes', 'provisioning-job', jobId] as const,
  session: ['auth', 'session'] as const,
  settings: ['resource', 'settings'] as const,
  settingGroups: ['resource', 'settings', 'groups'] as const,
  mfaMethods: ['resource', 'auth', 'mfa-methods'] as const,
  webauthnCredentials: ['resource', 'auth', 'webauthn-credentials'] as const,
  authProviders: ['resource', 'settings', 'auth-providers'] as const,
  squads: ['resource', 'squads'] as const,
  squadDetail: (squadId: string) => ['resource', 'squads', squadId, 'detail'] as const,
  subscriptions: ['resource', 'subscriptions'] as const,
  subscriptionTemplates: ['resource', 'subscription-templates'] as const,
  responseRules: ['resource', 'response-rules'] as const,
  subscriptionPageConfigs: ['resource', 'subscription-page-configs'] as const,
  nodePlugins: ['resource', 'node-plugins'] as const,
  panelIdentity: ['resource', 'settings', 'public-identity'] as const,
  infraProviders: ['resource', 'infra-billing', 'providers'] as const,
  infraBillingRecords: ['resource', 'infra-billing', 'records'] as const,
  infraBillingSummary: ['resource', 'infra-billing', 'summary'] as const,
  toolSummary: ['resource', 'tools', 'summary'] as const,
  toolHwid: ['resource', 'tools', 'hwid'] as const,
  toolTopUsers: ['resource', 'tools', 'top-users'] as const,
  toolUserIps: ['resource', 'tools', 'user-ips'] as const,
  toolNodeUserIps: ['resource', 'tools', 'node-user-ips'] as const,
  toolSrh: ['resource', 'tools', 'srh'] as const,
  toolSessions: ['resource', 'tools', 'sessions'] as const,
  toolTorrentReports: ['resource', 'tools', 'torrent-reports'] as const,
  toolHappRouting: ['resource', 'tools', 'happ-routing'] as const,
  toolSnippets: ['resource', 'tools', 'snippets'] as const,
  userDetail: (userId: string) => ['resource', 'users', userId, 'detail'] as const,
  users: ['resource', 'users'] as const,
}

export function useApiKeysPageData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listApiKeys,
    queryKey: resourceQueryKeys.apiKeys,
  })
}

export function usePanelIdentityData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.readPanelIdentity,
    queryKey: resourceQueryKeys.panelIdentity,
  })
}

export function useCreateApiKey() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: ApiKeyCreateRequest) => apiClient.createApiKey(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.apiKeys })
    },
  })
}

export function useRevokeApiKey() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (apiKeyId: string) => apiClient.revokeApiKey(apiKeyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.apiKeys })
    },
  })
}

export function useLicensePageData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.readLicense,
    queryKey: resourceQueryKeys.license,
  })
}

export function useLicensesPageData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listLicenses,
    queryKey: resourceQueryKeys.licenses,
  })
}

export function useNodesPageData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listNodes,
    queryKey: resourceQueryKeys.nodes,
  })
}

export function useNodeCommandsData(nodeId: string | undefined) {
  const apiClient = useApiClient()

  return useQuery({
    enabled: Boolean(nodeId),
    queryFn: () => apiClient.listNodeCommands(nodeId as string),
    queryKey: resourceQueryKeys.nodeCommands(nodeId ?? ''),
  })
}

export function useNodeMetricsData(nodeId: string | undefined) {
  const apiClient = useApiClient()

  return useQuery({
    enabled: Boolean(nodeId),
    queryFn: () => apiClient.listNodeMetrics(nodeId as string),
    queryKey: resourceQueryKeys.nodeMetrics(nodeId ?? ''),
  })
}

export function useNodeOverviewData(nodeId: string | undefined) {
  const apiClient = useApiClient()

  return useQuery({
    enabled: Boolean(nodeId),
    queryFn: () => apiClient.getNodeOverview(nodeId as string),
    queryKey: resourceQueryKeys.nodeOverview(nodeId ?? ''),
  })
}

export function useCreateNodeCommand() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: NodeCommandCreateRequest }) =>
      apiClient.createNodeCommand(id, request),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodeCommands(variables.id) })
    },
  })
}

export function usePauseNode() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: NodePauseRequest }) =>
      apiClient.pauseNode(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodes })
    },
  })
}

export function useResumeNode() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: NodeResumeRequest }) =>
      apiClient.resumeNode(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodes })
    },
  })
}

export function useQuarantineNode() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: NodeQuarantineRequest }) =>
      apiClient.quarantineNode(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodes })
    },
  })
}

export function useUpdateNode() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: NodeUpdateRequest }) =>
      apiClient.updateNode(id, request),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodes })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodeCommands(variables.id) })
    },
  })
}

export function useDeleteNode() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteNode(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodes })
    },
  })
}

export function useReorderNodes() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: NodeReorderRequest) => apiClient.reorderNodes(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodes })
    },
  })
}

export function useBulkNodes() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: NodeBulkActionRequest) => apiClient.bulkNodes(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodes })
    },
  })
}

export function useRestartNode() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.restartNode(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodeCommands(id) })
    },
  })
}

export function useRestartAllNodes() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: apiClient.restartAllNodes,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodes })
    },
  })
}

export function useResetNodeTraffic() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.resetNodeTraffic(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodeCommands(id) })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodeMetrics(id) })
    },
  })
}

export function useProfilesPageData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listProfiles,
    queryKey: resourceQueryKeys.profiles,
  })
}

export function useProtocolAdaptersData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listProtocolAdapters,
    queryKey: resourceQueryKeys.protocolAdapters,
  })
}

export function useProfileComputedConfig(profileId: string | undefined) {
  const apiClient = useApiClient()

  return useQuery({
    enabled: Boolean(profileId),
    queryFn: () => apiClient.getProfileComputedConfig(profileId ?? ''),
    queryKey: resourceQueryKeys.profileComputedConfig(profileId ?? ''),
  })
}

export function useProfileInbounds(profileId: string | undefined) {
  const apiClient = useApiClient()

  return useQuery({
    enabled: Boolean(profileId),
    queryFn: () => apiClient.listProfileInbounds(profileId ?? ''),
    queryKey: resourceQueryKeys.profileInbounds(profileId ?? ''),
  })
}

export function useGlobalProfileInbounds() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listGlobalProfileInbounds,
    queryKey: resourceQueryKeys.profileGlobalInbounds,
  })
}

export function useCreateProfile() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: ProtocolProfileCreateRequest) => apiClient.createProfile(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profiles })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profileGlobalInbounds })
    },
  })
}

export function useBulkProfiles() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ action, request }: { action: string; request: ProfileBulkActionRequest }) =>
      apiClient.bulkProfiles(action, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profiles })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profileGlobalInbounds })
    },
  })
}

export function useApplyProfileToNode() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (profileId: string) => apiClient.applyProfileToNode(profileId),
    onSuccess: (_response, profileId) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profiles })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.hosts })
      void queryClient.invalidateQueries({
        queryKey: resourceQueryKeys.profileComputedConfig(profileId),
      })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profileInbounds(profileId) })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profileGlobalInbounds })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodeCommands(_response.node_id) })
    },
  })
}

export function useUpdateProfile() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: ProtocolProfileUpdateRequest }) =>
      apiClient.updateProfile(id, request),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profiles })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.squads })
      void queryClient.invalidateQueries({
        queryKey: resourceQueryKeys.profileComputedConfig(variables.id),
      })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.hosts })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profileInbounds(variables.id) })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profileGlobalInbounds })
    },
  })
}

export function useDeleteProfile() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteProfile(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profiles })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profileGlobalInbounds })
    },
  })
}

export function useReorderProfiles() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => apiClient.reorderProfiles(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profiles })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profileGlobalInbounds })
    },
  })
}

export function useHostsPageData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listHosts,
    queryKey: resourceQueryKeys.hosts,
  })
}

export function useCreateHost() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: HostCreateRequest) => apiClient.createHost(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.hosts })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profiles })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.squads })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profileGlobalInbounds })
    },
  })
}

export function useUpdateHost() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: HostUpdateRequest }) =>
      apiClient.updateHost(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.hosts })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profiles })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profileGlobalInbounds })
    },
  })
}

export function useDeleteHost() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteHost(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.hosts })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profiles })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profileGlobalInbounds })
    },
  })
}

export function useBulkHosts() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ action, request }: { action: string; request: HostBulkActionRequest }) =>
      apiClient.bulkHosts(action, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.hosts })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profiles })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profileGlobalInbounds })
    },
  })
}

export function useReorderHosts() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => apiClient.reorderHosts(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.hosts })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profiles })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profileGlobalInbounds })
    },
  })
}

export function useSquadsPageData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listSquads,
    queryKey: resourceQueryKeys.squads,
  })
}

export function useCreateSquad() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: SquadCreateRequest) => apiClient.createSquad(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.squads })
    },
  })
}

export function useSquadDetailData(squadId: string | undefined) {
  const apiClient = useApiClient()

  return useQuery({
    enabled: Boolean(squadId),
    queryFn: () => apiClient.getSquadDetail(squadId as string),
    queryKey: resourceQueryKeys.squadDetail(squadId ?? ''),
  })
}

export function useUpdateSquad() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: SquadUpdateRequest }) =>
      apiClient.updateSquad(id, request),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.squads })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.squadDetail(variables.id) })
    },
  })
}

export function useDeleteSquad() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteSquad(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.squads })
    },
  })
}

export function useAddSquadUsers() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: SquadUserMutationRequest }) =>
      apiClient.addSquadUsers(id, request),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.squads })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.squadDetail(variables.id) })
    },
  })
}

export function useRemoveSquadUsers() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: SquadUserMutationRequest }) =>
      apiClient.removeSquadUsers(id, request),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.squads })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.squadDetail(variables.id) })
    },
  })
}

export function useReorderSquads() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => apiClient.reorderSquads(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.squads })
    },
  })
}

export function useSubscriptionsPageData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listSubscriptions,
    queryKey: resourceQueryKeys.subscriptions,
  })
}

export function useSubscriptionTemplatesData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listSubscriptionTemplates,
    queryKey: resourceQueryKeys.subscriptionTemplates,
  })
}

export function useCreateSubscriptionTemplate() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: SubscriptionTemplateCreateRequest) =>
      apiClient.createSubscriptionTemplate(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptionTemplates })
    },
  })
}

export function useUpdateSubscriptionTemplate() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: SubscriptionTemplateUpdateRequest }) =>
      apiClient.updateSubscriptionTemplate(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptionTemplates })
    },
  })
}

export function useDeleteSubscriptionTemplate() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteSubscriptionTemplate(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptionTemplates })
    },
  })
}

export function useReorderSubscriptionTemplates() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => apiClient.reorderSubscriptionTemplates(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptionTemplates })
    },
  })
}

export function useResponseRulesData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listResponseRules,
    queryKey: resourceQueryKeys.responseRules,
  })
}

export function useCreateResponseRule() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: ResponseRuleCreateRequest) => apiClient.createResponseRule(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.responseRules })
    },
  })
}

export function useUpdateResponseRule() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: ResponseRuleUpdateRequest }) =>
      apiClient.updateResponseRule(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.responseRules })
    },
  })
}

export function useDeleteResponseRule() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteResponseRule(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.responseRules })
    },
  })
}

export function useReorderResponseRules() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => apiClient.reorderResponseRules(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.responseRules })
    },
  })
}

export function useTestResponseRule() {
  const apiClient = useApiClient()

  return useMutation({
    mutationFn: (request: ResponseRuleTestRequest) => apiClient.testResponseRule(request),
  })
}

export function useSubscriptionPageConfigsData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listSubscriptionPageConfigs,
    queryKey: resourceQueryKeys.subscriptionPageConfigs,
  })
}

export function useCreateSubscriptionPageConfig() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: SubscriptionPageConfigCreateRequest) =>
      apiClient.createSubscriptionPageConfig(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptionPageConfigs })
    },
  })
}

export function useUpdateSubscriptionPageConfig() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      request,
    }: {
      id: string
      request: SubscriptionPageConfigUpdateRequest
    }) => apiClient.updateSubscriptionPageConfig(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptionPageConfigs })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptions })
    },
  })
}

export function useCloneSubscriptionPageConfig() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      request,
    }: {
      id: string
      request: SubscriptionPageConfigCloneRequest
    }) => apiClient.cloneSubscriptionPageConfig(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptionPageConfigs })
    },
  })
}

export function useDeleteSubscriptionPageConfig() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteSubscriptionPageConfig(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptionPageConfigs })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptions })
    },
  })
}

export function useReorderSubscriptionPageConfigs() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => apiClient.reorderSubscriptionPageConfigs(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptionPageConfigs })
    },
  })
}

export function useToolSummaryData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.readToolSummary,
    queryKey: resourceQueryKeys.toolSummary,
  })
}

export function useHwidInspectorData(query?: string) {
  const apiClient = useApiClient()
  const normalizedQuery = query?.trim() ?? ''

  return useQuery({
    queryFn: () => apiClient.inspectHwid(normalizedQuery || undefined),
    queryKey: [...resourceQueryKeys.toolHwid, normalizedQuery],
  })
}

export function useTopUsersData(metric: string, limit = 50) {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: () => apiClient.inspectTopUsers(metric, limit),
    queryKey: [...resourceQueryKeys.toolTopUsers, metric, limit],
  })
}

export function useUserIpsData(query: string, limit = 200) {
  const apiClient = useApiClient()
  const normalizedQuery = query.trim() || undefined

  return useQuery({
    queryFn: () => apiClient.inspectUserIps(normalizedQuery, limit),
    queryKey: [...resourceQueryKeys.toolUserIps, normalizedQuery, limit],
  })
}

export function useNodeUserIpsData(query: string, limit = 200) {
  const apiClient = useApiClient()
  const normalizedQuery = query.trim() || undefined

  return useQuery({
    queryFn: () => apiClient.inspectNodeUserIps(normalizedQuery, limit),
    queryKey: [...resourceQueryKeys.toolNodeUserIps, normalizedQuery, limit],
  })
}

export function useSrhInspectorData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.inspectSrh,
    queryKey: resourceQueryKeys.toolSrh,
  })
}

export function useSessionInspectorData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.inspectSessions,
    queryKey: resourceQueryKeys.toolSessions,
  })
}

export function useRevokeToolSession() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sessionId: string) => apiClient.revokeToolSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.toolSessions })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.toolSummary })
    },
  })
}

export function useTorrentReportsData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.inspectTorrentReports,
    queryKey: resourceQueryKeys.toolTorrentReports,
  })
}

export function useTruncateTorrentReports() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: apiClient.truncateTorrentReports,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.toolTorrentReports })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.toolSummary })
    },
  })
}

export function useGenerateX25519Keypair() {
  const apiClient = useApiClient()

  return useMutation({
    mutationFn: apiClient.generateX25519Keypair,
  })
}

export function useGenerateNodeKey() {
  const apiClient = useApiClient()

  return useMutation({
    mutationFn: apiClient.generateNodeKey,
  })
}

export function useHappRoutingData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.inspectHappRouting,
    queryKey: resourceQueryKeys.toolHappRouting,
  })
}

export function useToolSnippetsData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listToolSnippets,
    queryKey: resourceQueryKeys.toolSnippets,
  })
}

export function useCreateToolSnippet() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: ToolSnippetCreateRequest) => apiClient.createToolSnippet(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.toolSnippets })
    },
  })
}

export function useUpdateToolSnippet() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: ToolSnippetUpdateRequest }) =>
      apiClient.updateToolSnippet(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.toolSnippets })
    },
  })
}

export function useDeleteToolSnippet() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteToolSnippet(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.toolSnippets })
    },
  })
}

export function useCreateSubscription() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: SubscriptionCreateRequest) => apiClient.createSubscription(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptions })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
    },
  })
}

export function useCloneSubscription() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.cloneSubscription(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptions })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
    },
  })
}

export function useDeleteSubscription() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteSubscription(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptions })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
    },
  })
}

export function useLookupSubscriptions() {
  const apiClient = useApiClient()

  return useMutation({
    mutationFn: (query: string) => apiClient.lookupSubscriptions(query),
  })
}

export function useSubscriptionDevices(subscriptionId: string | null) {
  const apiClient = useApiClient()

  return useQuery({
    enabled: Boolean(subscriptionId),
    queryFn: () => apiClient.listSubscriptionDevices(subscriptionId ?? ''),
    queryKey: [...resourceQueryKeys.subscriptions, subscriptionId, 'devices'],
  })
}

export function useUpdateSubscription() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: SubscriptionUpdateRequest }) =>
      apiClient.updateSubscription(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptions })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
    },
  })
}

export function useRevokeSubscription() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.revokeSubscription(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.subscriptions })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
    },
  })
}

export function useSettingsPageData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listSettings,
    queryKey: resourceQueryKeys.settings,
  })
}

export function useSettingGroupsData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listSettingGroups,
    queryKey: resourceQueryKeys.settingGroups,
  })
}

export function useAuthProvidersData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listAuthProviders,
    queryKey: resourceQueryKeys.authProviders,
  })
}

export function useUpdateAuthProvider() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      provider,
      request,
    }: {
      provider: string
      request: AuthProviderUpdateRequest
    }) => apiClient.updateAuthProvider(provider, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.authProviders })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.settings })
    },
  })
}

export function useUpdateSetting() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ key, request }: { key: string; request: SettingUpdateRequest }) =>
      apiClient.updateSetting(key, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.settings })
    },
  })
}

export function useUpdateSettingGroup() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      groupKey,
      request,
    }: {
      groupKey: string
      request: SettingGroupUpdateRequest
    }) => apiClient.updateSettingGroup(groupKey, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.settingGroups })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.settings })
    },
  })
}

export function useMfaMethodsData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listMfaMethods,
    queryKey: resourceQueryKeys.mfaMethods,
  })
}

export function useSetupTotp() {
  const apiClient = useApiClient()

  return useMutation({
    mutationFn: (label: string) => apiClient.setupTotp(label),
  })
}

export function useVerifyTotpSetup() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ code, methodId }: { code: string; methodId: string }) =>
      apiClient.verifyTotpSetup(methodId, code),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.mfaMethods })
    },
  })
}

export function useDeleteMfaMethod() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (methodId: string) => apiClient.deleteMfaMethod(methodId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.mfaMethods })
    },
  })
}

export function useWebAuthnCredentialsData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listWebAuthnCredentials,
    queryKey: resourceQueryKeys.webauthnCredentials,
  })
}

export function useDeleteWebAuthnCredential() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (credentialId: string) => apiClient.deleteWebAuthnCredential(credentialId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.webauthnCredentials })
    },
  })
}

export function useCreateNodeProvisioningJob() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: ProvisioningJobCreateRequest) =>
      apiClient.createProvisioningJob(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodes })
    },
  })
}

export function useUsersPageData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listUsers,
    queryKey: resourceQueryKeys.users,
  })
}

export function useLookupUsers() {
  const apiClient = useApiClient()

  return useMutation({
    mutationFn: (query: string) => apiClient.lookupUsers(query),
  })
}

export function useUserDetailData(userId: string | undefined) {
  const apiClient = useApiClient()

  return useQuery({
    enabled: Boolean(userId),
    queryFn: () => apiClient.getUserDetail(userId as string),
    queryKey: resourceQueryKeys.userDetail(userId ?? ''),
  })
}

export function useCreateUser() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: UserCreateRequest) => apiClient.createUser(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
    },
  })
}

export function useUpdateUser() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: UserUpdateRequest }) =>
      apiClient.updateUser(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
    },
  })
}

export function useDeleteUser() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteUser(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
    },
  })
}

export function useEnableUser() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.enableUser(id),
    onSuccess: (_user, id) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.userDetail(id) })
    },
  })
}

export function useDisableUser() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.disableUser(id),
    onSuccess: (_user, id) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.userDetail(id) })
    },
  })
}

export function useRevokeUser() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.revokeUser(id),
    onSuccess: (_user, id) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.userDetail(id) })
    },
  })
}

export function useResetUserTraffic() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.resetUserTraffic(id),
    onSuccess: (_user, id) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.userDetail(id) })
    },
  })
}

export function useDeleteUserDevice() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ deviceId, userId }: { deviceId: string; userId: string }) =>
      apiClient.deleteUserDevice(userId, deviceId),
    onSuccess: (_detail, variables) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.userDetail(variables.userId) })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.toolHwid })
    },
  })
}

export function useClearUserDevices() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (userId: string) => apiClient.clearUserDevices(userId),
    onSuccess: (_detail, userId) => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.userDetail(userId) })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.toolHwid })
    },
  })
}

export function useBulkUsers() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ action, request }: { action: string; request: UserBulkActionRequest }) =>
      apiClient.bulkUsers(action, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.users })
    },
  })
}

export function useNodePluginsData(nodeId?: string) {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: () => apiClient.listNodePlugins(nodeId),
    queryKey: nodeId ? [...resourceQueryKeys.nodePlugins, nodeId] : resourceQueryKeys.nodePlugins,
  })
}

export function useCreateNodePlugin() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: NodePluginCreateRequest) => apiClient.createNodePlugin(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodePlugins })
    },
  })
}

export function useCloneNodePlugin() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: NodePluginCloneRequest }) =>
      apiClient.cloneNodePlugin(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodePlugins })
    },
  })
}

export function useReorderNodePlugins() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: NodePluginReorderRequest) => apiClient.reorderNodePlugins(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodePlugins })
    },
  })
}

export function useApplyNodePlugins() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: NodePluginApplyRequest) => apiClient.applyNodePlugins(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodePlugins })
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodes })
    },
  })
}

export function useUpdateNodePlugin() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: NodePluginUpdateRequest }) =>
      apiClient.updateNodePlugin(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodePlugins })
    },
  })
}

export function useDeleteNodePlugin() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteNodePlugin(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.nodePlugins })
    },
  })
}

export function useInfraProvidersData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listInfraProviders,
    queryKey: resourceQueryKeys.infraProviders,
  })
}

export function useInfraBillingRecordsData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listInfraBillingRecords,
    queryKey: resourceQueryKeys.infraBillingRecords,
  })
}

export function useInfraBillingSummary() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.infraBillingSummary,
    queryKey: resourceQueryKeys.infraBillingSummary,
  })
}

function useInvalidateInfraBilling() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.infraProviders })
    void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.infraBillingRecords })
    void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.infraBillingSummary })
  }
}

export function useCreateInfraProvider() {
  const apiClient = useApiClient()
  const invalidate = useInvalidateInfraBilling()

  return useMutation({
    mutationFn: (request: InfraProviderCreateRequest) => apiClient.createInfraProvider(request),
    onSuccess: invalidate,
  })
}

export function useDeleteInfraProvider() {
  const apiClient = useApiClient()
  const invalidate = useInvalidateInfraBilling()

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteInfraProvider(id),
    onSuccess: invalidate,
  })
}

export function useCreateInfraBillingRecord() {
  const apiClient = useApiClient()
  const invalidate = useInvalidateInfraBilling()

  return useMutation({
    mutationFn: (request: InfraBillingRecordCreateRequest) =>
      apiClient.createInfraBillingRecord(request),
    onSuccess: invalidate,
  })
}
