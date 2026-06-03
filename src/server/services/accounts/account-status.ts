import { refreshTokenByMethod, type TokenRefreshDeps } from './token-refresh'

interface Bonus {
  bonusCode?: string
  displayName?: string
  usageLimit?: number
  usageLimitWithPrecision?: number
  currentUsage?: number
  currentUsageWithPrecision?: number
  status?: string
  expiresAt?: string
}

interface FreeTrialInfo {
  usageLimit?: number
  usageLimitWithPrecision?: number
  currentUsage?: number
  currentUsageWithPrecision?: number
  freeTrialStatus?: string
  freeTrialExpiry?: string
}

interface UsageBreakdown {
  usageLimit?: number
  usageLimitWithPrecision?: number
  currentUsage?: number
  currentUsageWithPrecision?: number
  displayName?: string
  displayNamePlural?: string
  resourceType?: string
  currency?: string
  unit?: string
  overageRate?: number
  overageCap?: number
  bonuses?: Bonus[]
  freeTrialInfo?: FreeTrialInfo
}

interface SubscriptionInfo {
  subscriptionTitle?: string
  type?: string
  upgradeCapability?: string
  overageCapability?: string
  subscriptionManagementTarget?: string
}

interface UsageUserInfo {
  email?: string
  userId?: string
}

interface OverageConfiguration {
  overageEnabled?: boolean
  overageStatus?: string
}

interface UsageResponse {
  daysUntilReset?: number
  nextDateReset?: string
  usageBreakdownList?: UsageBreakdown[]
  overageConfiguration?: OverageConfiguration
  subscriptionInfo?: SubscriptionInfo
  userInfo?: UsageUserInfo
}

interface UserInfoResponse {
  email?: string
  userId?: string
  idp?: string
  status?: string
  featureFlags?: string[]
}

interface RefreshedCredentials {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}

export interface CheckAccountStatusAccount {
  id?: string
  email?: string
  idp?: string
  machineId?: string
  subscription?: {
    type?: string
  }
  credentials?: {
    accessToken?: string
    refreshToken?: string
    clientId?: string
    clientSecret?: string
    region?: string
    authMethod?: string
    provider?: string
  }
}

export interface CheckAccountStatusResult {
  success: boolean
  data?: {
    status: 'active' | 'error'
    email?: string
    userId?: string
    idp?: string
    userStatus?: string
    featureFlags?: string[]
    subscriptionTitle: string
    usage: {
      current: number
      limit: number
      percentUsed: number
      lastUpdated: number
      baseLimit: number
      baseCurrent: number
      freeTrialLimit: number
      freeTrialCurrent: number
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
        resourceType?: string
        displayName?: string
        displayNamePlural?: string
        currency?: string
        unit?: string
        overageRate?: number
        overageCap?: number
        overageEnabled?: boolean
      }
    }
    subscription: {
      type: string
      title: string
      rawType?: string
      expiresAt?: number
      daysRemaining?: number
      upgradeCapability?: string
      overageCapability?: string
      managementTarget?: string
    }
    newCredentials?: {
      accessToken: string
      refreshToken?: string
      expiresAt?: number
    }
  }
  error?: {
    message: string
    isBanned?: boolean
  }
}

export interface CheckAccountStatusDeps {
  tokenRefreshDeps: TokenRefreshDeps
  getAccountProxyUrl?: (accountId: string) => string | undefined
  getUsageAndLimits: (
    accessToken: string,
    idp: string,
    machineId?: string,
    accountMachineId?: string,
    region?: string,
    email?: string,
    proxyUrl?: string
  ) => Promise<Record<string, unknown>>
  getUserInfo: (
    accessToken: string,
    idp: string,
    machineId?: string,
    email?: string,
    proxyUrl?: string
  ) => Promise<Record<string, unknown>>
}

