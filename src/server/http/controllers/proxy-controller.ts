import { Router, writeJsonResponse } from '../router'
import type { ProxyService } from '../../services/proxy/proxy-service'
import type {
  ApiKey,
  ProxyAccount,
  ProxyClientModel,
  ProxyClientTarget,
  ProxyConfig
} from '../../../core/proxy'

export interface ProxyControllerDeps {
  proxyService: ProxyService
}

function readObjectBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true'
}

export function createProxyRouter(deps: ProxyControllerDeps): Router {
  const { proxyService } = deps
  const router = new Router()

  router.get('/api/proxy/status', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...proxyService.getStatus() })
  })

  router.get('/api/proxy/dashboard', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, dashboard: proxyService.getDashboard() })
  })

  router.post('/api/proxy/start', async (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const result = await proxyService.start(body.config as Partial<ProxyConfig> | undefined)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/proxy/stop', async (_req, res) => {
    const result = await proxyService.stop()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/proxy/restart', async (_req, res) => {
    const result = await proxyService.restart()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.get('/api/proxy/needs-restart', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...proxyService.needsRestart() })
  })

  router.post('/api/proxy/config', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const config = (body.config || body) as Partial<ProxyConfig>
    const result = proxyService.updateConfig(config)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/proxy/reset-credits', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...proxyService.resetCredits() })
  })

  router.post('/api/proxy/reset-tokens', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...proxyService.resetTokens() })
  })

  router.post('/api/proxy/reset-request-stats', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...proxyService.resetRequestStats() })
  })

  router.get('/api/proxy/logs', (_req, res, ctx) => {
    const countParam = ctx.query.get('count')
    const count = countParam ? Number(countParam) : undefined
    writeJsonResponse(res, 200, {
      ok: true,
      logs: proxyService.getLogs(Number.isFinite(count) ? count : undefined)
    })
  })

  router.delete('/api/proxy/logs', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...proxyService.clearLogs() })
  })

  router.get('/api/proxy/logs/count', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...proxyService.getLogsCount() })
  })

  router.get('/api/proxy/usage-api-type', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, type: proxyService.getUsageApiType() })
  })

  router.post('/api/proxy/usage-api-type', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const type = body.type === 'cbor' ? 'cbor' : 'rest'
    writeJsonResponse(res, 200, { ok: true, ...proxyService.setUsageApiType(type) })
  })

  router.get('/api/proxy/use-kproxy-for-api', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, enabled: proxyService.getUseKProxyForApi() })
  })

  router.post('/api/proxy/use-kproxy-for-api', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    writeJsonResponse(res, 200, {
      ok: true,
      ...proxyService.setUseKProxyForApi(readBoolean(body.enabled))
    })
  })

  router.get('/api/proxy/self-signed-cert', (_req, res) => {
    const result = proxyService.getSelfSignedCertInfo()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/proxy/self-signed-cert/regenerate', (_req, res) => {
    const result = proxyService.regenerateSelfSignedCert()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.get('/api/proxy/audit-log', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...proxyService.getAuditLog() })
  })

  router.get('/api/proxy/api-keys', (_req, res) => {
    const result = proxyService.getApiKeys()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/proxy/api-keys', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body) as {
      name?: string
      key?: string
      format?: ApiKey['format']
      creditsLimit?: number
      modelAllowlist?: string[]
      accountAllowlist?: string[]
    }
    if (!body.name) {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少 name' })
      return
    }
    const result = proxyService.addApiKey({
      name: body.name,
      key: body.key,
      format: body.format,
      creditsLimit: body.creditsLimit,
      modelAllowlist: body.modelAllowlist,
      accountAllowlist: body.accountAllowlist
    })
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.put('/api/proxy/api-keys/:id', (_req, res, ctx) => {
    const result = proxyService.updateApiKey(
      ctx.params.id,
      readObjectBody(ctx.body) as Partial<ApiKey>
    )
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.delete('/api/proxy/api-keys/:id', (_req, res, ctx) => {
    const result = proxyService.deleteApiKey(ctx.params.id)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/proxy/api-keys/:id/reset-usage', (_req, res, ctx) => {
    const result = proxyService.resetApiKeyUsage(ctx.params.id)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.get('/api/proxy/accounts', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...proxyService.getAccounts() })
  })

  router.post('/api/proxy/accounts', (_req, res, ctx) => {
    const result = proxyService.addAccount(readObjectBody(ctx.body) as unknown as ProxyAccount)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.delete('/api/proxy/accounts/:id', (_req, res, ctx) => {
    const result = proxyService.removeAccount(ctx.params.id)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/proxy/accounts/sync', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const accounts = Array.isArray(body.accounts) ? body.accounts : []
    const result = proxyService.syncAccounts(accounts as ProxyAccount[])
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/proxy/accounts/reset-pool', (_req, res) => {
    const result = proxyService.resetPool()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/proxy/accounts/:id/clear-suspended', (_req, res, ctx) => {
    const result = proxyService.clearAccountSuspended(ctx.params.id)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/proxy/accounts/:id/proxy-binding', (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const result = proxyService.setAccountProxyBinding(
      ctx.params.id,
      typeof body.proxyUrl === 'string' ? body.proxyUrl : undefined
    )
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/proxy/models/refresh', (_req, res) => {
    const result = proxyService.refreshModels()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.get('/api/proxy/models', async (_req, res) => {
    const result = await proxyService.getModels()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/proxy/configure-clients', async (_req, res, ctx) => {
    const body = readObjectBody(ctx.body) as {
      clients?: ProxyClientTarget[]
      modelId?: string
      modelName?: string
      models?: ProxyClientModel[]
    }
    if (!body.clients || !body.modelId) {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少 clients 或 modelId' })
      return
    }
    const result = await proxyService.configureClients({
      clients: body.clients,
      modelId: body.modelId,
      modelName: body.modelName,
      models: body.models
    })
    writeJsonResponse(res, 200, { ok: result.success === true, ...result })
  })

  return router
}
