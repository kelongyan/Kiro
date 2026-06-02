import type { AccountData } from '../../storage/account-store'
import type { WebhookEntry, WebhookEvent, WebhookService } from '../webhooks/webhook-service'

export interface ConfigSyncAccountStore {
  loadAccounts(): AccountData | null
  saveAccounts(data: AccountData): void
}

export interface ConfigSyncKeyValueStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export interface ConfigSyncServiceDeps {
  accountStore?: ConfigSyncAccountStore
  configStore?: ConfigSyncKeyValueStore
  webhookService?: WebhookService
}

export interface ConfigSyncExportOptions {
  proxyPool?: boolean
  webhooks?: boolean
  registerConfig?: boolean
  registerTemplates?: boolean
  registerSettings?: boolean
  appSettings?: boolean
  includeProxyCredentials?: boolean
}

export interface ConfigSyncImportOptions {
  proxyPool?: boolean
  webhooks?: boolean
  registerConfig?: boolean
  registerTemplates?: boolean
  registerSettings?: boolean
  appSettings?: boolean
}

export interface PortableConfig {
  version: 1
  exportedAt: string
  app: 'kiro-account-manager'
  proxyPool?: Array<Record<string, unknown>>
  proxyPoolConfig?: Record<string, unknown>
  webhooks?: Array<Record<string, unknown>>
  registerConfig?: Record<string, unknown>
  registerTemplates?: Array<Record<string, unknown>>
  registerLocalStorage?: Record<string, string>
  appSettings?: PortableAppSettings
}

export interface PortableAppSettings {
  theme?: string
  darkMode?: boolean
  language?: string
  autoRefreshEnabled?: boolean
  autoRefreshInterval?: number
  autoRefreshConcurrency?: number
  statusCheckInterval?: number
  privacyMode?: boolean
  usagePrecision?: boolean
  autoSwitchEnabled?: boolean
  autoSwitchThreshold?: number
  autoSwitchInterval?: number
  switchTarget?: string
}

export interface ConfigSyncExportResult {
  success: boolean
  config: PortableConfig
  counts: Record<string, number>
}

export interface ConfigSyncImportResult {
  success: boolean
  counts: Record<string, number>
  error?: string
}

const APP_ID = 'kiro-account-manager'
const REGISTER_CONFIG_KEY = 'registerConfig'
const REGISTER_TEMPLATES_KEY = 'registerTemplates'
const REGISTER_LOCAL_STORAGE_KEY = 'registerLocalStorage'
const DEFAULT_WEBHOOK_EVENTS: WebhookEvent[] = [
  'batch-completed',
  'risk-warning',
  'account-banned'
]
const WEBHOOK_EVENTS = new Set<WebhookEvent>([
  'batch-completed',
  'batch-error',
  'risk-warning',
  'account-banned',
  'register-success',
  'register-failed',
  'token-expired'
])

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cloneObject(value: unknown): Record<string, unknown> {
  return isObject(value) ? { ...value } : {}
}

