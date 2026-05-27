import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '../app/providers/AppProviders'
import { appRoutes } from '../app/routes'
import type { AuthSession, LumenApiClient } from '../shared/api/types'

type RenderOptions = {
  apiClient?: LumenApiClient
  initialSession?: AuthSession | null
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

export function renderWithRouter(initialPath: string, options: RenderOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  const router = createMemoryRouter(appRoutes, { initialEntries: [initialPath] })

  return render(
    <AppProviders
      apiClient={options.apiClient}
      initialSession={options.initialSession}
      queryClientOverride={queryClient}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  )
}

export function renderWithProviders(ui: ReactElement) {
  const queryClient = createTestQueryClient()

  return render(<AppProviders queryClientOverride={queryClient}>{ui}</AppProviders>)
}
