import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApiClient } from './apiClientContext'
import type {
  ApiKeyCreateRequest,
  HostBulkActionRequest,
  HostCreateRequest,
  HostUpdateRequest,
  ProtocolProfileCreateRequest,
  ProtocolProfileUpdateRequest,
  ProvisioningJobCreateRequest,
  SettingUpdateRequest,
  SquadCreateRequest,
  SubscriptionCreateRequest,
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
  profiles: ['resource', 'profiles'] as const,
  protocolAdapters: ['resource', 'protocol-adapters'] as const,
  provisioningJob: (jobId: string) => ['resource', 'nodes', 'provisioning-job', jobId] as const,
  session: ['auth', 'session'] as const,
  settings: ['resource', 'settings'] as const,
  squads: ['resource', 'squads'] as const,
  subscriptions: ['resource', 'subscriptions'] as const,
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

export function useSubscriptionsPageData() {
  const apiClient = useApiClient()

  return useQuery({
    queryFn: apiClient.listSubscriptions,
    queryKey: resourceQueryKeys.subscriptions,
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
