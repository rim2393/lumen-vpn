import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApiClient } from './apiClientContext'
import type {
  ApiKeyCreateRequest,
  AuthProviderUpdateRequest,
  HostBulkActionRequest,
  HostCreateRequest,
  HostUpdateRequest,
  NodeCommandCreateRequest,
  NodePauseRequest,
  NodeQuarantineRequest,
  NodeResumeRequest,
  ProtocolProfileCreateRequest,
  ProtocolProfileUpdateRequest,
  ProvisioningJobCreateRequest,
  ResponseRuleCreateRequest,
  ResponseRuleTestRequest,
  ResponseRuleUpdateRequest,
  SettingUpdateRequest,
  SquadCreateRequest,
  SquadUpdateRequest,
  SquadUserMutationRequest,
  SubscriptionCreateRequest,
  SubscriptionTemplateCreateRequest,
  SubscriptionTemplateUpdateRequest,
  SubscriptionUpdateRequest,
  UserBulkActionRequest,
  UserCreateRequest,
  UserUpdateRequest,
} from './types'

export const resourceQueryKeys = {
  apiKeys: ['resource', 'api-keys'] as const,
  hosts: ['resource', 'hosts'] as const,
  license: ['resource', 'license'] as const,
  nodes: ['resource', 'nodes'] as const,
  nodeCommands: (nodeId: string) => ['resource', 'nodes', nodeId, 'commands'] as const,
  nodeMetrics: (nodeId: string) => ['resource', 'nodes', nodeId, 'metrics'] as const,
  profiles: ['resource', 'profiles'] as const,
  protocolAdapters: ['resource', 'protocol-adapters'] as const,
  provisioningJob: (jobId: string) => ['resource', 'nodes', 'provisioning-job', jobId] as const,
  session: ['auth', 'session'] as const,
  settings: ['resource', 'settings'] as const,
  authProviders: ['resource', 'settings', 'auth-providers'] as const,
  squads: ['resource', 'squads'] as const,
  squadDetail: (squadId: string) => ['resource', 'squads', squadId, 'detail'] as const,
  subscriptions: ['resource', 'subscriptions'] as const,
  subscriptionTemplates: ['resource', 'subscription-templates'] as const,
  responseRules: ['resource', 'response-rules'] as const,
  toolSummary: ['resource', 'tools', 'summary'] as const,
  toolHwid: ['resource', 'tools', 'hwid'] as const,
  toolSrh: ['resource', 'tools', 'srh'] as const,
  toolSessions: ['resource', 'tools', 'sessions'] as const,
  toolTorrentReports: ['resource', 'tools', 'torrent-reports'] as const,
  toolHappRouting: ['resource', 'tools', 'happ-routing'] as const,
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

export function useCreateProfile() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: ProtocolProfileCreateRequest) => apiClient.createProfile(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profiles })
    },
  })
}

export function useUpdateProfile() {
  const apiClient = useApiClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: ProtocolProfileUpdateRequest }) =>
      apiClient.updateProfile(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.profiles })
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

export function useToolSummaryData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.readToolSummary,
    queryKey: resourceQueryKeys.toolSummary,
  })
}

export function useHwidInspectorData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.inspectHwid,
    queryKey: resourceQueryKeys.toolHwid,
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

export function useHappRoutingData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.inspectHappRouting,
    queryKey: resourceQueryKeys.toolHappRouting,
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
