import type { AccountService } from '../accounts/account-service'
import type { AccountData } from '../../storage/account-store'
import type { ConfigStore } from '../../storage/config-store'
import type {
  SchedulerPolicy,
  SchedulerRunSnapshot,
  SchedulerRunStatus,
  SchedulerTaskSnapshot,
  SchedulerTaskStatus,
  SchedulerTaskType
} from './types'

interface SchedulerServiceDeps {
  accountService: AccountService
  store: ConfigStore
  emitEvent: (type: string, payload: unknown) => void
}

interface StoredAccountCredentials {
  accessToken?: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  region?: string
  authMethod?: string
  provider?: string
  expiresAt?: number
}

interface StoredAccount {
  id: string
  email?: string
  idp?: string
  machineId?: string
  status?: string
  lastError?: string
  credentials?: StoredAccountCredentials
}

interface SchedulerTaskState {
  id: string
  type: SchedulerTaskType
  title: string
  enabled: boolean
  status: SchedulerTaskStatus
  running: boolean
  paused: boolean
  policy: SchedulerPolicy
  timer: ReturnType<typeof setTimeout> | null
  nextRunAt?: number
  lastRunAt?: number
  lastFinishedAt?: number
  lastStatus?: SchedulerRunStatus
  lastError?: string
  failureCount: number
  abortController: AbortController | null
}

interface SchedulerTaskPreviousState {
  enabled: boolean
  paused: boolean
  intervalMs: number
}

const RUN_HISTORY_KEY = 'schedulerRuns'
const TASK_STATE_KEY = 'schedulerTaskState'
const RUN_HISTORY_LIMIT = 100
const TOKEN_REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000
const DEFAULT_CHECK_INTERVAL_MINUTES = 30
const MIN_INTERVAL_MS = 60 * 1000

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

function toIso(value: number | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined
}

function isBannedOrError(account: StoredAccount): boolean {
  const text = `${account.status || ''} ${account.lastError || ''}`.toLowerCase()
  return text.includes('banned') || text.includes('suspended') || text.includes('封禁')
}

function normalizeInterval(minutes: number | undefined, fallback: number): number {
  const value = minutes && minutes > 0 ? minutes : fallback
  return Math.max(MIN_INTERVAL_MS, value * 60 * 1000)
}

export class SchedulerService {
  private readonly deps: SchedulerServiceDeps
  private readonly tasks = new Map<string, SchedulerTaskState>()
  private runs: SchedulerRunSnapshot[] = []

  constructor(deps: SchedulerServiceDeps) {
    this.deps = deps
  }

  initialize(): void {
    this.runs = this.loadRuns()
    this.refreshTasksFromAccountSettings()
  }

  shutdown(): void {
    for (const task of this.tasks.values()) {
      this.clearTimer(task)
    }
  }

  health(): { ok: true; tasks: SchedulerTaskSnapshot[]; recentRuns: SchedulerRunSnapshot[] } {
    this.refreshTasksFromAccountSettings()
    return {
      ok: true,
      tasks: this.listTasks(),
      recentRuns: this.listRuns()
    }
  }

  listTasks(): SchedulerTaskSnapshot[] {
    return Array.from(this.tasks.values()).map((task) => this.toTaskSnapshot(task))
  }

  listRuns(taskId?: string): SchedulerRunSnapshot[] {
    return this.runs
      .filter((run) => !taskId || run.taskId === taskId)
      .slice(-50)
      .reverse()
  }

  async runTaskNow(taskId: string): Promise<SchedulerRunSnapshot> {
    this.refreshTasksFromAccountSettings()
    const task = this.requireTask(taskId)
    return this.executeTask(task, 'manual')
  }

  pauseTask(taskId: string): SchedulerTaskSnapshot {
    const task = this.requireTask(taskId)
    task.abortController?.abort()
    task.paused = true
    task.enabled = false
    task.status = 'paused'
    task.nextRunAt = undefined
    this.clearTimer(task)
    this.persistTaskState()
    this.emitTaskEvent('scheduler-task-paused', task)
    return this.toTaskSnapshot(task)
  }

  resumeTask(taskId: string): SchedulerTaskSnapshot {
    this.refreshTasksFromAccountSettings()
    const task = this.requireTask(taskId)
    task.paused = false
    task.enabled = true
    task.status = 'idle'
    this.persistTaskState()
    this.scheduleTask(task, 0)
    return this.toTaskSnapshot(task)
  }

