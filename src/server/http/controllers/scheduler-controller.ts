import { Router, writeJsonResponse } from '../router'
import type { SchedulerService } from '../../services/scheduler/scheduler-service'

export interface SchedulerControllerDeps {
  schedulerService: SchedulerService
}

export function createSchedulerRouter(deps: SchedulerControllerDeps): Router {
  const { schedulerService } = deps
  const router = new Router()

  router.get('/api/scheduler/health', (_req, res) => {
    writeJsonResponse(res, 200, schedulerService.health())
  })

  router.get('/api/scheduler/tasks', (_req, res) => {
    writeJsonResponse(res, 200, {
      ok: true,
      tasks: schedulerService.listTasks()
    })
  })

  router.get('/api/scheduler/runs', (_req, res, ctx) => {
    writeJsonResponse(res, 200, {
      ok: true,
      runs: schedulerService.listRuns(ctx.query.get('taskId') || undefined)
    })
  })

  router.post('/api/scheduler/tasks/:id/run', async (_req, res, ctx) => {
    const run = await schedulerService.runTaskNow(ctx.params.id)
    writeJsonResponse(res, 200, { ok: true, run })
  })

  router.post('/api/scheduler/tasks/:id/pause', (_req, res, ctx) => {
    const task = schedulerService.pauseTask(ctx.params.id)
    writeJsonResponse(res, 200, { ok: true, task })
  })

  router.post('/api/scheduler/tasks/:id/resume', (_req, res, ctx) => {
    const task = schedulerService.resumeTask(ctx.params.id)
    writeJsonResponse(res, 200, { ok: true, task })
  })

  router.post('/api/scheduler/tasks/:id/start', (_req, res, ctx) => {
    const task = schedulerService.startTask(ctx.params.id)
    writeJsonResponse(res, 200, { ok: true, task })
  })

  router.post('/api/scheduler/tasks/:id/stop', (_req, res, ctx) => {
    const task = schedulerService.stopTask(ctx.params.id)
    writeJsonResponse(res, 200, { ok: true, task })
  })

  return router
}
