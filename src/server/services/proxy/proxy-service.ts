import { randomBytes, randomUUID } from 'crypto'
import {
  configureProxyClients,
  ProxyServer,
  setEnableTokenBufferReserve,
  setLogStreamEvents,
  setPayloadSizeLimitKB,
  setTokenBufferReserve,
  type ApiKey,
  type ProxyAccount,
  type ProxyClientModel,
  type ProxyClientTarget,
  type ProxyConfig,
  type ProxyStats
} from '../../../core/proxy'
import { proxyLogStore, type LogEntry } from '../../../core/proxy/logger'

export interface ProxyKeyValueStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export interface ProxyServiceDeps {
  dataDir: string
  createServer: () => ProxyServer
  getServer?: () => ProxyServer | null
  store?: ProxyKeyValueStore
  emitEvent: (type: string, payload: unknown) => void
  getUsageApiType?: () => 'rest' | 'cbor'
  setUsageApiType?: (type: 'rest' | 'cbor') => void
  getUseKProxyForApi?: () => boolean
  setUseKProxyForApi?: (enabled: boolean) => void
  clearAccountSuspended?: (accountId: string) => void
}

export interface ProxyStatusResult {
  running: boolean
  config: ProxyConfig | null
  stats: ReturnType<typeof serializeProxyStats> | null
  sessionStats: ReturnType<ProxyServer['getSessionStats']> | null
}

interface ApiKeyCreateInput {
  name: string
  key?: string
  format?: 'sk' | 'simple' | 'token'
  creditsLimit?: number
}

interface ConfigureClientsInput {
  clients: ProxyClientTarget[]
  modelId: string
  modelName?: string
  models?: ProxyClientModel[]
}

function serializeMap<T>(map: Map<string, T> | Record<string, T> | undefined): Record<string, T> {
  if (!map) return {}
  if (map instanceof Map) return Object.fromEntries(map.entries())
  return map
}

function serializeProxyStats(stats: ProxyStats): Omit<
  ProxyStats,
  'accountStats' | 'endpointStats' | 'modelStats'
> & {
  accountStats: Record<string, ProxyStats['accountStats'] extends Map<string, infer V> ? V : never>
  endpointStats: Record<
    string,
    ProxyStats['endpointStats'] extends Map<string, infer V> ? V : never
  >
  modelStats: Record<string, ProxyStats['modelStats'] extends Map<string, infer V> ? V : never>
} {
  return {
    ...stats,
    accountStats: serializeMap(stats.accountStats),
    endpointStats: serializeMap(stats.endpointStats),
    modelStats: serializeMap(stats.modelStats)
  }
}

function generateApiKey(format: ApiKeyCreateInput['format']): string {
  const randomHex = randomBytes(24).toString('hex')
  switch (format || 'sk') {
    case 'simple':
      return `PROXY_KEY_${randomHex.toUpperCase().substring(0, 32)}`
    case 'token':
      return `KEY:${randomHex.substring(0, 16)}:TOKEN:${randomHex.substring(16, 32)}`
    case 'sk':
    default:
      return `sk-${randomHex}`
  }
}

export class ProxyService {
  private deps: ProxyServiceDeps
  private server: ProxyServer | null = null

  constructor(deps: ProxyServiceDeps) {
    this.deps = deps
    proxyLogStore.initialize(deps.dataDir)
  }

  private get currentServer(): ProxyServer | null {
    return this.deps.getServer?.() || this.server
  }

  private ensureServer(): ProxyServer {
    const existing = this.currentServer
    if (existing) return existing
    this.server = this.deps.createServer()
    return this.server
  }

  private getSavedConfig(): ProxyConfig | null {
    return (this.deps.store?.get('proxyConfig') as ProxyConfig | undefined) || null
  }

  private saveConfig(config: ProxyConfig): void {
    this.deps.store?.set('proxyConfig', config)
  }

  private applyConfigSideEffects(config: Partial<ProxyConfig>): void {
    if (config.logStreamEvents !== undefined) {
      setLogStreamEvents(config.logStreamEvents)
    }
    if (config.payloadSizeLimitKB !== undefined) {
      setPayloadSizeLimitKB(config.payloadSizeLimitKB)
    }
    if (config.enableTokenBufferReserve !== undefined) {
      setEnableTokenBufferReserve(config.enableTokenBufferReserve)
    }
    if (config.tokenBufferReserve !== undefined) {
      setTokenBufferReserve(config.tokenBufferReserve)
    }
  }

