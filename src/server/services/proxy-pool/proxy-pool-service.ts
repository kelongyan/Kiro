import { randomUUID } from 'crypto'
import type { AccountService } from '../accounts/account-service'
import type { AccountData } from '../../storage/account-store'
import type { ProxyPoolValidateInput } from '../diagnostics/diagnostics-service'

export type ProxyProtocol = 'http' | 'https' | 'socks5' | 'socks4'
export type ProxyStatus = 'untested' | 'testing' | 'alive' | 'dead' | 'slow'
export type ProxyPoolStrategy = 'round_robin' | 'random' | 'least_used' | 'fastest'

export interface ProxyEntry {
  id: string
  url: string
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string
  password?: string
  label?: string
  source?: string
  tags?: string[]
  status: ProxyStatus
  latencyMs?: number
  externalIp?: string
  lastTestedAt?: number
  lastError?: string
  usedCount: number
  failCount: number
  lastUsedAt?: number
  lastBoundEmail?: string
  enabled: boolean
  createdAt: number
}

export interface ProxyPoolConfig {
  enabled: boolean
  strategy: ProxyPoolStrategy
  validateOnStartup: boolean
  autoDisableDead: boolean
  failureThreshold: number
  testUrl: string
  testTimeoutMs: number
  autoValidateIntervalMin: number
  autoValidateConcurrency: number
}

export interface ProxyPoolSnapshot {
  proxies: ProxyEntry[]
  config: ProxyPoolConfig
  cursor: number
  bindings: Record<string, string>
  counts: {
    total: number
    enabled: number
    alive: number
    slow: number
    dead: number
    untested: number
    boundAccounts: number
  }
}

export interface ProxyPoolImportResult {
  added: number
  skipped: number
  failed: number
  ids: string[]
}

export interface ProxyPoolValidateResult {
  success: boolean
  latencyMs?: number
  externalIp?: string
  error?: string
}

export interface ProxyPoolPick {
  id: string
  url: string
  protocol: ProxyProtocol
  host: string
  port: number
}

export interface ProxyPoolServiceDeps {
  accountService: AccountService
  validateProxy: (input: ProxyPoolValidateInput) => Promise<ProxyPoolValidateResult>
  emitEvent?: (type: string, payload: unknown) => void
}

interface ParsedProxy {
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string
  password?: string
  normalized: string
}

const DEFAULT_PROXY_POOL_CONFIG: ProxyPoolConfig = {
  enabled: false,
  strategy: 'round_robin',
  validateOnStartup: false,
  autoDisableDead: true,
  failureThreshold: 3,
  testUrl: 'https://api.ipify.org?format=json',
  testTimeoutMs: 8000,
  autoValidateIntervalMin: 0,
  autoValidateConcurrency: 5
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function normalizeProtocol(raw: string): ProxyProtocol | null {
  const protocol = raw.toLowerCase()
  if (
    protocol === 'http' ||
    protocol === 'https' ||
    protocol === 'socks5' ||
    protocol === 'socks4'
  ) {
    return protocol
  }
  if (protocol === 'socks') return 'socks5'
  return null
}

function defaultPort(protocol: ProxyProtocol): number {
  switch (protocol) {
    case 'http':
      return 8080
    case 'https':
      return 443
    case 'socks4':
    case 'socks5':
      return 1080
  }
}

function buildProxyUrl(
  protocol: ProxyProtocol,
  host: string,
  port: number,
  username?: string,
  password?: string
): string {
  const auth = username
    ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : ''
  return `${protocol}://${auth}${host}:${port}`
}

export function parseProxyUrl(raw: string): ParsedProxy | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const protocol = normalizeProtocol(url.protocol.replace(':', ''))
      if (!protocol) return null
      const port = Number(url.port) || defaultPort(protocol)
      if (!url.hostname || !Number.isFinite(port)) return null
      const username = url.username ? decodeURIComponent(url.username) : undefined
      const password = url.password ? decodeURIComponent(url.password) : undefined
      return {
        protocol,
        host: url.hostname,
        port,
        username,
        password,
        normalized: buildProxyUrl(protocol, url.hostname, port, username, password)
      }
    } catch {
      return null
    }
  }

  const parts = trimmed.split(':')
  if (parts.length === 4 && /^\d+$/.test(parts[1] || '')) {
    const [host, portRaw, username, password] = parts
    const port = Number(portRaw)
    if (!host || !Number.isFinite(port)) return null
    return {
      protocol: 'http',
      host,
      port,
      username: username || undefined,
      password: password || undefined,
      normalized: buildProxyUrl('http', host, port, username, password)
    }
  }

  if (trimmed.includes('@')) {
    const atIndex = trimmed.lastIndexOf('@')
    const authPart = trimmed.slice(0, atIndex)
    const hostPart = trimmed.slice(atIndex + 1)
    const colonIndex = authPart.indexOf(':')
    const username = colonIndex >= 0 ? authPart.slice(0, colonIndex) : authPart
    const password = colonIndex >= 0 ? authPart.slice(colonIndex + 1) : undefined
    const hostParts = hostPart.split(':')
    const port = Number(hostParts[1])
    if (!hostParts[0] || !Number.isFinite(port)) return null
    return {
      protocol: 'http',
      host: hostParts[0],
      port,
      username: username || undefined,
      password,
      normalized: buildProxyUrl('http', hostParts[0], port, username, password)
    }
  }

  if (parts.length === 2 && /^\d+$/.test(parts[1] || '')) {
    const port = Number(parts[1])
    if (!parts[0] || !Number.isFinite(port)) return null
    return {
      protocol: 'http',
      host: parts[0],
      port,
      normalized: buildProxyUrl('http', parts[0], port)
    }
  }

  return null
}