  stopTask(taskId: string): SchedulerTaskSnapshot {
    return this.pauseTask(taskId)
  }

  startTask(taskId: string): SchedulerTaskSnapshot {
    return this.resumeTask(taskId)
  }

  private refreshTasksFromAccountSettings(): void {
    const data = this.getAccountData()
    const savedState = this.getSavedTaskState()
    const concurrency = Math.max(1, Math.min(500, Number(data?.autoRefreshConcurrency ?? 100)))
    const refreshIntervalMs = normalizeInterval(asNumber(data?.autoRefreshInterval), 5)
    const checkIntervalMs = normalizeInterval(
      asNumber(data?.statusCheckInterval),
      DEFAULT_CHECK_INTERVAL_MINUTES
    )
    const autoRefreshEnabled = asBoolean(data?.autoRefreshEnabled) ?? true

    const refreshTask = this.upsertTask({
      id: 'account-auto-refresh',
      title: '账号自动刷新',
      type: 'account-refresh',
      enabled: autoRefreshEnabled,
      policy: {
        intervalMs: refreshIntervalMs,
        concurrency,
        maxRetries: 3,
        backoffMs: 2 * 60 * 1000
      },
      savedState
    })

    const checkTask = this.upsertTask({
      id: 'account-status-check',
      title: '账号状态检测',
      type: 'account-check',
      enabled: true,
      policy: {
        intervalMs: checkIntervalMs,
        concurrency,
        maxRetries: 3,
        backoffMs: 2 * 60 * 1000
      },
      savedState
    })

    this.reconcileTaskSchedule(refreshTask.task, refreshTask.previous)
    this.reconcileTaskSchedule(checkTask.task, checkTask.previous)
  }

  private upsertTask(input: {
    id: string
    title: string
    type: SchedulerTaskType
    enabled: boolean
    policy: SchedulerPolicy
    savedState: Record<string, { paused?: boolean; enabled?: boolean }>
  }): { task: SchedulerTaskState; previous?: SchedulerTaskPreviousState } {
    const saved = input.savedState[input.id]
    const existing = this.tasks.get(input.id)
    const paused = saved?.paused ?? false
    const enabled = input.enabled && (saved?.enabled ?? true)

    if (existing) {
      const previous = {
        enabled: existing.enabled,
        paused: existing.paused,
        intervalMs: existing.policy.intervalMs
      }
      existing.title = input.title
      existing.enabled = enabled
      existing.paused = paused
      existing.policy = input.policy
      if (paused) existing.status = 'paused'
      else if (existing.status === 'paused') existing.status = 'idle'
      return { task: existing, previous }
    }

    const task: SchedulerTaskState = {
      id: input.id,
      title: input.title,
      type: input.type,
      enabled,
      paused,
      status: paused ? 'paused' : 'idle',
      running: false,
      policy: input.policy,
      timer: null,
      failureCount: 0,
      abortController: null
    }
    this.tasks.set(input.id, task)
    return { task }
  }

  private reconcileTaskSchedule(
    task: SchedulerTaskState,
    previous?: SchedulerTaskPreviousState
  ): void {
    if (task.running) return

    if (!task.enabled || task.paused) {
      task.nextRunAt = undefined
      this.clearTimer(task)
      return
    }

    const becameSchedulable = !previous || !previous.enabled || previous.paused
    const intervalChanged = previous ? previous.intervalMs !== task.policy.intervalMs : true

    if (!task.timer || becameSchedulable || intervalChanged) {
      this.scheduleTask(task, task.policy.intervalMs)
    }
  }

