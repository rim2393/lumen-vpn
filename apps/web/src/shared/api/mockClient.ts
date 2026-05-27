import {
  apiKeyRecords,
  licenseSummary,
  mockSession,
  nodeRecords,
  userRecords,
} from '../data/lumenData'
import type { LumenApiClient, ResourceListResponse } from './types'

const generatedAt = '2026-05-27T00:00:00Z'

function asListResponse<TItem>(items: TItem[]): ResourceListResponse<TItem> {
  return {
    generatedAt,
    items,
    source: 'mock',
    total: items.length,
  }
}

export function createMockLumenApiClient(): LumenApiClient {
  return {
    getSession: async () => mockSession,
    listApiKeys: async () => asListResponse(apiKeyRecords),
    listNodes: async () => asListResponse(nodeRecords),
    listUsers: async () => asListResponse(userRecords),
    readLicense: async () => licenseSummary,
  }
}
