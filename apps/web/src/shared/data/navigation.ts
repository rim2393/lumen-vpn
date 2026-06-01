import {
  BadgeCheck,
  Cog,
  Folder,
  Globe2,
  ListChecks,
  KeyRound,
  LayoutDashboard,
  Layers3,
  Network,
  Plug,
  Radar,
  RadioTower,
  Rss,
  ShieldCheck,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

export type NavigationItem = {
  label: string
  to: string
  icon: LucideIcon
}

export type NavigationGroup = {
  label: string
  items: NavigationItem[]
}

export const navigationGroups: NavigationGroup[] = [
  {
    label: 'Control',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
      { label: 'Users', to: '/users', icon: UsersRound },
      { label: 'Nodes', to: '/nodes', icon: Network },
      { label: 'Node plugins', to: '/node-plugins', icon: Plug },
      { label: 'Hosts', to: '/hosts', icon: Globe2 },
    ],
  },
  {
    label: 'Delivery',
    items: [
      { label: 'Profiles', to: '/profiles', icon: Layers3 },
      { label: 'Squads', to: '/squads', icon: RadioTower },
      { label: 'Subscription', to: '/subscription', icon: Rss },
      { label: 'Templates', to: '/templates', icon: Folder },
      { label: 'Response rules', to: '/response-rules', icon: ListChecks },
      { label: 'Subscription Page', to: '/subscription-page', icon: ShieldCheck },
      { label: 'Settings', to: '/settings', icon: Cog },
    ],
  },
  {
    label: 'Governance',
    items: [
      { label: 'License', to: '/license', icon: BadgeCheck },
      { label: 'Infra billing', to: '/infra-billing', icon: Wallet },
      { label: 'API keys', to: '/api-keys', icon: KeyRound },
      { label: 'Guard portal', to: '/guard/portal', icon: ShieldCheck },
    ],
  },
  {
    label: 'Tools',
    items: [{ label: 'Tools', to: '/tools', icon: Radar }],
  },
]
