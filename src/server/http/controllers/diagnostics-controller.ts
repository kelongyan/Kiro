import { Router, writeJsonResponse } from '../router'
import type {
  DiagnosticsHttpProbeInput,
  DiagnosticsRunInput,
  DiagnosticsService,
  ProxyPoolValidateInput
} from '../../services/diagnostics/diagnostics-service'

export interface DiagnosticsControllerDeps {
  diagnosticsService: DiagnosticsService
}

function readObjectBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

export function createDiagnosticsRouter(deps: DiagnosticsControllerDeps): Router {
  const { diagnosticsService } = deps
  const router = new Router()

  router.post('/api/diagnostics/run', async (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const targets = Array.isArray(body.targets) ? body.targets : []
    const result = await diagnosticsService.run({
      proxyUrl: typeof body.proxyUrl === 'string' ? body.proxyUrl : undefined,
      targets: targets as DiagnosticsRunInput['targets']
    })
    writeJsonResponse(res, 200, { ok: true, ...result })
  })

  router.post('/api/diagnostics/http-probe', async (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const result = await diagnosticsService.httpProbe(body as unknown as DiagnosticsHttpProbeInput)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/diagnostics/proxy-pool/validate', async (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const result = await diagnosticsService.validateProxy(body as unknown as ProxyPoolValidateInput)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  return router
}