function normalizeEntry(id: string, value: unknown): ProxyEntry | null {
  if (!isObject(value)) return null
  const url = asString(value.url)
  const parsed = url ? parseProxyUrl(url) : null
  const protocol = normalizeProtocol(asString(value.protocol) || parsed?.protocol || '')
  const host = asString(value.host) || parsed?.host
  const port = asNumber(value.port) || parsed?.port
  if (!url || !protocol || !host || !port) return null

  const statusRaw = asString(value.status)
  const status: ProxyStatus =
    statusRaw === 'testing' || statusRaw === 'alive' || statusRaw === 'dead' || statusRaw === 'slow'
      ? statusRaw
      : 'untested'

  return {
    id: asString(value.id) || id,
    url,
    protocol,
    host,
    port,
    username: asString(value.username) || parsed?.username,
    password: asString(value.password) || parsed?.password,
    label: asString(value.label),
    source: asString(value.source),
    tags: Array.isArray(value.tags)
      ? value.tags.filter((item): item is string => typeof item === 'string')
      : undefined,
    status,
    latencyMs: asNumber(value.latencyMs),
    externalIp: asString(value.externalIp),
    lastTestedAt: asNumber(value.lastTestedAt),
    lastError: asString(value.lastError),
    usedCount: asNumber(value.usedCount) || 0,
    failCount: asNumber(value.failCount) || 0,
    lastUsedAt: asNumber(value.lastUsedAt),
    lastBoundEmail: asString(value.lastBoundEmail),
    enabled: asBoolean(value.enabled) ?? true,
    createdAt: asNumber(value.createdAt) || Date.now()
  }
}

function normalizeConfig(value: unknown): ProxyPoolConfig {
  const raw = isObject(value) ? value : {}
  const strategyRaw = asString(raw.strategy)
  const strategy: ProxyPoolStrategy =
    strategyRaw === 'random' ||
    strategyRaw === 'least_used' ||
    strategyRaw === 'fastest' ||
    strategyRaw === 'round_robin'
      ? strategyRaw
      : DEFAULT_PROXY_POOL_CONFIG.strategy

  return {
    enabled: asBoolean(raw.enabled) ?? DEFAULT_PROXY_POOL_CONFIG.enabled,
    strategy,
    validateOnStartup:
      asBoolean(raw.validateOnStartup) ?? DEFAULT_PROXY_POOL_CONFIG.validateOnStartup,
    autoDisableDead: asBoolean(raw.autoDisableDead) ?? DEFAULT_PROXY_POOL_CONFIG.autoDisableDead,
    failureThreshold: Math.max(
      1,
      asNumber(raw.failureThreshold) || DEFAULT_PROXY_POOL_CONFIG.failureThreshold
    ),
    testUrl: asString(raw.testUrl) || DEFAULT_PROXY_POOL_CONFIG.testUrl,
    testTimeoutMs: Math.max(
      100,
      asNumber(raw.testTimeoutMs) || DEFAULT_PROXY_POOL_CONFIG.testTimeoutMs
    ),
    autoValidateIntervalMin: Math.max(
      0,
      asNumber(raw.autoValidateIntervalMin) || DEFAULT_PROXY_POOL_CONFIG.autoValidateIntervalMin
    ),
    autoValidateConcurrency: Math.max(
      1,
      asNumber(raw.autoValidateConcurrency) || DEFAULT_PROXY_POOL_CONFIG.autoValidateConcurrency
    )
  }
}

