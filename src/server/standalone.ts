import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
import { AccountService } from './services/accounts/account-service'
import { AuthService } from './services/auth/auth-service'
import {
  checkKiroAccount,
  getUsageAndLimits,
  getUserInfo
} from './services/accounts/kiro-account-api'
import { createAccountRouter } from './http/controllers/account-controller'
import { createAuthRouter } from './http/controllers/auth-controller'
import { createProxyRouter } from './http/controllers/proxy-controller'
import { createKiroLocalRouter } from './http/controllers/kiro-local-controller'
import { createRegistrationRouter } from './http/controllers/registration-controller'
import { createMachineIdRouter } from './http/controllers/machine-id-controller'
import { createKiroSettingsRouter } from './http/controllers/kiro-settings-controller'
import { createKProxyRouter } from './http/controllers/kproxy-controller'
import { createDiagnosticsRouter } from './http/controllers/diagnostics-controller'
import { createSubscriptionRouter } from './http/controllers/subscription-controller'
import { createWebhookRouter } from './http/controllers/webhook-controller'
import { createConfigSyncRouter } from './http/controllers/config-sync-controller'
import { createSchedulerRouter } from './http/controllers/scheduler-controller'
import { createProxyPoolRouter } from './http/controllers/proxy-pool-controller'
import {
  createLocalAdminServer,
  type LocalAdminServer,
  type LocalAdminServerInfo
} from './http/local-admin-server'
import { publishEvent } from './events'
import { getDataDir, setDataDir } from './runtime/paths'
import { ProxyService } from './services/proxy/proxy-service'
import { KiroLocalService } from './services/kiro-local/kiro-local-service'
import { RegistrationService } from './services/registration/registration-service'
import { MachineIdService } from './services/machine-id/machine-id-service'
import { KiroSettingsService } from './services/kiro-settings/kiro-settings-service'
import { KProxyManagementService } from './services/kproxy/kproxy-service'
import { DiagnosticsService } from './services/diagnostics/diagnostics-service'
import { SubscriptionService } from './services/subscriptions/subscription-service'
import { WebhookService } from './services/webhooks/webhook-service'
import { ConfigSyncService } from './services/config-sync/config-sync-service'
import { SchedulerService } from './services/scheduler/scheduler-service'
import { ProxyPoolService } from './services/proxy-pool/proxy-pool-service'
import { ConfigStore } from './storage/config-store'
import { maskSecret, redactSensitiveText } from './logging/redact'
import { ProxyServer, type ProxyAccount, type ProxyConfig } from '../core/proxy'
import { safeCreateProxyAgent } from '../core/proxy/systemProxy'

interface StandaloneOptions {
  host?: string
  port?: number
  accessToken?: string
  dataDir?: string
  encryptionKey?: string
  staticDir?: string
  openBrowser?: boolean
}

interface StandaloneRuntime {
  accountService: AccountService
  authService: AuthService
  proxyService: ProxyService
  kiroLocalService: KiroLocalService
  registrationService: RegistrationService
  machineIdService: MachineIdService
  kiroSettingsService: KiroSettingsService
  kproxyService: KProxyManagementService
  diagnosticsService: DiagnosticsService
  subscriptionService: SubscriptionService
  webhookService: WebhookService
  configSyncService: ConfigSyncService
  schedulerService: SchedulerService
  proxyPoolService: ProxyPoolService
  server: LocalAdminServer
  info: LocalAdminServerInfo
  staticDir?: string
  close(): Promise<void>
}

