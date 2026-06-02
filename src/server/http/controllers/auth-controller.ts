import { Router, writeJsonResponse } from '../router'
import type { AuthService } from '../../services/auth/auth-service'

// ============ 类型 ============

export interface AuthControllerDeps {
  authService: AuthService
}

// ============ Controller ============

/**
 * 认证相关 REST API 控制器。
 *
 * 提供 Builder ID、IAM SSO、Social Login、SSO Import 四种登录流程的接口。
 * 所有登录状态保存在 AuthService 内存中。
 */
export function createAuthRouter(deps: AuthControllerDeps): Router {
  const { authService } = deps
  const router = new Router()

  // ============ Builder ID ============

  // POST /api/auth/builder-id/start
  router.post('/api/auth/builder-id/start', async (_req, res, ctx) => {
    const body = (ctx.body || {}) as { region?: string }
    const result = await authService.startBuilderIdLogin(body.region)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  // POST /api/auth/builder-id/poll
  router.post('/api/auth/builder-id/poll', async (_req, res, ctx) => {
    const body = (ctx.body || {}) as { region?: string }
    const result = await authService.pollBuilderIdAuth(body.region)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  // POST /api/auth/builder-id/cancel
  router.post('/api/auth/builder-id/cancel', (_req, res) => {
    authService.cancelBuilderIdLogin()
    writeJsonResponse(res, 200, { ok: true })
  })

  // ============ IAM SSO ============

  // POST /api/auth/iam-sso/start
  router.post('/api/auth/iam-sso/start', async (_req, res, ctx) => {
    const body = (ctx.body || {}) as { startUrl?: string; region?: string }

    if (!body.startUrl) {
      writeJsonResponse(res, 400, { ok: false, error: '缺少 startUrl' })
      return
    }

    const result = await authService.startIamSsoLogin(body.startUrl, body.region)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  // POST /api/auth/iam-sso/poll
  router.post('/api/auth/iam-sso/poll', (_req, res) => {
    const result = authService.pollIamSsoAuth()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  // POST /api/auth/iam-sso/cancel
  router.post('/api/auth/iam-sso/cancel', async (_req, res) => {
    await authService.cancelIamSsoLogin()
    writeJsonResponse(res, 200, { ok: true })
  })

  // ============ Social Login ============

  // POST /api/auth/social/start
  router.post('/api/auth/social/start', async (_req, res, ctx) => {
    const body = (ctx.body || {}) as {
      provider?: 'Google' | 'Github'
      usePrivateMode?: boolean
    }

    if (!body.provider || (body.provider !== 'Google' && body.provider !== 'Github')) {
      writeJsonResponse(res, 400, { ok: false, error: 'provider 必须为 Google 或 Github' })
      return
    }

    const result = await authService.startSocialLogin(body.provider, body.usePrivateMode)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  // POST /api/auth/social/exchange
  router.post('/api/auth/social/exchange', async (_req, res, ctx) => {
    const body = (ctx.body || {}) as { code?: string; state?: string }

    if (!body.code || !body.state) {
      writeJsonResponse(res, 400, { ok: false, error: '缺少 code 或 state' })
      return
    }

    const result = await authService.exchangeSocialToken(body.code, body.state)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  // POST /api/auth/social/cancel
  router.post('/api/auth/social/cancel', (_req, res) => {
    authService.cancelSocialLogin()
    writeJsonResponse(res, 200, { ok: true })
  })

  // ============ SSO Import ============

  // POST /api/auth/sso-import
  router.post('/api/auth/sso-import', async (_req, res, ctx) => {
    const body = (ctx.body || {}) as { bearerToken?: string; region?: string }

    if (!body.bearerToken) {
      writeJsonResponse(res, 400, { ok: false, error: '缺少 bearerToken' })
      return
    }

    const result = await authService.importFromSsoToken(body.bearerToken, body.region)
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  return router
}
