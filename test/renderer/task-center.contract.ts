import type {
  SchedulerRunSnapshot,
  SchedulerTaskSnapshot
} from '../../src/renderer/src/services/local-admin-scheduler'
import type { TaskEntry } from '../../src/renderer/src/store/tasks'
import { buildTaskCenterSections } from '../../src/renderer/src/components/pages/task-center-utils'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function createSchedulerTask(id: string): SchedulerTaskSnapshot {
  return {
    id,
    type: 'account-check',
    title: '账号状态检测',
    enabled: true,
    status: 'idle',
    running: false,
    paused: false,
    policy: { intervalMs: 60_000, concurrency: 5, maxRetries: 3, backoffMs: 10_000 },
    failureCount: 0
  }
}

function createLocalTask(id: string, kind: TaskEntry['kind']): TaskEntry {
  const now = Date.now()
  return {
    id,
    kind,
    title: '批量注册 20 个账号',
    status: 'running',
    progress: 45,
    done: 9,
    total: 20,
    successCount: 7,
    failedCount: 2,
    createdAt: now,
    updatedAt: now
  }
}

function mergesSchedulerAndLocalTasksIntoSeparateSections(): void {
  const sections = buildTaskCenterSections(
    [createSchedulerTask('scheduler-1')],
    [createLocalTask('local-1', 'register-batch')],
    [] as SchedulerRunSnapshot[]
  )

  assert(sections.local.length === 1, 'local section should include register task')
  assert(sections.scheduler.length === 1, 'scheduler section should include server tasks')
  assert(
    sections.local[0]?.kind === 'register-batch',
    'local section should preserve original local task kind'
  )
}

mergesSchedulerAndLocalTasksIntoSeparateSections()
