import { Router, writeJsonResponse } from '../router'
import type { DeviceIdMapping, KProxyConfig } from '../../../main/kproxy'
import type { KProxyManagementService } from '../../services/kproxy/kproxy-service'

export interface KProxyControllerDeps {
  kproxyService: KProxyManagementService
}

function readObjectBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

export function createKProxyRouter(deps: KProxyControllerDeps): Router {
  const { kproxyService } = deps
  const router = new Router()

  router.get('/api/kproxy/status', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...kproxyService.getStatus() })
  })

  router.post('/api/kproxy/init', async (_req, res) => {
    const result = await kproxyService.initialize()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kproxy/start', async (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const config = (body.config || body) as Partial<KProxyConfig>
    const result = await kproxyService.start(Object.keys(config).length > 0 ? config : undefined)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kproxy/stop', async (_req, res) => {
    const result = await kproxyService.stop()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kproxy/config', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const config = (body.config || body) as Partial<KProxyConfig>
    const result = kproxyService.updateConfig(config)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kproxy/device-id', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    if (typeof body.deviceId !== 'string') {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少 deviceId' })
      return
    }
    const result = kproxyService.setDeviceId(body.deviceId)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.get('/api/kproxy/device-id/random', (_req, res) => {
    const result = kproxyService.generateDeviceId()
    writeJsonResponse(res, 200, { ok: true, ...result })
  })

  router.get('/api/kproxy/device-mappings', (_req, res) => {
    const result = kproxyService.getDeviceMappings()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kproxy/device-mappings', (_req, res, ctx) => {
    const mapping = readObjectBody(ctx.body) as unknown as DeviceIdMapping
    if (!mapping.accountId || !mapping.deviceId) {
      writeJsonResponse(res, 400, {
        ok: false,
        success: false,
        error: '缺少 accountId 或 deviceId'
      })
      return
    }
    const result = kproxyService.addDeviceMapping(mapping)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kproxy/device-mappings/switch', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    if (typeof body.accountId !== 'string') {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少 accountId' })
      return
    }
    const result = kproxyService.switchToAccount(body.accountId)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.get('/api/kproxy/ca-cert', (_req, res) => {
    const result = kproxyService.getCaCert()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kproxy/ca-cert/export', async (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const result = await kproxyService.exportCaCert(
      typeof body.exportPath === 'string' ? body.exportPath : undefined
    )
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.get('/api/kproxy/ca-cert/installed', async (_req, res) => {
    const result = await kproxyService.checkCaCertInstalled()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kproxy/ca-cert/install', async (_req, res) => {
    const result = await kproxyService.installCaCert()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kproxy/ca-cert/uninstall', async (_req, res) => {
    const result = await kproxyService.uninstallCaCert()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/kproxy/stats/reset', (_req, res) => {
    const result = kproxyService.resetStats()
    writeJsonResponse(res, 200, { ok: true, ...result })
  })

  return router
}
