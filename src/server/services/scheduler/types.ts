export type SchedulerTaskType = 'account-refresh' | 'account-check'
export type SchedulerTaskStatus = 'idle' | 'running' | 'paused' | 'failed'
export type SchedulerRunStatus = 'running' | 'success' | 'failed' | 'cancelled'

export interface SchedulerPolicy {
  intervalMs: number
  concurrency: number
  maxRetries: number
  backoffMs: number
}

export interface SchedulerTaskSnapshot {
  id: string
  type: SchedulerTaskType
  title: string
  enabled: boolean
  status: SchedulerTaskStatus
  running: boolean
  paused: boolean
  policy: SchedulerPolicy
  nextRunAt?: string
  lastRunAt?: string
  lastFinishedAt?: string
  lastStatus?: SchedulerRunStatus
  lastError?: string
  failureCount: number
}

export interface SchedulerRunSnapshot {
  id: string
  taskId: string
  taskTitle: string
  status: SchedulerRunStatus
  startedAt: string
  finishedAt?: string
  total: number
  success: number
  failed: number
  error?: string
}

export interface SchedulerTaskEventPayload {
  task: SchedulerTaskSnapshot
  run?: SchedulerRunSnapshot
}