  private async executeTask(
    task: SchedulerTaskState,
    trigger: 'timer' | 'manual'
  ): Promise<SchedulerRunSnapshot> {
    if (task.running) {
      throw new Error('任务正在运行')
    }

    this.clearTimer(task)
    task.running = true
    task.status = 'running'
    task.lastRunAt = Date.now()
    task.nextRunAt = undefined
    task.abortController = new AbortController()

    const run: SchedulerRunSnapshot = {
      id: `${task.id}-${Date.now()}`,
      taskId: task.id,
      taskTitle: task.title,
      status: 'running',
      startedAt: new Date(task.lastRunAt).toISOString(),
      total: 0,
      success: 0,
      failed: 0
    }
    this.addRun(run)
    this.emitTaskEvent('scheduler-task-started', task, run)

    try {
      const result =
        task.type === 'account-refresh'
          ? await this.runAccountRefreshTask(task)
          : await this.runAccountCheckTask(task)

      run.total = result.completed
      run.success = result.successCount
      run.failed = result.failedCount
      run.status = result.cancelled ? 'cancelled' : result.failedCount > 0 ? 'failed' : 'success'
      if (run.status === 'failed') {
        run.error = `${result.failedCount} 个账号失败`
      } else if (run.status === 'cancelled') {
        run.error = '任务已取消'
      }
      task.failureCount = run.status === 'failed' ? task.failureCount + 1 : 0
      task.lastError = run.error
      this.finishRun(task, run)
      this.emitTaskEvent(
        run.status === 'cancelled' ? 'scheduler-task-failed' : 'scheduler-task-completed',
        task,
        run
      )
    } catch (error) {
      run.status = 'failed'
      run.error = error instanceof Error ? error.message : 'Unknown error'
      task.failureCount += 1
      task.lastError = run.error
      this.finishRun(task, run)
      this.emitTaskEvent('scheduler-task-failed', task, run)
    } finally {
      task.running = false
      task.abortController = null
      task.status = task.paused ? 'paused' : task.lastStatus === 'failed' ? 'failed' : 'idle'
      if (task.enabled && !task.paused) {
        const delay =
          task.failureCount > 0
            ? Math.min(task.policy.intervalMs, task.policy.backoffMs * 2 ** (task.failureCount - 1))
            : task.policy.intervalMs
        this.scheduleTask(task, delay)
      }
      if (trigger === 'manual') {
        this.persistTaskState()
      }
    }

    return run
  }

  private finishRun(task: SchedulerTaskState, run: SchedulerRunSnapshot): void {
    const now = Date.now()
    run.finishedAt = new Date(now).toISOString()
    task.lastFinishedAt = now
    task.lastStatus = run.status
    this.persistRuns()
  }

  private async runAccountRefreshTask(task: SchedulerTaskState) {
    const data = this.getAccountData()
    const syncInfo = asBoolean(data?.autoRefreshSyncInfo) ?? true
    const accounts = this.getStoredAccounts().filter((account) => {
      if (isBannedOrError(account)) return false
      const expiresAt = account.credentials?.expiresAt
      const timeUntilExpiry = typeof expiresAt === 'number' ? expiresAt - Date.now() : Infinity
      return timeUntilExpiry <= TOKEN_REFRESH_BEFORE_EXPIRY_MS || syncInfo
    })

    const payload = accounts
      .filter((account) => account.credentials?.refreshToken)
      .map((account) => ({
        id: account.id,
        email: account.email,
        idp: account.idp,
        machineId: account.machineId,
        needsTokenRefresh:
          typeof account.credentials?.expiresAt === 'number'
            ? account.credentials.expiresAt - Date.now() <= TOKEN_REFRESH_BEFORE_EXPIRY_MS
            : true,
        credentials: {
          refreshToken: account.credentials?.refreshToken || '',
          clientId: account.credentials?.clientId,
          clientSecret: account.credentials?.clientSecret,
          region: account.credentials?.region,
          authMethod: account.credentials?.authMethod,
          accessToken: account.credentials?.accessToken,
          provider: account.credentials?.provider
        }
      }))

    this.deps.emitEvent('scheduler-task-progress', {
      taskId: task.id,
      total: payload.length,
      completed: 0,
      success: 0,
      failed: 0
    })

    return this.deps.accountService.batchRefresh(payload, task.policy.concurrency, syncInfo, {
      signal: task.abortController?.signal,
      perItemTimeoutMs: 30_000,
      adaptiveConcurrency: true
    })
  }

  private async runAccountCheckTask(task: SchedulerTaskState) {
    const payload = this.getStoredAccounts()
      .filter((account) => !isBannedOrError(account) && account.credentials?.accessToken)
      .map((account) => ({
        id: account.id,
        email: account.email || '',
        idp: account.idp,
        machineId: account.machineId,
        credentials: {
          accessToken: account.credentials?.accessToken || '',
          refreshToken: account.credentials?.refreshToken,
          clientId: account.credentials?.clientId,
          clientSecret: account.credentials?.clientSecret,
          region: account.credentials?.region,
          authMethod: account.credentials?.authMethod,
          provider: account.credentials?.provider
        }
      }))

    this.deps.emitEvent('scheduler-task-progress', {
      taskId: task.id,
      total: payload.length,
      completed: 0,
      success: 0,
      failed: 0
    })

    return this.deps.accountService.batchCheck(payload, task.policy.concurrency, {
      signal: task.abortController?.signal,
      perItemTimeoutMs: 30_000,
      adaptiveConcurrency: true
    })
  }

