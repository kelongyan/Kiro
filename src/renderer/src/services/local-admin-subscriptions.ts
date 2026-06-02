import { LocalAdminClientError, postJson } from './local-admin-client'

export interface LegacyResult {
  success: boolean
  error?: string
}

export interface SubscriptionPlan {
  name: string
  qSubscriptionType: string
  description: {
    title: string
    billingInterval: string
    featureHeader: string
    features: string[]
  }
  pricing: {
    amount: number
    currency: string
  }
}

export interface AccountSubscriptionInput {
  accessToken: string
  region?: string
  profileArn?: string
  machineId?: string
  provider?: string
  authMethod?: string
  accountId?: string
}

type HttpResult<T> = T & { ok?: boolean }

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toFailure<T extends LegacyResult>(error: unknown, fallback: string): T {
  if (error instanceof LocalAdminClientError && isObject(error.body)) {
    if (typeof error.body.success === 'boolean') {
      return error.body as T
    }
    return {
      success: false,
      error: typeof error.body.error === 'string' ? error.body.error : fallback
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
    return toFailure<T>(error, fallback)
  }
}

function accountInput(
  accessToken: string,
  region?: string,
  profileArn?: string,
  machineId?: string,
  provider?: string,
  authMethod?: string,
  accountId?: string
): AccountSubscriptionInput {
  return {
    accessToken,
    region,
    profileArn,
    machineId,
    provider,
    authMethod,
    accountId
  }
}

export function accountGetSubscriptions(
  accessToken: string,
  region?: string,
  profileArn?: string,
  machineId?: string,
  provider?: string,
  authMethod?: string,
  accountId?: string
): Promise<
  LegacyResult & {
    plans: SubscriptionPlan[]
    disclaimer?: string[]
  }
> {
  return postLegacyResult(
    '/api/subscriptions/plans',
    accountInput(accessToken, region, profileArn, machineId, provider, authMethod, accountId),
    '获取订阅列表失败'
  )
}

export function accountGetSubscriptionUrl(
  accessToken: string,
  subscriptionType?: string,
  region?: string,
  profileArn?: string,
  machineId?: string,
  provider?: string,
  authMethod?: string,
  accountId?: string
): Promise<LegacyResult & { url?: string; status?: string }> {
  return postLegacyResult(
    '/api/subscriptions/url',
    {
      ...accountInput(accessToken, region, profileArn, machineId, provider, authMethod, accountId),
      subscriptionType
    },
    '获取订阅链接失败'
  )
}

export function accountSetOverage(
  accessToken: string,
  overageStatus: 'ENABLED' | 'DISABLED',
  region?: string,
  profileArn?: string,
  machineId?: string,
  provider?: string,
  authMethod?: string,
  accountId?: string
): Promise<LegacyResult> {
  return postLegacyResult(
    '/api/subscriptions/overage',
    {
      ...accountInput(accessToken, region, profileArn, machineId, provider, authMethod, accountId),
      overageStatus
    },
    '设置超额偏好失败'
  )
}

export function openSubscriptionWindow(url: string): Promise<LegacyResult> {
  return postLegacyResult('/api/subscriptions/open', { url }, '打开订阅链接失败')
}
