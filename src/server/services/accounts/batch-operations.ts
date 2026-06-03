import { refreshTokenByMethod, type TokenRefreshDeps } from './token-refresh'

// ============ 类型 ============

export interface BatchRefreshAccount {
  id: string
  email?: string
  idp?: string
  needsTokenRefresh?: boolean
  machineId?: string
  credentials: {
    refreshToken: string
    clientId?: string
    clientSecret?: string
    region?: string
    authMethod?: string
    accessToken?: string
    provider?: string
  }
}

export interface BatchCheckAccount {
  id: string
  email: string
  machineId?: string
  credentials: {
    accessToken: string
    refreshToken?: string
    clientId?: string
    clientSecret?: string
    region?: string
    authMethod?: string
    provider?: string
  }
  idp?: string
}

export interface BatchResult {
  success: boolean
  completed: number
  successCount: number
  failedCount: number
}

export interface AccountCheckResult {
  success: boolean
  usage?: Record<string, unknown>
  userInfo?: Record<string, unknown>
  subscription?: Record<string, unknown>
  status?: string
  error?: string
}

interface UsageBreakdownItem {
  resourceType?: string
  displayName?: string
  displayNamePlural?: string
  usageLimit?: number
  usageLimitWithPrecision?: number
  currentUsage?: number
  currentUsageWithPrecision?: number
  currency?: string
  unit?: string
  overageRate?: number
  overageCap?: number
  freeTrialInfo?: {
    freeTrialStatus?: string
    usageLimit?: number
    usageLimitWithPrecision?: number
    currentUsage?: number
    currentUsageWithPrecision?: number
    freeTrialExpiry?: string
  }
  bonuses?: Array<{
    bonusCode?: string
    displayName?: string
    usageLimit?: number
    usageLimitWithPrecision?: number
    currentUsage?: number
    currentUsageWithPrecision?: number
    expiresAt?: string
    status?: string
  }>
}

interface UsageApiResponse {
  usageBreakdownList?: UsageBreakdownItem[]
  nextDateReset?: string
  subscriptionInfo?: {
    subscriptionTitle?: string
    type?: string
    overageCapability?: string
    upgradeCapability?: string
    subscriptionManagementTarget?: string
  }
  overageConfiguration?: {
    overageStatus?: string
    overageEnabled?: boolean
    overageLimit?: number | null
  }
}

interface BackgroundAccountData {
  usage?: {
    current: number
    limit: number
    baseCurrent: number
    baseLimit: number
    freeTrialCurrent: number
    freeTrialLimit: number
    freeTrialExpiry?: string
    bonuses: Array<{
      code: string
      name: string
      current: number
      limit: number
      expiresAt?: string
    }>
    nextResetDate?: string
    resourceDetail?: {
      displayName?: string
      displayNamePlural?: string
      resourceType?: string
      currency?: string
      unit?: string
      overageRate?: number
      overageCap?: number
      overageEnabled?: boolean
    }
  }
  subscription?: {
    type: string
    title: string
    daysRemaining?: number
    expiresAt?: number
    overageCapability?: string
    upgradeCapability?: string
    subscriptionManagementTarget?: string
  }
  userInfo?: {
    email?: string
    userId?: string
    status?: string
  }
  status: string
  errorMessage?: string
}

// ============ 依赖注入 ============

export interface BatchOperationDeps {
  /** Token 刷新依赖 */
  tokenRefreshDeps: TokenRefreshDeps
  /** 获取账号绑定的代理 URL */
  getAccountProxyUrl?: (accountId: string) => string | undefined
  /** 检查账号状态（调用 Kiro API 获取用量/用户信息） */
  checkAccount: (
    accessToken: string,
    idp: string,
    machineId?: string,
    region?: string,
    email?: string,
    proxyUrl?: string
  ) => Promise<AccountCheckResult>
  /** 发布事件（进度/结果） */
  emitEvent: (type: string, payload: unknown) => void
}