  private getAccountData(): AccountData | null {
    return this.deps.accountService.loadAccounts() || this.deps.accountService.getLastSavedData()
  }

  private getStoredAccounts(): StoredAccount[] {
    const data = this.getAccountData()
    if (!data || !isObject(data.accounts)) return []

    return Object.entries(data.accounts)
      .map(([id, raw]) => this.normalizeStoredAccount(id, raw))
      .filter((account): account is StoredAccount => account !== null)
  }

  private normalizeStoredAccount(id: string, value: unknown): StoredAccount | null {
    if (!isObject(value)) return null
    const rawCredentials = isObject(value.credentials) ? value.credentials : {}
    return {
      id: asString(value.id) || id,
      email: asString(value.email),
      idp: asString(value.idp),
      machineId: asString(value.machineId),
      status: asString(value.status),
      lastError: asString(value.lastError),
      credentials: {
        accessToken: asString(rawCredentials.accessToken),
        refreshToken: asString(rawCredentials.refreshToken),
        clientId: asString(rawCredentials.clientId),
        clientSecret: asString(rawCredentials.clientSecret),
        region: asString(rawCredentials.region),
        authMethod: asString(rawCredentials.authMethod),
        provider: asString(rawCredentials.provider),
        expiresAt: asNumber(rawCredentials.expiresAt)
      }
    }
  }

  private scheduleTask(task: SchedulerTaskState, delayMs: number): void {
    this.clearTimer(task)
    if (!task.enabled || task.paused) return
    const delay = Math.max(0, delayMs)
    task.nextRunAt = Date.now() + delay
    task.timer = setTimeout(() => {
      task.timer = null
      void this.executeTask(task, 'timer')
    }, delay)
  }

  private clearTimer(task: SchedulerTaskState): void {
    if (task.timer) {
      clearTimeout(task.timer)
      task.timer = null
    }
  }

  private addRun(run: SchedulerRunSnapshot): void {
    this.runs.push(run)
    if (this.runs.length > RUN_HISTORY_LIMIT) {
      this.runs.splice(0, this.runs.length - RUN_HISTORY_LIMIT)
    }
    this.persistRuns()
  }

  private loadRuns(): SchedulerRunSnapshot[] {
    const raw = this.deps.store.get(RUN_HISTORY_KEY)
    if (!Array.isArray(raw)) return []
    return raw.filter((item): item is SchedulerRunSnapshot => {
      return isObject(item) && typeof item.id === 'string' && typeof item.taskId === 'string'
    })
  }

  private persistRuns(): void {
    this.deps.store.set(RUN_HISTORY_KEY, this.runs.slice(-RUN_HISTORY_LIMIT))
  }

  private getSavedTaskState(): Record<string, { paused?: boolean; enabled?: boolean }> {
    const raw = this.deps.store.get(TASK_STATE_KEY)
    return isObject(raw) ? (raw as Record<string, { paused?: boolean; enabled?: boolean }>) : {}
  }

  private persistTaskState(): void {
    const state: Record<string, { paused: boolean; enabled: boolean }> = {}
    for (const task of this.tasks.values()) {
      state[task.id] = {
        paused: task.paused,
        enabled: task.enabled
      }
    }
    this.deps.store.set(TASK_STATE_KEY, state)
  }

  private requireTask(taskId: string): SchedulerTaskState {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`未知任务：${taskId}`)
    }
    return task
  }

  private toTaskSnapshot(task: SchedulerTaskState): SchedulerTaskSnapshot {
    return {
      id: task.id,
      type: task.type,
      title: task.title,
      enabled: task.enabled,
      status: task.status,
      running: task.running,
      paused: task.paused,
      policy: task.policy,
      nextRunAt: toIso(task.nextRunAt),
      lastRunAt: toIso(task.lastRunAt),
      lastFinishedAt: toIso(task.lastFinishedAt),
      lastStatus: task.lastStatus,
      lastError: task.lastError,
      failureCount: task.failureCount
    }
  }

  private emitTaskEvent(type: string, task: SchedulerTaskState, run?: SchedulerRunSnapshot): void {
    this.deps.emitEvent(type, {
      task: this.toTaskSnapshot(task),
      run
    })
  }
}
