import { Router, writeJsonResponse } from '../router'
import type {
  ProxyEntry,
  ProxyPoolConfig,
  ProxyPoolService
} from '../../services/proxy-pool/proxy-pool-service'

export interface ProxyPoolControllerDeps {
  proxyPoolService: ProxyPoolService
}

function readObjectBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export function createProxyPoolRouter(deps: ProxyPoolControllerDeps): Router {
  const { proxyPoolService } = deps
  const router = new Router()

  router.get('/api/proxy-pool', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...proxyPoolService.getSnapshot() })
  })

  router.post('/api/proxy-pool/import', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const result = proxyPoolService.importProxies(typeof body.text === 'string' ? body.text : '')
    writeJsonResponse(res, 200, { ok: true, ...result, snapshot: proxyPoolService.getSnapshot() })
  })

  router.post('/api/proxy-pool/config', (_req, res, ctx) => {
    const config = proxyPoolService.updateConfig(
      readObjectBody(ctx.body) as Partial<ProxyPoolConfig>
    )
    writeJsonResponse(res, 200, { ok: true, config })
  })

  router.put('/api/proxy-pool/proxies/:id', (_req, res, ctx) => {
    const proxy = proxyPoolService.updateProxy(
      ctx.params.id,
      readObjectBody(ctx.body) as Partial<ProxyEntry>
    )
    if (!proxy) {
      writeJsonResponse(res, 404, { ok: false, success: false, error: 'Proxy not found' })
      return
    }
    writeJsonResponse(res, 200, { ok: true, success: true, proxy })
  })

  router.delete('/api/proxy-pool/proxies/:id', (_req, res, ctx) => {
    const success = proxyPoolService.removeProxy(ctx.params.id)
    writeJsonResponse(res, 200, { ok: true, success })
  })

  router.post('/api/proxy-pool/proxies/:id/toggle', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const proxy = proxyPoolService.toggleProxyEnabled(
      ctx.params.id,
      typeof body.enabled === 'boolean' ? body.enabled : undefined
    )
    if (!proxy) {
      writeJsonResponse(res, 404, { ok: false, success: false, error: 'Proxy not found' })
      return
    }
    writeJsonResponse(res, 200, { ok: true, success: true, proxy })
  })

  router.post('/api/proxy-pool/proxies/:id/validate', async (_req, res, ctx) => {
    const result = await proxyPoolService.validateProxy(ctx.params.id)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/proxy-pool/validate', async (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const ids = readStringArray(body.ids)
    const concurrency =
      typeof body.concurrency === 'number' && Number.isFinite(body.concurrency)
        ? body.concurrency
        : 5
    await proxyPoolService.validateProxiesBatch(ids, concurrency)
    writeJsonResponse(res, 200, { ok: true, snapshot: proxyPoolService.getSnapshot() })
  })

  router.post('/api/proxy-pool/accounts/:accountId/binding', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const proxyId = typeof body.proxyId === 'string' ? body.proxyId : ''
    if (!proxyId) {
      writeJsonResponse(res, 400, { ok: false, success: false, error: 'Missing proxyId' })
      return
    }
    const result = proxyPoolService.bindAccountToProxy(ctx.params.accountId, proxyId)
    writeJsonResponse(res, result.success ? 200 : 404, { ok: result.success, ...result })
  })

  router.delete('/api/proxy-pool/accounts/:accountId/binding', (_req, res, ctx) => {
    const result = proxyPoolService.unbindAccountFromProxy(ctx.params.accountId)
    writeJsonResponse(res, 200, { ok: true, ...result })
  })

  router.post('/api/proxy-pool/accounts/bind', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const accountIds = readStringArray(body.accountIds)
    const proxyId = typeof body.proxyId === 'string' ? body.proxyId : ''
    if (!proxyId) {
      writeJsonResponse(res, 400, { ok: false, success: false, error: 'Missing proxyId' })
      return
    }
    const result = proxyPoolService.bindAccountsToProxy(accountIds, proxyId)
    writeJsonResponse(res, result.success ? 200 : 404, { ok: result.success, ...result })
  })

  router.delete('/api/proxy-pool/accounts/bindings', (_req, res) => {
    const result = proxyPoolService.clearAccountProxyBindings()
    writeJsonResponse(res, 200, { ok: true, ...result })
  })

  router.get('/api/proxy-pool/accounts/:accountId/proxy-url', (_req, res, ctx) => {
    writeJsonResponse(res, 200, {
      ok: true,
      proxyUrl: proxyPoolService.getAccountProxyUrl(ctx.params.accountId)
    })
  })

  return router
}
