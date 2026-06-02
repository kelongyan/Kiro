import { Router, writeJsonResponse } from '../router'
import type {
  KiroSettingsService,
  McpServerConfig
} from '../../services/kiro-settings/kiro-settings-service'

export interface KiroSettingsControllerDeps {
  kiroSettingsService: KiroSettingsService
}

export function createKiroSettingsRouter(deps: KiroSettingsControllerDeps): Router {
  const { kiroSettingsService } = deps
  const router = new Router()

  router.get('/api/kiro-settings', async (_req, res) => {
    const data = await kiroSettingsService.readSettings()
    writeJsonResponse(res, 200, { ok: true, ...data })
  })

  router.post('/api/kiro-settings', async (_req, res, ctx) => {
    const settings = ctx.body
    if (!settings || typeof settings !== 'object') {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少 settings' })
      return
    }

    const result = await kiroSettingsService.saveSettings(settings as Record<string, unknown>)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.get('/api/kiro-settings/models', async (_req, res) => {
    const result = await kiroSettingsService.availableModels()
    writeJsonResponse(res, 200, { ok: !result.error, ...result })
  })

  router.post('/api/kiro-settings/open/mcp-config', async (_req, res, ctx) => {
    const body = ctx.body as { type?: 'user' | 'workspace' } | undefined
    const result = await kiroSettingsService.openMcpConfig(body?.type || 'user')
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kiro-settings/open/steering-folder', async (_req, res) => {
    const result = await kiroSettingsService.openSteeringFolder()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kiro-settings/open/settings-file', async (_req, res) => {
    const result = await kiroSettingsService.openSettingsFile()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kiro-settings/open/steering-file', async (_req, res, ctx) => {
    const body = ctx.body as { filename?: string } | undefined
    if (!body?.filename) {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少 filename' })
      return
    }

    const result = await kiroSettingsService.openSteeringFile(body.filename)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kiro-settings/default-rules', async (_req, res) => {
    const result = await kiroSettingsService.createDefaultRules()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.get('/api/kiro-settings/steering/:filename', (_req, res, ctx) => {
    const result = kiroSettingsService.readSteeringFile(ctx.params.filename)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kiro-settings/steering/:filename', (_req, res, ctx) => {
    const body = ctx.body as { content?: string } | undefined
    if (typeof body?.content !== 'string') {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少 content' })
      return
    }

    const result = kiroSettingsService.saveSteeringFile(ctx.params.filename, body.content)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.delete('/api/kiro-settings/steering/:filename', (_req, res, ctx) => {
    const result = kiroSettingsService.deleteSteeringFile(ctx.params.filename)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kiro-settings/mcp', (_req, res, ctx) => {
    const body = ctx.body as
      | { name?: string; config?: McpServerConfig; oldName?: string }
      | undefined
    if (!body?.name || !body.config) {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少 name 或 config' })
      return
    }

    const result = kiroSettingsService.saveMcpServer(body.name, body.config, body.oldName)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.delete('/api/kiro-settings/mcp/:name', (_req, res, ctx) => {
    const result = kiroSettingsService.deleteMcpServer(ctx.params.name)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  return router
}