export class ProxyPoolService {
  private readonly deps: ProxyPoolServiceDeps

  constructor(deps: ProxyPoolServiceDeps) {
    this.deps = deps
  }

  getSnapshot(): ProxyPoolSnapshot {
    const state = this.readState()
    const proxies = Array.from(state.proxyPool.values())
    return {
      proxies,
      config: state.config,
      cursor: state.cursor,
      bindings: state.bindings,
      counts: {
        total: proxies.length,
        enabled: proxies.filter((proxy) => proxy.enabled).length,
        alive: proxies.filter((proxy) => proxy.status === 'alive').length,
        slow: proxies.filter((proxy) => proxy.status === 'slow').length,
        dead: proxies.filter((proxy) => proxy.status === 'dead').length,
        untested: proxies.filter((proxy) => proxy.status === 'untested').length,
        boundAccounts: Object.keys(state.bindings).length
      }
    }
  }

  addProxy(
    rawUrl: string,
    options: { label?: string; source?: string; tags?: string[] } = {}
  ): string | null {
    const parsed = parseProxyUrl(rawUrl)
    if (!parsed) return null

    const state = this.readState()
    if (this.hasProxy(state.proxyPool, parsed)) return null

    const id = randomUUID()
    state.proxyPool.set(id, {
      id,
      url: parsed.normalized,
      protocol: parsed.protocol,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
      label: options.label,
      source: options.source || 'manual',
      tags: options.tags,
      status: 'untested',
      usedCount: 0,
      failCount: 0,
      enabled: true,
      createdAt: Date.now()
    })
    this.writeState(state)
    return id
  }

  importProxies(text: string): ProxyPoolImportResult {
    const result: ProxyPoolImportResult = { added: 0, skipped: 0, failed: 0, ids: [] }
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
    if (lines.length === 0) return result

    const state = this.readState()
    const keys = new Set<string>()
    for (const proxy of state.proxyPool.values()) {
      keys.add(this.proxyKey(proxy))
    }

    for (const line of lines) {
      const parsed = parseProxyUrl(line)
      if (!parsed) {
        result.failed++
        continue
      }
      const key = `${parsed.protocol}://${parsed.host}:${parsed.port}`
      if (keys.has(key)) {
        result.skipped++
        continue
      }
      keys.add(key)
      const id = randomUUID()
      state.proxyPool.set(id, {
        id,
        url: parsed.normalized,
        protocol: parsed.protocol,
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
        source: 'import',
        status: 'untested',
        usedCount: 0,
        failCount: 0,
        enabled: true,
        createdAt: Date.now()
      })
      result.added++
      result.ids.push(id)
    }

    if (result.added > 0) {
      this.writeState(state)
    }
    return result
  }

  updateConfig(config: Partial<ProxyPoolConfig>): ProxyPoolConfig {
    const state = this.readState()
    state.config = normalizeConfig({ ...state.config, ...config })
    this.writeState(state)
    return state.config
  }

  updateProxy(id: string, updates: Partial<ProxyEntry>): ProxyEntry | null {
    const state = this.readState()
    const existing = state.proxyPool.get(id)
    if (!existing) return null
    const next = { ...existing, ...updates, id }
    if (updates.url) {
      const parsed = parseProxyUrl(updates.url)
      if (!parsed) return null
      next.url = parsed.normalized
      next.protocol = parsed.protocol
      next.host = parsed.host
      next.port = parsed.port
      next.username = parsed.username
      next.password = parsed.password
    }
    state.proxyPool.set(id, next)
    this.writeState(state)
    return next
  }

  toggleProxyEnabled(id: string, enabled?: boolean): ProxyEntry | null {
    const state = this.readState()
    const existing = state.proxyPool.get(id)
    if (!existing) return null
    const next = { ...existing, enabled: enabled ?? !existing.enabled }
    state.proxyPool.set(id, next)
    this.writeState(state)
    return next
  }