function normalizeSubscriptionTitle(subscriptionTitle: string): string {
  const titleUpper = subscriptionTitle.toUpperCase()
  if (
    titleUpper.includes('PRO+') ||
    titleUpper.includes('PRO_PLUS') ||
    titleUpper.includes('PROPLUS')
  ) {
    return 'Pro_Plus'
  }
  if (titleUpper.includes('POWER')) return 'Enterprise'
  if (titleUpper.includes('PRO')) return 'Pro'
  if (titleUpper.includes('ENTERPRISE')) return 'Enterprise'
  if (titleUpper.includes('TEAMS')) return 'Teams'
  return 'Free'
}

function mapCheckError(error?: string): { status: string; errorMessage?: string } {
  if (!error) return { status: 'error' }
  if (error.includes('401')) {
    return { status: 'expired', errorMessage: 'Token 已过期，请刷新' }
  }
  return { status: 'error', errorMessage: error }
}

function normalizeCheckResult(checkResult?: AccountCheckResult): BackgroundAccountData {
  if (!checkResult) {
    return { status: 'active' }
  }

  if (!checkResult.success) {
    return mapCheckError(checkResult.error)
  }

  const usageRaw = checkResult.usage as UsageApiResponse | undefined
  const userInfoRaw = checkResult.userInfo as
    | {
        email?: string
        userId?: string
        status?: string
      }
    | undefined

  let status = checkResult.status || 'active'
  let errorMessage = checkResult.error

  if (
    userInfoRaw?.status &&
    userInfoRaw.status !== 'Active' &&
    userInfoRaw.status !== 'Stale' &&
    status !== 'error'
  ) {
    status = 'error'
    errorMessage = `用户状态异常: ${userInfoRaw.status}`
  }

  if (!usageRaw) {
    return {
      userInfo: userInfoRaw,
      subscription: checkResult.subscription as BackgroundAccountData['subscription'],
      status,
      errorMessage
    }
  }

  const creditUsage = usageRaw.usageBreakdownList?.find(
    (item) => item.resourceType === 'CREDIT' || item.displayName === 'Credits'
  )
  const baseCurrent = creditUsage?.currentUsageWithPrecision ?? creditUsage?.currentUsage ?? 0
  const baseLimit = creditUsage?.usageLimitWithPrecision ?? creditUsage?.usageLimit ?? 0

  let freeTrialCurrent = 0
  let freeTrialLimit = 0
  let freeTrialExpiry: string | undefined
  if (creditUsage?.freeTrialInfo?.freeTrialStatus === 'ACTIVE') {
    freeTrialCurrent =
      creditUsage.freeTrialInfo.currentUsageWithPrecision ??
      creditUsage.freeTrialInfo.currentUsage ??
      0
    freeTrialLimit =
      creditUsage.freeTrialInfo.usageLimitWithPrecision ?? creditUsage.freeTrialInfo.usageLimit ?? 0
    freeTrialExpiry = creditUsage.freeTrialInfo.freeTrialExpiry
  }

  const bonuses: Array<{
    code: string
    name: string
    current: number
    limit: number
    expiresAt?: string
  }> = []
  if (creditUsage?.bonuses) {
    for (const bonus of creditUsage.bonuses) {
      if (bonus.status === 'ACTIVE') {
        bonuses.push({
          code: bonus.bonusCode || '',
          name: bonus.displayName || '',
          current: bonus.currentUsageWithPrecision ?? bonus.currentUsage ?? 0,
          limit: bonus.usageLimitWithPrecision ?? bonus.usageLimit ?? 0,
          expiresAt: bonus.expiresAt
        })
      }
    }
  }

  const totalLimit = baseLimit + freeTrialLimit + bonuses.reduce((sum, item) => sum + item.limit, 0)
  const totalCurrent =
    baseCurrent + freeTrialCurrent + bonuses.reduce((sum, item) => sum + item.current, 0)

  const subscriptionTitle = usageRaw.subscriptionInfo?.subscriptionTitle || 'Free'
  let daysRemaining: number | undefined
  let expiresAt: number | undefined
  if (usageRaw.nextDateReset) {
    expiresAt = new Date(usageRaw.nextDateReset).getTime()
    daysRemaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24)))
  }

  return {
    usage: {
      current: totalCurrent,
      limit: totalLimit,
      baseCurrent,
      baseLimit,
      freeTrialCurrent,
      freeTrialLimit,
      freeTrialExpiry,
      bonuses,
      nextResetDate: usageRaw.nextDateReset,
      resourceDetail: creditUsage
        ? {
            displayName: creditUsage.displayName,
            displayNamePlural: creditUsage.displayNamePlural,
            resourceType: creditUsage.resourceType,
            currency: creditUsage.currency,
            unit: creditUsage.unit,
            overageRate: creditUsage.overageRate,
            overageCap: creditUsage.overageCap,
            overageEnabled:
              usageRaw.overageConfiguration?.overageStatus === 'ENABLED' ||
              usageRaw.overageConfiguration?.overageEnabled === true
          }
        : undefined
    },
    subscription: {
      type: normalizeSubscriptionTitle(subscriptionTitle),
      title: subscriptionTitle,
      daysRemaining,
      expiresAt,
      overageCapability: usageRaw.subscriptionInfo?.overageCapability,
      upgradeCapability: usageRaw.subscriptionInfo?.upgradeCapability,
      subscriptionManagementTarget: usageRaw.subscriptionInfo?.subscriptionManagementTarget
    },
    userInfo: userInfoRaw,
    status,
    errorMessage
  }
}