function parseUsageResponse(
  account: CheckAccountStatusAccount,
  result: UsageResponse,
  newCredentials?: RefreshedCredentials,
  userInfo?: UserInfoResponse
): CheckAccountStatusResult {
  console.log(`[Kiro API] Usage [${account.email || userInfo?.email || 'unknown'}]`, result)

  const creditUsage = result.usageBreakdownList?.find(
    (breakdown) => breakdown.resourceType === 'CREDIT' || breakdown.displayName === 'Credits'
  )

  const baseLimit = creditUsage?.usageLimitWithPrecision ?? creditUsage?.usageLimit ?? 0
  const baseCurrent = creditUsage?.currentUsageWithPrecision ?? creditUsage?.currentUsage ?? 0

  let freeTrialLimit = 0
  let freeTrialCurrent = 0
  let freeTrialExpiry: string | undefined
  if (creditUsage?.freeTrialInfo?.freeTrialStatus === 'ACTIVE') {
    freeTrialLimit =
      creditUsage.freeTrialInfo.usageLimitWithPrecision ?? creditUsage.freeTrialInfo.usageLimit ?? 0
    freeTrialCurrent =
      creditUsage.freeTrialInfo.currentUsageWithPrecision ??
      creditUsage.freeTrialInfo.currentUsage ??
      0
    freeTrialExpiry = creditUsage.freeTrialInfo.freeTrialExpiry
  }

  const bonusesData: Array<{
    code: string
    name: string
    current: number
    limit: number
    expiresAt?: string
  }> = []
  if (creditUsage?.bonuses) {
    for (const bonus of creditUsage.bonuses) {
      if (bonus.status === 'ACTIVE') {
        bonusesData.push({
          code: bonus.bonusCode || '',
          name: bonus.displayName || '',
          current: bonus.currentUsageWithPrecision ?? bonus.currentUsage ?? 0,
          limit: bonus.usageLimitWithPrecision ?? bonus.usageLimit ?? 0,
          expiresAt: bonus.expiresAt
        })
      }
    }
  }

  const totalLimit = baseLimit + freeTrialLimit + bonusesData.reduce((sum, b) => sum + b.limit, 0)
  const totalUsed =
    baseCurrent + freeTrialCurrent + bonusesData.reduce((sum, b) => sum + b.current, 0)
  const nextResetDate = result.nextDateReset

  const subscriptionTitle = result.subscriptionInfo?.subscriptionTitle ?? 'Free'
  let subscriptionType = account.subscription?.type ?? 'Free'
  if (subscriptionTitle.toUpperCase().includes('PRO')) {
    subscriptionType = 'Pro'
  } else if (subscriptionTitle.toUpperCase().includes('ENTERPRISE')) {
    subscriptionType = 'Enterprise'
  } else if (subscriptionTitle.toUpperCase().includes('TEAMS')) {
    subscriptionType = 'Teams'
  }

  let expiresAt: number | undefined
  let daysRemaining: number | undefined
  if (result.nextDateReset) {
    expiresAt = new Date(result.nextDateReset).getTime()
    daysRemaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24)))
  }

  const resourceDetail = creditUsage
    ? {
        resourceType: creditUsage.resourceType,
        displayName: creditUsage.displayName,
        displayNamePlural: creditUsage.displayNamePlural,
        currency: creditUsage.currency,
        unit: creditUsage.unit,
        overageRate: creditUsage.overageRate,
        overageCap: creditUsage.overageCap,
        overageEnabled:
          result.overageConfiguration?.overageStatus === 'ENABLED' ||
          result.overageConfiguration?.overageEnabled === true
      }
    : undefined

  return {
    success: true,
    data: {
      status:
        !userInfo?.status || userInfo.status === 'Active' || userInfo.status === 'Stale'
          ? 'active'
          : 'error',
      email: result.userInfo?.email,
      userId: result.userInfo?.userId,
      idp: userInfo?.idp,
      userStatus: userInfo?.status,
      featureFlags: userInfo?.featureFlags,
      subscriptionTitle,
      usage: {
        current: totalUsed,
        limit: totalLimit,
        percentUsed: totalLimit > 0 ? totalUsed / totalLimit : 0,
        lastUpdated: Date.now(),
        baseLimit,
        baseCurrent,
        freeTrialLimit,
        freeTrialCurrent,
        freeTrialExpiry,
        bonuses: bonusesData,
        nextResetDate,
        resourceDetail
      },
      subscription: {
        type: subscriptionType,
        title: subscriptionTitle,
        rawType: result.subscriptionInfo?.type,
        expiresAt,
        daysRemaining,
        upgradeCapability: result.subscriptionInfo?.upgradeCapability,
        overageCapability: result.subscriptionInfo?.overageCapability,
        managementTarget: result.subscriptionInfo?.subscriptionManagementTarget
      },
      newCredentials: newCredentials
        ? {
            accessToken: newCredentials.accessToken,
            refreshToken: newCredentials.refreshToken,
            expiresAt: newCredentials.expiresIn
              ? Date.now() + newCredentials.expiresIn * 1000
              : undefined
          }
        : undefined
    }
  }
}

