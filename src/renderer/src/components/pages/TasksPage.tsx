import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Clock,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Timer
} from 'lucide-react'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { cn } from '@/lib/utils'
import {
  getSchedulerHealth,
  pauseSchedulerTask,
  resumeSchedulerTask,
  runSchedulerTask,
  type SchedulerRunSnapshot,
  type SchedulerTaskSnapshot
} from '@/services/local-admin-scheduler'
import { useTranslation } from '@/hooks/useTranslation'

function formatDateTime(value?: string): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatInterval(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`
}

function statusTone(status: string): string {
  if (status === 'running') return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
  if (status === 'failed') return 'bg-destructive/10 text-destructive border-destructive/20'
  if (status === 'paused') return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
  return 'bg-success/10 text-success border-success/20'
}

export function TasksPage(): React.ReactNode {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const [tasks, setTasks] = useState<SchedulerTaskSnapshot[]>([])
  const [runs, setRuns] = useState<SchedulerRunSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const health = await getSchedulerHealth()
      setTasks(health.tasks)
      setRuns(health.recentRuns)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scheduler')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => clearInterval(timer)
  }, [refresh])

  const runAction = async (
    taskId: string,
    action: (id: string) => Promise<unknown>
  ): Promise<void> => {
    setBusyTaskId(taskId)
    try {
      await action(taskId)
      await refresh()
    } finally {
      setBusyTaskId(null)
    }
  }

  return (
    <div className="flex-1 p-6 space-y-5 overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            {isEn ? 'Task Center' : '任务中心'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isEn ? 'Server-side account polling and maintenance' : '后端账号轮询与维护任务'}
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          {isEn ? 'Refresh' : '刷新'}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {tasks.map((task) => (
          <Card key={task.id} className="rounded-lg">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    {task.title}
                  </CardTitle>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className={cn('text-xs', statusTone(task.status))}>
                      {task.status}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {task.type}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyTaskId === task.id || task.running}
                    onClick={() => void runAction(task.id, runSchedulerTask)}
                    title={isEn ? 'Run now' : '立即运行'}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                  {task.paused ? (
                    <Button
                      size="sm"
                      disabled={busyTaskId === task.id}
                      onClick={() => void runAction(task.id, resumeSchedulerTask)}
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      {isEn ? 'Resume' : '恢复'}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyTaskId === task.id}
                      onClick={() => void runAction(task.id, pauseSchedulerTask)}
                    >
                      <Pause className="h-3.5 w-3.5" />
                      {isEn ? 'Pause' : '暂停'}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border bg-muted/20 p-3">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Timer className="h-3.5 w-3.5" />
                    {isEn ? 'Interval' : '间隔'}
                  </div>
                  <div className="font-mono mt-1">{formatInterval(task.policy.intervalMs)}</div>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <div className="text-xs text-muted-foreground">
                    {isEn ? 'Concurrency' : '并发'}
                  </div>
                  <div className="font-mono mt-1">{task.policy.concurrency}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">{isEn ? 'Next Run' : '下次执行'}</div>
                  <div className="font-mono mt-1">{formatDateTime(task.nextRunAt)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{isEn ? 'Last Finished' : '上次完成'}</div>
                  <div className="font-mono mt-1">{formatDateTime(task.lastFinishedAt)}</div>
                </div>
              </div>
              {task.lastError && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {task.lastError}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Clock className="h-4 w-4" />
          {isEn ? 'Recent Runs' : '最近执行'}
        </h2>
        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_1fr] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/40">
            <span>{isEn ? 'Task' : '任务'}</span>
            <span>{isEn ? 'Status' : '状态'}</span>
            <span>{isEn ? 'Result' : '结果'}</span>
            <span>{isEn ? 'Started' : '开始'}</span>
            <span>{isEn ? 'Error' : '错误'}</span>
          </div>
          {runs.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {loading ? (isEn ? 'Loading...' : '加载中...') : isEn ? 'No runs' : '暂无执行记录'}
            </div>
          ) : (
            runs.map((run) => (
              <div
                key={run.id}
                className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_1fr] gap-3 px-4 py-3 text-sm border-t"
              >
                <span className="truncate">{run.taskTitle}</span>
                <Badge variant="outline" className={cn('w-fit text-xs', statusTone(run.status))}>
                  {run.status}
                </Badge>
                <span className="font-mono text-xs">
                  {run.success}/{run.failed}/{run.total}
                </span>
                <span className="font-mono text-xs">{formatDateTime(run.startedAt)}</span>
                <span className="truncate text-xs text-destructive">{run.error || '-'}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