  removeProxy(id: string): boolean {
    return this.removeProxies([id]) > 0
  }

  removeProxies(ids: string[]): number {
    if (ids.length === 0) return 0
    const state = this.readState()
    const idSet = new Set(ids)
    let removed = 0
    for (const id of idSet) {
      if (state.proxyPool.delete(id)) removed++
    }
    for (const [accountId, proxyId] of Object.entries(state.bindings)) {
      if (idSet.has(proxyId)) delete state.bindings[accountId]
    }
    if (removed > 0) this.writeState(state)
    return removed
  }

  async validateProxy(id: string): Promise<ProxyPoolValidateResult> {
    const state = this.readState()
    const proxy = state.proxyPool.get(id)
    if (!proxy) return { success: false, error: 'Proxy not found' }

    state.proxyPool.set(id, { ...proxy, status: 'testing' })
    this.writeState(state)

    let result: ProxyPoolValidateResult
    try {
      result = await this.deps.validateProxy({
        url: proxy.url,
        testUrl: state.config.testUrl,
        timeoutMs: state.config.testTimeoutMs
      })
    } catch (error) {
      result = { success: false, error: error instanceof Error ? error.message : String(error) }
    }

    const latest = this.readState()
    const existing = latest.proxyPool.get(id)
    if (!existing) return result
    const failCount = result.success ? existing.failCount : existing.failCount + 1
    const autoDisable =
      !result.success &&
      latest.config.autoDisableDead &&
      failCount >= latest.config.failureThreshold
    latest.proxyPool.set(id, {
      ...existing,
      status: result.success
        ? result.latencyMs !== undefined && result.latencyMs > 3000
          ? 'slow'
          : 'alive'
        : 'dead',
      latencyMs: result.latencyMs,
      externalIp: result.externalIp,
      lastTestedAt: Date.now(),
      lastError: result.success ? undefined : result.error,
      failCount,
      enabled: autoDisable ? false : existing.enabled
    })
    this.writeState(latest)
    this.emit('proxy-pool-validation', { id, result })
    return result
  }

