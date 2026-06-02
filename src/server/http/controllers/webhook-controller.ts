import { Router, writeJsonResponse } from '../router'
import type {
  WebhookEntry,
  WebhookEvent,
  WebhookMessage,
  WebhookService
} from '../../services/webhooks/webhook-service'

export interface WebhookControllerDeps {
  webhookService: WebhookService
}

function readObjectBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

export function createWebhookRouter(deps: WebhookControllerDeps): Router {
  const { webhookService } = deps
  const router = new Router()

  router.get('/api/webhooks/health', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...webhookService.health() })
  })

  router.get('/api/webhooks', (_req, res) => {
    const result = webhookService.list()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/webhooks', (_req, res, ctx) => {
    const result = webhookService.add(
      readObjectBody(ctx.body) as Omit<WebhookEntry, 'id' | 'createdAt'>
    )
    writeJsonResponse(res, result.success ? 200 : 400, { ok: result.success, ...result })
  })

  router.put('/api/webhooks/:id', (_req, res, ctx) => {
    const result = webhookService.update(
      ctx.params.id,
      readObjectBody(ctx.body) as Partial<Omit<WebhookEntry, 'id' | 'createdAt'>>
    )
    writeJsonResponse(res, result.success ? 200 : 404, { ok: result.success, ...result })
  })

  router.delete('/api/webhooks/:id', (_req, res, ctx) => {
    const result = webhookService.remove(ctx.params.id)
    writeJsonResponse(res, result.success ? 200 : 404, { ok: result.success, ...result })
  })

  router.post('/api/webhooks/:id/toggle', (_req, res, ctx) => {
    const result = webhookService.toggle(ctx.params.id)
    writeJsonResponse(res, result.success ? 200 : 404, { ok: result.success, ...result })
  })

  router.post('/api/webhooks/:id/test', async (_req, res, ctx) => {
    const result = await webhookService.test(ctx.params.id)
    writeJsonResponse(res, result.success ? 200 : 404, { ok: result.success, ...result })
  })

  router.post('/api/webhooks/trigger', async (_req, res, ctx) => {
    const body = readObjectBody(ctx.body) as {
      event?: WebhookEvent
      payload?: WebhookMessage
    }
    if (!body.event || !body.payload) {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少 event 或 payload' })
      return
    }

    const result = await webhookService.trigger(body.event, body.payload)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  return router
}