function isWebhookEvent(value: unknown): value is WebhookEvent {
  return typeof value === 'string' && WEBHOOK_EVENTS.has(value as WebhookEvent)
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function createDefaultAccountData(): AccountData {
  return {
    accounts: {},
    groups: {},
    tags: {},
    activeAccountId: null,
    autoRefreshEnabled: true,
    autoRefreshInterval: 30,
    autoRefreshConcurrency: 50,
    autoRefreshSyncInfo: true,
    statusCheckInterval: 30,
    privacyMode: false,
    usagePrecision: false,
    proxyEnabled: false,
    proxyUrl: '',
    autoSwitchEnabled: false,
    autoSwitchThreshold: 10,
    autoSwitchInterval: 5,
    switchTarget: 'ide',
    theme: 'default',
    darkMode: false,
    language: 'auto',
    machineIdConfig: {},
    accountMachineIds: {},
    machineIdHistory: [],
    proxyPool: {},
    proxyPoolConfig: {},
    proxyPoolCursor: 0,
    accountProxyBindings: {}
  }
}

function serializeProxyPool(
  proxyPool: Record<string, unknown> | undefined,
  includeCredentials: boolean
): Array<Record<string, unknown>> {
  if (!proxyPool) return []
  return Object.entries(proxyPool).map(([id, value]) => {
    const entry: Record<string, unknown> = { id, ...cloneObject(value) }
    if (!includeCredentials) {
      delete entry.password
      if (typeof entry.url === 'string') {
        entry.url = entry.url.replace(/:([^:@/]+)@/, ':***@')
      }
    }
    return entry
  })
}

function readAppSettings(data: AccountData | null): PortableAppSettings | undefined {
  if (!data) return undefined
  return {
    theme: readString(data.theme, 'default'),
    darkMode: readBoolean(data.darkMode, false),
    language: readString(data.language, 'auto'),
    autoRefreshEnabled: readBoolean(data.autoRefreshEnabled, true),
    autoRefreshInterval: readNumber(data.autoRefreshInterval, 30),
    autoRefreshConcurrency: readNumber(data.autoRefreshConcurrency, 50),
    statusCheckInterval: readNumber(data.statusCheckInterval, 30),
    privacyMode: readBoolean(data.privacyMode, false),
    usagePrecision: readBoolean(data.usagePrecision, false),
    autoSwitchEnabled: readBoolean(data.autoSwitchEnabled, false),
    autoSwitchThreshold: readNumber(data.autoSwitchThreshold, 10),
    autoSwitchInterval: readNumber(data.autoSwitchInterval, 5),
    switchTarget: readString(data.switchTarget, 'ide')
  }
}

function applyAppSettings(data: AccountData, settings: PortableAppSettings): void {
  if (typeof settings.theme === 'string') data.theme = settings.theme
  if (typeof settings.darkMode === 'boolean') data.darkMode = settings.darkMode
  if (typeof settings.language === 'string') data.language = settings.language
  if (typeof settings.autoRefreshEnabled === 'boolean') {
    data.autoRefreshEnabled = settings.autoRefreshEnabled
  }
  if (typeof settings.autoRefreshInterval === 'number') {
    data.autoRefreshInterval = settings.autoRefreshInterval
  }
  if (typeof settings.autoRefreshConcurrency === 'number') {
    data.autoRefreshConcurrency = settings.autoRefreshConcurrency
  }
  if (typeof settings.statusCheckInterval === 'number') {
    data.statusCheckInterval = settings.statusCheckInterval
  }
  if (typeof settings.privacyMode === 'boolean') data.privacyMode = settings.privacyMode
  if (typeof settings.usagePrecision === 'boolean') data.usagePrecision = settings.usagePrecision
  if (typeof settings.autoSwitchEnabled === 'boolean') {
    data.autoSwitchEnabled = settings.autoSwitchEnabled
  }
  if (typeof settings.autoSwitchThreshold === 'number') {
    data.autoSwitchThreshold = settings.autoSwitchThreshold
  }
  if (typeof settings.autoSwitchInterval === 'number') {
    data.autoSwitchInterval = settings.autoSwitchInterval
  }
  if (typeof settings.switchTarget === 'string') data.switchTarget = settings.switchTarget
}

function normalizeProxyEntry(
  entry: Record<string, unknown>,
  fallbackId: string
): { id: string; value: Record<string, unknown> } | null {
  const url = typeof entry.url === 'string' ? entry.url : undefined
  if (url && url.includes('***')) return null

  const id = typeof entry.id === 'string' && entry.id ? entry.id : fallbackId
  const { id: _ignoredId, ...value } = entry
  void _ignoredId
  return { id, value }
}

function normalizeWebhookInput(value: Record<string, unknown>): Omit<WebhookEntry, 'id' | 'createdAt'> | null {
  const kind = typeof value.kind === 'string' ? value.kind : 'custom'
  const url = typeof value.url === 'string' ? value.url : ''
  if (!url) return null

  const events = Array.isArray(value.events) ? value.events.filter(isWebhookEvent) : DEFAULT_WEBHOOK_EVENTS

  return {
    kind: kind as WebhookEntry['kind'],
    url,
    label: typeof value.label === 'string' ? value.label : undefined,
    enabled: value.enabled !== false,
    telegramChatId: typeof value.telegramChatId === 'string' ? value.telegramChatId : undefined,
    customTemplate: typeof value.customTemplate === 'string' ? value.customTemplate : undefined,
    events
  }
}

export class ConfigSyncService {
  private deps: ConfigSyncServiceDeps

  constructor(deps: ConfigSyncServiceDeps = {}) {
    this.deps = deps
  }

  health(): { success: boolean } {
    return { success: true }
  }

  exportConfig(options: ConfigSyncExportOptions = {}): ConfigSyncExportResult {
    const accountData = this.deps.accountStore?.loadAccounts() || null
    const config: PortableConfig = {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: APP_ID
    }
    const counts: Record<string, number> = {}

    if (options.proxyPool !== false && accountData?.proxyPool) {
      const proxyPool = serializeProxyPool(
        accountData.proxyPool,
        options.includeProxyCredentials === true
      )
      if (proxyPool.length > 0) {
        config.proxyPool = proxyPool
        counts.proxyPool = proxyPool.length
      }
      if (isObject(accountData.proxyPoolConfig)) {
        config.proxyPoolConfig = { ...accountData.proxyPoolConfig }
      }
    }

    if (options.webhooks !== false && this.deps.webhookService) {
      const result = this.deps.webhookService.list()
      if (result.webhooks.length > 0) {
        config.webhooks = result.webhooks.map((webhook) => ({ ...webhook }))
        counts.webhooks = result.webhooks.length
      }
    }

    if (options.registerConfig !== false) {
      const registerConfig = this.deps.configStore?.get(REGISTER_CONFIG_KEY)
      if (isObject(registerConfig)) {
        config.registerConfig = { ...registerConfig }
        counts.registerConfig = 1
      }
    }

    if (options.registerTemplates !== false) {
      const registerTemplates = this.deps.configStore?.get(REGISTER_TEMPLATES_KEY)
      if (Array.isArray(registerTemplates)) {
        config.registerTemplates = registerTemplates.filter(isObject).map((item) => ({ ...item }))
        counts.registerTemplates = config.registerTemplates.length
      }
    }

    if (options.registerSettings !== false) {
      const registerLocalStorage = this.deps.configStore?.get(REGISTER_LOCAL_STORAGE_KEY)
      if (isObject(registerLocalStorage)) {
        config.registerLocalStorage = Object.fromEntries(
          Object.entries(registerLocalStorage).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
        counts.registerSettings = Object.keys(config.registerLocalStorage).length
      }
    }

    if (options.appSettings !== false) {
      const appSettings = readAppSettings(accountData)
      if (appSettings) {
        config.appSettings = appSettings
        counts.appSettings = 1
      }
    }

    return { success: true, config, counts }
  }

  importConfig(config: PortableConfig, options: ConfigSyncImportOptions = {}): ConfigSyncImportResult {
    if (!config || config.app !== APP_ID || config.version !== 1) {
      return { success: false, counts: {}, error: '不是有效的 Kiro 账号管理器配置' }
    }

    const counts: Record<string, number> = {}
    let accountData = this.deps.accountStore?.loadAccounts() || null
    let accountDataChanged = false

    if (options.proxyPool !== false && Array.isArray(config.proxyPool)) {
      accountData = accountData || createDefaultAccountData()
      accountData.proxyPool = isObject(accountData.proxyPool) ? accountData.proxyPool : {}
      let added = 0
      config.proxyPool.forEach((raw, index) => {
        if (!isObject(raw)) return
        const normalized = normalizeProxyEntry(raw, `import-${Date.now()}-${index}`)
        if (!normalized) return
        accountData!.proxyPool[normalized.id] = normalized.value
        added++
      })
      if (added > 0) {
        counts.proxyPool = added
        accountDataChanged = true
      }
    }

    if (options.proxyPool !== false && isObject(config.proxyPoolConfig)) {
      accountData = accountData || createDefaultAccountData()
      accountData.proxyPoolConfig = {
        ...cloneObject(accountData.proxyPoolConfig),
        ...config.proxyPoolConfig
      }
      counts.proxyPoolConfig = 1
      accountDataChanged = true
    }

    if (options.appSettings !== false && config.appSettings) {
      accountData = accountData || createDefaultAccountData()
      applyAppSettings(accountData, config.appSettings)
      counts.appSettings = 1
      accountDataChanged = true
    }

    if (accountDataChanged && accountData) {
      this.deps.accountStore?.saveAccounts(accountData)
    }

    if (options.webhooks !== false && Array.isArray(config.webhooks) && this.deps.webhookService) {
      const existing = new Set(
        this.deps.webhookService.list().webhooks.map((webhook) => `${webhook.kind}:${webhook.url}`)
      )
      let added = 0
      for (const raw of config.webhooks) {
        if (!isObject(raw)) continue
        const input = normalizeWebhookInput(raw)
        if (!input) continue
        const key = `${input.kind}:${input.url}`
        if (existing.has(key)) continue
        const result = this.deps.webhookService.add(input)
        if (result.success) {
          existing.add(key)
          added++
        }
      }
      if (added > 0) counts.webhooks = added
    }

    if (options.registerConfig !== false && isObject(config.registerConfig)) {
      this.deps.configStore?.set(REGISTER_CONFIG_KEY, config.registerConfig)
      counts.registerConfig = 1
    }

    if (options.registerTemplates !== false && Array.isArray(config.registerTemplates)) {
      this.deps.configStore?.set(REGISTER_TEMPLATES_KEY, config.registerTemplates)
      counts.registerTemplates = config.registerTemplates.length
    }

    if (options.registerSettings !== false && isObject(config.registerLocalStorage)) {
      this.deps.configStore?.set(REGISTER_LOCAL_STORAGE_KEY, config.registerLocalStorage)
      counts.registerSettings = Object.keys(config.registerLocalStorage).length
    }

    return { success: true, counts }
  }
}
