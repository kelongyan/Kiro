import { LocalAdminClientError, getJson, postJson } from './local-admin-client'
import type { AccountSubscription, AccountUsage } from '../types/account'

export interface LegacyResult {
  success: boolean
  error?: unknown
}

export interface BatchOperationResult extends LegacyResult {
  completed: number
  successCount: number
  failedCount: number
}

export interface TokenRefreshResult extends LegacyResult {
  data?: {
    accessToken: string
    refreshToken?: string
    expiresIn: number
  }
}

export interface AccountStatusResult extends LegacyResult {
  data?: {
    status: string
    email?: string
    userId?: string
    idp?: string
    usage?: AccountUsage
    subscription?: Partial<AccountSubscription>
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

export interface VerifyAccountCredentialsInput {
  refreshToken: string
  clientId: string
  clientSecret: string
  region?: string
  authMethod?: string
  provider?: string
}

export interface AccountModelInfo {
  id: string
  name: string
  description: string
  inputTypes?: string[]
  maxInputTokens?: number | null
  maxOutputTokens?: number | null
  rateMultiplier?: number
  rateUnit?: string
}

export interface RemoteUsageDetails {
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
  resourceDetail?: AccountUsage['resourceDetail']
}

export interface RemoteSubscriptionDetails {
  rawType?: string
  managementTarget?: string
  upgradeCapability?: string
  overageCapability?: string
}

export interface VerifyAccountCredentialsResult extends LegacyResult {
  data?: {
    email: string
    userId: string
    accessToken: string
    refreshToken: string
    expiresIn?: number
    subscriptionType: string
    subscriptionTitle: string
    subscription?: RemoteSubscriptionDetails
    usage: RemoteUsageDetails
    daysRemaining?: number
    expiresAt?: number
  }
  error?: string
}

export interface BuilderIdStartResult extends LegacyResult {
  userCode?: string
  verificationUri?: string
  expiresIn?: number
  interval?: number
  error?: string
}

export interface AuthPollResult extends LegacyResult {
  completed?: boolean
  status?: string
  accessToken?: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  region?: string
  expiresIn?: number
  error?: string
}

export interface IamSsoStartResult extends LegacyResult {
  authorizeUrl?: string
  expiresIn?: number
  error?: string
}

export interface SocialStartResult extends LegacyResult {
  loginUrl?: string
  state?: string
  error?: string
}

export interface SocialTokenResult extends LegacyResult {
  accessToken?: string
  refreshToken?: string
  profileArn?: string
  expiresIn?: number
  authMethod?: string
  provider?: string
  error?: string
}

export interface SsoImportResult extends LegacyResult {
  data?: {
    accessToken: string
    refreshToken: string
    clientId: string
    clientSecret: string
    region: string
    expiresIn?: number
    email?: string
    userId?: string
    idp?: string
    status?: string
    subscriptionType?: string
    subscriptionTitle?: string
    subscription?: RemoteSubscriptionDetails
    usage?: RemoteUsageDetails
    daysRemaining?: number
    expiresAt?: number
  }
  error?: string | { message: string }
}

export interface BackgroundRefreshAccount {
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

export interface BackgroundCheckAccount {
  id: string
  email: string
  idp?: string
  credentials: {
    accessToken: string
    refreshToken?: string
    clientId?: string
    clientSecret?: string
    region?: string
    authMethod?: string
    provider?: string
  }
}

type HttpResult<T> = T & { ok?: boolean }

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function coerceLegacyFailure<T extends LegacyResult>(error: unknown, fallback: string): T {
  if (error instanceof LocalAdminClientError && isObject(error.body)) {
    if (typeof error.body.success === 'boolean') {
      return error.body as T
    }
    return {
      success: false,
      error: error.body.error || fallback
    } as T
  }

  return {
    success: false,
    error: error instanceof Error ? error.message : fallback
  } as T
}

async function postLegacyResult<T extends LegacyResult>(
  path: string,
  body?: unknown,
  fallback = '请求失败'
): Promise<T> {
  try {
    return await postJson<HttpResult<T>>(path, body)
  } catch (error) {
    return coerceLegacyFailure<T>(error, fallback)
  }
}

function normalizeBuilderPoll(result: AuthPollResult): AuthPollResult {
  if (result.success && result.accessToken) {
    return { ...result, completed: true }
  }
  if (!result.success && result.error === '等待授权中...') {
    return { success: true, completed: false, status: 'pending' }
  }
  if (!result.success && result.error === '请求过于频繁，已增加间隔') {
    return { success: true, completed: false, status: 'slow_down' }
  }
  return result
}

function normalizeIamPoll(result: AuthPollResult): AuthPollResult {
  if (!result.completed && !result.error) {
    return { success: true, completed: false, status: 'pending' }
  }
  return result
}

export async function loadAccounts<TData = unknown>(): Promise<TData | null> {
  const result = await getJson<{ ok: true; data: TData | null }>('/api/accounts')
  return result.data
}

export async function saveAccounts(data: unknown): Promise<void> {
  await postJson('/api/accounts', data)
}

export function refreshAccountToken(account: unknown): Promise<TokenRefreshResult> {
  return postLegacyResult<TokenRefreshResult>('/api/accounts/refresh', account, '刷新账号失败')
}

export function checkAccountStatus(account: unknown): Promise<AccountStatusResult> {
  return postLegacyResult<AccountStatusResult>(
    '/api/accounts/check-status',
    account,
    '检查账号失败'
  )
}

export function backgroundBatchRefresh(
  accounts: BackgroundRefreshAccount[],
  concurrency?: number,
  syncInfo?: boolean
): Promise<BatchOperationResult> {
  return postLegacyResult<BatchOperationResult>('/api/accounts/batch-refresh', {
    accounts,
    concurrency,
    syncInfo
  })
}

export function backgroundBatchCheck(
  accounts: BackgroundCheckAccount[],
  concurrency?: number
): Promise<BatchOperationResult> {
  return postLegacyResult<BatchOperationResult>('/api/accounts/batch-check', {
    accounts,
    concurrency
  })
}

export function verifyAccountCredentials(
  credentials: VerifyAccountCredentialsInput
): Promise<VerifyAccountCredentialsResult> {
  return postLegacyResult<VerifyAccountCredentialsResult>(
    '/api/accounts/verify',
    credentials,
    '验证失败'
  )
}

export function accountGetModels(
  accessToken: string,
  region?: string,
  profileArn?: string,
  machineId?: string,
  provider?: string,
  authMethod?: string,
  accountId?: string
): Promise<{ success: boolean; error?: string; models: AccountModelInfo[] }> {
  return postLegacyResult(
    '/api/accounts/models',
    {
      accessToken,
      region,
      profileArn,
      machineId,
      provider,
      authMethod,
      accountId
    },
    '获取模型失败'
  )
}

export function startBuilderIdLogin(region?: string): Promise<BuilderIdStartResult> {
  return postLegacyResult<BuilderIdStartResult>('/api/auth/builder-id/start', {
    region: region || 'us-east-1'
  })
}

export async function pollBuilderIdAuth(region?: string): Promise<AuthPollResult> {
  const result = await postLegacyResult<AuthPollResult>('/api/auth/builder-id/poll', {
    region: region || 'us-east-1'
  })
  return normalizeBuilderPoll(result)
}

export async function cancelBuilderIdLogin(): Promise<{ success: boolean }> {
  await postJson('/api/auth/builder-id/cancel')
  return { success: true }
}

export async function startIamSsoLogin(
  startUrl: string,
  region?: string
): Promise<IamSsoStartResult> {
  const result = await postLegacyResult<IamSsoStartResult & { authUrl?: string }>(
    '/api/auth/iam-sso/start',
    {
      startUrl,
      region: region || 'us-east-1'
    },
    '启动 IAM SSO 登录失败'
  )
  return {
    ...result,
    authorizeUrl: result.authorizeUrl || result.authUrl,
    expiresIn: result.expiresIn || 600
  }
}

export async function pollIamSsoAuth(region?: string): Promise<AuthPollResult> {
  void region
  const result = await postLegacyResult<AuthPollResult>('/api/auth/iam-sso/poll')
  return normalizeIamPoll(result)
}

export async function cancelIamSsoLogin(): Promise<{ success: boolean }> {
  await postJson('/api/auth/iam-sso/cancel')
  return { success: true }
}

export function startSocialLogin(
  provider: 'Google' | 'Github',
  usePrivateMode?: boolean
): Promise<SocialStartResult> {
  return postLegacyResult<SocialStartResult>('/api/auth/social/start', {
    provider,
    usePrivateMode
  })
}

export function exchangeSocialToken(code: string, state: string): Promise<SocialTokenResult> {
  return postLegacyResult<SocialTokenResult>(
    '/api/auth/social/exchange',
    { code, state },
    'Token 交换失败'
  )
}

export async function cancelSocialLogin(): Promise<{ success: boolean }> {
  await postJson('/api/auth/social/cancel')
  return { success: true }
}

export function importFromSsoToken(
  bearerToken: string,
  region?: string
): Promise<SsoImportResult> {
  return postLegacyResult<SsoImportResult>('/api/auth/sso-import', {
    bearerToken,
    region: region || 'us-east-1'
  })
}
