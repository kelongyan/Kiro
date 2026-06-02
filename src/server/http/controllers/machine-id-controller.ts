import { Router, writeJsonResponse } from '../router'
import type { MachineIdService } from '../../services/machine-id/machine-id-service'

export interface MachineIdControllerDeps {
  machineIdService: MachineIdService
}

export function createMachineIdRouter(deps: MachineIdControllerDeps): Router {
  const { machineIdService } = deps
  const router = new Router()

  router.get('/api/machine-id/os', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, osType: machineIdService.getOSType() })
  })

  router.get('/api/machine-id/current', async (_req, res) => {
    const result = await machineIdService.getCurrent()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/machine-id/set', async (_req, res, ctx) => {
    const body = ctx.body as { machineId?: string } | undefined
    if (!body?.machineId) {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少 machineId' })
      return
    }

    const result = await machineIdService.set(body.machineId)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.get('/api/machine-id/random', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, machineId: machineIdService.generateRandom() })
  })

  router.get('/api/machine-id/admin', async (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, isAdmin: await machineIdService.checkAdmin() })
  })

  router.get('/api/machine-id/admin-restart', async (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, data: await machineIdService.requestAdminRestart() })
  })

  router.post('/api/machine-id/backup', async (_req, res, ctx) => {
    const body = ctx.body as { machineId?: string; filePath?: string } | undefined
    if (!body?.machineId || !body.filePath) {
      writeJsonResponse(res, 400, {
        ok: false,
        success: false,
        error: '缺少 machineId 或 filePath'
      })
      return
    }

    const success = await machineIdService.backupToFile(body.machineId, body.filePath)
    writeJsonResponse(res, 200, { ok: success, success })
  })

  router.post('/api/machine-id/restore', async (_req, res, ctx) => {
    const body = ctx.body as { filePath?: string } | undefined
    if (!body?.filePath) {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少 filePath' })
      return
    }

    const result = await machineIdService.restoreFromFile(body.filePath)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  return router
}