  async validateProxiesBatch(ids: string[], concurrency: number = 5): Promise<void> {
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < ids.length) {
        const id = ids[cursor++]
        try {
          await this.validateProxy(id)
        } catch {
          // Per-proxy result is persisted by validateProxy.
        }
      }
    }
    const workerCount = Math.max(1, Math.min(concurrency, ids.length))
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
  }

  pickNextProxy(reason: string = 'request'): ProxyPoolPick | null {
    const state = this.readState()
    if (!state.config.enabled) return null

    const candidates = Array.from(state.proxyPool.values()).filter(
      (proxy) => proxy.enabled && proxy.status !== 'dead'
    )
    if (candidates.length === 0) return null

    let picked: ProxyEntry
    switch (state.config.strategy) {
      case 'random':
        picked = candidates[Math.floor(Math.random() * candidates.length)]
        break
      case 'least_used':
        picked = candidates.reduce((best, proxy) =>
          proxy.usedCount < best.usedCount ? proxy : best
        )
        break
      case 'fastest':
        picked = candidates.slice().sort((a, b) => {
          const left = a.latencyMs ?? Number.POSITIVE_INFINITY
          const right = b.latencyMs ?? Number.POSITIVE_INFINITY
          return left - right
        })[0]
        break
      case 'round_robin':
      default:
        picked = candidates[state.cursor % candidates.length]
        state.cursor += 1
        break
    }

    state.proxyPool.set(picked.id, {
      ...picked,
      usedCount: picked.usedCount + 1,
      lastUsedAt: Date.now()
    })
    this.writeState(state)
    this.emit('proxy-pool-proxy-picked', { id: picked.id, reason })
    return {
      id: picked.id,
      url: picked.url,
      protocol: picked.protocol,
      host: picked.host,
      port: picked.port
    }
  }

  reportProxyResult(id: string, success: boolean, boundEmail?: string, error?: string): void {
    const state = this.readState()
    const existing = state.proxyPool.get(id)
    if (!existing) return

    const failCount = success ? existing.failCount : existing.failCount + 1
    const autoDisable =
      !success && state.config.autoDisableDead && failCount >= state.config.failureThreshold
    state.proxyPool.set(id, {
      ...existing,
      failCount,
      lastBoundEmail: boundEmail || existing.lastBoundEmail,
      lastError: success ? existing.lastError : error,
      status: autoDisable ? 'dead' : existing.status,
      enabled: autoDisable ? false : existing.enabled
    })
    this.writeState(state)
    this.emit('proxy-pool-result', { id, success, boundEmail, error })
  }

  bindAccountToProxy(accountId: string, proxyId: string): { success: boolean; error?: string } {
    const state = this.readState()
    if (!state.proxyPool.has(proxyId)) {
      return { success: false, error: 'Proxy not found' }
    }
    state.bindings[accountId] = proxyId
    this.writeState(state)
    this.emit('proxy-pool-account-bound', { accountId, proxyId })
    return { success: true }
  }

  bindAccountsToProxy(
    accountIds: string[],
    proxyId: string
  ): { success: boolean; count: number; error?: string } {
    const state = this.readState()
    if (!state.proxyPool.has(proxyId)) {
      return { success: false, count: 0, error: 'Proxy not found' }
    }
    for (const accountId of accountIds) {
      state.bindings[accountId] = proxyId
    }
    this.writeState(state)
    return { success: true, count: accountIds.length }
  }

  unbindAccountFromProxy(accountId: string): { success: boolean } {
    const state = this.readState()
    delete state.bindings[accountId]
    this.writeState(state)
    return { success: true }
  }

  clearAccountProxyBindings(): { success: boolean; count: number } {
    const state = this.readState()
    const count = Object.keys(state.bindings).length
    state.bindings = {}
    this.writeState(state)
    return { success: true, count }
  }

  getAccountProxyUrl(accountId: string): string | undefined {
    const state = this.readState()
    const proxyId = state.bindings[accountId]
    if (!proxyId) return undefined
    const proxy = state.proxyPool.get(proxyId)
    if (!proxy || !proxy.enabled || proxy.status === 'dead') return undefined
    return proxy.url
  }

  applyAccountProxyUrl<T extends { id?: string; proxyUrl?: string }>(account: T): T {
    if (!account.id) return account
    const proxyUrl = this.getAccountProxyUrl(account.id)
    return { ...account, proxyUrl }
  }

  private hasProxy(proxyPool: Map<string, ProxyEntry>, parsed: ParsedProxy): boolean {
    const key = `${parsed.protocol}://${parsed.host}:${parsed.port}`
    for (const proxy of proxyPool.values()) {
      if (this.proxyKey(proxy) === key) return true
    }
    return false
  }

  private proxyKey(proxy: Pick<ProxyEntry, 'protocol' | 'host' | 'port'>): string {
    return `${proxy.protocol}://${proxy.host}:${proxy.port}`
  }

  private readState(): {
    data: AccountData | null
    proxyPool: Map<string, ProxyEntry>
    config: ProxyPoolConfig
    cursor: number
    bindings: Record<string, string>
  } {
    const data =
      this.deps.accountService.loadAccounts() || this.deps.accountService.getLastSavedData()
    const proxyPool = new Map<string, ProxyEntry>()
    const rawPool = isObject(data?.proxyPool) ? data.proxyPool : {}
    for (const [id, value] of Object.entries(rawPool)) {
      const entry = normalizeEntry(id, value)
      if (entry) proxyPool.set(entry.id, entry)
    }
    const rawBindings = isObject(data?.accountProxyBindings) ? data.accountProxyBindings : {}
    const bindings: Record<string, string> = {}
    for (const [accountId, proxyId] of Object.entries(rawBindings)) {
      if (typeof proxyId === 'string') bindings[accountId] = proxyId
    }
    return {
      data,
      proxyPool,
      config: normalizeConfig(data?.proxyPoolConfig),
      cursor: asNumber(data?.proxyPoolCursor) || 0,
      bindings
    }
  }

  private writeState(state: {
    data: AccountData | null
    proxyPool: Map<string, ProxyEntry>
    config: ProxyPoolConfig
    cursor: number
    bindings: Record<string, string>
  }): void {
    if (!state.data) return
    this.deps.accountService.saveAccounts({
      ...state.data,
      proxyPool: Object.fromEntries(state.proxyPool),
      proxyPoolConfig: state.config as unknown as Record<string, unknown>,
      proxyPoolCursor: state.cursor,
      accountProxyBindings: state.bindings
    })
  }

  private emit(type: string, payload: unknown): void {
    this.deps.emitEvent?.(type, payload)
  }
}
