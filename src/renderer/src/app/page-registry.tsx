import { Suspense, lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import type { PageType } from './navigation'

function lazyPage<TProps>(
  loader: () => Promise<{ default: ComponentType<TProps> }>
): LazyExoticComponent<ComponentType<TProps>> {
  return lazy(loader)
}

const pageComponents: Record<PageType, LazyExoticComponent<ComponentType>> = {
  home: lazyPage(() =>
    import('@renderer/features/home').then((module) => ({ default: module.HomePage }))
  ),
  accounts: lazyPage(() =>
    import('@renderer/features/accounts').then((module) => ({ default: module.AccountManager }))
  ),
  tasks: lazyPage(() =>
    import('@renderer/features/tasks').then((module) => ({ default: module.TasksPage }))
  ),
  machineId: lazyPage(() =>
    import('@renderer/features/machine-id').then((module) => ({ default: module.MachineIdPage }))
  ),
  kiroSettings: lazyPage(() =>
    import('@renderer/features/kiro-settings').then((module) => ({
      default: module.KiroSettingsPage
    }))
  ),
  proxy: lazyPage(() =>
    import('@renderer/features/proxy').then((module) => ({ default: module.ProxyPage }))
  ),
  kproxy: lazyPage(() =>
    import('@renderer/features/kproxy').then((module) => ({ default: module.KProxyPage }))
  ),
  proxyPool: lazyPage(() =>
    import('@renderer/features/proxy-pool').then((module) => ({ default: module.ProxyPoolPage }))
  ),
  register: lazyPage(() =>
    import('@renderer/features/register').then((module) => ({ default: module.RegisterPage }))
  ),
  subscription: lazyPage(() =>
    import('@renderer/features/subscription').then((module) => ({
      default: module.SubscriptionPage
    }))
  ),
  webhooks: lazyPage(() =>
    import('@renderer/features/webhooks').then((module) => ({ default: module.WebhooksPage }))
  ),
  diagnose: lazyPage(() =>
    import('@renderer/features/diagnostics').then((module) => ({ default: module.DiagnosePage }))
  ),
  configSync: lazyPage(() =>
    import('@renderer/features/config-sync').then((module) => ({
      default: module.ConfigSyncPage
    }))
  ),
  logs: lazyPage(() =>
    import('@renderer/features/logs').then((module) => ({ default: module.LogsPage }))
  ),
  settings: lazyPage(() =>
    import('@renderer/features/settings').then((module) => ({ default: module.SettingsPage }))
  ),
  about: lazyPage(() =>
    import('@renderer/features/about').then((module) => ({ default: module.AboutPage }))
  )
}

function PageLoadingFallback(): React.JSX.Element {
  return (
    <div className="h-full p-6">
      <div className="page-hero h-full flex items-center justify-center">
        <div className="glass-card-subtle rounded-2xl px-6 py-4 text-sm text-muted-foreground">
          Loading page...
        </div>
      </div>
    </div>
  )
}

export function renderPage(currentPage: PageType): React.JSX.Element {
  const PageComponent = pageComponents[currentPage] || pageComponents.home

  return (
    <Suspense fallback={<PageLoadingFallback />}>
      <PageComponent />
    </Suspense>
  )
}
