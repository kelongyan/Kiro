import { LocalAdminClientError, deleteJson, getJson, postJson, putJson } from './local-admin-client'

type ApiKeyFormat = 'sk' | 'simple' | 'token'
type ClientTarget = 'claudeCode' | 'opencode' | 'codex' | 'gemini' | 'hermes' | 'openclaw'

export interface LegacyResult {
  success: boolean
  error?: string
}

export interface ProxyLogEntry {
  timestamp: string
  level: string
  category: string
  message: string
  data?: unknown
}

export interface RecentProxyLogEntry {
  time: string
  requestId?: string
  path: string
  model?: string
  apiKeyId?: string
  accountId?: string
  status: number
  tokens?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  credits?: number
  responseTime?: number
  error?: string
  [key: string]: unknown
}

export interface ProxyDashboardRequestLog {
  requestId?: string
  timestamp: number
  path: string
  model: string
  apiKeyId?: string
  accountId: string
  status?: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  credits?: number
  responseTime: number
  success: boolean
  error?: string
}

export interface ProxyAccountInput {
  id: string
  email?: string
  accessToken: string
  refreshToken?: string
  profileArn?: string
  expiresAt?: number
  clientId?: string
  clientSecret?: string
  region?: string
  authMethod?: string
  provider?: string
  machineId?: string
  proxyUrl?: string
}

export interface ProxyModelInfo {
  id: string
  name: string
  description: string
  inputTypes?: string[]
  maxInputTokens?: number | null
  maxOutputTokens?: number | null
  rateMultiplier?: number
  rateUnit?: string
  supportsThinking?: boolean
  thinkingEfforts?: string[]
  supportsPromptCaching?: boolean
  modelProvider?: string
}

export interface ProxyApiKey {
  id: string
  name: string
  key: string
  format?: ApiKeyFormat
  enabled: boolean
  createdAt: number
  lastUsedAt?: number
  creditsLimit?: number
  modelAllowlist?: string[]
  accountAllowlist?: string[]
  usage: {
    totalRequests: number
    totalCredits: number
    totalInputTokens: number
    totalOutputTokens: number
    daily: Record<
      string,
      { requests: number; credits: number; inputTokens: number; outputTokens: number }
    >
    byModel?: Record<
      string,
      { requests: number; credits: number; inputTokens: number; outputTokens: number }
    >
  }
  usageHistory?: Array<{
    timestamp: number
    model: string
    inputTokens: number
    outputTokens: number
    credits: number
    path: string
  }>
}

export interface ProxyDashboard {
  running: boolean
  origin: string
  host: string
  port: number
  strategy: string
  requests: {
    total: number
    success: number
    failed: number
    successRate: number
  }
  tokens: {
    total: number
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    reasoning: number
  }
  credits: {
    total: number
  }
  accounts: {
    total: number
    available: number
    unavailable: number
    suspended: number
    exhausted: number
    cooldown: number
  }
  apiKeys: {
    total: number
    enabled: number
    disabled: number
    limited: number
    exhausted: number
    restricted: number
  }
  recentRequests: ProxyDashboardRequestLog[]
}

type HttpResult<T> = T & { ok?: boolean }

const RECENT_PROXY_LOGS_STORAGE_KEY = 'kiro.proxy.recentRequestLogs'
const MAX_RECENT_PROXY_LOGS = 100

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

function toFailure<T extends LegacyResult>(error: unknown, fallback: string): T {
  if (error instanceof LocalAdminClientError && isObject(error.body)) {
    if (typeof error.body.success === 'boolean') {
      return error.body as T
    }
    return {
      success: false,
      error: typeof error.body.error === 'string' ? error.body.error : fallback
    } as T
  }
  return {
    success: false,
    error: error instanceof Error ? error.message : fallback
  } as T
}

async function getLegacyResult<T extends LegacyResult>(path: string, fallback: string): Promise<T> {
  try {
    return await getJson<HttpResult<T>>(path)
  } catch (error) {
    return toFailure<T>(error, fallback)
  }
}

async function postLegacyResult<T extends LegacyResult>(
  path: string,
  body?: unknown,
  fallback = '请求失败'
): Promise<T> {
  try {
    return await postJson<HttpResult<T>>(path, body)
  } catch (error) {
    return toFailure<T>(error, fallback)
  }
}

async function putLegacyResult<T extends LegacyResult>(
  path: string,
  body?: unknown,
  fallback = '请求失败'
): Promise<T> {
  try {
    return await putJson<HttpResult<T>>(path, body)
  } catch (error) {
    return toFailure<T>(error, fallback)
  }
}

async function deleteLegacyResult<T extends LegacyResult>(
  path: string,
  fallback = '请求失败'
): Promise<T> {
  try {
    return await deleteJson<HttpResult<T>>(path)
  } catch (error) {
    return toFailure<T>(error, fallback)
  }
}

