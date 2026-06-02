import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { writeFile, readFile } from 'fs/promises'
import { encode, decode } from 'cbor-x'
import {
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
  type Dispatcher
} from 'undici'
import icon from '../../resources/icon.png?asset'
import {
  ProxyServer,
  configureProxyClients,
  type ProxyAccount,
  type ProxyConfig,
  type ProxyClientTarget,
  type ProxyClientModel
} from './proxy'
import { getKProxyService, type KProxyConfig, type DeviceIdMapping } from './kproxy'
import {
  fetchKiroModels,
  setUseKProxyForApiInProxy,
  setLogStreamEvents,
  setPayloadSizeLimitKB,
  setTokenBufferReserve,
  setEnableTokenBufferReserve
} from './proxy/kiroApi'
import { getSystemProxy, safeCreateProxyAgent } from './proxy/systemProxy'
import { proxyLogStore, interceptConsole } from './proxy/logger'
import { registerIPCHandlers as registerRegistrationHandlers } from './registration/ipc-handlers'
import { createBackupController } from './services/storage/backup'
import {
  fetchWithAppProxy as fetchWithAppProxyService,
  getFallbackRestApiBase,
  getRestApiBase,
  normalizeProxyUrl
} from './services/network/proxy-utils'
import { showOpenFileDialog, showSaveFileDialog } from './services/runtime/dialogs'
import { openExternalUrl, openFilePath } from './services/runtime/open'
import { getUserDataPath } from './services/runtime/paths'
import { publishEvent } from '../server'
import { AccountService } from '../server/services/accounts/account-service'
import { AuthService } from '../server/services/auth/auth-service'
import { createAccountRouter } from '../server/http/controllers/account-controller'
import { createAuthRouter } from '../server/http/controllers/auth-controller'
import { createProxyRouter } from '../server/http/controllers/proxy-controller'
import { createKiroLocalRouter } from '../server/http/controllers/kiro-local-controller'
import { createRegistrationRouter } from '../server/http/controllers/registration-controller'
import { createMachineIdRouter } from '../server/http/controllers/machine-id-controller'
import { createKiroSettingsRouter } from '../server/http/controllers/kiro-settings-controller'
import { createKProxyRouter } from '../server/http/controllers/kproxy-controller'
import { createDiagnosticsRouter } from '../server/http/controllers/diagnostics-controller'
import { createSubscriptionRouter } from '../server/http/controllers/subscription-controller'
import { createWebhookRouter } from '../server/http/controllers/webhook-controller'
import { createLocalAdminServer, type LocalAdminServer } from '../server/http/local-admin-server'
import { ProxyService } from '../server/services/proxy/proxy-service'
import { KiroLocalService } from '../server/services/kiro-local/kiro-local-service'
import { RegistrationService } from '../server/services/registration/registration-service'
import { MachineIdService } from '../server/services/machine-id/machine-id-service'
import { KiroSettingsService } from '../server/services/kiro-settings/kiro-settings-service'
import { KProxyManagementService } from '../server/services/kproxy/kproxy-service'
import { DiagnosticsService } from '../server/services/diagnostics/diagnostics-service'
import { SubscriptionService } from '../server/services/subscriptions/subscription-service'
import { WebhookService } from '../server/services/webhooks/webhook-service'
// ============ Kiro API 调用 ============
const KIRO_API_BASE = 'https://app.kiro.dev/service/KiroWebPortalService/operation'
// API 类型配置
type UsageApiType = 'rest' | 'cbor'
let currentUsageApiType: UsageApiType = 'rest' // 默认使用 REST API (GetUsageLimits)

export function setUsageApiType(type: UsageApiType): void {
  currentUsageApiType = type
  console.log(`[API] Usage API type set to: ${type}`)
}

export function getUsageApiType(): UsageApiType {
  return currentUsageApiType
}

// 是否使用 K-Proxy 代理发送 API 请求
let useKProxyForApi: boolean = false

export function setUseKProxyForApi(enabled: boolean): void {
  useKProxyForApi = enabled
  // 同步设置到 kiroApi.ts
  setUseKProxyForApiInProxy(enabled)
  console.log(`[API] Use K-Proxy for API requests: ${enabled}`)
}

export function getUseKProxyForApi(): boolean {
  return useKProxyForApi
}

// 获取网络代理 agent（优先 K-Proxy，其次用户设置代理，其次系统代理）
function getNetworkAgent(): Dispatcher | undefined {
  if (useKProxyForApi) {
    const kproxyService = getKProxyService()
    if (kproxyService?.isRunning()) {
      const config = kproxyService.getConfig()
      const proxyUrl = `http://${config.host}:${config.port}`
      const agent = safeCreateProxyAgent(proxyUrl)
      if (agent) return agent
    }
  }
  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy
  const envAgent = safeCreateProxyAgent(envProxy)
  if (envAgent) return envAgent
  return safeCreateProxyAgent(getSystemProxy())
}

/**
 * 通用 fetch 函数
 * @param url 请求 URL
 * @param options fetch 选项
 * @param overrideProxyUrl 可选：账号绑定的代理 URL（优先级最高，覆盖全局代理逻辑）
 *
 * 优先级：overrideProxyUrl > K-Proxy > 用户设置代理 > 系统代理 > 直连
 */
// 兼容函数，指向 getNetworkAgent
function getKProxyAgent(): Dispatcher | undefined {
  return getNetworkAgent()
}

function fetchWithAppProxy(
  url: string,
  options: RequestInit,
  overrideProxyUrl?: string
): Promise<Response> {
  return fetchWithAppProxyService(
    url,
    options,
    overrideProxyUrl,
    getNetworkAgent,
    safeCreateProxyAgent
  )
}

// ============ OIDC Token 刷新 ============
interface OidcRefreshResult {
  success: boolean
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
  error?: string
}

// 社交登录 (GitHub/Google) 的 Token 刷新端点
const KIRO_AUTH_ENDPOINT = 'https://prod.us-east-1.auth.desktop.kiro.dev'

interface StoredAccountCredentials {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  clientId?: string
  clientSecret?: string
  region?: string
  authMethod?: 'social' | 'idc' | 'IdC' | 'external_idp'
  provider?: string
}

interface StoredAccountRecord {
  id?: string
  email?: string
  status?: string
  idp?: string
  profileArn?: string
  machineId?: string
  isActive?: boolean
  credentials?: StoredAccountCredentials
}

function hasStoredAccountAccessToken(acc: StoredAccountRecord): acc is StoredAccountRecord & {
  id: string
  credentials: StoredAccountCredentials & { accessToken: string }
} {
  return typeof acc.id === 'string' && typeof acc.credentials?.accessToken === 'string'
}

// ============ 代理设置 ============

// 设置代理环境变量
function applyProxySettings(enabled: boolean, url: string): void {
  if (enabled && url) {
    const normalized = normalizeProxyUrl(url)
    process.env.HTTP_PROXY = normalized
    process.env.HTTPS_PROXY = normalized
    process.env.http_proxy = normalized
    process.env.https_proxy = normalized
    if (normalized !== url) {
      console.log(`[Proxy] Enabled: ${normalized} (规范化自: ${url})`)
    } else {
      console.log(`[Proxy] Enabled: ${normalized}`)
    }
  } else {
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.http_proxy
    delete process.env.https_proxy
    console.log('[Proxy] Disabled')
  }
}

// ============ 防抖 store 写入（减少磁盘 I/O） ============
const pendingStoreWrites: Map<string, unknown> = new Map()
let storeFlushTimer: ReturnType<typeof setTimeout> | null = null
const STORE_FLUSH_INTERVAL = 5000 // 5 秒批量写入一次

function debouncedStoreSet(key: string, value: unknown): void {
  pendingStoreWrites.set(key, value)
  if (!storeFlushTimer) {
    storeFlushTimer = setTimeout(flushStoreWrites, STORE_FLUSH_INTERVAL)
  }
}

function flushStoreWrites(): void {
  storeFlushTimer = null
  if (!store || pendingStoreWrites.size === 0) return
  for (const [key, value] of pendingStoreWrites) {
    store.set(key, value)
  }
  pendingStoreWrites.clear()
}

// ============ Server 层服务实例（HTTP API + 浏览器管理面板） ============
let accountService: AccountService | null = null
let authService: AuthService | null = null
let proxyService: ProxyService | null = null
let kiroLocalService: KiroLocalService | null = null
let registrationService: RegistrationService | null = null
let machineIdService: MachineIdService | null = null
let kiroSettingsService: KiroSettingsService | null = null
let kproxyManagementService: KProxyManagementService | null = null
let diagnosticsService: DiagnosticsService | null = null
let subscriptionService: SubscriptionService | null = null
let webhookService: WebhookService | null = null
let localAdminServer: LocalAdminServer | null = null

function getAccountService(): AccountService {
  if (!accountService) {
    throw new Error('AccountService 未初始化')
  }
  return accountService
}

function getAuthService(): AuthService {
  if (!authService) {
    throw new Error('AuthService 未初始化')
  }
  return authService
}

function getKiroLocalService(): KiroLocalService {
  if (!kiroLocalService) {
    throw new Error('KiroLocalService 未初始化')
  }
  return kiroLocalService
}

function getRegistrationService(): RegistrationService {
  if (!registrationService) {
    throw new Error('RegistrationService 未初始化')
  }
  return registrationService
}

function getMachineIdService(): MachineIdService {
  if (!machineIdService) {
    throw new Error('MachineIdService 未初始化')
  }
  return machineIdService
}

function getKiroSettingsService(): KiroSettingsService {
  if (!kiroSettingsService) {
    throw new Error('KiroSettingsService 未初始化')
  }
  return kiroSettingsService
}

function getKProxyManagementService(): KProxyManagementService {
  if (!kproxyManagementService) {
    throw new Error('KProxyManagementService 未初始化')
  }
  return kproxyManagementService
}

function getDiagnosticsService(): DiagnosticsService {
  if (!diagnosticsService) {
    throw new Error('DiagnosticsService 未初始化')
  }
  return diagnosticsService
}

function getSubscriptionService(): SubscriptionService {
  if (!subscriptionService) {
    throw new Error('SubscriptionService 未初始化')
  }
  return subscriptionService
}

// ============ Kiro API 反代服务器 ============
let proxyServer: ProxyServer | null = null

