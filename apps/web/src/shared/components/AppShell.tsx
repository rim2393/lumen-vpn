import { CircleHelp, Languages, LogOut, Menu, Search, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthSession } from '../../features/auth/authSession'
import { useApiClient } from '../api/apiClientContext'
import { usePanelIdentityData } from '../api/resourceHooks'
import { navigationGroups } from '../data/navigation'
import { I18nProvider, useI18n, type AppLanguage } from '../i18n/I18nProvider'
import { BrandMark } from './BrandMark'

const languageOptions: Array<{ label: string; value: AppLanguage }> = [
  { label: 'EN', value: 'en' },
  { label: 'RU', value: 'ru' },
]

const readStoredLanguage = (): AppLanguage | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const storedLanguage = window.localStorage.getItem('lumen-ui-language')
  return storedLanguage === 'ru' || storedLanguage === 'en' ? storedLanguage : null
}

const readInitialLanguage = (): AppLanguage => {
  return readStoredLanguage() ?? 'en'
}

export function AppShell() {
  const [language, setLanguage] = useState<AppLanguage>(readInitialLanguage)
  const [hasStoredLanguage, setHasStoredLanguage] = useState(() => readStoredLanguage() !== null)
  const identity = usePanelIdentityData()

  function updateLanguage(value: AppLanguage) {
    setHasStoredLanguage(true)
    setLanguage(value)
  }

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      !hasStoredLanguage &&
      identity.data?.default_locale
    ) {
      setLanguage(identity.data.default_locale)
    }
  }, [hasStoredLanguage, identity.data?.default_locale])

  useEffect(() => {
    document.documentElement.lang = language
    if (hasStoredLanguage) {
      window.localStorage.setItem('lumen-ui-language', language)
    }
  }, [hasStoredLanguage, language])

  return (
    <I18nProvider language={language} setLanguage={updateLanguage}>
      <AppShellLayout />
    </I18nProvider>
  )
}

function AppShellLayout() {
  const apiClient = useApiClient()
  const identity = usePanelIdentityData()
  const navigate = useNavigate()
  const { clearSession, session } = useAuthSession()
  const { language, setLanguage, t } = useI18n()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchStatus, setSearchStatus] = useState('')
  const closeSidebar = () => setIsSidebarOpen(false)
  const productName = identity.data?.product_name ?? 'Lumen Guard'
  const searchableRoutes = useMemo(
    () =>
      navigationGroups.flatMap((group) =>
        group.items.map((item) => ({
          keywords: `${group.label} ${item.label} ${t(group.label)} ${t(item.label)}`.toLowerCase(),
          label: t(item.label),
          to: item.to,
        })),
      ),
    [t],
  )
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) {
      return []
    }

    return searchableRoutes.filter((route) => route.keywords.includes(query)).slice(0, 5)
  }, [searchQuery])

  async function handleSignOut() {
    try {
      await apiClient.logout()
    } finally {
      clearSession()
      navigate('/guard/login', { replace: true })
    }
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const firstResult = searchResults[0]
    if (!firstResult) {
      setSearchStatus(t('No matching section found.'))
      return
    }

    setSearchStatus(`${t('Opening')} ${firstResult.label}.`)
    setSearchQuery('')
    navigate(firstResult.to)
  }

  return (
    <div className="app-shell" data-density="compact">
      <a className="skip-link" href="#main-content">
        {t('Skip to content')}
      </a>
      <aside className={`sidebar ${isSidebarOpen ? 'sidebar--open' : ''}`} aria-label={t('Primary navigation')}>
        <div className="sidebar__header">
          <Link to="/dashboard" className="sidebar__brand" aria-label={`${productName} dashboard`}>
            <BrandMark productName={productName} />
          </Link>
          <button
            type="button"
            className="icon-button sidebar__close"
            aria-label={t('Close navigation')}
            onClick={() => setIsSidebarOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar__nav" aria-label={t('Primary')}>
          {navigationGroups.map((group) => (
            <section key={group.label} className="sidebar__group">
              <h2>{t(group.label)}</h2>
              {group.items.map((item) => {
                const Icon = item.icon

                return (
                  <NavLink key={item.to} to={item.to} className="sidebar__link" onClick={closeSidebar}>
                    <Icon size={18} aria-hidden="true" />
                    <span>{t(item.label)}</span>
                  </NavLink>
                )
              })}
            </section>
          ))}
        </nav>
        <div className="sidebar__footer">
          <span>{t('Operator')}</span>
          <strong>{session?.email ?? t('Not signed in')}</strong>
        </div>
      </aside>

      {isSidebarOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label={t('Close navigation overlay')}
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <div className="shell-main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button topbar__menu"
            aria-label={t('Open navigation')}
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <form className="topbar__search" onSubmit={handleSearchSubmit}>
            <Search size={18} aria-hidden="true" />
            <label className="sr-only" htmlFor="topbar-search">
              {t('Search control plane')}
            </label>
            <input
              id="topbar-search"
              type="search"
              placeholder={t('Search users, nodes, hosts')}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery ? (
              <div className="topbar__search-results" role="listbox" aria-label={t('Search results')}>
                {searchResults.length > 0 ? (
                  searchResults.map((result) => (
                    <button
                      key={result.to}
                      type="button"
                      role="option"
                      onClick={() => {
                        setSearchQuery('')
                        setSearchStatus(`${t('Opening')} ${result.label}.`)
                        navigate(result.to)
                      }}
                    >
                      {result.label}
                    </button>
                  ))
                ) : (
                  <span>{t('No matches')}</span>
                )}
              </div>
            ) : null}
            <span className="sr-only" aria-live="polite">
              {searchStatus}
            </span>
          </form>
          <nav className="topbar__actions" aria-label={t('Admin actions')}>
            <label className="language-switcher">
              <Languages size={18} aria-hidden="true" />
              <span className="sr-only">{t('Interface language')}</span>
              <select
                aria-label={t('Interface language')}
                value={language}
                onChange={(event) => setLanguage(event.target.value as AppLanguage)}
              >
                {languageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <Link to="/settings" className="icon-button" aria-label={t('Settings')}>
              <Settings size={18} />
            </Link>
            <Link to="/tools" className="icon-button" aria-label={t('Help')}>
              <CircleHelp size={18} />
            </Link>
            <button type="button" className="icon-button" aria-label={t('Sign out')} onClick={handleSignOut}>
              <LogOut size={18} />
            </button>
          </nav>
        </header>
        <main id="main-content" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