export function proxyStart(config?: Record<string, unknown>): Promise<{
  success: boolean
  port?: number
  error?: string
}> {
  return postLegacyResult('/api/proxy/start', { config }, '启动反代失败')
}

export function proxyStop(): Promise<LegacyResult> {
  return postLegacyResult('/api/proxy/stop', undefined, '停止反代失败')
}

export function proxyRestart(): Promise<LegacyResult> {
  return postLegacyResult('/api/proxy/restart', undefined, '重启反代失败')
}

export function proxyGetStatus(): Promise<{
  running: boolean
  config: unknown
  stats: unknown
  sessionStats?: unknown
}> {
  return getJson('/api/proxy/status')
}

export async function proxyGetDashboard(): Promise<ProxyDashboard> {
  const result = await getJson<{ ok?: boolean; dashboard: ProxyDashboard }>('/api/proxy/dashboard')
  return result.dashboard
}

export function proxyUpdateConfig(
  config: Record<string, unknown>
): Promise<{ success: boolean; config?: unknown; error?: string }> {
  return postLegacyResult('/api/proxy/config', config, '更新反代配置失败')
}

export function proxyResetCredits(): Promise<{ success: boolean }> {
  return postLegacyResult('/api/proxy/reset-credits', undefined, '重置 credits 失败')
}

export function proxyResetTokens(): Promise<{ success: boolean }> {
  return postLegacyResult('/api/proxy/reset-tokens', undefined, '重置 tokens 失败')
}

export function proxyResetRequestStats(): Promise<{ success: boolean }> {
  return postLegacyResult('/api/proxy/reset-request-stats', undefined, '重置统计失败')
}

export async function proxyGetLogs(count?: number): Promise<ProxyLogEntry[]> {
  const query = typeof count === 'number' ? `?count=${encodeURIComponent(String(count))}` : ''
  const result = await getJson<{ ok?: boolean; logs: ProxyLogEntry[] }>(`/api/proxy/logs${query}`)
  return Array.isArray(result.logs) ? result.logs : []
}

export function proxyClearLogs(): Promise<{ success: boolean }> {
  return deleteLegacyResult('/api/proxy/logs', '清空日志失败')
}

export async function proxyGetLogsCount(): Promise<number> {
  const result = await getJson<{ ok?: boolean; count: number }>('/api/proxy/logs/count')
  return typeof result.count === 'number' ? result.count : 0
}

export function proxySelfSignedCertInfo(): Promise<{
  success: boolean
  cert?: string
  key?: string
  fingerprint?: string
  notBefore?: number
  notAfter?: number
  subject?: string
  altNames?: string[]
  error?: string
}> {
  return getLegacyResult('/api/proxy/self-signed-cert', '读取自签证书失败')
}

export function proxySelfSignedCertRegenerate(): Promise<{
  success: boolean
  cert?: string
  key?: string
  fingerprint?: string
  notBefore?: number
  notAfter?: number
  subject?: string
  altNames?: string[]
  error?: string
}> {
  return postLegacyResult(
    '/api/proxy/self-signed-cert/regenerate',
    undefined,
    '重新生成自签证书失败'
  )
}

export function proxyNeedsRestart(): Promise<{ needsRestart: boolean }> {
  return getJson('/api/proxy/needs-restart')
}

export function proxyAuditLog(): Promise<{
  entries: Array<{ ts: number; type: string; data: Record<string, unknown> }>
}> {
  return getJson('/api/proxy/audit-log')
}

export function proxyAddAccount(
  account: ProxyAccountInput
): Promise<{ success: boolean; accountCount?: number; error?: string }> {
  return postLegacyResult('/api/proxy/accounts', account, '添加反代账号失败')
}

export function proxyRemoveAccount(
  accountId: string
): Promise<{ success: boolean; accountCount?: number; error?: string }> {
  return deleteLegacyResult(
    `/api/proxy/accounts/${encodePathSegment(accountId)}`,
    '移除反代账号失败'
  )
}

export function proxySyncAccounts(
  accounts: ProxyAccountInput[]
): Promise<{ success: boolean; accountCount?: number; error?: string }> {
  return postLegacyResult('/api/proxy/accounts/sync', { accounts }, '同步反代账号失败')
}

export function proxyGetAccounts(): Promise<{ accounts: unknown[]; availableCount: number }> {
  return getJson('/api/proxy/accounts')
}

export function proxyResetPool(): Promise<LegacyResult> {
  return postLegacyResult('/api/proxy/accounts/reset-pool', undefined, '重置反代池失败')
}