function initProxyServer(): ProxyServer {
  if (proxyServer) return proxyServer

  // 确保日志存储已初始化（app.whenReady 中已调用，此处兜底）
  proxyLogStore.initialize(getUserDataPath())

  // 从 store 加载保存的配置，如果没有则使用默认配置
  const savedConfig = store?.get('proxyConfig') as Partial<ProxyConfig> | undefined
  // 从 store 加载保存的 Usage API 类型
  const savedUsageApiType = store?.get('usageApiType') as 'rest' | 'cbor' | undefined
  if (savedUsageApiType) {
    setUsageApiType(savedUsageApiType)
  }
  // 从 store 加载保存的 K-Proxy 代理设置
  const savedUseKProxyForApi = store?.get('useKProxyForApi') as boolean | undefined
  if (savedUseKProxyForApi !== undefined) {
    setUseKProxyForApi(savedUseKProxyForApi)
  }
  // 从 store 加载保存的累计 credits 和 tokens
  const savedTotalCredits = (store?.get('proxyTotalCredits') as number) || 0
  const savedInputTokens = (store?.get('proxyInputTokens') as number) || 0
  const savedOutputTokens = (store?.get('proxyOutputTokens') as number) || 0
  // 从 store 加载保存的请求统计
  const savedTotalRequests = (store?.get('proxyTotalRequests') as number) || 0
  const savedSuccessRequests = (store?.get('proxySuccessRequests') as number) || 0
  const savedFailedRequests = (store?.get('proxyFailedRequests') as number) || 0
  const defaultConfig: ProxyConfig = {
    enabled: false,
    port: 5580,
    host: '127.0.0.1',
    enableMultiAccount: true,
    selectedAccountIds: [],
    logRequests: true,
    maxConcurrent: 10,
    maxRetries: 3,
    retryDelayMs: 1000,
    tokenRefreshBeforeExpiry: 300, // 5分钟提前刷新
    clientDrivenToolExecution: true,
    enableTokenBufferReserve: false,
    tokenBufferReserve: 20000
  }

  // 合并保存的配置和默认配置
  const config: ProxyConfig = savedConfig ? { ...defaultConfig, ...savedConfig } : defaultConfig

  // 恢复 payload 大小限制
  if (config.payloadSizeLimitKB) {
    setPayloadSizeLimitKB(config.payloadSizeLimitKB)
  }
  // 恢复 Token buffer reserve（开关 + 数值）
  setEnableTokenBufferReserve(config.enableTokenBufferReserve === true)
  if (config.tokenBufferReserve) {
    setTokenBufferReserve(config.tokenBufferReserve)
  }

  proxyServer = new ProxyServer(config, {
    onRequest: (info) => {
      emitAppEvent('proxy-request', info)
    },
    onResponse: (info) => {
      emitAppEvent('proxy-response', info)
    },
    onError: (error) => {
      console.error('[ProxyServer] Error:', error)
      emitAppEvent('proxy-error', error.message)
    },
    onStatusChange: (running, port) => {
      emitAppEvent('proxy-status-change', { running, port })
    },
    // Token 刷新回调 - 复用已有的刷新逻辑，含账号绑定代理
    onTokenRefresh: async (account) => {
      try {
        console.log(
          `[ProxyServer] Refreshing token for ${account.email || account.id}${account.proxyUrl ? ' [via bound proxy]' : ''}`
        )
        const refreshResult = await refreshTokenByMethod(
          account.refreshToken || '',
          account.clientId || '',
          account.clientSecret || '',
          account.region || 'us-east-1',
          account.authMethod,
          account.proxyUrl // 账号绑定的代理（如有）
        )

        if (refreshResult.success && refreshResult.accessToken) {
          return {
            success: true,
            accessToken: refreshResult.accessToken,
            refreshToken: refreshResult.refreshToken,
            expiresAt: Date.now() + (refreshResult.expiresIn || 3600) * 1000
          }
        }
        return { success: false, error: refreshResult.error || 'Token 刷新失败' }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    },
    // 账号更新回调 - 通知渲染进程更新账号数据
    onAccountUpdate: (account) => {
      emitAppEvent('proxy-account-update', {
        id: account.id,
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        expiresAt: account.expiresAt
      })
    },
    // 账号被 Kiro 后端长期封禁 - 通知渲染进程标记 lastError + 持久化到 store
    // 不同于 token 失效，需要人工解封；账号池已自动跳过该账号
    onAccountSuspended: (info) => {
      console.warn(
        `[ProxyServer] Account suspended: ${info.email || info.accountId} (${info.reason})`
      )
      // 推送 IPC 事件给前端 store
      emitAppEvent('proxy-account-suspended', {
        id: info.accountId,
        email: info.email,
        reason: info.reason,
        message: info.message,
        suspendedAt: Date.now()
      })
      // 持久化封禁状态：依赖 renderer store 接收 IPC 后通过 saveToStorage 防抖落盘，
      // 主进程仅在 lastSavedData 内存快照上做轻量更新，避免每次封禁都触发整库加解密 IO。
      // 这能从根本上消除频繁封禁场景下的主进程阻塞（旧代码 store.get + store.set 各做一次 AES 全库加解密）
      if (lastSavedData && typeof lastSavedData === 'object') {
        try {
          const data = lastSavedData as { accounts?: Record<string, Record<string, unknown>> }
          if (data.accounts?.[info.accountId]) {
            data.accounts[info.accountId] = {
              ...data.accounts[info.accountId],
              status: 'error',
              lastError: `[${info.reason}] ${info.message}`,
              lastCheckedAt: Date.now()
            }
          }
        } catch (e) {
          console.error('[ProxyServer] Failed to update suspended state in memory:', e)
        }
      }
    },
    // Credits 更新回调 - 使用防抖持久化
    onCreditsUpdate: (totalCredits) => {
      debouncedStoreSet('proxyTotalCredits', totalCredits)
    },
    // Tokens 更新回调 - 使用防抖持久化
    onTokensUpdate: (inputTokens, outputTokens) => {
      debouncedStoreSet('proxyInputTokens', inputTokens)
      debouncedStoreSet('proxyOutputTokens', outputTokens)
    },
    // 请求统计更新回调 - 使用防抖持久化
    onRequestStatsUpdate: (totalRequests, successRequests, failedRequests) => {
      debouncedStoreSet('proxyTotalRequests', totalRequests)
      debouncedStoreSet('proxySuccessRequests', successRequests)
      debouncedStoreSet('proxyFailedRequests', failedRequests)
    },
    // 账号池为空时懒加载 - 从 store 读取账号数据同步到 pool
    onPoolEmpty: async () => {
      await initStore()
      if (!store) return
      const accountData = store.get('accountData') as
        | {
            accounts?: Record<string, StoredAccountRecord>
            accountProxyBindings?: Record<string, string>
            proxyPool?: Record<string, { url?: string; enabled?: boolean; status?: string }>
          }
        | undefined
      if (!accountData?.accounts) return

      // 构建 accountId → proxyUrl 映射（用于反代时 N:1 分桶）
      const bindings = accountData.accountProxyBindings || {}
      const proxyPool = accountData.proxyPool || {}
      const buildProxyUrl = (accountId: string): string | undefined => {
        const proxyId = bindings[accountId]
        if (!proxyId) return undefined
        const p = proxyPool[proxyId]
        if (!p || !p.enabled || p.status === 'dead') return undefined
        return p.url
      }

      const proxyAccounts = Object.values(accountData.accounts)
        .filter(
          (
            acc
          ): acc is StoredAccountRecord & {
            id: string
            credentials: StoredAccountCredentials & { accessToken: string }
          } => acc.status === 'active' && hasStoredAccountAccessToken(acc)
        )
        .map((acc) => ({
          id: acc.id,
          email: acc.email,
          accessToken: acc.credentials.accessToken,
          refreshToken: acc.credentials?.refreshToken,
          profileArn: acc.profileArn,
          expiresAt: acc.credentials?.expiresAt,
          machineId: acc.machineId,
          clientId: acc.credentials?.clientId,
          clientSecret: acc.credentials?.clientSecret,
          region: acc.credentials?.region || 'us-east-1',
          authMethod: acc.credentials?.authMethod,
          provider: acc.credentials?.provider || acc.idp,
          proxyUrl: buildProxyUrl(acc.id)
        }))
      if (proxyAccounts.length > 0 && proxyServer) {
        const pool = proxyServer.getAccountPool()
        proxyAccounts.forEach((acc) => pool.addAccount(acc))
        const boundCount = proxyAccounts.filter((a) => a.proxyUrl).length
        console.log(
          `[ProxyServer] Lazy-synced ${proxyAccounts.length} accounts from store (${boundCount} with bound proxy)`
        )
      }
    }
  })

  // P1-6 注入 webhook 触发器：让反代关键事件（封号 / 全员配额耗尽 / 限流）能推送通知
  proxyServer.setWebhookTrigger((event, payload) => {
    // 通过 IPC 转发到 renderer，由 useWebhookStore.triggerEvent 实际发送
    emitAppEvent('proxy-webhook-trigger', { event, payload })
  })

  // 恢复保存的累计 credits
  if (savedTotalCredits > 0) {
    proxyServer.setTotalCredits(savedTotalCredits)
  }

  // 恢复保存的累计 tokens
  if (savedInputTokens > 0 || savedOutputTokens > 0) {
    proxyServer.setTotalTokens(savedInputTokens, savedOutputTokens)
  }

  // 恢复保存的请求统计
  if (savedTotalRequests > 0 || savedSuccessRequests > 0 || savedFailedRequests > 0) {
    proxyServer.setRequestStats(savedTotalRequests, savedSuccessRequests, savedFailedRequests)
  }

  return proxyServer
}

// ============ 隐私模式打开浏览器 ============
import { exec, execSync } from 'child_process'

// 获取 Windows 默认浏览器
function getWindowsDefaultBrowser(): string {
  try {
    // 从注册表读取默认浏览器
    const progId = execSync(
      'reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )

    if (progId.includes('ChromeHTML') || progId.includes('Google')) return 'chrome'
    if (progId.includes('MSEdgeHTM') || progId.includes('Edge')) return 'msedge'
    if (progId.includes('FirefoxURL') || progId.includes('Firefox')) return 'firefox'
    if (progId.includes('BraveHTML') || progId.includes('Brave')) return 'brave'
    if (progId.includes('Opera')) return 'opera'

    return 'unknown'
  } catch {
    return 'unknown'
  }
}

// 使用隐私模式打开浏览器
function openBrowserInPrivateMode(url: string): void {
  const platform = process.platform
  console.log(`[Browser] Opening in private mode on ${platform}: ${url}`)

  try {
    if (platform === 'win32') {
      // Windows: 检测默认浏览器并使用对应的隐私模式参数
      const defaultBrowser = getWindowsDefaultBrowser()
      console.log(`[Browser] Detected default browser: ${defaultBrowser}`)

      let command = ''
      switch (defaultBrowser) {
        case 'chrome':
          command = `start chrome --incognito "${url}"`
          break
        case 'msedge':
          command = `start msedge -inprivate "${url}"`
          break
        case 'firefox':
          command = `start firefox -private-window "${url}"`
          break
        case 'brave':
          command = `start brave --incognito "${url}"`
          break
        case 'opera':
          command = `start opera --private "${url}"`
          break
        default:
          // 未知浏览器，尝试常见浏览器
          console.log('[Browser] Unknown default browser, trying common browsers...')
          exec(`start chrome --incognito "${url}"`, (err) => {
            if (err) {
              exec(`start msedge -inprivate "${url}"`, (err2) => {
                if (err2) {
                  exec(`start firefox -private-window "${url}"`, (err3) => {
                    if (err3) {
                      console.log('[Browser] Fallback to default browser (non-private)')
                      void openExternalUrl(url)
                    }
                  })
                }
              })
            }
          })
          return
      }

      exec(command, (err) => {
        if (err) {
          console.log(`[Browser] Failed to open ${defaultBrowser}, fallback to default`)
          void openExternalUrl(url)
        }
      })
    } else if (platform === 'darwin') {
      // macOS: 尝试 Chrome -> Firefox -> 默认浏览器
      exec(`open -na "Google Chrome" --args --incognito "${url}"`, (err) => {
        if (err) {
          exec(`open -a Firefox --args -private-window "${url}"`, (err2) => {
            if (err2) {
              console.log('[Browser] Fallback to default browser')
              void openExternalUrl(url)
            }
          })
        }
      })
    } else {
      // Linux: 尝试 Chrome -> Chromium -> Firefox
      exec(`google-chrome --incognito "${url}"`, (err) => {
        if (err) {
          exec(`chromium --incognito "${url}"`, (err2) => {
            if (err2) {
              exec(`firefox -private-window "${url}"`, (err3) => {
                if (err3) {
                  console.log('[Browser] Fallback to default browser')
                  void openExternalUrl(url)
                }
              })
            }
          })
        }
      })
    }
  } catch (error) {
    console.error('[Browser] Error opening in private mode:', error)
    void openExternalUrl(url)
  }
}

// IdC (BuilderId) 的 OIDC Token 刷新
async function refreshOidcToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  region: string = 'us-east-1',
  proxyUrl?: string // 账号绑定的代理 URL（可选，优先级最高）
): Promise<OidcRefreshResult> {
  console.log(
    `[OIDC] Refreshing token with clientId: ${clientId.substring(0, 20)}...${proxyUrl ? ' [via bound proxy]' : ''}`
  )

  const url = `https://oidc.${region}.amazonaws.com/token`

  const payload = {
    clientId,
    clientSecret,
    refreshToken,
    grantType: 'refresh_token'
  }

  try {
    const response = await fetchWithAppProxy(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      },
      proxyUrl
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[OIDC] Refresh failed: ${response.status} - ${errorText}`)
      return { success: false, error: `HTTP ${response.status}: ${errorText}` }
    }

    const data = await response.json()
    console.log(`[OIDC] Token refreshed successfully, expires in ${data.expiresIn}s`)

    return {
      success: true,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken, // 可能不返回新的 refreshToken
      expiresIn: data.expiresIn
    }
  } catch (error) {
    console.error(`[OIDC] Refresh error:`, error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// 社交登录 (GitHub/Google) 的 Token 刷新
async function refreshSocialToken(
  refreshToken: string,
  proxyUrl?: string // 账号绑定的代理 URL（可选，优先级最高）
): Promise<OidcRefreshResult> {
  console.log(`[Social] Refreshing token...${proxyUrl ? ' [via bound proxy]' : ''}`)

  const url = `${KIRO_AUTH_ENDPOINT}/refreshToken`
  const machineId = getCurrentMachineId()

  try {
    const response = await fetchWithAppProxy(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': getKiroUserAgent(machineId)
        },
        body: JSON.stringify({ refreshToken })
      },
      proxyUrl
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Social] Refresh failed: ${response.status} - ${errorText}`)
      return { success: false, error: `HTTP ${response.status}: ${errorText}` }
    }

    const data = await response.json()
    console.log(`[Social] Token refreshed successfully, expires in ${data.expiresIn}s`)

    return {
      success: true,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      expiresIn: data.expiresIn
    }
  } catch (error) {
    console.error(`[Social] Refresh error:`, error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// 通用 Token 刷新 - 根据 authMethod 选择刷新方式
async function refreshTokenByMethod(
  token: string,
  clientId: string,
  clientSecret: string,
  region: string = 'us-east-1',
  authMethod?: string,
  proxyUrl?: string // 账号绑定的代理 URL（可选，优先级最高）
): Promise<OidcRefreshResult> {
  // 如果是社交登录，使用 Kiro Auth Service 刷新
  if (authMethod === 'social') {
    return refreshSocialToken(token, proxyUrl)
  }
  // 否则使用 OIDC 刷新 (IdC/BuilderId)
  return refreshOidcToken(token, clientId, clientSecret, region, proxyUrl)
}

function generateInvocationId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Kiro 版本和 User-Agent 生成
const KIRO_VERSION = '0.6.18'

function getKiroUserAgent(machineId?: string): string {
  const suffix = machineId ? `KiroIDE-${KIRO_VERSION}-${machineId}` : `KiroIDE-${KIRO_VERSION}`
  return `aws-sdk-js/1.0.18 ua/2.1 os/windows lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.18 m/E ${suffix}`
}

function getKiroAmzUserAgent(machineId?: string): string {
  const suffix = machineId ? `KiroIDE ${KIRO_VERSION} ${machineId}` : `KiroIDE-${KIRO_VERSION}`
  return `aws-sdk-js/1.0.18 ${suffix}`
}

function getCurrentMachineId(): string | undefined {
  const kproxyService = getKProxyService()
  if (!kproxyService) return undefined
  return kproxyService.getDeviceId()
}

async function kiroApiRequest<T>(
  operation: string,
  body: Record<string, unknown>,
  accessToken: string,
  idp: string = 'BuilderId', // 支持 BuilderId, Github, Google
  accountMachineId?: string, // 账户绑定的设备 ID
  email?: string // 用于日志标识
): Promise<T> {
  // 优先使用账户绑定的设备 ID，其次使用 K-Proxy 全局设备 ID
  const machineId = accountMachineId || getCurrentMachineId()
  const logTag = email || `token:${accessToken?.slice(-6) || '?'}`
  console.log(
    `[Kiro API] ${operation} [${logTag}] ${idp} machineId=${machineId?.slice(0, 8) || 'none'}`
  )
  const agent = getKProxyAgent()

  // 使用 undici fetch 支持代理
  const headers: Record<string, string> = {
    accept: 'application/cbor',
    'content-type': 'application/cbor',
    'smithy-protocol': 'rpc-v2-cbor',
    'amz-sdk-invocation-id': generateInvocationId(),
    'amz-sdk-request': 'attempt=1; max=1',
    'x-amz-user-agent': getKiroAmzUserAgent(machineId),
    authorization: `Bearer ${accessToken}`,
    cookie: `Idp=${idp}; AccessToken=${accessToken}`
  }

  let response: Response
  if (agent) {
    response = (await undiciFetch(`${KIRO_API_BASE}/${operation}`, {
      method: 'POST',
      headers,
      body: Buffer.from(encode(body)),
      dispatcher: agent
    } as UndiciRequestInit)) as unknown as Response
  } else {
    response = await fetchWithAppProxy(`${KIRO_API_BASE}/${operation}`, {
      method: 'POST',
      headers,
      body: Buffer.from(encode(body))
    })
  }

  if (!response.ok) {
    // 尝试解析 CBOR 格式的错误响应
    let errorMessage = `HTTP ${response.status}`
    const errorBuffer = await response.arrayBuffer()
    try {
      const errorData = decode(Buffer.from(errorBuffer)) as { __type?: string; message?: string }
      if (errorData.__type && errorData.message) {
        // 提取错误类型名称（去掉命名空间）
        const errorType = errorData.__type.split('#').pop() || errorData.__type
        // 在错误消息中包含 HTTP 状态码，便于封禁检测
        errorMessage = `HTTP ${response.status}: ${errorType}: ${errorData.message}`
      } else if (errorData.message) {
        errorMessage = `HTTP ${response.status}: ${errorData.message}`
      }
      console.error(`[Kiro API] Error:`, errorData)
    } catch {
      // 如果 CBOR 解析失败，显示原始内容
      const errorText = Buffer.from(errorBuffer).toString('utf-8')
      console.error(`[Kiro API] Error (raw): ${errorText}`)
    }
    throw new Error(errorMessage)
  }

  const arrayBuffer = await response.arrayBuffer()
  const result = decode(Buffer.from(arrayBuffer)) as T
  // 精简响应日志：一行摘要 + 完整数据放 data（ⓘ 展开）
  const r = result as Record<string, unknown>
  const resSummary = r.email ? `${r.email} [${r.status || 'ok'}]` : `${response.status}`
  console.log(`[Kiro API] ${operation} [${logTag}] → ${resSummary}`, result)
  return result
}

// ============ GetUsageLimits REST API (官方格式) ============
interface UsageLimitsResponse {
  // REST API 实际返回 usageBreakdownList（不是 usageBreakdowns）
  usageBreakdownList?: Array<{
    type?: string
    resourceType?: string
    displayName?: string
    displayNamePlural?: string
    currentUsage?: number
    currentUsageWithPrecision?: number
    usageLimit?: number
    usageLimitWithPrecision?: number
    currency?: string
    unit?: string
    overageRate?: number
    overageCap?: number
    overageCharges?: number
    currentOverages?: number
    freeTrialUsage?: {
      currentUsage?: number
      currentUsageWithPrecision?: number
      usageLimit?: number
      usageLimitWithPrecision?: number
      freeTrialStatus?: string
      freeTrialExpiry?: string
    }
    // REST API 直接返回 freeTrialInfo（与 freeTrialUsage 结构相同）
    freeTrialInfo?: {
      currentUsage?: number
      currentUsageWithPrecision?: number
      usageLimit?: number
      usageLimitWithPrecision?: number
      freeTrialStatus?: string
      freeTrialExpiry?: number | string
    }
    bonuses?: Array<{
      bonusCode?: string
      displayName?: string
      description?: string
      usageLimit?: number
      usageLimitWithPrecision?: number
      currentUsage?: number
      currentUsageWithPrecision?: number
      expiresAt?: number | string // REST API 返回数字时间戳
      redeemedAt?: number | string
      status?: string
    }>
  }>
  nextDateReset?: number | string // Unix 时间戳（秒）或 ISO 字符串
  subscriptionInfo?: {
    subscriptionName?: string
    subscriptionTitle?: string
    subscriptionType?: string
    status?: string
    subscriptionManagementTarget?: string
    upgradeCapability?: string
    overageCapability?: string
  }
  overageSettings?: {
    overageStatus?: string
  }
  overageConfiguration?: {
    overageEnabled?: boolean
    overageStatus?: string
  }
  userInfo?: {
    email?: string
    userId?: string
  }
}

// 辅助函数：将 Unix 时间戳（秒）或 ISO 字符串转换为 ISO 字符串
function normalizeResetDate(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') {
    // Unix 时间戳（秒），转换为毫秒后创建 Date
    return new Date(value * 1000).toISOString()
  }
  return value
}

async function fetchRestApi(
  baseUrl: string,
  path: string,
  accessToken: string,
  machineId?: string
): Promise<Response> {
  const agent = getKProxyAgent()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': getKiroUserAgent(machineId),
    'x-amz-user-agent': getKiroAmzUserAgent(machineId)
  }
  const url = `${baseUrl}${path}`
  if (agent) {
    return (await undiciFetch(url, {
      method: 'GET',
      headers,
      dispatcher: agent
    } as UndiciRequestInit)) as unknown as Response
  }
  return await fetchWithAppProxy(url, { method: 'GET', headers })
}

