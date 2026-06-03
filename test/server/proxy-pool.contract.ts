import { ProxyPoolService } from '../../src/server/services/proxy-pool/proxy-pool-service'
import type { AccountService } from '../../src/server/services/accounts/account-service'
import type { AccountData } from '../../src/server/storage/account-store'
import type { ProxyPoolValidateInput } from '../../src/server/services/diagnostics/diagnostics-service'
import type { ProxyPoolValidateResult } from '../../src/server/services/proxy-pool/proxy-pool-service'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function makeAccountData(overrides: Partial<AccountData> = {}): AccountData {
  return {
    accounts: {},
    groups: {},
    tags: {},
    activeAccountId: null,
    autoRefreshEnabled: true,
    autoRefreshInterval: 5,
    autoRefreshConcurrency: 100,
    autoRefreshSyncInfo: true,
    statusCheckInterval: 30,
    privacyMode: false,
    usagePrecision: false,
    proxyEnabled: false,
    proxyUrl: '',
    autoSwitchEnabled: false,
    autoSwitchThreshold: 80,
    autoSwitchInterval: 30,
    switchTarget: 'ide',
    theme: 'default',
    darkMode: false,
    language: 'zh',
    machineIdConfig: {},
    accountMachineIds: {},
    machineIdHistory: [],
    proxyPool: {},
    proxyPoolConfig: {},
    proxyPoolCursor: 0,
    accountProxyBindings: {},
    ...overrides
  }
}

function createFixture(
  validateProxy?: (input: ProxyPoolValidateInput) => Promise<ProxyPoolValidateResult>
) {
  let data = makeAccountData()
  const accountService = {
    loadAccounts: () => data,
    getLastSavedData: () => data,
    saveAccounts: (next: AccountData) => {
      data = next
    }
  } as unknown as AccountService

  const service = new ProxyPoolService({
    accountService,
    validateProxy: validateProxy || (async () => ({ success: true, latencyMs: 12 })),
    emitEvent: () => undefined
  })

  return { service, getData: () => data }
}

async function importDeduplicatesAndNormalizesSupportedFormats(): Promise<void> {
  const { service } = createFixture()
  const result = service.importProxies(`
127.0.0.1:8080
127.0.0.1:8080
127.0.0.2:8081:user:pass
user2:pass2@127.0.0.3:8082
http://user3:pass3@127.0.0.4:8083
socks5://127.0.0.5:1080
not-a-proxy
`)

  assert(result.added === 5, 'five valid unique proxies should be imported')
  assert(result.skipped === 1, 'duplicate proxy should be skipped')
  assert(result.failed === 1, 'invalid proxy should be counted as failed')

  const snapshot = service.getSnapshot()
  assert(snapshot.proxies.length === 5, 'snapshot should expose imported proxies')
  assert(
    snapshot.proxies.some((proxy) => proxy.url === 'http://user:pass@127.0.0.2:8081'),
    'host:port:user:pass should normalize to auth URL'
  )
  assert(
    snapshot.proxies.some((proxy) => proxy.url === 'socks5://127.0.0.5:1080'),
    'socks5 proxy should keep socks5 protocol'
  )
}

async function batchValidationHonorsConcurrencyAndAutoDisablesDead(): Promise<void> {
  let active = 0
  let maxActive = 0
  const { service } = createFixture(async (input: ProxyPoolValidateInput) => {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 20))
    active--
    return input.url.includes('dead')
      ? { success: false, latencyMs: 20, error: 'dead proxy' }
      : { success: true, latencyMs: 20, externalIp: '203.0.113.8' }
  })

  service.updateConfig({ autoDisableDead: true, failureThreshold: 1 })
  service.importProxies(`
alive-a.test:8001
dead-proxy.test:8002
alive-b.test:8003
alive-c.test:8004
`)
  const ids = service.getSnapshot().proxies.map((proxy) => proxy.id)
  await service.validateProxiesBatch(ids, 2)

  const dead = service.getSnapshot().proxies.find((proxy) => proxy.host === 'dead-proxy.test')
  assert(maxActive <= 2, 'batch validation should not exceed requested concurrency')
  assert(dead?.status === 'dead', 'failed validation should mark proxy dead')
  assert(dead?.enabled === false, 'dead proxy should auto-disable when threshold is reached')
}

async function strategiesAndAccountBindingsUseAvailableProxies(): Promise<void> {
  const { service } = createFixture()
  service.importProxies(`
fast.test:8001
slow.test:8002
`)
  const [fast, slow] = service.getSnapshot().proxies

  service.updateProxy(fast.id, { status: 'alive', latencyMs: 25, usedCount: 8 })
  service.updateProxy(slow.id, { status: 'alive', latencyMs: 900, usedCount: 1 })
  service.updateConfig({ enabled: true, strategy: 'least_used' })

  const leastUsed = service.pickNextProxy('registration')
  assert(leastUsed?.id === slow.id, 'least_used should pick proxy with lower usedCount')

  service.updateConfig({ strategy: 'fastest' })
  const fastest = service.pickNextProxy('registration')
  assert(fastest?.id === fast.id, 'fastest should pick proxy with lowest latency')

  service.bindAccountToProxy('account-1', fast.id)
  assert(
    service.getAccountProxyUrl('account-1') === fast.url,
    'bound account should resolve proxy URL'
  )

  service.updateProxy(fast.id, { status: 'dead' })
  assert(
    service.getAccountProxyUrl('account-1') === undefined,
    'dead bound proxy should fall back to global/direct'
  )
}

await importDeduplicatesAndNormalizesSupportedFormats()
await batchValidationHonorsConcurrencyAndAutoDisablesDead()
await strategiesAndAccountBindingsUseAvailableProxies()