export function proxyClearAccountSuspended(accountId: string): Promise<LegacyResult> {
  return postLegacyResult(
    `/api/proxy/accounts/${encodePathSegment(accountId)}/clear-suspended`,
    undefined,
    '解除封禁标记失败'
  )
}

export function proxyRefreshModels(): Promise<LegacyResult> {
  return postLegacyResult('/api/proxy/models/refresh', undefined, '刷新模型失败')
}

export function proxyGetModels(): Promise<{
  success: boolean
  error?: string
  models: ProxyModelInfo[]
  fromCache?: boolean
}> {
  return getLegacyResult('/api/proxy/models', '获取模型失败')
}

export function proxyConfigureClients(input: {
  clients: ClientTarget[]
  modelId: string
  modelName?: string
  models?: Array<{
    id: string
    name?: string
    inputTypes?: string[]
    maxInputTokens?: number | null
    maxOutputTokens?: number | null
  }>
}): Promise<{
  success: boolean
  error?: string
  proxyOrigin: string
  openaiBaseUrl: string
  results: Array<{
    client: ClientTarget
    success: boolean
    paths: string[]
    backupPaths: string[]
    error?: string
  }>
}> {
  return postLegacyResult('/api/proxy/configure-clients', input, '配置客户端失败')
}

export function proxyGetApiKeys(): Promise<{
  success: boolean
  apiKeys: ProxyApiKey[]
  error?: string
}> {
  return getLegacyResult('/api/proxy/api-keys', '读取 API Key 失败')
}

export function proxyAddApiKey(apiKey: {
  name: string
  key?: string
  format?: ApiKeyFormat
  creditsLimit?: number
  modelAllowlist?: string[]
  accountAllowlist?: string[]
}): Promise<{ success: boolean; apiKey?: ProxyApiKey; error?: string }> {
  return postLegacyResult('/api/proxy/api-keys', apiKey, '新增 API Key 失败')
}

export function proxyUpdateApiKey(
  id: string,
  updates: {
    name?: string
    key?: string
    enabled?: boolean
    creditsLimit?: number | null
    modelAllowlist?: string[]
    accountAllowlist?: string[]
  }
): Promise<{ success: boolean; apiKey?: ProxyApiKey; error?: string }> {
  return putLegacyResult(
    `/api/proxy/api-keys/${encodePathSegment(id)}`,
    updates,
    '更新 API Key 失败'
  )
}

export function proxyDeleteApiKey(id: string): Promise<LegacyResult> {
  return deleteLegacyResult(`/api/proxy/api-keys/${encodePathSegment(id)}`, '删除 API Key 失败')
}

export function proxyResetApiKeyUsage(id: string): Promise<LegacyResult> {
  return postLegacyResult(
    `/api/proxy/api-keys/${encodePathSegment(id)}/reset-usage`,
    undefined,
    '重置 API Key 用量失败'
  )
}

export async function getUsageApiType(): Promise<'rest' | 'cbor'> {
  const result = await getJson<{ ok?: boolean; type: 'rest' | 'cbor' }>('/api/proxy/usage-api-type')
  return result.type === 'cbor' ? 'cbor' : 'rest'
}

export function setUsageApiType(
  type: 'rest' | 'cbor'
): Promise<{ success: boolean; type: 'rest' | 'cbor' }> {
  return postLegacyResult('/api/proxy/usage-api-type', { type }, '保存 Usage API 类型失败')
}

export async function getUseKProxyForApi(): Promise<boolean> {
  const result = await getJson<{ ok?: boolean; enabled: boolean }>('/api/proxy/use-kproxy-for-api')
  return result.enabled === true
}

export function setUseKProxyForApi(
  enabled: boolean
): Promise<{ success: boolean; enabled: boolean }> {
  return postLegacyResult('/api/proxy/use-kproxy-for-api', { enabled }, '保存 K-Proxy 设置失败')
}

export async function proxySaveLogs(
  logs: RecentProxyLogEntry[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const storage = getLocalStorage()
    if (!storage) return { success: true }
    storage.setItem(
      RECENT_PROXY_LOGS_STORAGE_KEY,
      JSON.stringify(logs.slice(0, MAX_RECENT_PROXY_LOGS))
    )
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save proxy logs'
    }
  }
}

export async function proxyLoadLogs(): Promise<{
  success: boolean
  logs: RecentProxyLogEntry[]
  error?: string
}> {
  try {
    const raw = getLocalStorage()?.getItem(RECENT_PROXY_LOGS_STORAGE_KEY)
    if (!raw) return { success: true, logs: [] }
    const parsed = JSON.parse(raw) as unknown
    return { success: true, logs: Array.isArray(parsed) ? parsed : [] }
  } catch (error) {
    return {
      success: false,
      logs: [],
      error: error instanceof Error ? error.message : 'Failed to load proxy logs'
    }
  }
}
