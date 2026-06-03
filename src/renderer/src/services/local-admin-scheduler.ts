import { getJson, postJson } from './local-admin-client'

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

export interface SchedulerHealthResponse {
  ok: true
  tasks: SchedulerTaskSnapshot[]
  recentRuns: SchedulerRunSnapshot[]
}

export async function getSchedulerHealth(): Promise<SchedulerHealthResponse> {
  return getJson<SchedulerHealthResponse>('/api/scheduler/health')
}

export async function getSchedulerTasks(): Promise<SchedulerTaskSnapshot[]> {
  const response = await getJson<{ ok: true; tasks: SchedulerTaskSnapshot[] }>(
    '/api/scheduler/tasks'
  )
  return response.tasks
}

export async function getSchedulerRuns(taskId?: string): Promise<SchedulerRunSnapshot[]> {
  const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''
  const response = await getJson<{ ok: true; runs: SchedulerRunSnapshot[] }>(
    `/api/scheduler/runs${query}`
  )
  return response.runs
}

export async function runSchedulerTask(taskId: string): Promise<SchedulerRunSnapshot> {
  const response = await postJson<{ ok: true; run: SchedulerRunSnapshot }>(
    `/api/scheduler/tasks/${encodeURIComponent(taskId)}/run`
  )
  return response.run
}

export async function pauseSchedulerTask(taskId: string): Promise<SchedulerTaskSnapshot> {
  const response = await postJson<{ ok: true; task: SchedulerTaskSnapshot }>(
    `/api/scheduler/tasks/${encodeURIComponent(taskId)}/pause`
  )
  return response.task
}

export async function resumeSchedulerTask(taskId: string): Promise<SchedulerTaskSnapshot> {
  const response = await postJson<{ ok: true; task: SchedulerTaskSnapshot }>(
    `/api/scheduler/tasks/${encodeURIComponent(taskId)}/resume`
  )
  return response.task
}
