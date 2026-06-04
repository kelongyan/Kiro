import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ProxyServer } from '../../src/core/proxy'
import type { ProxyAccount } from '../../src/core/proxy'
import { AccountPool } from '../../src/core/proxy/accountPool'
import { ProxyService } from '../../src/server/services/proxy/proxy-service'
import type { ProxyKeyValueStore } from '../../src/server/services/proxy/proxy-service'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function createStore(): ProxyKeyValueStore {
  const values = new Map<string, unknown>()
  return {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value)
    }
  }
}

function createService() {
  const dataDir = mkdtempSync(join(tmpdir(), 'kiro-proxy-dashboard-'))
  let server: ProxyServer | null = null
  const service = new ProxyService({
    dataDir,
    store: createStore(),
    emitEvent: () => undefined,
    createServer: () => {
      server = new ProxyServer({
        enabled: false,
        host: '127.0.0.1',
        port: 5580,
        enableMultiAccount: true,
        selectedAccountIds: [],
        logRequests: true,
        maxConcurrent: 10
      })
      return server
    },
    getServer: () => server
  })
  return {
    service,
    getServer: () => {
      if (!server) throw new Error('server not initialized')
      return server
    },
    cleanup: () => rmSync(dataDir, { recursive: true, force: true })
  }
}

function makeAccount(input: Partial<ProxyAccount> & Pick<ProxyAccount, 'id'>): ProxyAccount {
  return {
    accessToken: `access-${input.id}`,
    refreshToken: `refresh-${input.id}`,
    email: `${input.id}@example.com`,
    ...input
  }
}

function dashboardSummarizesProxyControlPlane(): void {
  const fixture = createService()
  try {
    const { service } = fixture
    const limitedKey = service.addApiKey({
      name: 'limited',
      creditsLimit: 5,
      modelAllowlist: ['anthropic.claude-sonnet-4'],
      accountAllowlist: ['acc-ok']
    })
    assert(limitedKey.success && limitedKey.apiKey, 'limited api key should be created')
    const disabledKey = service.addApiKey({ name: 'disabled' })
    assert(disabledKey.success && disabledKey.apiKey, 'disabled api key should be created')
    service.updateApiKey(disabledKey.apiKey.id, { enabled: false })

    service.syncAccounts([
      makeAccount({ id: 'acc-ok' }),
      makeAccount({ id: 'acc-cooling' }),
      makeAccount({ id: 'acc-suspended', suspendedAt: Date.now(), suspendReason: 'risk' }),
      makeAccount({ id: 'acc-exhausted', quotaUsed: 10, quotaLimit: 10 })
    ])
    fixture.getServer().getAccountPool().recordError('acc-cooling')
    fixture.getServer().setRequestStats(9, 7, 2)
    fixture.getServer().setTotalTokens(120, 80)
    fixture.getServer().setTotalCredits(3.5)
    fixture.getServer().getStats().recentRequests.push({
      requestId: 'req-1',
      timestamp: Date.now(),
      path: '/v1/chat/completions',
      model: 'anthropic.claude-sonnet-4',
      apiKeyId: limitedKey.apiKey.id,
      accountId: 'acc-ok',
      status: 200,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      reasoningTokens: 1,
      credits: 0.25,
      responseTime: 1234,
      success: true
    })

    const dashboard = service.getDashboard()

    assert(dashboard.running === false, 'dashboard should expose running state')
    assert(dashboard.origin === 'http://127.0.0.1:5580', 'dashboard should expose proxy origin')
    assert(
      dashboard.strategy === 'least-used',
      'dashboard should expose least-used default strategy'
    )
    assert(dashboard.requests.total === 9, 'dashboard should expose request total')
    assert(dashboard.requests.successRate === 7 / 9, 'dashboard should compute success rate')
    assert(dashboard.tokens.total === 200, 'dashboard should expose token total')
    assert(dashboard.credits.total === 3.5, 'dashboard should expose credits total')
    assert(dashboard.accounts.total === 4, 'dashboard should expose account total')
    assert(dashboard.accounts.available === 1, 'dashboard should expose available accounts')
    assert(dashboard.accounts.suspended === 1, 'dashboard should count suspended accounts')
    assert(dashboard.accounts.exhausted === 1, 'dashboard should count exhausted accounts')
    assert(dashboard.accounts.cooldown === 1, 'dashboard should count cooldown accounts')
    assert(dashboard.apiKeys.total === 2, 'dashboard should expose API key total')
    assert(dashboard.apiKeys.enabled === 1, 'dashboard should expose enabled API keys')
    assert(dashboard.apiKeys.disabled === 1, 'dashboard should expose disabled API keys')
    assert(dashboard.apiKeys.restricted === 1, 'dashboard should count restricted API keys')
    assert(dashboard.recentRequests[0]?.requestId === 'req-1', 'dashboard should expose request id')
    assert(
      dashboard.recentRequests[0]?.apiKeyId === limitedKey.apiKey.id,
      'dashboard should expose api key id'
    )
    assert(
      dashboard.recentRequests[0]?.accountId === 'acc-ok',
      'dashboard should expose account id'
    )
    assert(
      dashboard.recentRequests[0]?.cacheWriteTokens === 2,
      'dashboard should expose cache write tokens'
    )
  } finally {
    fixture.cleanup()
  }
}

function apiKeyPermissionFieldsPersist(): void {
  const fixture = createService()
  try {
    const { service } = fixture
    const result = service.addApiKey({
      name: 'team-a',
      modelAllowlist: ['model-a', 'model-b'],
      accountAllowlist: ['acc-a']
    })

    assert(result.success && result.apiKey, 'api key should be created')
    assert(result.apiKey.modelAllowlist?.length === 2, 'model allowlist should be returned')
    assert(result.apiKey.accountAllowlist?.[0] === 'acc-a', 'account allowlist should be returned')

    const update = service.updateApiKey(result.apiKey.id, {
      modelAllowlist: ['model-c'],
      accountAllowlist: ['acc-b', 'acc-c']
    })
    assert(update.success && update.apiKey, 'api key should be updated')
    assert(update.apiKey.modelAllowlist?.[0] === 'model-c', 'model allowlist should update')
    assert(update.apiKey.accountAllowlist?.length === 2, 'account allowlist should update')
  } finally {
    fixture.cleanup()
  }
}

function accountPoolLeastUsedStrategyChoosesLowerUsageAccount(): void {
  const pool = new AccountPool()
  pool.addAccount(makeAccount({ id: 'acc-a' }))
  pool.addAccount(makeAccount({ id: 'acc-b' }))
  pool.recordSuccess('acc-a')
  pool.recordSuccess('acc-a')
  pool.recordSuccess('acc-b')
  pool.setStrategy('least-used')

  const next = pool.getNextAccount()
  assert(next?.id === 'acc-b', 'least-used should choose the account with fewer requests')
}

dashboardSummarizesProxyControlPlane()
apiKeyPermissionFieldsPersist()
accountPoolLeastUsedStrategyChoosesLowerUsageAccount()