// ============ 批量刷新 ============

/**
 * 后台批量刷新账号。
 *
 * 分批并发执行，通过事件发布进度和结果。
 * 每批完成后等待所有 Promise，确保不遗漏错误。
 */
export async function batchRefresh(
  accounts: BatchRefreshAccount[],
  concurrency: number = 10,
  syncInfo: boolean = true,
  deps: BatchOperationDeps
): Promise<BatchResult> {
  console.log(
    `[BackgroundRefresh] Starting batch refresh for ${accounts.length} accounts, ` +
      `concurrency: ${concurrency}, syncInfo: ${syncInfo}`
  )

  let completed = 0
  let successCount = 0
  let failedCount = 0

  for (let i = 0; i < accounts.length; i += concurrency) {
    const batch = accounts.slice(i, i + concurrency)

    await Promise.allSettled(
      batch.map(async (account) => {
        try {
          const {
            refreshToken,
            clientId,
            clientSecret,
            region,
            authMethod,
            accessToken,
            provider
          } = account.credentials
          const needsTokenRefresh = account.needsTokenRefresh !== false

          const boundProxyUrl = deps.getAccountProxyUrl?.(account.id)

          // 确定 idp
          let idp = 'BuilderId'
          if (authMethod === 'social') {
            idp = provider || account.idp || 'BuilderId'
          } else if (provider) {
            idp = provider
          }

          let newAccessToken = accessToken
          let newRefreshToken = refreshToken
          let newExpiresIn: number | undefined

          // 刷新 Token
          if (needsTokenRefresh) {
            if (!refreshToken) {
              failedCount++
              completed++
              deps.emitEvent('background-refresh-result', {
                id: account.id,
                success: false,
                error: '缺少 refreshToken'
              })
              return
            }

            const refreshResult = await refreshTokenByMethod(
              refreshToken,
              clientId || '',
              clientSecret || '',
              region || 'us-east-1',
              authMethod,
              deps.tokenRefreshDeps,
              boundProxyUrl
            )

            if (!refreshResult.success) {
              failedCount++
              completed++
              deps.emitEvent('background-refresh-result', {
                id: account.id,
                success: false,
                error: refreshResult.error
              })
              return
            }

            newAccessToken = refreshResult.accessToken || accessToken
            newRefreshToken = refreshResult.refreshToken || refreshToken
            newExpiresIn = refreshResult.expiresIn
          }

          if (!newAccessToken) {
            failedCount++
            completed++
            deps.emitEvent('background-refresh-result', {
              id: account.id,
              success: false,
              error: '缺少 accessToken'
            })
            return
          }

          // 检查账号状态（如果 syncInfo 启用）
          let checkResult: AccountCheckResult | undefined
          if (syncInfo) {
            try {
              checkResult = await deps.checkAccount(
                newAccessToken,
                idp,
                account.machineId,
                region || 'us-east-1',
                account.email,
                boundProxyUrl
              )
            } catch (err) {
              checkResult = {
                success: false,
                error: err instanceof Error ? err.message : String(err)
              }
            }
          }

          const normalized = normalizeCheckResult(checkResult)

          successCount++
          completed++

          // 发布进度
          deps.emitEvent('background-refresh-progress', {
            completed,
            total: accounts.length,
            success: successCount,
            failed: failedCount
          })

          // 发布结果
          deps.emitEvent('background-refresh-result', {
            id: account.id,
            success: true,
            data: {
              accessToken: newAccessToken,
              refreshToken: newRefreshToken,
              expiresIn: newExpiresIn,
              usage: normalized.usage,
              userInfo: normalized.userInfo,
              subscription: normalized.subscription,
              status: normalized.status,
              errorMessage: normalized.errorMessage
            }
          })
        } catch (error) {
          failedCount++
          completed++
          deps.emitEvent('background-refresh-result', {
            id: account.id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      })
    )

    // 每批完成后发布进度
    deps.emitEvent('background-refresh-progress', {
      completed,
      total: accounts.length,
      success: successCount,
      failed: failedCount
    })

    if (i + concurrency < accounts.length) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  console.log(`[BackgroundRefresh] Completed: ${successCount} success, ${failedCount} failed`)
  return { success: true, completed, successCount, failedCount }
}

// ============ 批量检查 ============

/**
 * 后台批量检查账号状态（不刷新 Token，仅查询用量/状态）。
 */
export async function batchCheck(
  accounts: BatchCheckAccount[],
  concurrency: number = 10,
  deps: BatchOperationDeps
): Promise<BatchResult> {
  console.log(
    `[BackgroundCheck] Starting batch check for ${accounts.length} accounts, concurrency: ${concurrency}`
  )

  let completed = 0
  let successCount = 0
  let failedCount = 0

  for (let i = 0; i < accounts.length; i += concurrency) {
    const batch = accounts.slice(i, i + concurrency)

    await Promise.allSettled(
      batch.map(async (account) => {
        try {
          const { accessToken, authMethod, provider, region } = account.credentials

          if (!accessToken) {
            failedCount++
            completed++
            deps.emitEvent('background-check-result', {
              id: account.id,
              success: false,
              error: '缺少 accessToken'
            })
            return
          }

          // 确定 idp
          let idp = account.idp || 'BuilderId'
          if (authMethod === 'social' && provider) {
            idp = provider
          }

          const checkResult = await deps.checkAccount(
            accessToken,
            idp,
            account.machineId,
            region || 'us-east-1',
            account.email,
            deps.getAccountProxyUrl?.(account.id)
          )
          const normalized = normalizeCheckResult(checkResult)

          successCount++
          completed++

          deps.emitEvent('background-check-progress', {
            completed,
            total: accounts.length,
            success: successCount,
            failed: failedCount
          })

          deps.emitEvent('background-check-result', {
            id: account.id,
            success: true,
            data: normalized
          })
        } catch (error) {
          failedCount++
          completed++
          deps.emitEvent('background-check-result', {
            id: account.id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      })
    )

    deps.emitEvent('background-check-progress', {
      completed,
      total: accounts.length,
      success: successCount,
      failed: failedCount
    })

    if (i + concurrency < accounts.length) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  console.log(`[BackgroundCheck] Completed: ${successCount} success, ${failedCount} failed`)
  return { success: true, completed, successCount, failedCount }
}
