import type { SchedulerRunSnapshot, SchedulerTaskSnapshot } from '@/services/local-admin-scheduler'
import type { TaskEntry } from '@/store/tasks'

export interface TaskCenterSections {
  local: TaskEntry[]
  scheduler: SchedulerTaskSnapshot[]
  runs: SchedulerRunSnapshot[]
}

export function buildTaskCenterSections(
  schedulerTasks: SchedulerTaskSnapshot[],
  localTasks: TaskEntry[],
  recentRuns: SchedulerRunSnapshot[]
): TaskCenterSections {
  return {
    local: [...localTasks].sort((left, right) => right.updatedAt - left.updatedAt),
    scheduler: [...schedulerTasks].sort((left, right) => {
      const leftTime = left.lastRunAt ? Date.parse(left.lastRunAt) : 0
      const rightTime = right.lastRunAt ? Date.parse(right.lastRunAt) : 0
      return rightTime - leftTime
    }),
    runs: [...recentRuns].sort(
      (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)
    )
  }
}