const DEFAULT_PORT = 9527
const DEFAULT_ENCRYPTION_KEY = 'kiro-account-manager-secret-key'
const DEFAULT_STATIC_DIR = resolve('out/renderer')

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid KIRO_ADMIN_PORT: ${value}`)
  }
  return parsed
}

function getEnvOptions(): StandaloneOptions {
  return {
    host: process.env.KIRO_ADMIN_HOST,
    port: parsePort(process.env.KIRO_ADMIN_PORT),
    accessToken: process.env.KIRO_ADMIN_TOKEN,
    dataDir: process.env.KIRO_ADMIN_DATA_DIR,
    encryptionKey: process.env.KIRO_ADMIN_ENCRYPTION_KEY,
    staticDir: process.env.KIRO_ADMIN_STATIC_DIR,
    openBrowser: process.env.KIRO_ADMIN_OPEN_BROWSER !== '0'
  }
}

function openExternalUrl(url: string): Promise<void> {
  const command =
    process.platform === 'win32'
      ? 'rundll32.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  return spawnDetached(command, args)
}

function openLocalPath(targetPath: string): Promise<void> {
  const command =
    process.platform === 'win32'
      ? 'explorer.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open'
  return spawnDetached(command, [targetPath])
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.once('error', reject)
      child.unref()
      resolve()
    } catch (error) {
      reject(error)
    }
  })
}

export async function startStandaloneServer(
  options: StandaloneOptions = {}
): Promise<StandaloneRuntime> {
  if (options.dataDir) {
    setDataDir(options.dataDir)
  }

  const dataDir = options.dataDir || getDataDir()
  const staticDir =
    options.staticDir ?? (existsSync(DEFAULT_STATIC_DIR) ? DEFAULT_STATIC_DIR : undefined)
  const fetchOpts = { createProxyAgent: (url: string | undefined) => safeCreateProxyAgent(url) }
  const withBoundProxy = (proxyUrl?: string) =>
    proxyUrl ? { ...fetchOpts, overrideProxyUrl: proxyUrl } : fetchOpts
  const configStore = new ConfigStore({
    dataDir,
    encryptionKey: options.encryptionKey || DEFAULT_ENCRYPTION_KEY
  })
  let proxyPoolService: ProxyPoolService | null = null

  const accountService = new AccountService({
    dataDir,
    encryptionKey: options.encryptionKey || DEFAULT_ENCRYPTION_KEY,
    emitEvent: (type, payload): void => {
      publishEvent(type, payload)
    },
    createProxyAgent: (url) => safeCreateProxyAgent(url),
    getAccountProxyUrl: (accountId) => proxyPoolService?.getAccountProxyUrl(accountId),
    checkAccount: (accessToken, idp, machineId, region, email, proxyUrl) =>
      checkKiroAccount(accessToken, idp, machineId, region, email, withBoundProxy(proxyUrl)),
    getUsageAndLimits: (accessToken, idp, machineId, _accountMachineId, region, email, proxyUrl) =>
      getUsageAndLimits(accessToken, idp, machineId, region, email, withBoundProxy(proxyUrl)),
    getUserInfo: (accessToken, idp, machineId, email, proxyUrl) =>
      getUserInfo(accessToken, idp, machineId, email, withBoundProxy(proxyUrl))
  })
  await accountService.initialize()

  const authService = new AuthService({
    fetchOpts,
    emitEvent: (type, payload): void => {
      publishEvent(type, payload)
    },
    openUrl: openExternalUrl
  })

  const kiroLocalService = new KiroLocalService({
    tokenRefreshDeps: { fetchOpts }
  })

  const machineIdService = new MachineIdService()
  const kiroSettingsService = new KiroSettingsService({
    openPath: openLocalPath,
    getAvailableModels: async () => ({ models: [] })
  })
  const kproxyService = new KProxyManagementService({
    store: configStore,
    emitEvent: (type, payload): void => {
      publishEvent(type, payload)
    }
  })
  const diagnosticsService = new DiagnosticsService({
    createProxyAgent: (url) => safeCreateProxyAgent(url),
    getOverview: async () => {
      const proxyStatus = proxyService.getStatus()
      const proxyPoolSnapshot = proxyPoolService?.getSnapshot()
      const kproxyStatus = kproxyService.getStatus()
      const webhookHealth = webhookService.health()
      const configSyncHealth = configSyncService.health()
      const schedulerHealth = schedulerService.health()
      return {
        checks: [
          {
            id: 'local-admin',
            label: 'Local Admin',
            category: 'local',
            success: true,
            detail: info?.baseUrl || 'running'
          },
          {
            id: 'proxy',
            label: 'Proxy Service',
            category: 'proxy',
            success: proxyStatus.config !== null,
            detail: proxyStatus.running ? 'running' : 'stopped'
          },
          {
            id: 'proxy-pool',
            label: 'Proxy Pool',
            category: 'proxy',
            success: Boolean(proxyPoolSnapshot),
            detail: proxyPoolSnapshot
              ? `${proxyPoolSnapshot.counts.enabled}/${proxyPoolSnapshot.counts.total} enabled`
              : 'not ready'
          },
          {
            id: 'kproxy',
            label: 'K-Proxy',
            category: 'proxy',
            success: kproxyStatus.config !== null,
            detail: kproxyStatus.running ? 'running' : 'stopped'
          },
          {
            id: 'webhooks',
            label: 'Webhooks',
            category: 'webhook',
            success: webhookHealth.success,
            detail: `${webhookHealth.count} configured`
          },
          {
            id: 'scheduler',
            label: 'Scheduler',
            category: 'scheduler',
            success: schedulerHealth.ok === true,
            detail: `${schedulerHealth.tasks.length} tasks`
          },
          {
            id: 'config-sync',
            label: 'Config Sync',
            category: 'storage',
            success: configSyncHealth.success,
            detail: dataDir
          }
        ]
      }
    }
  })
  proxyPoolService = new ProxyPoolService({
    accountService,
    validateProxy: (input) => diagnosticsService.validateProxy(input),
    emitEvent: (type, payload): void => {
      publishEvent(type, payload)
    }
  })
  const registrationService = new RegistrationService({
    emitEvent: (type, payload): void => {
      publishEvent(type, payload)
    },
    pickProxyForRegistration: () => proxyPoolService?.pickNextProxy('registration') || null,
    reportProxyResult: (proxyId, success, boundEmail, error) => {
      proxyPoolService?.reportProxyResult(proxyId, success, boundEmail, error)
    }
  })
  const subscriptionService = new SubscriptionService({
    openSubscriptionUrl: openExternalUrl
  })
  const webhookService = new WebhookService({
    store: configStore
  })
  const configSyncService = new ConfigSyncService({
    accountStore: accountService,
    configStore,
    webhookService
  })
  const schedulerService = new SchedulerService({
    accountService,
    store: configStore,
    emitEvent: (type, payload): void => {
      publishEvent(type, payload)
    }
  })
  schedulerService.initialize()

  const proxyService = new ProxyService({
    dataDir,
    store: configStore,
    emitEvent: (type, payload): void => {
      publishEvent(type, payload)
    },
    getAccountProxyUrl: (accountId) => proxyPoolService?.getAccountProxyUrl(accountId),
    createServer: () => {
      const savedConfig = (configStore.get('proxyConfig') as Partial<ProxyConfig> | undefined) || {}
      const proxyServer = new ProxyServer(savedConfig, {
        onRequest: (info): void => {
          publishEvent('proxy-request', info)
        },
        onResponse: (info): void => {
          publishEvent('proxy-response', info)
        },
        onError: (error): void => {
          publishEvent('proxy-error', error.message)
        },
        onStatusChange: (running, port): void => {
          publishEvent('proxy-status-change', { running, port })
        },
        onTokenRefresh: async (account: ProxyAccount) => {
          const result = await accountService.refreshToken({
            id: account.id,
            credentials: {
              refreshToken: account.refreshToken || '',
              clientId: account.clientId,
              clientSecret: account.clientSecret,
              region: account.region,
              authMethod: account.authMethod,
              provider: account.provider
            }
          })
          if (result.success && result.accessToken) {
            return {
              success: true,
              accessToken: result.accessToken,
              refreshToken: result.refreshToken,
              expiresAt: Date.now() + (result.expiresIn || 3600) * 1000
            }
          }
          return { success: false, error: result.error || 'Token 刷新失败' }
        },
        onAccountUpdate: (account): void => {
          publishEvent('proxy-account-update', {
            id: account.id,
            accessToken: account.accessToken,
            refreshToken: account.refreshToken,
            expiresAt: account.expiresAt
          })
        },
        onAccountSuspended: (info): void => {
          publishEvent('proxy-account-suspended', info)
        },
        onCreditsUpdate: (totalCredits): void => {
          configStore.set('proxyTotalCredits', totalCredits)
        },
        onTokensUpdate: (inputTokens, outputTokens): void => {
          configStore.set('proxyInputTokens', inputTokens)
          configStore.set('proxyOutputTokens', outputTokens)
        },
        onRequestStatsUpdate: (totalRequests, successRequests, failedRequests): void => {
          configStore.set('proxyTotalRequests', totalRequests)
          configStore.set('proxySuccessRequests', successRequests)
          configStore.set('proxyFailedRequests', failedRequests)
        }
      })
      proxyServer.setTotalCredits((configStore.get('proxyTotalCredits') as number | undefined) || 0)
      proxyServer.setTotalTokens(
        (configStore.get('proxyInputTokens') as number | undefined) || 0,
        (configStore.get('proxyOutputTokens') as number | undefined) || 0
      )
      proxyServer.setRequestStats(
        (configStore.get('proxyTotalRequests') as number | undefined) || 0,
        (configStore.get('proxySuccessRequests') as number | undefined) || 0,
        (configStore.get('proxyFailedRequests') as number | undefined) || 0
      )
      proxyServer.setWebhookTrigger((event, payload): void => {
        publishEvent('proxy-webhook-trigger', { event, payload })
      })
      return proxyServer
    }
  })

  const server = createLocalAdminServer({
    host: options.host,
    port: options.port ?? DEFAULT_PORT,
    accessToken: options.accessToken,
    staticDir,
    routers: [
      createAccountRouter({ accountService }),
      createAuthRouter({ authService }),
      createProxyRouter({ proxyService }),
      createKiroLocalRouter({ kiroLocalService }),
      createRegistrationRouter({ registrationService }),
      createMachineIdRouter({ machineIdService }),
      createKiroSettingsRouter({ kiroSettingsService }),
      createKProxyRouter({ kproxyService }),
      createDiagnosticsRouter({ diagnosticsService }),
      createProxyPoolRouter({ proxyPoolService }),
      createSubscriptionRouter({ subscriptionService }),
      createWebhookRouter({ webhookService }),
      createConfigSyncRouter({ configSyncService }),
      createSchedulerRouter({ schedulerService })
    ]
  })

  const info = await server.listen()

  return {
    accountService,
    authService,
    proxyService,
    kiroLocalService,
    registrationService,
    machineIdService,
    kiroSettingsService,
    kproxyService,
    diagnosticsService,
    subscriptionService,
    webhookService,
    configSyncService,
    schedulerService,
    proxyPoolService,
    server,
    info,
    staticDir,
    async close(): Promise<void> {
      schedulerService.shutdown()
      await proxyService.shutdown()
      await kproxyService.shutdown()
      await registrationService.shutdown()
      await accountService.shutdown()
      await authService.shutdown()
      await server.close()
    }
  }
}

async function runSmoke(runtime: StandaloneRuntime): Promise<void> {
  const response = await fetch(`${runtime.info.baseUrl}/api/health`)
  if (!response.ok) {
    throw new Error(`Health check failed: HTTP ${response.status}`)
  }
  const body = (await response.json()) as { ok?: boolean }
  if (body.ok !== true) {
    throw new Error('Health check failed: ok is not true')
  }

  if (runtime.staticDir) {
    const uiResponse = await fetch(`${runtime.info.baseUrl}/`)
    if (!uiResponse.ok) {
      throw new Error(`Static UI check failed: HTTP ${uiResponse.status}`)
    }
    const contentType = uiResponse.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) {
      throw new Error(`Static UI check failed: expected text/html, got ${contentType}`)
    }
    const html = await uiResponse.text()
    const assetMatch = html.match(/["'](\/assets\/[^"']+\.(?:js|css))["']/)
    if (assetMatch) {
      const assetResponse = await fetch(`${runtime.info.baseUrl}${assetMatch[1]}`)
      if (!assetResponse.ok) {
        throw new Error(`Static asset check failed: HTTP ${assetResponse.status}`)
      }
    }
  }

  const proxyStatusResponse = await fetch(`${runtime.info.baseUrl}/api/proxy/status`, {
    headers: {
      Authorization: `Bearer ${runtime.info.accessToken}`
    }
  })
  if (!proxyStatusResponse.ok) {
    throw new Error(`Proxy status check failed: HTTP ${proxyStatusResponse.status}`)
  }
  const proxyStatusBody = (await proxyStatusResponse.json()) as { ok?: boolean }
  if (proxyStatusBody.ok !== true) {
    throw new Error('Proxy status check failed: ok is not true')
  }

  const proxyDashboardResponse = await fetch(`${runtime.info.baseUrl}/api/proxy/dashboard`, {
    headers: {
      Authorization: `Bearer ${runtime.info.accessToken}`
    }
  })
  if (!proxyDashboardResponse.ok) {
    throw new Error(`Proxy dashboard check failed: HTTP ${proxyDashboardResponse.status}`)
  }
  const proxyDashboardBody = (await proxyDashboardResponse.json()) as {
    ok?: boolean
    dashboard?: { accounts?: { total?: number }; apiKeys?: { total?: number } }
  }
  if (
    proxyDashboardBody.ok !== true ||
    typeof proxyDashboardBody.dashboard?.accounts?.total !== 'number' ||
    typeof proxyDashboardBody.dashboard?.apiKeys?.total !== 'number'
  ) {
    throw new Error('Proxy dashboard check failed: invalid body')
  }

  const proxyPoolResponse = await fetch(`${runtime.info.baseUrl}/api/proxy-pool`, {
    headers: {
      Authorization: `Bearer ${runtime.info.accessToken}`
    }
  })
  if (!proxyPoolResponse.ok) {
    throw new Error(`Proxy pool check failed: HTTP ${proxyPoolResponse.status}`)
  }
  const proxyPoolBody = (await proxyPoolResponse.json()) as {
    ok?: boolean
    proxies?: unknown[]
    counts?: { total?: number; boundAccounts?: number }
  }
  if (
    proxyPoolBody.ok !== true ||
    !Array.isArray(proxyPoolBody.proxies) ||
    typeof proxyPoolBody.counts?.total !== 'number' ||
    typeof proxyPoolBody.counts?.boundAccounts !== 'number'
  ) {
    throw new Error('Proxy pool check failed: invalid body')
  }

  const schedulerHealthResponse = await fetch(`${runtime.info.baseUrl}/api/scheduler/health`, {
    headers: {
      Authorization: `Bearer ${runtime.info.accessToken}`
    }
  })
  if (!schedulerHealthResponse.ok) {
    throw new Error(`Scheduler health check failed: HTTP ${schedulerHealthResponse.status}`)
  }
  const schedulerHealthBody = (await schedulerHealthResponse.json()) as {
    ok?: boolean
    tasks?: Array<{ id?: string }>
  }
  if (schedulerHealthBody.ok !== true) {
    throw new Error('Scheduler health check failed: ok is not true')
  }
  if (
    !schedulerHealthBody.tasks?.some((task) => task.id === 'account-auto-refresh') ||
    !schedulerHealthBody.tasks?.some((task) => task.id === 'account-status-check')
  ) {
    throw new Error('Scheduler health check failed: default tasks missing')
  }

  const schedulerRunResponse = await fetch(
    `${runtime.info.baseUrl}/api/scheduler/tasks/account-status-check/run`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.info.accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  )
  if (!schedulerRunResponse.ok) {
    throw new Error(`Scheduler manual run check failed: HTTP ${schedulerRunResponse.status}`)
  }
  const schedulerRunBody = (await schedulerRunResponse.json()) as {
    ok?: boolean
    run?: { status?: string; total?: number }
  }
  if (schedulerRunBody.ok !== true || schedulerRunBody.run?.total !== 0) {
    throw new Error('Scheduler manual run check failed: invalid run body')
  }

  const schedulerPauseResponse = await fetch(
    `${runtime.info.baseUrl}/api/scheduler/tasks/account-status-check/pause`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.info.accessToken}`
      }
    }
  )
  if (!schedulerPauseResponse.ok) {
    throw new Error(`Scheduler pause check failed: HTTP ${schedulerPauseResponse.status}`)
  }

  const schedulerResumeResponse = await fetch(
    `${runtime.info.baseUrl}/api/scheduler/tasks/account-status-check/resume`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.info.accessToken}`
      }
    }
  )
  if (!schedulerResumeResponse.ok) {
    throw new Error(`Scheduler resume check failed: HTTP ${schedulerResumeResponse.status}`)
  }

  const kiroLocalResponse = await fetch(`${runtime.info.baseUrl}/api/kiro-local/active-account`, {
    headers: {
      Authorization: `Bearer ${runtime.info.accessToken}`
    }
  })
  if (!kiroLocalResponse.ok) {
    throw new Error(`Kiro local active-account check failed: HTTP ${kiroLocalResponse.status}`)
  }
  const kiroLocalBody = (await kiroLocalResponse.json()) as { ok?: boolean }
  if (typeof kiroLocalBody.ok !== 'boolean') {
    throw new Error('Kiro local active-account check failed: ok is not boolean')
  }

  const registrationStatusResponse = await fetch(
    `${runtime.info.baseUrl}/api/registration/status`,
    {
      headers: {
        Authorization: `Bearer ${runtime.info.accessToken}`
      }
    }
  )
  if (!registrationStatusResponse.ok) {
    throw new Error(`Registration status check failed: HTTP ${registrationStatusResponse.status}`)
  }
  const registrationStatusBody = (await registrationStatusResponse.json()) as { ok?: boolean }
  if (registrationStatusBody.ok !== true) {
    throw new Error('Registration status check failed: ok is not true')
  }

  const machineIdOsResponse = await fetch(`${runtime.info.baseUrl}/api/machine-id/os`, {
    headers: {
      Authorization: `Bearer ${runtime.info.accessToken}`
    }
  })
  if (!machineIdOsResponse.ok) {
    throw new Error(`Machine ID OS check failed: HTTP ${machineIdOsResponse.status}`)
  }
  const machineIdOsBody = (await machineIdOsResponse.json()) as { ok?: boolean; osType?: string }
  if (machineIdOsBody.ok !== true || typeof machineIdOsBody.osType !== 'string') {
    throw new Error('Machine ID OS check failed: invalid body')
  }

  const kiroSettingsResponse = await fetch(`${runtime.info.baseUrl}/api/kiro-settings`, {
    headers: {
      Authorization: `Bearer ${runtime.info.accessToken}`
    }
  })
  if (!kiroSettingsResponse.ok) {
    throw new Error(`Kiro settings check failed: HTTP ${kiroSettingsResponse.status}`)
  }
  const kiroSettingsBody = (await kiroSettingsResponse.json()) as { ok?: boolean }
  if (kiroSettingsBody.ok !== true) {
    throw new Error('Kiro settings check failed: ok is not true')
  }

  const kproxyStatusResponse = await fetch(`${runtime.info.baseUrl}/api/kproxy/status`, {
    headers: {
      Authorization: `Bearer ${runtime.info.accessToken}`
    }
  })
  if (!kproxyStatusResponse.ok) {
    throw new Error(`K-Proxy status check failed: HTTP ${kproxyStatusResponse.status}`)
  }
  const kproxyStatusBody = (await kproxyStatusResponse.json()) as { ok?: boolean }
  if (kproxyStatusBody.ok !== true) {
    throw new Error('K-Proxy status check failed: ok is not true')
  }

  const kproxySystemInfoResponse = await fetch(`${runtime.info.baseUrl}/api/kproxy/system-info`, {
    headers: {
      Authorization: `Bearer ${runtime.info.accessToken}`
    }
  })
  if (!kproxySystemInfoResponse.ok) {
    throw new Error(`K-Proxy system info check failed: HTTP ${kproxySystemInfoResponse.status}`)
  }
  const kproxySystemInfoBody = (await kproxySystemInfoResponse.json()) as {
    ok?: boolean
    platform?: string
    caInstalled?: boolean
    adminRecommended?: boolean
  }
  if (
    kproxySystemInfoBody.ok !== true ||
    typeof kproxySystemInfoBody.platform !== 'string' ||
    typeof kproxySystemInfoBody.caInstalled !== 'boolean' ||
    typeof kproxySystemInfoBody.adminRecommended !== 'boolean'
  ) {
    throw new Error('K-Proxy system info check failed: invalid body')
  }

  const diagnosticsProbeResponse = await fetch(
    `${runtime.info.baseUrl}/api/diagnostics/http-probe`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.info.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: `${runtime.info.baseUrl}/api/health`,
        timeoutMs: 3000
      })
    }
  )
  if (!diagnosticsProbeResponse.ok) {
    throw new Error(`Diagnostics probe check failed: HTTP ${diagnosticsProbeResponse.status}`)
  }
  const diagnosticsProbeBody = (await diagnosticsProbeResponse.json()) as {
    ok?: boolean
    success?: boolean
    status?: number
  }
  if (diagnosticsProbeBody.ok !== true || diagnosticsProbeBody.success !== true) {
    throw new Error('Diagnostics probe check failed: invalid body')
  }

  const subscriptionsHealthResponse = await fetch(
    `${runtime.info.baseUrl}/api/subscriptions/health`,
    {
      headers: {
        Authorization: `Bearer ${runtime.info.accessToken}`
      }
    }
  )
  if (!subscriptionsHealthResponse.ok) {
    throw new Error(`Subscriptions health check failed: HTTP ${subscriptionsHealthResponse.status}`)
  }
  const subscriptionsHealthBody = (await subscriptionsHealthResponse.json()) as { ok?: boolean }
  if (subscriptionsHealthBody.ok !== true) {
    throw new Error('Subscriptions health check failed: ok is not true')
  }

  const webhooksHealthResponse = await fetch(`${runtime.info.baseUrl}/api/webhooks/health`, {
    headers: {
      Authorization: `Bearer ${runtime.info.accessToken}`
    }
  })
  if (!webhooksHealthResponse.ok) {
    throw new Error(`Webhooks health check failed: HTTP ${webhooksHealthResponse.status}`)
  }
  const webhooksHealthBody = (await webhooksHealthResponse.json()) as { ok?: boolean }
  if (webhooksHealthBody.ok !== true) {
    throw new Error('Webhooks health check failed: ok is not true')
  }

  const configSyncHealthResponse = await fetch(`${runtime.info.baseUrl}/api/config-sync/health`, {
    headers: {
      Authorization: `Bearer ${runtime.info.accessToken}`
    }
  })
  if (!configSyncHealthResponse.ok) {
    throw new Error(`Config sync health check failed: HTTP ${configSyncHealthResponse.status}`)
  }
  const configSyncHealthBody = (await configSyncHealthResponse.json()) as { ok?: boolean }
  if (configSyncHealthBody.ok !== true) {
    throw new Error('Config sync health check failed: ok is not true')
  }

  console.log('[Standalone] Smoke check passed')
}

export async function runStandaloneMain(): Promise<void> {
  const smoke = process.argv.includes('--smoke')
  const options = getEnvOptions()
  const runtime = await startStandaloneServer(options)
  let closing = false

  const close = async (exitCode: number = 0): Promise<void> => {
    if (closing) return
    closing = true
    await runtime.close()
    process.exitCode = exitCode
  }

  console.log(`[Standalone] Local admin server listening on ${runtime.info.baseUrl}`)
  console.log(`[Standalone] Admin URL: ${redactSensitiveText(runtime.info.adminUrl)}`)
  console.log(`[Standalone] Access token: ${maskSecret(runtime.info.accessToken)}`)
  console.log(`[Standalone] Data dir: ${getDataDir()}`)

  if (!smoke && options.openBrowser !== false) {
    void openExternalUrl(runtime.info.adminUrl).catch((error) => {
      console.warn('[Standalone] Failed to open browser:', error)
    })
  }

  process.once('SIGINT', () => {
    void close(0)
  })
  process.once('SIGTERM', () => {
    void close(0)
  })

  if (smoke) {
    try {
      await runSmoke(runtime)
      await close(0)
    } catch (error) {
      console.error('[Standalone] Smoke check failed:', error)
      await close(1)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runStandaloneMain().catch((error) => {
    console.error('[Standalone] Failed to start:', error)
    process.exit(1)
  })
}
