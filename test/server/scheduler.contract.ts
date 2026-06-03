import { SchedulerService } from '../../src/server/services/scheduler/scheduler-service'
import type { AccountService } from '../../src/server/services/accounts/account-service'
import type { AccountData } from '../../src/server/storage/account-store'
import type { ConfigStore } from '../../src/server/storage/config-store'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function createSchedulerFixture(data: AccountData): SchedulerService {
  const storeData = new Map<string, unknown>()
  const store = {
    get: (key: string) => storeData.get(key),
    set: (key: string, value: unknown) => {
      storeData.set(key, value)
    },
    delete: (key: string) => {
      storeData.delete(key)
    },
    has: (key: string) => storeData.has(key)
  } as unknown as ConfigStore

  const accountService = {
    loadAccounts: () => data,
    getLastSavedData: () => data,
    batchRefresh: async () => ({
      success: true,
      completed: 0,
      successCount: 0,
      failedCount: 0
    }),
    batchCheck: async () => ({
      success: true,
      completed: 0,
      successCount: 0,
      failedCount: 0
    })
  } as unknown as AccountService

  return new SchedulerService({
    accountService,
    store,
    emitEvent: () => undefined
  })
}

function findAutoRefreshTask(service: SchedulerService) {
  const task = service.listTasks().find((item) => item.id === 'account-auto-refresh')
  assert(task, 'auto refresh task should exist')
  return task
}

async function healthDoesNotRescheduleUnchangedTask(): Promise<void> {
  const data = makeAccountData()
  const service = createSchedulerFixture(data)
  service.initialize()

  const before = findAutoRefreshTask(service).nextRunAt
  assert(before, 'auto refresh task should be scheduled on initialize')

  await wait(20)
  service.health()
  const after = findAutoRefreshTask(service).nextRunAt

  service.shutdown()
  assert(after === before, 'health polling should not keep pushing nextRunAt forward')
}

async function disabledAutoRefreshClearsSchedule(): Promise<void> {
  const data = makeAccountData()
  const service = createSchedulerFixture(data)
  service.initialize()

  assert(findAutoRefreshTask(service).nextRunAt, 'auto refresh task should start scheduled')

  data.autoRefreshEnabled = false
  service.health()
  const task = findAutoRefreshTask(service)

  service.shutdown()
  assert(!task.enabled, 'disabled auto refresh setting should disable the scheduler task')
  assert(!task.nextRunAt, 'disabled auto refresh setting should clear nextRunAt')
}

async function intervalChangeReschedulesTask(): Promise<void> {
  const data = makeAccountData()
  const service = createSchedulerFixture(data)
  service.initialize()

  const before = findAutoRefreshTask(service).nextRunAt
  await wait(20)
  data.autoRefreshInterval = 10
  service.health()
  const after = findAutoRefreshTask(service).nextRunAt

  service.shutdown()
  assert(before !== after, 'interval change should reschedule the next run')
  assert(
    after !== undefined && Date.parse(after) - Date.now() > 9 * 60 * 1000,
    'new schedule should use the updated interval'
  )
}

await healthDoesNotRescheduleUnchangedTask()
await disabledAutoRefreshClearsSchedule()
await intervalChangeReschedulesTask()
