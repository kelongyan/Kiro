import { Router, writeJsonResponse } from '../router'
import type {
  ConfigSyncExportOptions,
  ConfigSyncImportOptions,
  ConfigSyncService,
  PortableConfig
} from '../../services/config-sync/config-sync-service'

export interface ConfigSyncControllerDeps {
  configSyncService: ConfigSyncService
}

function readObjectBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

export function createConfigSyncRouter(deps: ConfigSyncControllerDeps): Router {
  const { configSyncService } = deps
  const router = new Router()

  router.get('/api/config-sync/health', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...configSyncService.health() })
  })

  router.post('/api/config-sync/export', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const result = configSyncService.exportConfig(
      readObjectBody(body.options) as ConfigSyncExportOptions
    )
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/config-sync/import', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const config = body.config || body
    const result = configSyncService.importConfig(
      config as PortableConfig,
      readObjectBody(body.options) as ConfigSyncImportOptions
    )
    writeJsonResponse(res, result.success ? 200 : 400, { ok: result.success, ...result })
  })

  return router
}
