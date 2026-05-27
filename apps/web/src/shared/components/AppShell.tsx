import { Bell, CircleHelp, Languages, LogOut, Menu, Search, Settings, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { navigationGroups } from '../data/navigation'
import { BrandMark } from './BrandMark'

type AppLanguage = 'en' | 'ru'

const languageOptions: Array<{ label: string; value: AppLanguage }> = [
  { label: 'EN', value: 'en' },
  { label: 'RU', value: 'ru' },
]

const readInitialLanguage = (): AppLanguage => {
  if (typeof window === 'undefined') {
    return 'en'
  }

  const storedLanguage = window.localStorage.getItem('lumen-ui-language')
  return storedLanguage === 'ru' ? 'ru' : 'en'
}

export function AppShell() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [language, setLanguage] = useState<AppLanguage>(readInitialLanguage)
  const closeSidebar = () => setIsSidebarOpen(false)

  useEffect(() => {
    document.documentElement.lang = language
    window.localStorage.setItem('lumen-ui-language', language)
  }, [language])

  return (
    <div className="app-shell" data-density="compact">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className={`sidebar ${isSidebarOpen ? 'sidebar--open' : ''}`} aria-label="Primary navigation">
        <div className="sidebar__header">
          <Link to="/dashboard" className="sidebar__brand" aria-label="Lumen Guard dashboard">
            <BrandMark />
          </Link>
          <button
            type="button"
            className="icon-button sidebar__close"
            aria-label="Close navigation"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar__nav" aria-label="Primary">
          {navigationGroups.map((group) => (
            <section key={group.label} className="sidebar__group">
              <h2>{group.label}</h2>
              {group.items.map((item) => {
                const Icon = item.icon

                return (
                  <NavLink key={item.to} to={item.to} className="sidebar__link" onClick={closeSidebar}>
                    <Icon size={18} aria-hidden="true" />
                    <span>{item.label}</span>
                  </NavLink>
                )
              })}
            </section>
          ))}
        </nav>
        <div className="sidebar__footer">
          <span>Instance</span>
          <strong>lumen-prod-01</strong>
        </div>
      </aside>

      {isSidebarOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Close navigation overlay"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <div className="shell-main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button topbar__menu"
            aria-label="Open navigation"
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <label className="topbar__search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Search control plane</span>
            <input type="search" placeholder="Search users, nodes, hosts" />
          </label>
          <nav className="topbar__actions" aria-label="Admin actions">
            <label className="language-switcher">
              <Languages size={18} aria-hidden="true" />
              <span className="sr-only">Interface language</span>
              <select
                aria-label="Interface language"
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
            <button type="button" className="icon-button" aria-label="Notifications">
              <Bell size={18} />
            </button>
            <button type="button" className="icon-button" aria-label="Settings">
              <Settings size={18} />
            </button>
            <button type="button" className="icon-button" aria-label="Help">
              <CircleHelp size={18} />
            </button>
            <Link to="/guard/login" className="icon-button" aria-label="Sign out">
              <LogOut size={18} />
            </Link>
          </nav>
        </header>
        <main id="main-content" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
