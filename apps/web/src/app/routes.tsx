import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import { AuthLayout } from '../features/auth/AuthLayout'
import { GuardPortalPage } from '../features/auth/GuardPortalPage'
import { LoginPage } from '../features/auth/LoginPage'
import { MfaPage } from '../features/auth/MfaPage'
import { RequireAuth } from '../features/auth/RequireAuth'
import { ApiKeysPage } from '../pages/ApiKeysPage'
import { DashboardPage } from '../pages/DashboardPage'
import { ErrorPage } from '../pages/ErrorPage'
import { HostsPage } from '../pages/HostsPage'
import { InfraBillingPage } from '../pages/InfraBillingPage'
import { LicensePage } from '../pages/LicensePage'
import { NodePluginsPage } from '../pages/NodePluginsPage'
import { NodesPage } from '../pages/NodesPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { ProfilesPage } from '../pages/ProfilesPage'
import { ResponseRulesPage } from '../pages/ResponseRulesPage'
import { SettingsPage } from '../pages/SettingsPage'
import { SquadsPage } from '../pages/SquadsPage'
import { SubscriptionPublicPage } from '../pages/SubscriptionPublicPage'
import { SubscriptionPage } from '../pages/SubscriptionPage'
import { TemplatesPage } from '../pages/TemplatesPage'
import { ToolsPage } from '../pages/ToolsPage'
import { UserDetailPage } from '../pages/UserDetailPage'
import { UsersPage } from '../pages/UsersPage'
import { AppShell } from '../shared/components/AppShell'

export const appRoutes: RouteObject[] = [
  {
    path: '/guard',
    element: <AuthLayout />,
    children: [
      { index: true, element: <Navigate to="/guard/login" replace /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'mfa', element: <MfaPage /> },
      {
        path: 'portal',
        element: (
          <RequireAuth>
            <GuardPortalPage />
          </RequireAuth>
        ),
      },
    ],
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'users/:userId', element: <UserDetailPage /> },
      { path: 'nodes', element: <NodesPage /> },
      { path: 'node-plugins', element: <NodePluginsPage /> },
      { path: 'hosts', element: <HostsPage /> },
      { path: 'profiles', element: <ProfilesPage /> },
      { path: 'squads', element: <SquadsPage /> },
      { path: 'subscription', element: <SubscriptionPage /> },
      { path: 'templates', element: <TemplatesPage /> },
      { path: 'response-rules', element: <ResponseRulesPage /> },
      { path: 'subscription-page', element: <SubscriptionPublicPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'license', element: <LicensePage /> },
      { path: 'infra-billing', element: <InfraBillingPage /> },
      { path: 'api-keys', element: <ApiKeysPage /> },
      { path: 'tools', element: <ToolsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const appRouter = createBrowserRouter(appRoutes)