  async start(
    config?: Partial<ProxyConfig>
  ): Promise<{ success: boolean; port?: number; error?: string }> {
    try {
      const server = this.ensureServer()
      if (config) {
        server.updateConfig(config)
        this.applyConfigSideEffects(config)
        this.saveConfig(server.getConfig())
      }
      await server.start()
      return { success: true, port: server.getConfig().port }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start proxy server'
      }
    }
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.currentServer?.stop()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop proxy server'
      }
    }
  }

  getStatus(): ProxyStatusResult {
    const server = this.currentServer
    if (!server) {
      return {
        running: false,
        config: this.getSavedConfig(),
        stats: null,
        sessionStats: null
      }
    }

    return {
      running: server.isRunning(),
      config: server.getConfig(),
      stats: serializeProxyStats(server.getStats()),
      sessionStats: server.getSessionStats()
    }
  }

  updateConfig(config: Partial<ProxyConfig>): {
    success: boolean
    config?: ProxyConfig
    error?: string
  } {
    try {
      const server = this.ensureServer()
      server.updateConfig(config)
      this.applyConfigSideEffects(config)
      const newConfig = server.getConfig()
      this.saveConfig(newConfig)
      return { success: true, config: newConfig }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update config'
      }
    }
  }

  resetCredits(): { success: boolean } {
    this.currentServer?.resetTotalCredits()
    this.deps.store?.set('proxyTotalCredits', 0)
    return { success: true }
  }

  resetTokens(): { success: boolean } {
    this.currentServer?.resetTotalTokens()
    this.deps.store?.set('proxyInputTokens', 0)
    this.deps.store?.set('proxyOutputTokens', 0)
    return { success: true }
  }

  resetRequestStats(): { success: boolean } {
    this.currentServer?.resetRequestStats()
    this.deps.store?.set('proxyTotalRequests', 0)
    this.deps.store?.set('proxySuccessRequests', 0)
    this.deps.store?.set('proxyFailedRequests', 0)
    return { success: true }
  }

  getLogs(count?: number): LogEntry[] {
    return count ? proxyLogStore.getLast(count) : proxyLogStore.getAll()
  }

  clearLogs(): { success: boolean } {
    proxyLogStore.clear()
    return { success: true }
  }

  getLogsCount(): { count: number } {
    return { count: proxyLogStore.count() }
  }

  getUsageApiType(): 'rest' | 'cbor' {
    return this.deps.getUsageApiType?.() || 'rest'
  }

  setUsageApiType(type: 'rest' | 'cbor'): { success: boolean; type: 'rest' | 'cbor' } {
    this.deps.setUsageApiType?.(type)
    this.deps.store?.set('usageApiType', type)
    return { success: true, type }
  }

  getUseKProxyForApi(): boolean {
    return this.deps.getUseKProxyForApi?.() || false
  }

  setUseKProxyForApi(enabled: boolean): { success: boolean; enabled: boolean } {
    this.deps.setUseKProxyForApi?.(enabled)
    this.deps.store?.set('useKProxyForApi', enabled)
    return { success: true, enabled }
  }

  getSelfSignedCertInfo(): { success: boolean; error?: string } & Record<string, unknown> {
    try {
      const server = this.currentServer
      if (!server) return { success: false, error: 'Proxy server not initialized' }
      const info = server.getSelfSignedCertInfo()
      if (!info) return { success: false, error: 'Failed to get self-signed cert info' }
      return { success: true, ...info }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get cert info'
      }
    }
  }

  regenerateSelfSignedCert(): { success: boolean; error?: string } & Record<string, unknown> {
    try {
      const server = this.currentServer
      if (!server) return { success: false, error: 'Proxy server not initialized' }
      const info = server.regenerateSelfSignedCert()
      if (!info) return { success: false, error: 'Failed to regenerate self-signed cert' }
      return { success: true, ...info }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to regenerate cert'
      }
    }
  }

  needsRestart(): { needsRestart: boolean } {
    return { needsRestart: this.currentServer?.needsRestart() || false }
  }

  async restart(): Promise<{ success: boolean; error?: string }> {
    try {
      const server = this.currentServer
      if (!server) return { success: false, error: 'Proxy server not initialized' }
      await server.restartServer()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to restart' }
    }
  }

  getAuditLog(): {
    entries: ReadonlyArray<{ ts: number; type: string; data: Record<string, unknown> }>
  } {
    return { entries: this.currentServer?.getAuditLog().slice(-200) || [] }
  }

  getApiKeys(): { success: boolean; apiKeys: ApiKey[]; error?: string } {
    try {
      const config = this.ensureServer().getConfig()
      return { success: true, apiKeys: config.apiKeys || [] }
    } catch (error) {
      return {
        success: false,
        apiKeys: [],
        error: error instanceof Error ? error.message : 'Failed to get API keys'
      }
    }
  }

  addApiKey(input: ApiKeyCreateInput): { success: boolean; apiKey?: ApiKey; error?: string } {
    try {
      const server = this.ensureServer()
      const config = server.getConfig()
      const apiKeys = [...(config.apiKeys || [])]
      const format = input.format || 'sk'
      const newApiKey: ApiKey = {
        id: randomUUID(),
        name: input.name || `API Key ${apiKeys.length + 1}`,
        key: input.key || generateApiKey(format),
        format,
        enabled: true,
        createdAt: Date.now(),
        creditsLimit: input.creditsLimit,
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
      this.saveConfig(server.getConfig())
      return { success: true, apiKey: newApiKey }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add API key'
      }
    }
  }

  updateApiKey(
    id: string,
    updates: Partial<ApiKey>
  ): { success: boolean; apiKey?: ApiKey; error?: string } {
    try {
      const server = this.ensureServer()
      const apiKeys = [...(server.getConfig().apiKeys || [])]
      const index = apiKeys.findIndex((key) => key.id === id)
      if (index === -1) return { success: false, error: 'API key not found' }

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
      this.saveConfig(server.getConfig())
      return { success: true, apiKey: apiKeys[index] }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update API key'
      }
    }
  }

  deleteApiKey(id: string): { success: boolean; error?: string } {
    try {
      const server = this.ensureServer()
      const apiKeys = [...(server.getConfig().apiKeys || [])]
      const index = apiKeys.findIndex((key) => key.id === id)
      if (index === -1) return { success: false, error: 'API key not found' }
      apiKeys.splice(index, 1)
      server.updateConfig({ apiKeys })
      this.saveConfig(server.getConfig())
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete API key'
      }
    }
  }

  resetApiKeyUsage(id: string): { success: boolean; error?: string } {
    try {
      const server = this.ensureServer()
      const apiKeys = [...(server.getConfig().apiKeys || [])]
      const apiKey = apiKeys.find((key) => key.id === id)
      if (!apiKey) return { success: false, error: 'API key not found' }
      apiKey.usage = {
        totalRequests: 0,
        totalCredits: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        daily: {}
      }
      server.updateConfig({ apiKeys })
      this.saveConfig(server.getConfig())
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset usage'
      }
    }
  }

  addAccount(account: ProxyAccount): { success: boolean; accountCount?: number; error?: string } {
    try {
      const pool = this.ensureServer().getAccountPool()
      pool.addAccount(account)
      return { success: true, accountCount: pool.size }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add account'
      }
    }
  }

  removeAccount(accountId: string): { success: boolean; accountCount?: number; error?: string } {
    try {
      const pool = this.ensureServer().getAccountPool()
      pool.removeAccount(accountId)
      return { success: true, accountCount: pool.size }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove account'
      }
    }
  }

  syncAccounts(accounts: ProxyAccount[]): {
    success: boolean
    accountCount?: number
    error?: string
  } {
    try {
      const pool = this.ensureServer().getAccountPool()
      pool.clear()
      for (const account of accounts) {
        pool.addAccount(account)
      }
      return { success: true, accountCount: pool.size }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync accounts'
      }
    }
  }

  getAccounts(): { accounts: ProxyAccount[]; availableCount: number } {
    const server = this.currentServer
    if (!server) return { accounts: [], availableCount: 0 }
    const pool = server.getAccountPool()
    return {
      accounts: pool.getAllAccounts(),
      availableCount: pool.availableCount
    }
  }

  refreshModels(): { success: boolean; error?: string } {
    const server = this.currentServer
    if (!server) return { success: false, error: 'Proxy server not initialized' }
    server.clearModelCache()
    return { success: true }
  }

  async getModels(): Promise<{
    success: boolean
    models: unknown[]
    fromCache?: boolean
    error?: string
  }> {
    const server = this.currentServer
    if (!server) return { success: false, error: 'Proxy server not initialized', models: [] }
    try {
      const result = await server.getAvailableModels()
      return { success: true, ...result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get models',
        models: []
      }
    }
  }

  async configureClients(input: ConfigureClientsInput): Promise<Record<string, unknown>> {
    try {
      const config = this.ensureServer().getConfig()
      const apiKey = (config.apiKey || config.apiKeys?.find((key) => key.enabled)?.key || '').trim()
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

  resetPool(): { success: boolean; error?: string } {
    try {
      this.currentServer?.getAccountPool().reset()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset pool'
      }
    }
  }

  clearAccountSuspended(accountId: string): { success: boolean; error?: string } {
    try {
      this.currentServer?.getAccountPool().clearSuspended(accountId)
      this.deps.clearAccountSuspended?.(accountId)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear suspended'
      }
    }
  }

  setAccountProxyBinding(accountId: string, proxyUrl: string | undefined): { success: boolean } {
    try {
      if (!accountId) return { success: false }
      const account = this.currentServer?.getAccountPool().getAccount(accountId)
      if (account) {
        account.proxyUrl = proxyUrl || undefined
      }
      return { success: true }
    } catch (error) {
      console.error('[ProxyService] Failed to set account proxy binding:', error)
      return { success: false }
    }
  }

  async shutdown(): Promise<void> {
    await this.currentServer?.stop()
    await proxyLogStore.flushSaveNow()
  }
}
