import type { AuthSession, LumenApiClient } from './types'

type HttpClientOptions = {
  baseUrl: string
  fetcher?: typeof fetch
  getSession: () => AuthSession | null
}

export class LumenApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'LumenApiError'
    this.status = status
  }
}

export function createHttpLumenApiClient({
  baseUrl,
  fetcher = fetch,
  getSession,
}: HttpClientOptions): LumenApiClient {
  async function request<TResponse>(path: string): Promise<TResponse> {
    const response = await fetcher(new URL(path, baseUrl), {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-Lumen-User': getSession()?.userId ?? 'anonymous',
      },
    })

    if (!response.ok) {
      throw new LumenApiError(`API request failed with status ${response.status}`, response.status)
    }

    return (await response.json()) as TResponse
  }

  return {
    getSession: () => request('/api/auth/session'),
    listApiKeys: () => request('/api/admin/api-keys'),
    listNodes: () => request('/api/admin/nodes'),
    listUsers: () => request('/api/admin/users'),
    readLicense: () => request('/api/admin/license'),
  }
}
