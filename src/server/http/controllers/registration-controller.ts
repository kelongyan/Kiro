import { Router, writeJsonResponse } from '../router'
import type { RegistrationService } from '../../services/registration/registration-service'

export interface RegistrationControllerDeps {
  registrationService: RegistrationService
}

export function createRegistrationRouter(deps: RegistrationControllerDeps): Router {
  const { registrationService } = deps
  const router = new Router()

  router.post('/api/registration/auto', async (_req, res, ctx) => {
    const config = ctx.body && typeof ctx.body === 'object' ? ctx.body : {}
    const result = await registrationService.startAuto(
      config as Parameters<RegistrationService['startAuto']>[0]
    )
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/registration/manual/phase1', async (_req, res, ctx) => {
    const config = ctx.body && typeof ctx.body === 'object' ? ctx.body : {}
    const result = await registrationService.manualPhase1(
      config as Parameters<RegistrationService['manualPhase1']>[0]
    )
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/registration/manual/phase2', async (_req, res, ctx) => {
    const body = ctx.body as { email?: string; fullName?: string } | undefined
    if (!body?.email) {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少 email' })
      return
    }

    const result = await registrationService.manualPhase2(body.email, body.fullName)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/registration/manual/phase3', async (_req, res, ctx) => {
    const body = ctx.body as { otp?: string } | undefined
    if (!body?.otp) {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少 otp' })
      return
    }

    const result = await registrationService.manualPhase3(body.otp)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/registration/cancel', async (_req, res, ctx) => {
    const body = ctx.body as { taskId?: string } | undefined
    const result = await registrationService.cancel(body?.taskId)
    writeJsonResponse(res, 200, { ok: true, ...result })
  })

  router.get('/api/registration/status', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...registrationService.status() })
  })

  return router
}