async function getUsageLimitsRest(
  accessToken: string,
  profileArn?: string,
  accountMachineId?: string, // 账户绑定的设备 ID
  ssoRegion?: string, // SSO 区域，用于选择正确的 REST API 端点
  email?: string // 用于日志标识
): Promise<UsageLimitsResponse> {
  // 优先使用账户绑定的设备 ID，其次使用 K-Proxy 全局设备 ID
  const machineId = accountMachineId || getCurrentMachineId()
  const logTag = email || `token:${accessToken?.slice(-6) || '?'}`
  console.log(`[Kiro REST API] GetUsageLimits [${logTag}] region=${ssoRegion || 'default'}`)

  const params = new URLSearchParams({
    origin: 'AI_EDITOR',
    resourceType: 'AGENTIC_REQUEST',
    isEmailRequired: 'true'
  })
  if (profileArn) {
    params.set('profileArn', profileArn)
  }
  const path = `/getUsageLimits?${params.toString()}`

  // 根据 SSO 区域选择主端点
  const primaryBase = getRestApiBase(ssoRegion)
  const fallbackBase = getFallbackRestApiBase(ssoRegion)

  let response = await fetchRestApi(primaryBase, path, accessToken, machineId)

  // 如果主端点返回 403，尝试备用端点
  if (response.status === 403) {
    console.log(`[Kiro REST API] Primary 403, fallback → ${fallbackBase}`)
    response = await fetchRestApi(fallbackBase, path, accessToken, machineId)
  }

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[Kiro REST API] GetUsageLimits failed: ${response.status}`, errorText)
    throw new Error(`HTTP ${response.status}: ${errorText}`)
  }

  const result = await response.json()
  console.log(`[Kiro REST API] GetUsageLimits [${logTag}] → ${response.status}`, result)
  return result
}

// 统一的用量查询接口 - 根据配置选择 API 类型
interface UnifiedUsageResponse {
  usageBreakdownList?: Array<{
    resourceType?: string
    displayName?: string
    displayNamePlural?: string
    currentUsage?: number
    currentUsageWithPrecision?: number
    usageLimit?: number
    usageLimitWithPrecision?: number
    currency?: string
    unit?: string
    overageRate?: number
    overageCap?: number
    type?: string
    freeTrialInfo?: {
      freeTrialStatus?: string
      usageLimit?: number
      usageLimitWithPrecision?: number
      currentUsage?: number
      currentUsageWithPrecision?: number
      freeTrialExpiry?: string
    }
    bonuses?: Array<{
      bonusCode?: string
      displayName?: string
      usageLimit?: number
      usageLimitWithPrecision?: number
      currentUsage?: number
      currentUsageWithPrecision?: number
      expiresAt?: string
      status?: string
    }>
  }>
  nextDateReset?: string
  subscriptionInfo?: {
    subscriptionName?: string
    subscriptionTitle?: string
    subscriptionType?: string
    status?: string
    type?: string
    subscriptionManagementTarget?: string
    upgradeCapability?: string
    overageCapability?: string
  }
  overageConfiguration?: {
    overageEnabled?: boolean
    overageStatus?: string
  }
  userInfo?: {
    email?: string
    userId?: string
  }
}

async function getUsageAndLimits(
  accessToken: string,
  idp: string = 'BuilderId',
  profileArn?: string,
  accountMachineId?: string, // 账户绑定的设备 ID
  ssoRegion?: string, // SSO 区域，用于选择正确的 REST API 端点
  email?: string // 用于日志标识
): Promise<UnifiedUsageResponse> {
  if (currentUsageApiType === 'rest') {
    // 使用 REST API (GetUsageLimits)
    const result = await getUsageLimitsRest(
      accessToken,
      profileArn,
      accountMachineId,
      ssoRegion,
      email
    )
    // REST API 返回的字段名和 CBOR API 相同，直接返回
    return {
      usageBreakdownList: result.usageBreakdownList?.map((b) => ({
        resourceType: b.resourceType || b.type,
        displayName: b.displayName,
        displayNamePlural: b.displayNamePlural,
        currentUsage: b.currentUsage,
        currentUsageWithPrecision: b.currentUsageWithPrecision,
        usageLimit: b.usageLimit,
        usageLimitWithPrecision: b.usageLimitWithPrecision,
        currency: b.currency,
        unit: b.unit,
        overageRate: b.overageRate,
        overageCap: b.overageCap,
        type: b.type,
        // REST API 直接返回 freeTrialInfo，CBOR API 返回 freeTrialUsage
        freeTrialInfo: b.freeTrialInfo
          ? {
              freeTrialStatus: b.freeTrialInfo.freeTrialStatus,
              usageLimit: b.freeTrialInfo.usageLimit,
              usageLimitWithPrecision: b.freeTrialInfo.usageLimitWithPrecision,
              currentUsage: b.freeTrialInfo.currentUsage,
              currentUsageWithPrecision: b.freeTrialInfo.currentUsageWithPrecision,
              // REST API 返回数字时间戳，需要转换为 ISO 字符串
              freeTrialExpiry:
                typeof b.freeTrialInfo.freeTrialExpiry === 'number'
                  ? new Date(b.freeTrialInfo.freeTrialExpiry * 1000).toISOString()
                  : b.freeTrialInfo.freeTrialExpiry
            }
          : b.freeTrialUsage
            ? {
                freeTrialStatus: b.freeTrialUsage.freeTrialStatus,
                usageLimit: b.freeTrialUsage.usageLimit,
                usageLimitWithPrecision: b.freeTrialUsage.usageLimitWithPrecision,
                currentUsage: b.freeTrialUsage.currentUsage,
                currentUsageWithPrecision: b.freeTrialUsage.currentUsageWithPrecision,
                freeTrialExpiry: b.freeTrialUsage.freeTrialExpiry
              }
            : undefined,
        // 转换 bonuses 中的时间戳为 ISO 字符串
        bonuses: b.bonuses?.map((bonus) => ({
          ...bonus,
          expiresAt:
            typeof bonus.expiresAt === 'number'
              ? new Date(bonus.expiresAt * 1000).toISOString()
              : bonus.expiresAt
        }))
      })),
      // REST API 返回的 nextDateReset 是 Unix 时间戳（秒），需要转换为 ISO 字符串
      nextDateReset: normalizeResetDate(result.nextDateReset),
      subscriptionInfo: result.subscriptionInfo,
      overageConfiguration: result.overageConfiguration,
      userInfo: result.userInfo
    }
  } else {
    // 使用 CBOR API (GetUserUsageAndLimits)
    // CBOR API (app.kiro.dev) 是网页端门户，仅支持 BuilderId 认证
    // Enterprise/IdC 账号可能返回 401，需要 fallback 到 REST API
    try {
      return await kiroApiRequest<UnifiedUsageResponse>(
        'GetUserUsageAndLimits',
        { isEmailRequired: true, origin: 'KIRO_IDE' },
        accessToken,
        idp,
        accountMachineId,
        email
      )
    } catch (cborError) {
      const errorMsg = cborError instanceof Error ? cborError.message : ''
      // CBOR 401/403 时自动 fallback 到 REST API
      if (errorMsg.includes('401') || errorMsg.includes('403')) {
        console.log(`[API] CBOR API failed (${errorMsg}), falling back to REST API...`)
        const result = await getUsageLimitsRest(
          accessToken,
          profileArn,
          accountMachineId,
          ssoRegion,
          email
        )
        return {
          usageBreakdownList: result.usageBreakdownList?.map((b) => ({
            resourceType: b.resourceType || b.type,
            displayName: b.displayName,
            displayNamePlural: b.displayNamePlural,
            currentUsage: b.currentUsage,
            currentUsageWithPrecision: b.currentUsageWithPrecision,
            usageLimit: b.usageLimit,
            usageLimitWithPrecision: b.usageLimitWithPrecision,
            currency: b.currency,
            unit: b.unit,
            overageRate: b.overageRate,
            overageCap: b.overageCap,
            type: b.type,
            freeTrialInfo: b.freeTrialInfo
              ? {
                  freeTrialStatus: b.freeTrialInfo.freeTrialStatus,
                  usageLimit: b.freeTrialInfo.usageLimit,
                  usageLimitWithPrecision: b.freeTrialInfo.usageLimitWithPrecision,
                  currentUsage: b.freeTrialInfo.currentUsage,
                  currentUsageWithPrecision: b.freeTrialInfo.currentUsageWithPrecision,
                  freeTrialExpiry:
                    typeof b.freeTrialInfo.freeTrialExpiry === 'number'
                      ? new Date(b.freeTrialInfo.freeTrialExpiry * 1000).toISOString()
                      : b.freeTrialInfo.freeTrialExpiry
                }
              : b.freeTrialUsage
                ? {
                    freeTrialStatus: b.freeTrialUsage.freeTrialStatus,
                    usageLimit: b.freeTrialUsage.usageLimit,
                    usageLimitWithPrecision: b.freeTrialUsage.usageLimitWithPrecision,
                    currentUsage: b.freeTrialUsage.currentUsage,
                    currentUsageWithPrecision: b.freeTrialUsage.currentUsageWithPrecision,
                    freeTrialExpiry: b.freeTrialUsage.freeTrialExpiry
                  }
                : undefined,
            bonuses: b.bonuses?.map((bonus) => ({
              ...bonus,
              expiresAt:
                typeof bonus.expiresAt === 'number'
                  ? new Date(bonus.expiresAt * 1000).toISOString()
                  : bonus.expiresAt
            }))
          })),
          nextDateReset: normalizeResetDate(result.nextDateReset as unknown as number | string),
          subscriptionInfo: result.subscriptionInfo,
          overageConfiguration: result.overageConfiguration,
          userInfo: result.userInfo
        }
      }
      throw cborError
    }
  }
}

// GetUserInfo API - 只需要 accessToken 即可调用
interface UserInfoResponse {
  email?: string
  userId?: string
  idp?: string
  status?: string
  featureFlags?: string[]
}

async function getUserInfo(
  accessToken: string,
  idp: string = 'BuilderId',
  accountMachineId?: string,
  email?: string
): Promise<UserInfoResponse> {
  return kiroApiRequest<UserInfoResponse>(
    'GetUserInfo',
    { origin: 'KIRO_IDE' },
    accessToken,
    idp,
    accountMachineId,
    email
  )
}

// 定义自定义协议
const PROTOCOL_PREFIX = 'kiro'

// electron-store 实例（延迟初始化）
let store: {
  get: (key: string, defaultValue?: unknown) => unknown
  set: (key: string, value: unknown) => void
  path: string
} | null = null

// 最后保存的数据（用于崩溃恢复）
let lastSavedData: unknown = null

async function initStore(): Promise<void> {
  if (store) return
  const Store = (await import('electron-store')).default
  const fs = await import('fs/promises')
  const path = await import('path')

  const storeInstance = new Store({
    name: 'kiro-accounts',
    encryptionKey: 'kiro-account-manager-secret-key'
  })

  store = storeInstance as unknown as typeof store

  // 尝试从备份恢复数据（如果主数据损坏）
  try {
    const backupPath = path.join(path.dirname(storeInstance.path), 'kiro-accounts.backup.json')
    const mainData = storeInstance.get('accountData')

    if (!mainData) {
      // 主数据不存在或损坏，尝试从备份恢复
      try {
        const backupContent = await fs.readFile(backupPath, 'utf-8')
        const backupData = JSON.parse(backupContent)
        if (backupData && backupData.accounts) {
          console.log('[Store] Restoring data from backup...')
          storeInstance.set('accountData', backupData)
          console.log('[Store] Data restored from backup successfully')
        }
      } catch {
        // 备份也不存在，忽略
      }
    }
  } catch (error) {
    console.error('[Store] Error checking backup:', error)
  }
}

// ============ 备份节流配置 ============
const { createBackup, flushBackupNow } = createBackupController(() => store)

let mainWindow: BrowserWindow | null = null
let isQuitting = false // 防止 will-quit 保存逻辑重复执行

function emitAppEvent(channel: string, payload: unknown): void {
  publishEvent(channel, payload)
  mainWindow?.webContents.send(channel, payload)
}

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    title: `Kiro 账号管理器 v${app.getVersion()}`,
    width: 1200, // 刚好容纳 3 列卡片 (340*3 + 16*2 + 边距)
    height: 1200,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon,
    frame: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    // 设置带版本号的标题（HTML 加载后会覆盖初始标题）
    mainWindow?.setTitle(`Kiro 账号管理器 v${app.getVersion()}`)
    mainWindow?.show()

    // 检查代理服务自启动配置
    setTimeout(async () => {
      try {
        await initStore()
        if (!store) return

        const savedProxyConfig = store.get('proxyConfig') as ProxyConfig | undefined
        if (!savedProxyConfig?.autoStart) return

        console.log('[ProxyServer] Auto-starting proxy server...')
        const server = initProxyServer()
        server.updateConfig(savedProxyConfig)

        // 自启动时同步账号到代理池（含重试机制应对冷启动数据延迟）
        const syncAccountsToPool = (): number => {
          const accountData = store!.get('accountData') as
            | {
                accounts?: Record<string, StoredAccountRecord>
                accountProxyBindings?: Record<string, string>
                proxyPool?: Record<string, { url?: string; enabled?: boolean; status?: string }>
              }
            | undefined
          if (!accountData?.accounts) return 0

          const bindings = accountData.accountProxyBindings || {}
          const proxyPool = accountData.proxyPool || {}
          const buildProxyUrl = (accountId: string): string | undefined => {
            const proxyId = bindings[accountId]
            if (!proxyId) return undefined
            const p = proxyPool[proxyId]
            if (!p || !p.enabled || p.status === 'dead') return undefined
            return p.url
          }

          const proxyAccounts = Object.values(accountData.accounts)
            .filter(
              (
                acc
              ): acc is StoredAccountRecord & {
                id: string
                credentials: StoredAccountCredentials & { accessToken: string }
              } => acc.status === 'active' && hasStoredAccountAccessToken(acc)
            )
            .map((acc) => ({
              id: acc.id,
              email: acc.email,
              accessToken: acc.credentials.accessToken,
              refreshToken: acc.credentials?.refreshToken,
              profileArn: acc.profileArn,
              expiresAt: acc.credentials?.expiresAt,
              machineId: acc.machineId,
              clientId: acc.credentials?.clientId,
              clientSecret: acc.credentials?.clientSecret,
              region: acc.credentials?.region || 'us-east-1',
              authMethod: acc.credentials?.authMethod,
              provider: acc.credentials?.provider || acc.idp,
              proxyUrl: buildProxyUrl(acc.id)
            }))
          if (proxyAccounts.length > 0) {
            const pool = server.getAccountPool()
            pool.clear()
            proxyAccounts.forEach((acc) => pool.addAccount(acc))
          }
          return proxyAccounts.length
        }

        const syncedCount = syncAccountsToPool()
        if (syncedCount > 0) {
          console.log('[ProxyServer] Auto-synced', syncedCount, 'accounts')
        } else {
          // 冷启动时 store 可能还没有数据（渲染进程尚未初始化完成），延迟重试
          console.log('[ProxyServer] No accounts found on initial sync, will retry...')
          const retrySync = (attempt: number): void => {
            setTimeout(() => {
              const count = syncAccountsToPool()
              if (count > 0) {
                console.log(`[ProxyServer] Retry #${attempt}: synced ${count} accounts`)
              } else if (attempt < 5) {
                retrySync(attempt + 1)
              } else {
                console.log(
                  '[ProxyServer] All retry attempts exhausted, no accounts available. Accounts will sync when UI loads.'
                )
              }
            }, attempt * 2000) // 2s, 4s, 6s, 8s, 10s
          }
          retrySync(1)
        }

        await server.start()
        console.log(
          '[ProxyServer] Auto-started successfully on port',
          savedProxyConfig.port || 5580
        )
      } catch (error) {
        console.error('[ProxyServer] Auto-start failed:', error)
      }

      // K-Proxy MITM 自启动
      try {
        const savedKProxyConfig = store?.get('kproxyConfig') as KProxyConfig | undefined
        if (savedKProxyConfig?.autoStart) {
          console.log('[KProxy] Auto-starting K-Proxy MITM...')
          const result = await getKProxyManagementService().autoStart()
          if (result.success && result.started) {
            console.log('[KProxy] Auto-started successfully')
          }
        }
      } catch (error) {
        console.error('[KProxy] Auto-start failed:', error)
      }
    }, 1000)
  })

  mainWindow.on('close', () => {
    // 窗口关闭前保存数据（同步保存，不等待备份）
    if (lastSavedData && store) {
      try {
        console.log('[Window] Saving data before close...')
        store.set('accountData', lastSavedData)
        // 备份异步进行，不阻塞关闭
        createBackup(lastSavedData)
          .then(() => {
            console.log('[Window] Backup created')
          })
          .catch((err) => {
            console.error('[Window] Backup failed:', err)
          })
        console.log('[Window] Data saved successfully')
      } catch (error) {
        console.error('[Window] Failed to save data:', error)
      }
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void openExternalUrl(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 注册自定义协议
function registerProtocol(): void {
  // 先注销旧的注册（防止上次异常退出未注销）
  unregisterProtocol()

  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL_PREFIX, process.execPath, [join(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL_PREFIX)
  }
  console.log(`[Protocol] Registered ${PROTOCOL_PREFIX}:// protocol`)
}

// 注销自定义协议 (应用退出时调用)
function unregisterProtocol(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.removeAsDefaultProtocolClient(PROTOCOL_PREFIX, process.execPath, [join(process.argv[1])])
    }
  } else {
    app.removeAsDefaultProtocolClient(PROTOCOL_PREFIX)
  }
  console.log(`[Protocol] Unregistered ${PROTOCOL_PREFIX}:// protocol`)
}

// 处理协议 URL (用于 OAuth 回调)
function handleProtocolUrl(url: string): void {
  if (!url.startsWith(`${PROTOCOL_PREFIX}://`)) return

  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname.replace(/^\/+/, '')

    // 处理 auth 回调
    if (pathname === 'auth/callback' || urlObj.host === 'auth') {
      const code = urlObj.searchParams.get('code')
      const state = urlObj.searchParams.get('state')

      if (code && state) {
        emitAppEvent('auth-callback', { code, state })
        mainWindow?.focus()
      }
    }
  } catch (error) {
    console.error('Failed to parse protocol URL:', error)
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // 初始化日志系统（尽早拦截，确保所有 console 输出都进入日志存储）
  proxyLogStore.initialize(getUserDataPath())
  interceptConsole()

  // 注册自定义协议
  registerProtocol()

  // ============ 初始化 Server 层服务（HTTP API + 浏览器管理面板） ============
  try {
    const dataDir = getUserDataPath()

    // 初始化 AccountService
    accountService = new AccountService({
      dataDir,
      encryptionKey: 'kiro-account-manager-secret-key',
      emitEvent: (type, payload) => emitAppEvent(type, payload),
      getNetworkAgent: () => getNetworkAgent(),
      createProxyAgent: (url) => safeCreateProxyAgent(url),
      getAccountProxyUrl: (accountId) => {
        if (!proxyServer) return undefined
        return proxyServer.getAccountPool().getAccount(accountId)?.proxyUrl
      },
      checkAccount: async (accessToken, idp, machineId?, region?, email?) => {
        try {
          const [usageResult, userInfoResult] = await Promise.all([
            getUsageAndLimits(accessToken, idp, undefined, machineId, region, email),
            getUserInfo(accessToken, idp, machineId, email).catch(() => undefined)
          ])
          return {
            success: true,
            usage: usageResult as unknown as Record<string, unknown>,
            userInfo: userInfoResult as unknown as Record<string, unknown>
          }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : '检查失败' }
        }
      },
      getUsageAndLimits: async (
        accessToken,
        idp,
        machineId?,
        _accountMachineId?,
        region?,
        email?
      ) => {
        return getUsageAndLimits(accessToken, idp, undefined, machineId, region, email) as Promise<
          Record<string, unknown>
        >
      },
      getUserInfo: async (accessToken, idp, machineId?, email?) => {
        return getUserInfo(accessToken, idp, machineId, email) as Promise<Record<string, unknown>>
      }
    })
    await accountService.initialize()

    // 初始化 AuthService
    authService = new AuthService({
      fetchOpts: {
        getAgent: () => getNetworkAgent(),
        createProxyAgent: (url) => safeCreateProxyAgent(url)
      },
      emitEvent: (type, payload) => emitAppEvent(type, payload),
      openUrl: async (url) => {
        void openExternalUrl(url)
      },
      openInPrivate: (url) => openBrowserInPrivateMode(url)
    })

    // 初始化 KiroLocalService（本地 Kiro IDE/CLI 凭证读写）
    kiroLocalService = new KiroLocalService({
      tokenRefreshDeps: {
        fetchOpts: {
          getAgent: () => getNetworkAgent(),
          createProxyAgent: (url) => safeCreateProxyAgent(url)
        }
      }
    })

    // 初始化 RegistrationService（注册任务池 + 事件发布）
    registrationService = new RegistrationService({
      emitEvent: (type, payload) => emitAppEvent(type, payload)
    })

    // 初始化 MachineIdService（系统机器码读写）
    machineIdService = new MachineIdService()

    // 初始化 KiroSettingsService（Kiro settings/MCP/Steering 文件管理）
    kiroSettingsService = new KiroSettingsService({
      openPath: async (targetPath) => {
        await openFilePath(targetPath)
      },
      getAvailableModels: async () => {
        try {
          if (!store) return { models: [] }
          const accountData = store.get('accountData') as
            | { accounts?: Record<string, StoredAccountRecord> }
            | undefined
          if (!accountData?.accounts) return { models: [] }

          const allAccounts = Object.values(accountData.accounts).filter(
            hasStoredAccountAccessToken
          )
          const account =
            allAccounts.find((acc) => acc.isActive && acc.credentials?.accessToken) ||
            allAccounts.find((acc) => acc.status === 'active' && acc.credentials?.accessToken)
          if (!account) return { models: [] }

          const proxyAccount = {
            id: account.id,
            email: account.email,
            accessToken: account.credentials.accessToken,
            refreshToken: account.credentials?.refreshToken,
            profileArn: account.profileArn,
            expiresAt: account.credentials?.expiresAt,
            clientId: account.credentials?.clientId,
            clientSecret: account.credentials?.clientSecret,
            region: account.credentials?.region || 'us-east-1',
            authMethod: account.credentials?.authMethod
          }

          const models = await fetchKiroModels(proxyAccount)
          return {
            models: models.map((model) => ({
              id: model.modelId,
              name: model.modelName,
              description: model.description
            }))
          }
        } catch (error) {
          console.error('[KiroSettings] Failed to fetch models:', error)
          return {
            models: [],
            error: error instanceof Error ? error.message : 'Failed to fetch models'
          }
        }
      }
    })

    // 初始化 KProxyManagementService（K-Proxy MITM 管理 + HTTP controller 复用）
    kproxyManagementService = new KProxyManagementService({
      store: {
        get: (key) => store?.get(key),
        set: (key, value) => {
          store?.set(key, value)
        }
      },
      emitEvent: (type, payload) => emitAppEvent(type, payload),
      chooseCaExportPath: async () => {
        const result = await showSaveFileDialog(mainWindow, {
          title: 'Export CA Certificate',
          defaultPath: 'kproxy-ca.crt',
          filters: [{ name: 'Certificate', extensions: ['crt', 'pem'] }]
        })
        return result.canceled ? undefined : result.filePath
      }
    })

    // 初始化 DiagnosticsService（一键诊断 / 代理池验活）
    diagnosticsService = new DiagnosticsService({
      createProxyAgent: (url) => safeCreateProxyAgent(url),
      fetchWithAppProxy: (url, init) => fetchWithAppProxy(url, init)
    })

    // 初始化 SubscriptionService（订阅计划 / 订阅入口 / 超额开关）
    subscriptionService = new SubscriptionService({
      openSubscriptionUrl: (url) => openBrowserInPrivateMode(url)
    })

    // 初始化 WebhookService（浏览器管理面板 Webhook API）
    webhookService = new WebhookService({
      store: {
        get: (key) => store?.get(key),
        set: (key, value) => {
          store?.set(key, value)
        }
      }
    })

    // 初始化 ProxyService（HTTP controller 复用 Electron 过渡态现有 proxyServer 实例）
    proxyService = new ProxyService({
      dataDir,
      emitEvent: (type, payload) => emitAppEvent(type, payload),
      createServer: () => initProxyServer(),
      getServer: () => proxyServer,
      store: {
        get: (key) => store?.get(key),
        set: (key, value) => {
          store?.set(key, value)
        }
      },
      getUsageApiType,
      setUsageApiType,
      getUseKProxyForApi,
      setUseKProxyForApi,
      clearAccountSuspended: (accountId) => {
        if (!store) return
        const accountData = store.get('accountData') as
          | { accounts?: Record<string, Record<string, unknown>> }
          | undefined
        if (accountData?.accounts?.[accountId]) {
          const acc = accountData.accounts[accountId]
          accountData.accounts[accountId] = {
            ...acc,
            status: 'active',
            lastError: undefined,
            lastCheckedAt: Date.now()
          }
          store.set('accountData', accountData)
          lastSavedData = accountData
        }
      }
    })

    // 创建路由器
    const accountRouter = createAccountRouter({ accountService })
    const authRouter = createAuthRouter({ authService })
    const proxyRouter = createProxyRouter({ proxyService })
    const kiroLocalRouter = createKiroLocalRouter({ kiroLocalService })
    const registrationRouter = createRegistrationRouter({ registrationService })
    const machineIdRouter = createMachineIdRouter({ machineIdService })
    const kiroSettingsRouter = createKiroSettingsRouter({ kiroSettingsService })
    const kproxyRouter = createKProxyRouter({ kproxyService: kproxyManagementService })
    const diagnosticsRouter = createDiagnosticsRouter({ diagnosticsService })
    const subscriptionRouter = createSubscriptionRouter({ subscriptionService })
    const webhookRouter = createWebhookRouter({ webhookService })

    // 启动本地管理 HTTP 服务器
    localAdminServer = createLocalAdminServer({
      port: 9527,
      routers: [
        accountRouter,
        authRouter,
        proxyRouter,
        kiroLocalRouter,
        registrationRouter,
        machineIdRouter,
        kiroSettingsRouter,
        kproxyRouter,
        diagnosticsRouter,
        subscriptionRouter,
        webhookRouter
      ]
    })
    const serverInfo = await localAdminServer.listen()
    console.log(`[LocalAdmin] HTTP API server listening on ${serverInfo.baseUrl}`)
    console.log(`[LocalAdmin] Admin URL: ${serverInfo.adminUrl}`)
  } catch (err) {
    console.error('[LocalAdmin] Failed to initialize server layer services:', err)
  }

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.kiro.account-manager')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC: 打开外部链接
  ipcMain.on('open-external', (_event, url: string, usePrivateMode?: boolean) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      if (usePrivateMode) {
        openBrowserInPrivateMode(url)
      } else {
        void openExternalUrl(url)
      }
    }
  })

  // ============ 注册功能 IPC ============
  registerRegistrationHandlers(getRegistrationService())

  // IPC: 获取应用版本
  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  // ============ 一键诊断 ============
  /**
   * 测试一组目标 URL 的连通性（用于诊断面板）
   * 支持指定代理 URL；返回每个目标的延迟与错误
   */
  ipcMain.handle(
    'diagnose:run',
    async (
      _event,
      params: {
        proxyUrl?: string
        targets: Array<{
          id: string
          label: string
          url: string
          timeoutMs?: number
          expectStatus?: number[]
        }>
      }
    ) => {
      return getDiagnosticsService().run(params)
    }
  )

  // ============ 代理池验活 ============
  /**
   * 通过指定代理 URL 请求测试地址，返回延迟与出口 IP
   * 仅支持 http/https 协议代理（受 undici ProxyAgent 限制；socks 协议会被 safeCreateProxyAgent 静默跳过）
   */
  ipcMain.handle(
    'proxy-pool:validate',
    async (
      _event,
      params: {
        url: string
        testUrl?: string
        timeoutMs?: number
      }
    ) => {
      return getDiagnosticsService().validateProxy(params)
    }
  )

  // ============ 账号-代理绑定（反代时 N 账号一个 IP）============
  /**
   * 设置账号在反代场景下使用的出口代理 URL
   * 同时更新：反代账号池里现存的 ProxyAccount.proxyUrl + store 持久化的 accountProxyBindings
   */
  ipcMain.handle(
    'account-set-proxy-binding',
    async (_event, accountId: string, proxyUrl: string | undefined) => {
      try {
        if (!accountId) return { success: false }
        // 更新反代账号池内存中的 proxyUrl
        if (proxyServer) {
          const pool = proxyServer.getAccountPool()
          const acc = pool.getAccount(accountId)
          if (acc) {
            acc.proxyUrl = proxyUrl || undefined
            console.log(
              `[ProxyServer] Account ${acc.email || accountId.slice(0, 8)} proxy ${proxyUrl ? `bound to ${proxyUrl.replace(/:([^:@/]+)@/, ':***@')}` : 'unbound'}`
            )
          }
        }
        return { success: true }
      } catch (err) {
        console.error('[account-set-proxy-binding] error:', err)
        return { success: false }
      }
    }
  )

  // ============ 通用 HTTP 诊断探测 ============
  /**
   * 使用应用代理设置发起一次 GET/HEAD 请求，返回延迟、状态码、错误信息。
   * 用于"一键诊断"面板中检测 Kiro API / 邮箱服务 / 公网连通性。
   */
  ipcMain.handle(
    'diagnose:http-probe',
    async (
      _event,
      params: {
        url: string
        method?: 'GET' | 'HEAD'
        timeoutMs?: number
      }
    ) => {
      return getDiagnosticsService().httpProbe(params)
    }
  )

  // IPC: 加载账号数据
  ipcMain.handle('load-accounts', async () => {
    try {
      return getAccountService().loadAccounts()
    } catch (error) {
      console.error('Failed to load accounts:', error)
      return null
    }
  })

  // IPC: 保存账号数据
  ipcMain.handle('save-accounts', async (_event, data) => {
    try {
      getAccountService().saveAccounts(data)

      // 保存最后的数据（用于崩溃恢复）
      lastSavedData = data
    } catch (error) {
      console.error('Failed to save accounts:', error)
      throw error
    }
  })

  // IPC: 刷新账号 Token（支持 IdC 和社交登录）
  ipcMain.handle('refresh-account-token', async (_event, account) => {
    try {
      const refreshResult = await getAccountService().refreshToken(account)

      if (!refreshResult.success || !refreshResult.accessToken) {
        return { success: false, error: { message: refreshResult.error || 'Token 刷新失败' } }
      }

      const refreshToken = account.credentials?.refreshToken || ''
      return {
        success: true,
        data: {
          accessToken: refreshResult.accessToken,
          refreshToken: refreshResult.refreshToken || refreshToken,
          expiresIn: refreshResult.expiresIn ?? 3600
        }
      }
    } catch (error) {
      return {
        success: false,
        error: { message: error instanceof Error ? error.message : 'Unknown error' }
      }
    }
  })

  // IPC: 从 SSO Token 导入账号 (x-amz-sso_authn)
  ipcMain.handle(
    'import-from-sso-token',
    async (_event, bearerToken: string, region: string = 'us-east-1') => {
      console.log('[IPC] import-from-sso-token called')

      try {
        const ssoResult = await getAuthService().importFromSsoToken(bearerToken, region)

        if (!ssoResult.success || !ssoResult.accessToken) {
          return { success: false, error: { message: ssoResult.error || 'SSO 授权失败' } }
        }

        if (!ssoResult.refreshToken || !ssoResult.clientId || !ssoResult.clientSecret) {
          return { success: false, error: { message: 'SSO 授权结果缺少刷新凭证' } }
        }

        const verifyResult = await getAccountService().verifyCredentials({
          refreshToken: ssoResult.refreshToken,
          clientId: ssoResult.clientId,
          clientSecret: ssoResult.clientSecret,
          region: ssoResult.region || region,
          authMethod: 'IdC',
          provider: 'BuilderId'
        })

        if (!verifyResult.success || !verifyResult.data) {
          return { success: false, error: { message: verifyResult.error || '获取账号信息失败' } }
        }

        return {
          success: true,
          data: {
            ...verifyResult.data,
            clientId: ssoResult.clientId,
            clientSecret: ssoResult.clientSecret,
            region: ssoResult.region || region,
            idp: 'BuilderId',
            status: 'active'
          }
        }
      } catch (error) {
        console.error('[IPC] import-from-sso-token error:', error)
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' }
        }
      }
    }
  )

  // IPC: 检查账号状态（支持自动刷新 Token）
  ipcMain.handle('check-account-status', async (_event, account) => {
    console.log(`[IPC] check-account-status [${account?.email || 'unknown'}]`)
    return getAccountService().checkAccountStatus(account)
  })

  // IPC: 后台批量刷新账号（在主进程执行，不阻塞 UI）
  ipcMain.handle(
    'background-batch-refresh',
    async (
      _event,
      accounts: Array<{
        id: string
        email?: string
        idp?: string
        needsTokenRefresh?: boolean
        machineId?: string
        credentials: {
          refreshToken: string
          clientId?: string
          clientSecret?: string
          region?: string
          authMethod?: string
          accessToken?: string
          provider?: string
        }
      }>,
      concurrency: number = 10,
      syncInfo: boolean = true
    ) => {
      return getAccountService().batchRefresh(accounts, concurrency, syncInfo)
    }
  )

  // IPC: 后台批量检查账号状态（不刷新 Token，只检查状态）
  ipcMain.handle(
    'background-batch-check',
    async (
      _event,
      accounts: Array<{
        id: string
        email: string
        machineId?: string
        credentials: {
          accessToken: string
          refreshToken?: string
          clientId?: string
          clientSecret?: string
          region?: string
          authMethod?: string
          provider?: string
        }
        idp?: string
      }>,
      concurrency: number = 10
    ) => {
      return getAccountService().batchCheck(accounts, concurrency)
    }
  )
  // IPC: 导出到文件
  ipcMain.handle('export-to-file', async (_event, data: string, filename: string) => {
    try {
      const result = await showSaveFileDialog(mainWindow, {
        title: '导出账号数据',
        defaultPath: filename,
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      })

      if (!result.canceled && result.filePath) {
        await writeFile(result.filePath, data, 'utf-8')
        return true
      }
      return false
    } catch (error) {
      console.error('Failed to export:', error)
      return false
    }
  })

  // IPC: 从文件导入
  ipcMain.handle('import-from-file', async () => {
    try {
      const result = await showOpenFileDialog(mainWindow, {
        title: '导入账号数据',
        filters: [
          { name: '所有支持的格式', extensions: ['json', 'csv', 'txt'] },
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'TXT Files', extensions: ['txt'] }
        ],
        properties: ['openFile']
      })

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0]
        const content = await readFile(filePath, 'utf-8')
        const ext = filePath.split('.').pop()?.toLowerCase() || 'json'
        return { content, format: ext }
      }
      return null
    } catch (error) {
      console.error('Failed to import:', error)
      return null
    }
  })

  // IPC: 验证凭证并获取账号信息（用于添加账号）
  ipcMain.handle(
    'verify-account-credentials',
    async (
      _event,
      credentials: {
        refreshToken: string
        clientId: string
        clientSecret: string
        region?: string
        authMethod?: string
        provider?: string // 'BuilderId', 'Github', 'Google' 等
      }
    ) => {
      console.log('[IPC] verify-account-credentials called')

      try {
        return await getAccountService().verifyCredentials({
          refreshToken: credentials.refreshToken,
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          region: credentials.region,
          authMethod: credentials.authMethod,
          provider: credentials.provider
        })
      } catch (error) {
        console.error('[Verify] Error:', error)
        return { success: false, error: error instanceof Error ? error.message : '验证失败' }
      }
    }
  )

  // IPC: 获取本地 SSO 缓存中当前使用的账号信息
  ipcMain.handle('get-local-active-account', async () => {
    return getKiroLocalService().getLocalActiveAccount()
  })

  // IPC: 从 Kiro 本地配置导入凭证
  ipcMain.handle('load-kiro-credentials', async () => {
    return getKiroLocalService().loadKiroCredentials()
  })

  // IPC: 切换账号 - 写入凭证到本地 SSO 缓存
  ipcMain.handle(
    'switch-account',
    async (
      _event,
      credentials: {
        accessToken: string
        refreshToken: string
        clientId: string
        clientSecret: string
        region?: string
        startUrl?: string
        authMethod?: 'IdC' | 'social'
        provider?: 'BuilderId' | 'Github' | 'Google' | 'Enterprise'
        profileArn?: string
      }
    ) => {
      return getKiroLocalService().switchAccount(credentials)
    }
  )

  // IPC: 切换账号到 Kiro CLI - 写入凭证到 SQLite 数据库
  // kiro-cli 使用 ~/.local/share/kiro-cli/data.sqlite3 中的 auth_kv 表
  ipcMain.handle(
    'switch-account-cli',
    async (
      _event,
      credentials: {
        accessToken: string
        refreshToken: string
        clientId?: string
        clientSecret?: string
        region?: string
        profileArn?: string
        provider?: string
        scopes?: string[]
      }
    ) => {
      const result = await getKiroLocalService().switchAccountCli(credentials)
      return {
        success: result.success,
        dbPath: result.data?.dbPath,
        error: result.error
      }
    }
  )

  // IPC: 退出登录 - 清除本地 SSO 缓存
  ipcMain.handle('logout-account', async () => {
    const result = await getKiroLocalService().logoutAccount()
    return {
      success: result.success,
      deletedCount: result.data?.deletedCount,
      error: result.error
    }
  })

  // ============ 手动登录相关 IPC ============

  // IPC: 启动 Builder ID 手动登录
  ipcMain.handle('start-builder-id-login', async (_event, region: string = 'us-east-1') => {
    return getAuthService().startBuilderIdLogin(region)
  })

  // IPC: 轮询 Builder ID 授权状态
  ipcMain.handle('poll-builder-id-auth', async (_event, region: string = 'us-east-1') => {
    const result = await getAuthService().pollBuilderIdAuth(region)
    if (result.success && result.accessToken) {
      return { ...result, completed: true }
    }
    if (!result.success && result.error === '等待授权中...') {
      return { success: true, completed: false, status: 'pending' }
    }
    if (!result.success && result.error === '请求过于频繁，已增加间隔') {
      return { success: true, completed: false, status: 'slow_down' }
    }
    return result
  })

  // IPC: 取消 Builder ID 登录
  ipcMain.handle('cancel-builder-id-login', async () => {
    getAuthService().cancelBuilderIdLogin()
    return { success: true }
  })

  // IPC: 启动 IAM Identity Center SSO 登录 (使用 Authorization Code Grant with PKCE)
  ipcMain.handle(
    'start-iam-sso-login',
    async (_event, startUrl: string, region: string = 'us-east-1') => {
      const result = await getAuthService().startIamSsoLogin(startUrl, region, false)
      return {
        success: result.success,
        authorizeUrl: result.authUrl,
        expiresIn: 600,
        error: result.error
      }
    }
  )

  // IPC: 轮询 IAM SSO 授权状态 (检查本地服务器是否收到回调)
  ipcMain.handle('poll-iam-sso-auth', async () => {
    const result = getAuthService().pollIamSsoAuth()
    if (!result.completed && !result.error) {
      return { success: true, completed: false, status: 'pending' }
    }
    return result
  })

  // IPC: 取消 IAM SSO 登录
  ipcMain.handle('cancel-iam-sso-login', async () => {
    await getAuthService().cancelIamSsoLogin()
    return { success: true }
  })

  // IPC: 启动 Social Auth 登录 (Google/GitHub)
  ipcMain.handle(
    'start-social-login',
    async (_event, provider: 'Google' | 'Github', usePrivateMode?: boolean) => {
      return getAuthService().startSocialLogin(provider, usePrivateMode)
    }
  )

  // IPC: 交换 Social Auth token
  ipcMain.handle('exchange-social-token', async (_event, code: string, state: string) => {
    return getAuthService().exchangeSocialToken(code, state)
  })

  // IPC: 取消 Social Auth 登录
  ipcMain.handle('cancel-social-login', async () => {
    getAuthService().cancelSocialLogin()
    return { success: true }
  })

  // IPC: 设置代理
  ipcMain.handle('set-proxy', async (_event, enabled: boolean, url: string) => {
    const normalizedUrl = enabled && url ? normalizeProxyUrl(url) : url
    console.log(
      `[IPC] set-proxy called: enabled=${enabled}, url=${normalizedUrl}${normalizedUrl !== url ? ` (原始: ${url})` : ''}`
    )
    try {
      applyProxySettings(enabled, url)

      // 同时设置 Electron 的 session 代理
      if (mainWindow) {
        const session = mainWindow.webContents.session
        if (enabled && normalizedUrl) {
          await session.setProxy({ proxyRules: normalizedUrl })
        } else {
          await session.setProxy({ proxyRules: '' })
        }
      }

      return { success: true, normalizedUrl }
    } catch (error) {
      console.error('[Proxy] Failed to set proxy:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // ============ Kiro 设置管理 IPC ============

  // IPC: 获取 Kiro 设置
  ipcMain.handle('get-kiro-settings', async () => {
    try {
      return await getKiroSettingsService().readSettings()
    } catch (error) {
      console.error('[KiroSettings] Failed to get settings:', error)
      return { error: error instanceof Error ? error.message : 'Failed to get settings' }
    }
  })

  // IPC: 获取 Kiro 可用模型列表（使用当前账号调用官方 API）
  ipcMain.handle('get-kiro-available-models', async () => {
    return getKiroSettingsService().availableModels()
  })

  // IPC: 保存 Kiro 设置
  ipcMain.handle('save-kiro-settings', async (_event, settings: Record<string, unknown>) => {
    return getKiroSettingsService().saveSettings(settings)
  })

  // IPC: 打开 Kiro MCP 配置文件
  ipcMain.handle('open-kiro-mcp-config', async (_event, type: 'user' | 'workspace') => {
    return getKiroSettingsService().openMcpConfig(type)
  })

  // IPC: 打开 Kiro Steering 目录
  ipcMain.handle('open-kiro-steering-folder', async () => {
    return getKiroSettingsService().openSteeringFolder()
  })

  // IPC: 打开 Kiro settings.json 文件
  ipcMain.handle('open-kiro-settings-file', async () => {
    return getKiroSettingsService().openSettingsFile()
  })

  // IPC: 打开指定的 Steering 文件
  ipcMain.handle('open-kiro-steering-file', async (_event, filename: string) => {
    return getKiroSettingsService().openSteeringFile(filename)
  })

  // IPC: 创建默认的 rules.md 文件
  ipcMain.handle('create-kiro-default-rules', async () => {
    return getKiroSettingsService().createDefaultRules()
  })

  // IPC: 读取 Steering 文件内容
  ipcMain.handle('read-kiro-steering-file', async (_event, filename: string) => {
    return getKiroSettingsService().readSteeringFile(filename)
  })

  // IPC: 保存 Steering 文件内容
  ipcMain.handle('save-kiro-steering-file', async (_event, filename: string, content: string) => {
    return getKiroSettingsService().saveSteeringFile(filename, content)
  })

  // ============ Kiro API 反代服务器 IPC ============

  // IPC: 启动反代服务器
  ipcMain.handle('proxy-start', async (_event, config?: Partial<ProxyConfig>) => {
    try {
      const server = initProxyServer()
      if (config) {
        server.updateConfig(config)
      }
      await server.start()
      return { success: true, port: server.getConfig().port }
    } catch (error) {
      console.error('[ProxyServer] Start failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start proxy server'
      }
    }
  })

  // IPC: 停止反代服务器
  ipcMain.handle('proxy-stop', async () => {
    try {
      if (proxyServer) {
        await proxyServer.stop()
      }
      return { success: true }
    } catch (error) {
      console.error('[ProxyServer] Stop failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop proxy server'
      }
    }
  })

  // IPC: 获取反代服务器状态
  ipcMain.handle('proxy-get-status', () => {
    if (!proxyServer) {
      // 未初始化时从 store 读取保存的配置
      const savedConfig = store?.get('proxyConfig') as ProxyConfig | undefined
      return { running: false, config: savedConfig || null, stats: null, sessionStats: null }
    }
    return {
      running: proxyServer.isRunning(),
      config: proxyServer.getConfig(),
      stats: proxyServer.getStats(),
      sessionStats: proxyServer.getSessionStats()
    }
  })

  // IPC: 重置累计 credits
  ipcMain.handle('proxy-reset-credits', () => {
    if (proxyServer) {
      proxyServer.resetTotalCredits()
    }
    if (store) {
      store.set('proxyTotalCredits', 0)
    }
    return { success: true }
  })

  // IPC: 重置累计 tokens
  ipcMain.handle('proxy-reset-tokens', () => {
    if (proxyServer) {
      proxyServer.resetTotalTokens()
    }
    if (store) {
      store.set('proxyInputTokens', 0)
      store.set('proxyOutputTokens', 0)
    }
    return { success: true }
  })

  // IPC: 重置请求统计
  ipcMain.handle('proxy-reset-request-stats', () => {
    if (proxyServer) {
      proxyServer.resetRequestStats()
    }
    if (store) {
      store.set('proxyTotalRequests', 0)
      store.set('proxySuccessRequests', 0)
      store.set('proxyFailedRequests', 0)
    }
    return { success: true }
  })

  // IPC: 获取反代日志
  ipcMain.handle('proxy-get-logs', (_event, count?: number) => {
    if (count) {
      return proxyLogStore.getLast(count)
    }
    return proxyLogStore.getAll()
  })

  // IPC: 清除反代日志
  ipcMain.handle('proxy-clear-logs', () => {
    proxyLogStore.clear()
    return { success: true }
  })

  // IPC: 获取反代日志数量
  ipcMain.handle('proxy-get-logs-count', () => {
    return proxyLogStore.count()
  })

  // IPC: 获取 Usage API 类型
  ipcMain.handle('get-usage-api-type', () => {
    return currentUsageApiType
  })

  // IPC: 设置 Usage API 类型
  ipcMain.handle('set-usage-api-type', (_event, type: 'rest' | 'cbor') => {
    setUsageApiType(type)
    // 保存到 store
    if (store) {
      store.set('usageApiType', type)
    }
    return { success: true, type }
  })

  // IPC: 获取是否使用 K-Proxy 代理
  ipcMain.handle('get-use-kproxy-for-api', () => {
    return getUseKProxyForApi()
  })

  // IPC: 设置是否使用 K-Proxy 代理
  ipcMain.handle('set-use-kproxy-for-api', (_event, enabled: boolean) => {
    setUseKProxyForApi(enabled)
    // 保存到 store
    if (store) {
      store.set('useKProxyForApi', enabled)
    }
    return { success: true, enabled }
  })

  // IPC: 更新反代服务器配置
  ipcMain.handle('proxy-update-config', async (_event, config: Partial<ProxyConfig>) => {
    try {
      const server = initProxyServer()
      server.updateConfig(config)
      const newConfig = server.getConfig()
      // 同步流式日志开关
      if (config.logStreamEvents !== undefined) {
        setLogStreamEvents(config.logStreamEvents)
      }
      // 同步 payload 大小限制
      if (config.payloadSizeLimitKB !== undefined) {
        setPayloadSizeLimitKB(config.payloadSizeLimitKB)
      }
      // 同步 Token buffer reserve（开关 + 数值）
      if (config.enableTokenBufferReserve !== undefined) {
        setEnableTokenBufferReserve(config.enableTokenBufferReserve)
      }
      if (config.tokenBufferReserve !== undefined) {
        setTokenBufferReserve(config.tokenBufferReserve)
      }
      // 保存配置到 store（用于自启动）
      if (store) {
        store.set('proxyConfig', newConfig)
      }
      return { success: true, config: newConfig }
    } catch (error) {
      console.error('[ProxyServer] Update config failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update config'
      }
    }
  })

  // ============ 反代安全 / 可观测 IPC（v1.8 新增） ============

  // 获取自签证书信息（PEM、指纹、有效期、SAN）
  ipcMain.handle('proxy-self-signed-cert-info', () => {
    try {
      if (!proxyServer) return { success: false, error: 'Proxy server not initialized' }
      const info = proxyServer.getSelfSignedCertInfo()
      if (!info) return { success: false, error: 'Failed to get self-signed cert info' }
      return { success: true, ...info }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 重新生成自签证书（用户主动触发）
  ipcMain.handle('proxy-self-signed-cert-regenerate', () => {
    try {
      if (!proxyServer) return { success: false, error: 'Proxy server not initialized' }
      const info = proxyServer.regenerateSelfSignedCert()
      if (!info) return { success: false, error: 'Failed to regenerate self-signed cert' }
      return { success: true, ...info }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 检查反代配置是否需要重启
  ipcMain.handle('proxy-needs-restart', () => {
    try {
      if (!proxyServer) return { needsRestart: false }
      return { needsRestart: proxyServer.needsRestart() }
    } catch {
      return { needsRestart: false }
    }
  })

  // 重启反代（用户在 UI 点"立即重启"时调用）
  ipcMain.handle('proxy-restart', async () => {
    try {
      if (!proxyServer) return { success: false, error: 'Proxy server not initialized' }
      await proxyServer.restartServer()
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 获取反代审计日志
  ipcMain.handle('proxy-audit-log', () => {
    try {
      if (!proxyServer) return { entries: [] }
      return { entries: proxyServer.getAuditLog().slice(-200) }
    } catch {
      return { entries: [] }
    }
  })

  // ============ API Key 管理 IPC ============

  // IPC: 获取所有 API Keys
  ipcMain.handle('proxy-get-api-keys', () => {
    try {
      const server = initProxyServer()
      const config = server.getConfig()
      return { success: true, apiKeys: config.apiKeys || [] }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get API keys',
        apiKeys: []
      }
    }
  })

  // IPC: 添加 API Key
  ipcMain.handle(
    'proxy-add-api-key',
    async (
      _event,
      apiKey: {
        name: string
        key?: string
        format?: 'sk' | 'simple' | 'token'
        creditsLimit?: number
      }
    ) => {
      try {
        const crypto = await import('crypto')
        const server = initProxyServer()
        const config = server.getConfig()
        const apiKeys = config.apiKeys || []

        // 根据格式生成随机 Key
        const format = apiKey.format || 'sk'
        let newKey = apiKey.key
        if (!newKey) {
          const randomHex = crypto.randomBytes(24).toString('hex')
          switch (format) {
            case 'sk':
              newKey = `sk-${randomHex}`
              break
            case 'simple':
              newKey = `PROXY_KEY_${randomHex.toUpperCase().substring(0, 32)}`
              break
            case 'token':
              newKey = `KEY:${randomHex.substring(0, 16)}:TOKEN:${randomHex.substring(16, 32)}`
              break
            default:
              newKey = `sk-${randomHex}`
          }
        }

        const newApiKey: import('./proxy/types').ApiKey = {
          id: crypto.randomUUID(),
          name: apiKey.name || `API Key ${apiKeys.length + 1}`,
          key: newKey,
          format: format,
          enabled: true,
          createdAt: Date.now(),
          creditsLimit: apiKey.creditsLimit,
          usage: {
            totalRequests: 0,
            totalCredits: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            daily: {}
          }
        }

        apiKeys.push(newApiKey)
        server.updateConfig({ apiKeys })

        if (store) {
          store.set('proxyConfig', server.getConfig())
        }

        return { success: true, apiKey: newApiKey }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add API key'
        }
      }
    }
  )

  // IPC: 更新 API Key
  ipcMain.handle(
    'proxy-update-api-key',
    (_event, id: string, updates: Partial<import('./proxy/types').ApiKey>) => {
      try {
        const server = initProxyServer()
        const config = server.getConfig()
        const apiKeys = config.apiKeys || []

        const index = apiKeys.findIndex((k) => k.id === id)
        if (index === -1) {
          return { success: false, error: 'API key not found' }
        }

        // 更新字段（不允许更新 id、createdAt、usage）
        const {
          id: ignoredId,
          createdAt: ignoredCreatedAt,
          usage: ignoredUsage,
          ...allowedUpdates
        } = updates
        void ignoredId
        void ignoredCreatedAt
        void ignoredUsage
        apiKeys[index] = { ...apiKeys[index], ...allowedUpdates }

        server.updateConfig({ apiKeys })

        if (store) {
          store.set('proxyConfig', server.getConfig())
        }

        return { success: true, apiKey: apiKeys[index] }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update API key'
        }
      }
    }
  )

  // IPC: 删除 API Key
  ipcMain.handle('proxy-delete-api-key', (_event, id: string) => {
    try {
      const server = initProxyServer()
      const config = server.getConfig()
      const apiKeys = config.apiKeys || []

      const index = apiKeys.findIndex((k) => k.id === id)
      if (index === -1) {
        return { success: false, error: 'API key not found' }
      }

      apiKeys.splice(index, 1)
      server.updateConfig({ apiKeys })

      if (store) {
        store.set('proxyConfig', server.getConfig())
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete API key'
      }
    }
  })

  // IPC: 重置 API Key 用量统计
  ipcMain.handle('proxy-reset-api-key-usage', (_event, id: string) => {
    try {
      const server = initProxyServer()
      const config = server.getConfig()
      const apiKeys = config.apiKeys || []

      const apiKey = apiKeys.find((k) => k.id === id)
      if (!apiKey) {
        return { success: false, error: 'API key not found' }
      }

      apiKey.usage = {
        totalRequests: 0,
        totalCredits: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        daily: {}
      }

      server.updateConfig({ apiKeys })

      if (store) {
        store.set('proxyConfig', server.getConfig())
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset usage'
      }
    }
  })

  // IPC: 添加账号到反代池
  ipcMain.handle('proxy-add-account', (_event, account: ProxyAccount) => {
    try {
      const server = initProxyServer()
      server.getAccountPool().addAccount(account)
      return { success: true, accountCount: server.getAccountPool().size }
    } catch (error) {
      console.error('[ProxyServer] Add account failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add account'
      }
    }
  })

  // IPC: 从反代池移除账号
  ipcMain.handle('proxy-remove-account', (_event, accountId: string) => {
    try {
      const server = initProxyServer()
      server.getAccountPool().removeAccount(accountId)
      return { success: true, accountCount: server.getAccountPool().size }
    } catch (error) {
      console.error('[ProxyServer] Remove account failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove account'
      }
    }
  })

  // IPC: 同步账号到反代池（批量更新）
  ipcMain.handle('proxy-sync-accounts', (_event, accounts: ProxyAccount[]) => {
    try {
      const server = initProxyServer()
      const pool = server.getAccountPool()
      pool.clear()
      for (const account of accounts) {
        pool.addAccount(account)
      }
      return { success: true, accountCount: pool.size }
    } catch (error) {
      console.error('[ProxyServer] Sync accounts failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync accounts'
      }
    }
  })

  // IPC: 获取反代池账号列表
  ipcMain.handle('proxy-get-accounts', () => {
    if (!proxyServer) {
      return { accounts: [], availableCount: 0 }
    }
    const pool = proxyServer.getAccountPool()
    return {
      accounts: pool.getAllAccounts(),
      availableCount: pool.availableCount
    }
  })

  // IPC: 刷新模型缓存
  ipcMain.handle('proxy-refresh-models', () => {
    if (!proxyServer) {
      return { success: false, error: 'Proxy server not initialized' }
    }
    proxyServer.clearModelCache()
    return { success: true }
  })

  // IPC: 获取可用模型列表
  ipcMain.handle('proxy-get-models', async () => {
    if (!proxyServer) {
      return { success: false, error: 'Proxy server not initialized', models: [] }
    }
    try {
      const result = await proxyServer.getAvailableModels()
      return { success: true, ...result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get models',
        models: []
      }
    }
  })

  ipcMain.handle(
    'proxy-configure-clients',
    async (
      _event,
      input: {
        clients: ProxyClientTarget[]
        modelId: string
        modelName?: string
        models?: ProxyClientModel[]
      }
    ) => {
      try {
        const server = initProxyServer()
        const config = server.getConfig()
        const apiKey = (
          config.apiKey ||
          config.apiKeys?.find((key) => key.enabled)?.key ||
          ''
        ).trim()
        if (!apiKey) {
          return {
            success: false,
            proxyOrigin: '',
            openaiBaseUrl: '',
            results: [],
            error: '请先在反代配置中设置或启用 API Key'
          }
        }
        return await configureProxyClients({
          clients: input.clients,
          host: config.host,
          port: config.port,
          tlsEnabled: config.tls?.enabled,
          apiKey,
          modelId: input.modelId,
          modelName: input.modelName,
          models: input.models
        })
      } catch (error) {
        return {
          success: false,
          proxyOrigin: '',
          openaiBaseUrl: '',
          results: [],
          error: error instanceof Error ? error.message : 'Failed to configure clients'
        }
      }
    }
  )

  // IPC: 获取账户可用模型列表
  ipcMain.handle(
    'account-get-models',
    async (
      _event,
      accessToken: string,
      region?: string,
      profileArn?: string,
      machineId?: string,
      provider?: string,
      authMethod?: string,
      accountId?: string
    ) => {
      try {
        const models = await fetchKiroModels({
          id: accountId || 'model-list-request',
          accessToken,
          region: region || 'us-east-1',
          profileArn,
          machineId,
          provider,
          authMethod: authMethod as ProxyAccount['authMethod']
        } as ProxyAccount)
        return {
          success: true,
          models: models.map((m) => ({
            id: m.modelId,
            name: m.modelName,
            description: m.description,
            inputTypes: m.supportedInputTypes,
            maxInputTokens: m.tokenLimits?.maxInputTokens,
            maxOutputTokens: m.tokenLimits?.maxOutputTokens,
            rateMultiplier: m.rateMultiplier,
            rateUnit: m.rateUnit
          }))
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get models',
          models: []
        }
      }
    }
  )

  // IPC: 获取可用订阅列表
  ipcMain.handle(
    'account-get-subscriptions',
    async (
      _event,
      accessToken: string,
      region?: string,
      profileArn?: string,
      machineId?: string,
      provider?: string,
      authMethod?: string,
      accountId?: string
    ) => {
      return getSubscriptionService().getSubscriptions({
        accessToken,
        region,
        profileArn,
        machineId,
        provider,
        authMethod,
        accountId
      })
    }
  )

  // IPC: 获取订阅管理/支付链接
  ipcMain.handle(
    'account-get-subscription-url',
    async (
      _event,
      accessToken: string,
      subscriptionType?: string,
      region?: string,
      profileArn?: string,
      machineId?: string,
      provider?: string,
      authMethod?: string,
      accountId?: string
    ) => {
      return getSubscriptionService().getSubscriptionUrl(
        {
          accessToken,
          region,
          profileArn,
          machineId,
          provider,
          authMethod,
          accountId
        },
        subscriptionType
      )
    }
  )

  // IPC: 设置用户偏好（超额开启/关闭）
  ipcMain.handle(
    'account-set-overage',
    async (
      _event,
      accessToken: string,
      overageStatus: 'ENABLED' | 'DISABLED',
      region?: string,
      profileArn?: string,
      machineId?: string,
      provider?: string,
      authMethod?: string,
      accountId?: string
    ) => {
      return getSubscriptionService().setOverage(
        {
          accessToken,
          region,
          profileArn,
          machineId,
          provider,
          authMethod,
          accountId
        },
        overageStatus
      )
    }
  )

  // IPC: 在系统默认浏览器无痕模式中打开订阅链接
  ipcMain.handle('open-subscription-window', async (_event, url: string) => {
    return getSubscriptionService().openSubscriptionWindow(url)
  })

  // 代理日志持久化（请求日志，与详细日志分开存储）
  const getProxyLogsPath = (): string => join(getUserDataPath(), 'proxy-request-logs.json')
  const MAX_LOGS = 100

  // IPC: 保存代理日志
  ipcMain.handle(
    'proxy-save-logs',
    async (
      _event,
      logs: Array<{ time: string; path: string; status: number; tokens?: number }>
    ) => {
      try {
        const logsPath = getProxyLogsPath()
        // 只保留最近 100 条
        const trimmedLogs = logs.slice(0, MAX_LOGS)
        await writeFile(logsPath, JSON.stringify(trimmedLogs, null, 2), 'utf-8')
        return { success: true }
      } catch (error) {
        console.error('[ProxyLogs] Save failed:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save logs'
        }
      }
    }
  )

  // IPC: 加载代理日志
  ipcMain.handle('proxy-load-logs', async () => {
    try {
      const logsPath = getProxyLogsPath()
      const content = await readFile(logsPath, 'utf-8')
      const logs = JSON.parse(content)
      return { success: true, logs }
    } catch {
      // 文件不存在是正常的
      return { success: true, logs: [] }
    }
  })

  // IPC: 重置反代池状态
  ipcMain.handle('proxy-reset-pool', () => {
    try {
      if (proxyServer) {
        proxyServer.getAccountPool().reset()
      }
      return { success: true }
    } catch (error) {
      console.error('[ProxyServer] Reset pool failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset pool'
      }
    }
  })

  // IPC: 手动解除账号封禁标记（用户确认账号已恢复后调用）
  // 1) 清除反代池中的 suspended 状态
  // 2) 同步清除 store.accountData[id].lastError，状态回到 active
  ipcMain.handle('proxy-clear-account-suspended', (_event, accountId: string) => {
    try {
      if (proxyServer) {
        proxyServer.getAccountPool().clearSuspended(accountId)
      }
      // 持久化清除 lastError
      if (store) {
        const accountData = store.get('accountData') as
          | { accounts?: Record<string, Record<string, unknown>> }
          | undefined
        if (accountData?.accounts?.[accountId]) {
          const acc = accountData.accounts[accountId]
          accountData.accounts[accountId] = {
            ...acc,
            status: 'active',
            lastError: undefined,
            lastCheckedAt: Date.now()
          }
          store.set('accountData', accountData)
          lastSavedData = accountData
        }
      }
      console.log(`[ProxyServer] Cleared suspended flag for account ${accountId}`)
      return { success: true }
    } catch (error) {
      console.error('[ProxyServer] Clear suspended failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear suspended'
      }
    }
  })

  // ============ K-Proxy MITM 代理 IPC ============

  // IPC: 初始化 K-Proxy 服务
  ipcMain.handle('kproxy-init', async () => {
    return getKProxyManagementService().initialize()
  })

  // IPC: 启动 K-Proxy
  ipcMain.handle('kproxy-start', async (_event, config?: Partial<KProxyConfig>) => {
    return getKProxyManagementService().start(config)
  })

  // IPC: 停止 K-Proxy
  ipcMain.handle('kproxy-stop', async () => {
    return getKProxyManagementService().stop()
  })

  // IPC: 获取 K-Proxy 状态
  ipcMain.handle('kproxy-get-status', () => {
    return getKProxyManagementService().getStatus()
  })

  // IPC: 更新 K-Proxy 配置
  ipcMain.handle('kproxy-update-config', async (_event, config: Partial<KProxyConfig>) => {
    return getKProxyManagementService().updateConfig(config)
  })

  // IPC: 设置当前设备 ID
  ipcMain.handle('kproxy-set-device-id', (_event, deviceId: string) => {
    return getKProxyManagementService().setDeviceId(deviceId)
  })

  // IPC: 生成新的设备 ID
  ipcMain.handle('kproxy-generate-device-id', () => {
    return getKProxyManagementService().generateDeviceId()
  })

  // IPC: 添加设备 ID 映射
  ipcMain.handle('kproxy-add-device-mapping', (_event, mapping: DeviceIdMapping) => {
    return getKProxyManagementService().addDeviceMapping(mapping)
  })

  // IPC: 获取所有设备 ID 映射
  ipcMain.handle('kproxy-get-device-mappings', () => {
    return getKProxyManagementService().getDeviceMappings()
  })

  // IPC: 切换到账号设备 ID
  ipcMain.handle('kproxy-switch-to-account', (_event, accountId: string) => {
    return getKProxyManagementService().switchToAccount(accountId)
  })

  // IPC: 获取 CA 证书 PEM（用于导出/安装）
  ipcMain.handle('kproxy-get-ca-cert', () => {
    return getKProxyManagementService().getCaCert()
  })

  // IPC: 导出 CA 证书到指定路径
  ipcMain.handle('kproxy-export-ca-cert', async (_event, exportPath?: string) => {
    return getKProxyManagementService().exportCaCert(exportPath)
  })

  // IPC: 重置 K-Proxy 统计
  ipcMain.handle('kproxy-reset-stats', () => {
    return getKProxyManagementService().resetStats()
  })

  // IPC: 检查 CA 证书是否已安装到系统信任存储
  ipcMain.handle('kproxy-check-ca-cert-installed', async () => {
    return getKProxyManagementService().checkCaCertInstalled()
  })

  // IPC: 安装 CA 证书到系统信任存储
  ipcMain.handle('kproxy-install-ca-cert', async () => {
    return getKProxyManagementService().installCaCert()
  })

  // IPC: 卸载 CA 证书从系统信任存储
  ipcMain.handle('kproxy-uninstall-ca-cert', async () => {
    return getKProxyManagementService().uninstallCaCert()
  })

  // ============ MCP 服务器管理 IPC ============

  // IPC: 保存 MCP 服务器配置
  ipcMain.handle(
    'save-mcp-server',
    async (
      _event,
      name: string,
      config: { command: string; args?: string[]; env?: Record<string, string> },
      oldName?: string
    ) => {
      return getKiroSettingsService().saveMcpServer(name, config, oldName)
    }
  )

  // IPC: 删除 MCP 服务器
  ipcMain.handle('delete-mcp-server', async (_event, name: string) => {
    return getKiroSettingsService().deleteMcpServer(name)
  })

  // IPC: 删除 Steering 文件
  ipcMain.handle('delete-kiro-steering-file', async (_event, filename: string) => {
    return getKiroSettingsService().deleteSteeringFile(filename)
  })

  // ============ 机器码管理 IPC ============

  // IPC: 获取操作系统类型
  ipcMain.handle('machine-id:get-os-type', () => {
    return getMachineIdService().getOSType()
  })

  // IPC: 获取当前机器码
  ipcMain.handle('machine-id:get-current', async () => {
    console.log('[MachineId] Getting current machine ID...')
    return await getMachineIdService().getCurrent()
  })

  // IPC: 设置新机器码
  ipcMain.handle('machine-id:set', async (_event, newMachineId: string) => {
    console.log('[MachineId] Setting new machine ID:', newMachineId.substring(0, 8) + '...')
    return await getMachineIdService().set(newMachineId)
  })

  // IPC: 生成随机机器码
  ipcMain.handle('machine-id:generate-random', () => {
    return getMachineIdService().generateRandom()
  })

  // IPC: 检查管理员权限
  ipcMain.handle('machine-id:check-admin', async () => {
    return await getMachineIdService().checkAdmin()
  })

  // IPC: 请求管理员权限重启
  ipcMain.handle('machine-id:request-admin-restart', async () => {
    return await getMachineIdService().requestAdminRestart()
  })

  // IPC: 备份机器码到文件
  ipcMain.handle('machine-id:backup-to-file', async (_event, machineId: string) => {
    const result = await showSaveFileDialog(mainWindow, {
      title: '备份机器码',
      defaultPath: 'machine-id-backup.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) {
      return false
    }

    return await getMachineIdService().backupToFile(machineId, result.filePath)
  })

  // IPC: 从文件恢复机器码
  ipcMain.handle('machine-id:restore-from-file', async () => {
    const result = await showOpenFileDialog(mainWindow, {
      title: '恢复机器码',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })

    if (result.canceled || !result.filePaths[0]) {
      return { success: false, error: '用户取消' }
    }

    return await getMachineIdService().restoreFromFile(result.filePaths[0])
  })

  // 更新协议处理函数以支持 Social Auth 回调
  const originalHandleProtocolUrl = handleProtocolUrl
  // @ts-ignore - 重新定义协议处理
  handleProtocolUrl = (url: string): void => {
    if (!url.startsWith(`${PROTOCOL_PREFIX}://`)) return

    try {
      const urlObj = new URL(url)

      // 处理 Social Auth 回调 (kiro://kiro.kiroAgent/authenticate-success)
      if (url.includes('authenticate-success') || url.includes('auth')) {
        const code = urlObj.searchParams.get('code')
        const state = urlObj.searchParams.get('state')
        const error = urlObj.searchParams.get('error')

        if (error) {
          console.log('[Login] Auth callback error:', error)
          emitAppEvent('social-auth-callback', { error })
          mainWindow?.focus()
          return
        }

        if (code && state) {
          console.log('[Login] Auth callback received, code:', code.substring(0, 20) + '...')
          emitAppEvent('social-auth-callback', { code, state })
          mainWindow?.focus()
        }
        return
      }

      // 调用原始处理函数处理其他协议
      originalHandleProtocolUrl(url)
    } catch (error) {
      console.error('Failed to parse protocol URL:', error)
    }
  }

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else if (mainWindow) {
      // macOS: 点击 Dock 图标时显示主窗口
      if (process.platform === 'darwin' && app.dock) {
        app.dock.show()
      }
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
})

// Windows/Linux: 处理第二个实例和协议 URL
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Windows: 协议 URL 会作为命令行参数传入
    const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL_PREFIX}://`))
    if (url) {
      handleProtocolUrl(url)
    }

    // 聚焦主窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// macOS: 处理协议 URL
app.on('open-url', (_event, url) => {
  handleProtocolUrl(url)
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 应用退出前注销 URI 协议处理器并保存数据
app.on('will-quit', async (event) => {
  // 防止重复处理
  if (isQuitting) return

  // 防止应用立即退出，先保存数据
  if (lastSavedData && store) {
    event.preventDefault()
    isQuitting = true

    // 设置超时，确保 3 秒后强制退出（防止关机阻塞）
    const forceQuitTimer = setTimeout(() => {
      console.log('[Exit] Force quit due to timeout')
      unregisterProtocol()
      app.exit(0)
    }, 3000)

    try {
      console.log('[Exit] Saving data before quit...')
      // 刷新待写入的防抖数据
      flushStoreWrites()
      store.set('accountData', lastSavedData)
      // 退出场景跳过节流，确保备份立即落盘
      await createBackup(lastSavedData)
      await flushBackupNow()
      // 强制落盘代理日志（异步节流中的尾巴数据）
      try {
        const { proxyLogStore } = await import('./proxy/logger')
        await proxyLogStore.flushSaveNow()
      } catch (err) {
        console.error('[Exit] Failed to flush proxy logs:', err)
      }
      console.log('[Exit] Data saved successfully')
    } catch (error) {
      console.error('[Exit] Failed to save data:', error)
    }

    // 关闭 Server 层服务（HTTP API + AuthService）
    try {
      if (accountService) {
        await accountService.shutdown()
        console.log('[Exit] AccountService shut down')
      }
      if (authService) {
        await authService.shutdown()
        console.log('[Exit] AuthService shut down')
      }
      if (proxyService) {
        await proxyService.shutdown()
        console.log('[Exit] ProxyService shut down')
      }
      if (kproxyManagementService) {
        await kproxyManagementService.shutdown()
        console.log('[Exit] KProxyManagementService shut down')
      }
      if (registrationService) {
        await registrationService.shutdown()
        console.log('[Exit] RegistrationService shut down')
      }
      if (localAdminServer) {
        await localAdminServer.close()
        console.log('[Exit] LocalAdmin HTTP server closed')
      }
    } catch (err) {
      console.error('[Exit] Failed to shut down server layer services:', err)
    }

    clearTimeout(forceQuitTimer)
    unregisterProtocol()
    app.exit(0)
  } else {
    // 即使没有 store 数据，也要关闭 Server 层服务
    try {
      if (accountService) await accountService.shutdown()
      if (authService) await authService.shutdown()
      if (proxyService) await proxyService.shutdown()
      if (kproxyManagementService) await kproxyManagementService.shutdown()
      if (registrationService) await registrationService.shutdown()
      if (localAdminServer) await localAdminServer.close()
    } catch (err) {
      console.error('[Exit] Failed to shut down server layer services:', err)
    }
    unregisterProtocol()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
