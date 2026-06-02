import { Router, writeJsonResponse } from '../router'
import type {
  SubscriptionAccountInput,
  SubscriptionService
} from '../../services/subscriptions/subscription-service'

export interface SubscriptionControllerDeps {
  subscriptionService: SubscriptionService
}

function readObjectBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

function readAccountInput(body: Record<string, unknown>): SubscriptionAccountInput {
  return {
    accessToken: typeof body.accessToken === 'string' ? body.accessToken : '',
    region: typeof body.region === 'string' ? body.region : undefined,
    profileArn: typeof body.profileArn === 'string' ? body.profileArn : undefined,
    machineId: typeof body.machineId === 'string' ? body.machineId : undefined,
    provider: typeof body.provider === 'string' ? body.provider : undefined,
    authMethod: typeof body.authMethod === 'string' ? body.authMethod : undefined,
    accountId: typeof body.accountId === 'string' ? body.accountId : undefined
  }
}

export function createSubscriptionRouter(deps: SubscriptionControllerDeps): Router {
  const { subscriptionService } = deps
  const router = new Router()

  router.get('/api/subscriptions/health', (_req, res) => {
    writeJsonResponse(res, 200, { ok: true, ...subscriptionService.health() })
  })

  router.post('/api/subscriptions/plans', async (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const result = await subscriptionService.getSubscriptions(readAccountInput(body))
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/subscriptions/url', async (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const result = await subscriptionService.getSubscriptionUrl(
      readAccountInput(body),
      typeof body.subscriptionType === 'string' ? body.subscriptionType : undefined
    )
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/subscriptions/overage', async (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const overageStatus = body.overageStatus === 'DISABLED' ? 'DISABLED' : 'ENABLED'
    const result = await subscriptionService.setOverage(readAccountInput(body), overageStatus)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  router.post('/api/subscriptions/open', async (_req, res, ctx) => {
    const body = readObjectBody(ctx.body)
    const result = await subscriptionService.openSubscriptionWindow(
      typeof body.url === 'string' ? body.url : ''
    )
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  return router
}
