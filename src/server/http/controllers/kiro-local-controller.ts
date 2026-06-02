import { Router, writeJsonResponse } from '../router'
import type { KiroLocalService } from '../../services/kiro-local/kiro-local-service'

export interface KiroLocalControllerDeps {
  kiroLocalService: KiroLocalService
}

export function createKiroLocalRouter(deps: KiroLocalControllerDeps): Router {
  const { kiroLocalService } = deps
  const router = new Router()

  // GET /api/kiro-local/active-account - 读取本地 Kiro SSO 缓存中的当前账号
  router.get('/api/kiro-local/active-account', async (_req, res) => {
    const result = await kiroLocalService.getLocalActiveAccount()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  // GET /api/kiro-local/credentials - 从 Kiro 本地配置导入凭证
  router.get('/api/kiro-local/credentials', async (_req, res) => {
    const result = await kiroLocalService.loadKiroCredentials()
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  // POST /api/kiro-local/switch-account - 切换 Kiro IDE 当前账号
  router.post('/api/kiro-local/switch-account', async (_req, res, ctx) => {
    const credentials = ctx.body
    if (!credentials || typeof credentials !== 'object') {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少账号凭证' })
      return
    }

    const result = await kiroLocalService.switchAccount(
      credentials as Parameters<KiroLocalService['switchAccount']>[0]
    )
    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  // POST /api/kiro-local/switch-account-cli - 切换 Kiro CLI 当前账号
  router.post('/api/kiro-local/switch-account-cli', async (_req, res, ctx) => {
    const credentials = ctx.body
    if (!credentials || typeof credentials !== 'object') {
      writeJsonResponse(res, 400, { ok: false, success: false, error: '缺少账号凭证' })
      return
    }

    const result = await kiroLocalService.switchAccountCli(
      credentials as Parameters<KiroLocalService['switchAccountCli']>[0]
    )
    writeJsonResponse(res, 200, {
      ok: result.success,
      success: result.success,
      dbPath: result.data?.dbPath,
      error: result.error
    })
  })

  // POST /api/kiro-local/logout - 清除本地 Kiro SSO 缓存
  router.post('/api/kiro-local/logout', async (_req, res) => {
    const result = await kiroLocalService.logoutAccount()
    writeJsonResponse(res, 200, {
      ok: result.success,
      success: result.success,
      deletedCount: result.data?.deletedCount,
      error: result.error
    })
  })

  return router
}
