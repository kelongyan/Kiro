import { AccountStore, type AccountData } from '../../storage/account-store'
import {
  refreshTokenByMethod,
  type OidcRefreshResult,
  type TokenRefreshDeps
} from './token-refresh'
import {
  batchRefresh,
  batchCheck,
  type BatchRefreshAccount,
  type BatchCheckAccount,
  type BatchResult,
  type BatchOperationDeps,
  type AccountCheckResult
} from './batch-operations'
import {
  checkAccountStatus,
  type CheckAccountStatusAccount,
  type CheckAccountStatusDeps,
  type CheckAccountStatusResult
} from './account-status'

// ============ 类型 ============

export interface AccountCredentials {
  id?: string
  credentials: {
    refreshToken: string
    clientId?: string
    clientSecret?: string
    region?: string
    authMethod?: string
    provider?: string
  }
}

export interface VerifyCredentialsInput {
  refreshToken: string
  clientId: string
  clientSecret: string
  region?: string
  authMethod?: string
  provider?: string
}

export interface VerifyResult {
  success: boolean
  data?: {
    email: string
    userId: string
    accessToken: string
    refreshToken: string
    expiresIn?: number
    subscriptionType: string
    subscriptionTitle: string
    subscription?: {
      rawType?: string
      managementTarget?: string
      upgradeCapability?: string
      overageCapability?: string
    }
    usage: {
      current: number
      limit: number
      baseLimit?: number
      baseCurrent?: number
      freeTrialLimit?: number
      freeTrialCurrent?: number
      freeTrialExpiry?: string
      bonuses?: Array<{
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
    daysRemaining?: number
    expiresAt?: number
  }
  error?: string
}

export interface AccountServiceDeps {
  /** 数据目录 */
  dataDir: string
  /** 加密密码（可选） */
  encryptionKey?: string
  /** 是否尝试从旧 electron-store 迁移数据，默认 true */
  migrateFromElectronStore?: boolean
  /** 发布事件 */
  emitEvent: (type: string, payload: unknown) => void
  /** 获取全局网络代理 agent */
  getNetworkAgent?: () => import('undici').Dispatcher | undefined
  /** 创建代理 agent */
  createProxyAgent?: (url: string | undefined) => import('undici').Dispatcher | undefined
  /** 获取账号绑定的代理 URL */
  getAccountProxyUrl?: (accountId: string) => string | undefined
  /** 检查账号状态（调用 Kiro API） */
  checkAccount: (
    accessToken: string,
    idp: string,
    machineId?: string,
    region?: string,
    email?: string
  ) => Promise<AccountCheckResult>
  /** 获取用量和限制 */
  getUsageAndLimits: (
    accessToken: string,
    idp: string,
    machineId?: string,
    accountMachineId?: string,
    region?: string,
    email?: string
  ) => Promise<Record<string, unknown>>
  /** 获取用户信息 */
  getUserInfo: (
    accessToken: string,
    idp: string,
    machineId?: string,
    email?: string
  ) => Promise<Record<string, unknown>>
}

// ============ AccountService ============

/**
 * 账号服务门面。
 *
 * 组合 AccountStore + TokenRefresh + BatchOperations，
 * 提供统一的账号管理能力。
 */
export class AccountService {
  private store: AccountStore
  private deps: AccountServiceDeps
  private tokenRefreshDeps: TokenRefreshDeps
  private migrationPromise: Promise<boolean>

  constructor(deps: AccountServiceDeps) {
    this.deps = deps

    this.store = new AccountStore({
      dataDir: deps.dataDir,
      encryptionKey: deps.encryptionKey
    })

    this.tokenRefreshDeps = {
      fetchOpts: {
        getAgent: deps.getNetworkAgent,
        createProxyAgent: deps.createProxyAgent
      }
    }

    // 尝试从 electron-store 迁移。standalone 纯 Node 入口可关闭，避免加载 Electron 依赖。
    this.migrationPromise =
      deps.migrateFromElectronStore === false
        ? Promise.resolve(false)
        : this.store.migrateFromElectronStore()
  }

  async initialize(): Promise<void> {
    await this.migrationPromise
  }

  // ============ 存储 ============

  loadAccounts(): AccountData | null {
    return this.store.load()
  }

  saveAccounts(data: AccountData): void {
    this.store.save(data)
  }

  getLastSavedData(): AccountData | null {
    return this.store.getLastSavedData()
  }

  // ============ 防抖代理统计 ============

  debouncedSet(key: string, value: unknown): void {
    this.store.debouncedSet(key, value)
  }

  flushPendingWrites(): void {
    this.store.flushPendingWrites()
  }

  // ============ Token 刷新 ============

  async refreshToken(account: AccountCredentials): Promise<OidcRefreshResult> {
    const { refreshToken, clientId, clientSecret, region, authMethod } = account.credentials

    if (!refreshToken) {
      return { success: false, error: '缺少 Refresh Token' }
    }
    if (authMethod !== 'social' && (!clientId || !clientSecret)) {
      return { success: false, error: '缺少 OIDC 刷新凭证 (clientId/clientSecret)' }
    }

    const boundProxyUrl = account.id ? this.deps.getAccountProxyUrl?.(account.id) : undefined

    return refreshTokenByMethod(
      refreshToken,
      clientId || '',
      clientSecret || '',
      region || 'us-east-1',
      authMethod,
      this.tokenRefreshDeps,
      boundProxyUrl
    )
  }

  // ============ 单账号状态检查 ============

  async checkAccountStatus(account: CheckAccountStatusAccount): Promise<CheckAccountStatusResult> {
    const statusDeps: CheckAccountStatusDeps = {
      tokenRefreshDeps: this.tokenRefreshDeps,
      getAccountProxyUrl: this.deps.getAccountProxyUrl,
      getUsageAndLimits: this.deps.getUsageAndLimits,
      getUserInfo: this.deps.getUserInfo
    }

    return checkAccountStatus(account, statusDeps)
  }

  // ============ 批量操作 ============

  async batchRefresh(
    accounts: BatchRefreshAccount[],
    concurrency?: number,
    syncInfo?: boolean
  ): Promise<BatchResult> {
    const batchDeps: BatchOperationDeps = {
      tokenRefreshDeps: this.tokenRefreshDeps,
      getAccountProxyUrl: this.deps.getAccountProxyUrl,
      checkAccount: this.deps.checkAccount,
      emitEvent: this.deps.emitEvent
    }
    return batchRefresh(accounts, concurrency, syncInfo ?? true, batchDeps)
  }

  async batchCheck(accounts: BatchCheckAccount[], concurrency?: number): Promise<BatchResult> {
    const batchDeps: BatchOperationDeps = {
      tokenRefreshDeps: this.tokenRefreshDeps,
      getAccountProxyUrl: this.deps.getAccountProxyUrl,
      checkAccount: this.deps.checkAccount,
      emitEvent: this.deps.emitEvent
    }
    return batchCheck(accounts, concurrency, batchDeps)
  }

  // ============ 验证凭证 ============

  async verifyCredentials(creds: VerifyCredentialsInput): Promise<VerifyResult> {
    const {
      refreshToken,
      clientId,
      clientSecret,
      region = 'us-east-1',
      authMethod,
      provider
    } = creds

    if (!refreshToken) {
      return { success: false, error: '请填写 Refresh Token' }
    }
    if (authMethod !== 'social' && (!clientId || !clientSecret)) {
      return { success: false, error: '请填写 Client ID 和 Client Secret' }
    }

    const idp =
      provider && (provider === 'Enterprise' || provider === 'Github' || provider === 'Google')
        ? provider
        : 'BuilderId'

    // Step 1: 刷新获取 accessToken
    const refreshResult = await refreshTokenByMethod(
      refreshToken,
      clientId,
      clientSecret,
      region,
      authMethod,
      this.tokenRefreshDeps
    )

    if (!refreshResult.success || !refreshResult.accessToken) {
      return { success: false, error: `Token 刷新失败: ${refreshResult.error}` }
    }

    // Step 2: 获取用量和用户信息
    try {
      const usageResult = (await this.deps.getUsageAndLimits(
        refreshResult.accessToken,
        idp,
        undefined,
        undefined,
        region
      )) as {
        usageBreakdownList?: Array<{
          resourceType?: string
          usageLimit?: number
          usageLimitWithPrecision?: number
          currentUsage?: number
          currentUsageWithPrecision?: number
          displayName?: string
          displayNamePlural?: string
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
            status?: string
            expiresAt?: string
          }>
        }>
        subscriptionInfo?: {
          subscriptionTitle?: string
          type?: string
          subscriptionManagementTarget?: string
          upgradeCapability?: string
          overageCapability?: string
        }
        nextDateReset?: string
        userInfo?: { email?: string; userId?: string }
        overageConfiguration?: {
          overageEnabled?: boolean
          overageStatus?: string
        }
      }

      const email = usageResult.userInfo?.email || ''
      const userId = usageResult.userInfo?.userId || ''

      // 解析订阅类型
      const subscriptionTitle = usageResult.subscriptionInfo?.subscriptionTitle || 'Free'
      let subscriptionType = 'Free'
      const titleUpper = subscriptionTitle.toUpperCase()
      if (
        titleUpper.includes('PRO+') ||
        titleUpper.includes('PRO_PLUS') ||
        titleUpper.includes('PROPLUS')
      ) {
        subscriptionType = 'Pro_Plus'
      } else if (titleUpper.includes('POWER')) {
        subscriptionType = 'Enterprise'
      } else if (titleUpper.includes('PRO')) {
        subscriptionType = 'Pro'
      } else if (titleUpper.includes('ENTERPRISE')) {
        subscriptionType = 'Enterprise'
      } else if (titleUpper.includes('TEAMS')) {
        subscriptionType = 'Teams'
      }

      // 解析使用量
      const creditUsage = usageResult.usageBreakdownList?.find((b) => b.resourceType === 'CREDIT')
      const baseLimit = creditUsage?.usageLimitWithPrecision ?? creditUsage?.usageLimit ?? 0
      const baseCurrent = creditUsage?.currentUsageWithPrecision ?? creditUsage?.currentUsage ?? 0

      let freeTrialLimit = 0
      let freeTrialCurrent = 0
      if (creditUsage?.freeTrialInfo?.freeTrialStatus === 'ACTIVE') {
        freeTrialCurrent =
          creditUsage.freeTrialInfo.currentUsageWithPrecision ??
          creditUsage.freeTrialInfo.currentUsage ??
          0
        freeTrialLimit =
          creditUsage.freeTrialInfo.usageLimitWithPrecision ??
          creditUsage.freeTrialInfo.usageLimit ??
          0
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

      const totalLimit =
        baseLimit + freeTrialLimit + bonuses.reduce((sum, item) => sum + item.limit, 0)
      const totalCurrent =
        baseCurrent + freeTrialCurrent + bonuses.reduce((sum, item) => sum + item.current, 0)

      // 计算到期信息
      let daysRemaining: number | undefined
      let expiresAt: number | undefined
      const nextResetDate = usageResult.nextDateReset
      if (nextResetDate) {
        expiresAt = new Date(nextResetDate).getTime()
        daysRemaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24)))
      }

      return {
        success: true,
        data: {
          email,
          userId,
          accessToken: refreshResult.accessToken,
          refreshToken: refreshResult.refreshToken || refreshToken,
          expiresIn: refreshResult.expiresIn,
          subscriptionType,
          subscriptionTitle,
          subscription: {
            rawType: usageResult.subscriptionInfo?.type,
            managementTarget: usageResult.subscriptionInfo?.subscriptionManagementTarget,
            upgradeCapability: usageResult.subscriptionInfo?.upgradeCapability,
            overageCapability: usageResult.subscriptionInfo?.overageCapability
          },
          usage: {
            current: totalCurrent,
            limit: totalLimit,
            baseLimit,
            baseCurrent,
            freeTrialLimit,
            freeTrialCurrent,
            freeTrialExpiry: creditUsage?.freeTrialInfo?.freeTrialExpiry,
            bonuses,
            nextResetDate,
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
                    usageResult.overageConfiguration?.overageStatus === 'ENABLED' ||
                    usageResult.overageConfiguration?.overageEnabled === true
                }
              : undefined
          },
          daysRemaining,
          expiresAt
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取用户信息失败'
      }
    }
  }

  // ============ 关闭 ============

  async shutdown(): Promise<void> {
    await this.store.shutdown()
  }

  // ============ 存储路径 ============

  get storePath(): string {
    return this.store.storePath
  }

  get dataDirPath(): string {
    return this.store.dataDirPath
  }
}
