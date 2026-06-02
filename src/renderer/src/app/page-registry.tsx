import type { PageType } from './navigation'
import { AccountManager } from '@renderer/features/accounts'
import { AboutPage } from '@renderer/features/about'
import { ConfigSyncPage } from '@renderer/features/config-sync'
import { DiagnosePage } from '@renderer/features/diagnostics'
import { HomePage } from '@renderer/features/home'
import { KiroSettingsPage, McpServerActions } from '@renderer/features/kiro-settings'
import { KProxyPage } from '@renderer/features/kproxy'
import { LogsPage } from '@renderer/features/logs'
import { MachineIdPage } from '@renderer/features/machine-id'
import { ProxyPage } from '@renderer/features/proxy'
import { ProxyPoolPage } from '@renderer/features/proxy-pool'
import { RegisterPage } from '@renderer/features/register'
import { SettingsPage } from '@renderer/features/settings'
import { SubscriptionPage } from '@renderer/features/subscription'
import { WebhooksPage } from '@renderer/features/webhooks'

void McpServerActions

export function renderPage(currentPage: PageType): React.JSX.Element {
  switch (currentPage) {
    case 'home':
      return <HomePage />
    case 'accounts':
      return <AccountManager />
    case 'machineId':
      return <MachineIdPage />
    case 'kiroSettings':
      return <KiroSettingsPage />
    case 'proxy':
      return <ProxyPage />
    case 'kproxy':
      return <KProxyPage />
    case 'proxyPool':
      return <ProxyPoolPage />
    case 'register':
      return <RegisterPage />
    case 'subscription':
      return <SubscriptionPage />
    case 'webhooks':
      return <WebhooksPage />
    case 'diagnose':
      return <DiagnosePage />
    case 'configSync':
      return <ConfigSyncPage />
    case 'logs':
      return <LogsPage />
    case 'settings':
      return <SettingsPage />
    case 'about':
      return <AboutPage />
    default:
      return <HomePage />
  }
}
