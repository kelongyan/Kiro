import { spawn } from 'child_process'
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
import { ConfigStore } from './storage/config-store'
import { ProxyServer, type ProxyAccount, type ProxyConfig } from '../main/proxy'
import { safeCreateProxyAgent } from '../main/proxy/systemProxy'

interface StandaloneOptions {
  host?: string
  port?: number
  accessToken?: string
  dataDir?: string
  encryptionKey?: string
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
  server: LocalAdminServer
  info: LocalAdminServerInfo
  close(): Promise<void>
}

const DEFAULT_PORT = 9527
const DEFAULT_ENCRYPTION_KEY = 'kiro-account-manager-secret-key'

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
    encryptionKey: process.env.KIRO_ADMIN_ENCRYPTION_KEY
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
  const fetchOpts = {}
  const configStore = new ConfigStore({
    dataDir,
    encryptionKey: options.encryptionKey || DEFAULT_ENCRYPTION_KEY
  })

  const accountService = new AccountService({
    dataDir,
    encryptionKey: options.encryptionKey || DEFAULT_ENCRYPTION_KEY,
    migrateFromElectronStore: false,
    emitEvent: (type, payload): void => {
      publishEvent(type, payload)
    },
    checkAccount: (accessToken, idp, machineId, region, email) =>
      checkKiroAccount(accessToken, idp, machineId, region, email, fetchOpts),
    getUsageAndLimits: (accessToken, idp, machineId, _accountMachineId, region, email) =>
      getUsageAndLimits(accessToken, idp, machineId, region, email, fetchOpts),
    getUserInfo: (accessToken, idp, machineId, email) =>
      getUserInfo(accessToken, idp, machineId, email, fetchOpts)
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

  const registrationService = new RegistrationService({
    emitEvent: (type, payload): void => {
      publishEvent(type, payload)
    }
  })

  const machineIdService = new MachineIdService()
  const kiroSettingsService = new KiroSettingsService({
    getAvailableModels: async () => ({ models: [] })
  })
  const kproxyService = new KProxyManagementService({
    store: configStore,
    emitEvent: (type, payload): void => {
      publishEvent(type, payload)
    }
  })
  const diagnosticsService = new DiagnosticsService({
    createProxyAgent: (url) => safeCreateProxyAgent(url)
  })
  const subscriptionService = new SubscriptionService({
    openSubscriptionUrl: openExternalUrl
  })
  const webhookService = new WebhookService({
    store: configStore
  })

  const proxyService = new ProxyService({
    dataDir,
    store: configStore,
    emitEvent: (type, payload): void => {
      publishEvent(type, payload)
    },
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
      createSubscriptionRouter({ subscriptionService }),
      createWebhookRouter({ webhookService })
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
    server,
    info,
    async close(): Promise<void> {
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

  console.log('[Standalone] Smoke check passed')
}

async function main(): Promise<void> {
  const smoke = process.argv.includes('--smoke')
  const runtime = await startStandaloneServer(getEnvOptions())
  let closing = false

  const close = async (exitCode: number = 0): Promise<void> => {
    if (closing) return
    closing = true
    await runtime.close()
    process.exitCode = exitCode
  }

  console.log(`[Standalone] Local admin server listening on ${runtime.info.baseUrl}`)
  console.log(`[Standalone] Admin URL: ${runtime.info.adminUrl}`)
  console.log(`[Standalone] Access token: ${runtime.info.accessToken}`)
  console.log(`[Standalone] Data dir: ${getDataDir()}`)

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
  void main().catch((error) => {
    console.error('[Standalone] Failed to start:', error)
    process.exit(1)
  })
}