function resolveIdp(account: CheckAccountStatusAccount): string {
  const { authMethod, provider } = account.credentials || {}
  if (authMethod === 'social') {
    return provider || account.idp || 'BuilderId'
  }
  return provider || 'BuilderId'
}

function isSuspendedError(errorMsg: string): boolean {
  return errorMsg.includes('AccountSuspendedException') || errorMsg.includes('423')
}

async function getUserInfoOrUndefined(
  deps: CheckAccountStatusDeps,
  accessToken: string,
  idp: string,
  machineId: string | undefined,
  email?: string,
  proxyUrl?: string
): Promise<UserInfoResponse | undefined> {
  try {
    return (await deps.getUserInfo(
      accessToken,
      idp,
      machineId,
      email,
      proxyUrl
    )) as UserInfoResponse
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('423') || message.includes('AccountSuspended')) {
      throw error
    }
    return undefined
  }
}

export async function checkAccountStatus(
  account: CheckAccountStatusAccount,
  deps: CheckAccountStatusDeps
): Promise<CheckAccountStatusResult> {
  const email = account.email || 'unknown'
  const { accessToken, refreshToken, clientId, clientSecret, region, authMethod } =
    account.credentials || {}
  const boundProxyUrl = account.id ? deps.getAccountProxyUrl?.(account.id) : undefined
  const idp = resolveIdp(account)

  if (!accessToken) {
    console.log('[AccountStatus] Missing accessToken')
    return { success: false, error: { message: '缺少 accessToken' } }
  }

  const accountMachineId = account.machineId

  try {
    try {
      const [userInfoResult, usageResult] = await Promise.all([
        getUserInfoOrUndefined(
          deps,
          accessToken,
          idp,
          accountMachineId,
          account.email,
          boundProxyUrl
        ),
        deps.getUsageAndLimits(
          accessToken,
          idp,
          undefined,
          accountMachineId,
          region,
          account.email,
          boundProxyUrl
        )
      ])
      return parseUsageResponse(account, usageResult as UsageResponse, undefined, userInfoResult)
    } catch (apiError) {
      const errorMsg = apiError instanceof Error ? apiError.message : ''

      if (isSuspendedError(errorMsg)) {
        console.log(`[AccountStatus] Account suspended/banned [${email}]`)
        return {
          success: false,
          error: { message: errorMsg, isBanned: true }
        }
      }

      const canRefresh = Boolean(
        refreshToken && (authMethod === 'social' || (clientId && clientSecret))
      )
      if (errorMsg.includes('401') && canRefresh && refreshToken) {
        console.log(
          `[AccountStatus] Token expired, attempting refresh [${email}] (authMethod: ${authMethod || 'IdC'})${boundProxyUrl ? ' [via bound proxy]' : ''}`
        )

        const refreshResult = await refreshTokenByMethod(
          refreshToken,
          clientId || '',
          clientSecret || '',
          region || 'us-east-1',
          authMethod,
          deps.tokenRefreshDeps,
          boundProxyUrl
        )

        if (refreshResult.success && refreshResult.accessToken) {
          console.log(`[AccountStatus] Token refreshed, retrying API call [${email}]`)

          const [userInfoResult, usageResult] = await Promise.all([
            getUserInfoOrUndefined(
              deps,
              refreshResult.accessToken,
              idp,
              accountMachineId,
              account.email,
              boundProxyUrl
            ),
            deps.getUsageAndLimits(
              refreshResult.accessToken,
              idp,
              undefined,
              accountMachineId,
              region,
              account.email,
              boundProxyUrl
            )
          ])

          return parseUsageResponse(
            account,
            usageResult as UsageResponse,
            {
              accessToken: refreshResult.accessToken,
              refreshToken: refreshResult.refreshToken,
              expiresIn: refreshResult.expiresIn
            },
            userInfoResult
          )
        }

        console.error('[AccountStatus] Token refresh failed:', refreshResult.error)
        return {
          success: false,
          error: { message: `Token 过期且刷新失败: ${refreshResult.error}` }
        }
      }

      throw apiError
    }
  } catch (error) {
    console.error('checkAccountStatus error:', error)
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
}
