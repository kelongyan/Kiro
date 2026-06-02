import { Router, writeJsonResponse } from '../router'
import type { AccountService } from '../../services/accounts/account-service'

// ============ 类型 ============

export interface AccountControllerDeps {
  accountService: AccountService
}

// ============ Controller ============

/**
 * 账号相关 REST API 控制器。
 *
 * 注册到已有 Router，提供账号 CRUD、刷新、批量操作、验证等接口。
 */
export function createAccountRouter(deps: AccountControllerDeps): Router {
  const { accountService } = deps
  const router = new Router()

  // GET /api/accounts - 加载账号数据
  router.get('/api/accounts', (_req, res) => {
    const data = accountService.loadAccounts()
    if (!data) {
      writeJsonResponse(res, 200, { ok: true, data: null })
      return
    }
    writeJsonResponse(res, 200, { ok: true, data })
  })

  // POST /api/accounts - 保存账号数据（完整覆盖）
  router.post('/api/accounts', (_req, res, ctx) => {
    const data = ctx.body
    if (!data || typeof data !== 'object') {
      writeJsonResponse(res, 400, { ok: false, error: '缺少账号数据' })
      return
    }
    accountService.saveAccounts(data as Parameters<AccountService['saveAccounts']>[0])
    writeJsonResponse(res, 200, { ok: true })
  })

  // POST /api/accounts/check-status - 检查单个账号状态（必要时自动刷新 token）
  router.post('/api/accounts/check-status', async (_req, res, ctx) => {
    const account = ctx.body
    if (!account || typeof account !== 'object') {
      writeJsonResponse(res, 400, { ok: false, error: '缺少账号数据' })
      return
    }

    const result = await accountService.checkAccountStatus(
      account as Parameters<AccountService['checkAccountStatus']>[0]
    )

    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  // POST /api/accounts/refresh - 刷新单个账号 token
  router.post('/api/accounts/refresh', async (_req, res, ctx) => {
    const account = ctx.body as {
      id?: string
      credentials?: {
        refreshToken?: string
        clientId?: string
        clientSecret?: string
        region?: string
        authMethod?: string
        provider?: string
      }
    }

    if (!account?.credentials?.refreshToken) {
      writeJsonResponse(res, 400, { ok: false, error: '缺少 refreshToken' })
      return
    }

    const result = await accountService.refreshToken({
      id: account.id,
      credentials: {
        refreshToken: account.credentials.refreshToken,
        clientId: account.credentials.clientId,
        clientSecret: account.credentials.clientSecret,
        region: account.credentials.region,
        authMethod: account.credentials.authMethod,
        provider: account.credentials.provider
      }
    })

    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  // POST /api/accounts/batch-refresh - 批量刷新
  router.post('/api/accounts/batch-refresh', async (_req, res, ctx) => {
    const body = ctx.body as {
      accounts?: Array<{
        id: string
        email?: string
        idp?: string
        needsTokenRefresh?: boolean
        machineId?: string
        refreshToken: string
        clientId?: string
        clientSecret?: string
        region?: string
        authMethod?: string
        provider?: string
        accessToken?: string
        credentials?: {
          refreshToken: string
          clientId?: string
          clientSecret?: string
          region?: string
          authMethod?: string
          accessToken?: string
          provider?: string
        }
      }>
      concurrency?: number
      syncInfo?: boolean
    }

    if (!body?.accounts || !Array.isArray(body.accounts)) {
      writeJsonResponse(res, 400, { ok: false, error: '缺少 accounts 数组' })
      return
    }

    const result = await accountService.batchRefresh(
      body.accounts.map((account) => ({
        id: account.id,
        email: account.email,
        idp: account.idp,
        needsTokenRefresh: account.needsTokenRefresh,
        machineId: account.machineId,
        credentials: account.credentials ?? {
          refreshToken: account.refreshToken,
          clientId: account.clientId,
          clientSecret: account.clientSecret,
          region: account.region,
          authMethod: account.authMethod,
          accessToken: account.accessToken,
          provider: account.provider
        }
      })),
      body.concurrency,
      body.syncInfo
    )

    writeJsonResponse(res, 200, { ok: true, ...result })
  })

  // POST /api/accounts/batch-check - 批量检查状态
  router.post('/api/accounts/batch-check', async (_req, res, ctx) => {
    const body = ctx.body as {
      accounts?: Array<{
        id: string
        email?: string
        accessToken: string
        idp: string
        region?: string
        refreshToken?: string
        clientId?: string
        clientSecret?: string
        authMethod?: string
        provider?: string
        credentials?: {
          accessToken: string
          refreshToken?: string
          clientId?: string
          clientSecret?: string
          region?: string
          authMethod?: string
          provider?: string
        }
      }>
      concurrency?: number
    }

    if (!body?.accounts || !Array.isArray(body.accounts)) {
      writeJsonResponse(res, 400, { ok: false, error: '缺少 accounts 数组' })
      return
    }

    const result = await accountService.batchCheck(
      body.accounts.map((account) => ({
        id: account.id,
        email: account.email || '',
        idp: account.idp,
        credentials: account.credentials ?? {
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
          clientId: account.clientId,
          clientSecret: account.clientSecret,
          region: account.region,
          authMethod: account.authMethod,
          provider: account.provider
        }
      })),
      body.concurrency
    )

    writeJsonResponse(res, 200, { ok: true, ...result })
  })

  // POST /api/accounts/verify - 验证凭证
  router.post('/api/accounts/verify', async (_req, res, ctx) => {
    const creds = ctx.body as {
      refreshToken?: string
      clientId?: string
      clientSecret?: string
      region?: string
      authMethod?: string
      provider?: string
    }

    if (!creds?.refreshToken) {
      writeJsonResponse(res, 400, { ok: false, error: '缺少 refreshToken' })
      return
    }

    const result = await accountService.verifyCredentials({
      refreshToken: creds.refreshToken,
      clientId: creds.clientId || '',
      clientSecret: creds.clientSecret || '',
      region: creds.region,
      authMethod: creds.authMethod,
      provider: creds.provider
    })

    writeJsonResponse(res, 200, { ok: result.success, ...result })
  })

  return router
}
