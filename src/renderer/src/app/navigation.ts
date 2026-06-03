import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Bell,
  CreditCard,
  Fingerprint,
  Home,
  Info,
  Network,
  ScrollText,
  Server,
  Settings,
  Shield,
  Sparkles,
  Stethoscope,
  Timer,
  UserPlus,
  Users
} from 'lucide-react'

export type PageType =
  | 'home'
  | 'accounts'
  | 'tasks'
  | 'machineId'
  | 'kiroSettings'
  | 'proxy'
  | 'kproxy'
  | 'proxyPool'
  | 'register'
  | 'subscription'
  | 'webhooks'
  | 'diagnose'
  | 'configSync'
  | 'logs'
  | 'settings'
  | 'about'

export interface NavigationItem {
  id: PageType
  labelKey: string
  icon: LucideIcon
}

export const navigationItems: NavigationItem[] = [
  { id: 'home', labelKey: 'nav.home', icon: Home },
  { id: 'accounts', labelKey: 'nav.accounts', icon: Users },
  { id: 'tasks', labelKey: 'nav.tasks', icon: Timer },
  { id: 'machineId', labelKey: 'nav.machineId', icon: Fingerprint },
  { id: 'kiroSettings', labelKey: 'nav.kiroSettings', icon: Sparkles },
  { id: 'proxy', labelKey: 'nav.proxy', icon: Server },
  { id: 'kproxy', labelKey: 'nav.kproxy', icon: Shield },
  { id: 'proxyPool', labelKey: 'nav.proxyPool', icon: Network },
  { id: 'register', labelKey: 'nav.register', icon: UserPlus },
  { id: 'subscription', labelKey: 'nav.subscription', icon: CreditCard },
  { id: 'webhooks', labelKey: 'nav.webhooks', icon: Bell },
  { id: 'diagnose', labelKey: 'nav.diagnose', icon: Stethoscope },
  { id: 'configSync', labelKey: 'nav.configSync', icon: Archive },
  { id: 'logs', labelKey: 'nav.logs', icon: ScrollText },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
  { id: 'about', labelKey: 'nav.about', icon: Info }
]
