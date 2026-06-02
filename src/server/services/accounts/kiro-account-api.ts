import { randomUUID } from 'crypto'
import { decode, encode } from 'cbor-x'
import { serverFetch, type ServerFetchOptions } from '../../runtime/fetch'
import { getKiroAmzUserAgent, getKiroUserAgent } from './token-refresh'
import type { AccountCheckResult } from './batch-operations'

const KIRO_WEB_PORTAL_OPERATION_BASE = 'https://app.kiro.dev/service/KiroWebPortalService/operation'

const KIRO_REST_API_ENDPOINTS: Record<string, string> = {
  'us-east-1': 'https://q.us-east-1.amazonaws.com',
  'eu-central-1': 'https://q.eu-central-1.amazonaws.com'
}

interface UsageLimitsResponse {
  usageBreakdownList?: Array<{
    type?: string
    resourceType?: string
    displayName?: string
    displayNamePlural?: string
    currentUsage?: number
    currentUsageWithPrecision?: number
    usageLimit?: number
    usageLimitWithPrecision?: number
    currency?: string
    unit?: string
    overageRate?: number
    overageCap?: number
    freeTrialUsage?: {
      currentUsage?: number
      currentUsageWithPrecision?: number
      usageLimit?: number
      usageLimitWithPrecision?: number
      freeTrialStatus?: string
      freeTrialExpiry?: string
    }
    freeTrialInfo?: {
      currentUsage?: number
      currentUsageWithPrecision?: number
      usageLimit?: number
      usageLimitWithPrecision?: number
      freeTrialStatus?: string
      freeTrialExpiry?: number | string
    }
    bonuses?: Array<{
      bonusCode?: string
      displayName?: string
      usageLimit?: number
      usageLimitWithPrecision?: number
      currentUsage?: number
      currentUsageWithPrecision?: number
      expiresAt?: number | string
      status?: string
    }>
  }>
  nextDateReset?: number | string
  subscriptionInfo?: {
    subscriptionName?: string
    subscriptionTitle?: string
    subscriptionType?: string
    status?: string
    type?: string
    subscriptionManagementTarget?: string
    upgradeCapability?: string
    overageCapability?: string
  }
  overageConfiguration?: {
    overageEnabled?: boolean
    overageStatus?: string
  }
  userInfo?: {
    email?: string
    userId?: string
  }
}

interface UnifiedUsageResponse {
  usageBreakdownList?: Array<{
    resourceType?: string
    displayName?: string
    displayNamePlural?: string
    currentUsage?: number
    currentUsageWithPrecision?: number
    usageLimit?: number
    usageLimitWithPrecision?: number
    currency?: string
    unit?: string
    overageRate?: number
    overageCap?: number
    type?: string
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
  }>
  nextDateReset?: string
  subscriptionInfo?: UsageLimitsResponse['subscriptionInfo']
  overageConfiguration?: UsageLimitsResponse['overageConfiguration']
  userInfo?: UsageLimitsResponse['userInfo']
}

interface UserInfoResponse {
  email?: string
  userId?: string
  idp?: string
  status?: string
  featureFlags?: string[]
}

function getRestApiBase(region?: string): string {
  if (!region) return KIRO_REST_API_ENDPOINTS['us-east-1']
  if (KIRO_REST_API_ENDPOINTS[region]) return KIRO_REST_API_ENDPOINTS[region]
  if (region.startsWith('eu-')) return KIRO_REST_API_ENDPOINTS['eu-central-1']
  return KIRO_REST_API_ENDPOINTS['us-east-1']
}

function getFallbackRestApiBase(region?: string): string {
  const primary = getRestApiBase(region)
  return primary === KIRO_REST_API_ENDPOINTS['eu-central-1']
    ? KIRO_REST_API_ENDPOINTS['us-east-1']
    : KIRO_REST_API_ENDPOINTS['eu-central-1']
}

function normalizeDate(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return new Date(value * 1000).toISOString()
  return value
}

async function fetchRestApi(
  baseUrl: string,
  path: string,
  accessToken: string,
  machineId: string | undefined,
  fetchOpts?: ServerFetchOptions
): Promise<Response> {
  return serverFetch(
    `${baseUrl}${path}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': getKiroUserAgent(machineId),
        'x-amz-user-agent': getKiroAmzUserAgent(machineId)
      }
    },
    fetchOpts
  )
}

async function getUsageLimitsRest(
  accessToken: string,
  machineId?: string,
  region?: string,
  email?: string,
  fetchOpts?: ServerFetchOptions
): Promise<UsageLimitsResponse> {
  const logTag = email || `token:${accessToken.slice(-6) || '?'}`
  console.log(`[Standalone Kiro API] GetUsageLimits [${logTag}] region=${region || 'default'}`)

  const params = new URLSearchParams({
    origin: 'AI_EDITOR',
    resourceType: 'AGENTIC_REQUEST',
    isEmailRequired: 'true'
  })
  const path = `/getUsageLimits?${params.toString()}`
  const primaryBase = getRestApiBase(region)
  const fallbackBase = getFallbackRestApiBase(region)

  let response = await fetchRestApi(primaryBase, path, accessToken, machineId, fetchOpts)
  if (response.status === 403) {
    response = await fetchRestApi(fallbackBase, path, accessToken, machineId, fetchOpts)
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`HTTP ${response.status}: ${errorText}`)
  }

  return (await response.json()) as UsageLimitsResponse
}

function normalizeUsageResult(result: UsageLimitsResponse): UnifiedUsageResponse {
  return {
    usageBreakdownList: result.usageBreakdownList?.map((item) => ({
      resourceType: item.resourceType || item.type,
      displayName: item.displayName,
      displayNamePlural: item.displayNamePlural,
      currentUsage: item.currentUsage,
      currentUsageWithPrecision: item.currentUsageWithPrecision,
      usageLimit: item.usageLimit,
      usageLimitWithPrecision: item.usageLimitWithPrecision,
      currency: item.currency,
      unit: item.unit,
      overageRate: item.overageRate,
      overageCap: item.overageCap,
      type: item.type,
      freeTrialInfo: item.freeTrialInfo
        ? {
            freeTrialStatus: item.freeTrialInfo.freeTrialStatus,
            usageLimit: item.freeTrialInfo.usageLimit,
            usageLimitWithPrecision: item.freeTrialInfo.usageLimitWithPrecision,
            currentUsage: item.freeTrialInfo.currentUsage,
            currentUsageWithPrecision: item.freeTrialInfo.currentUsageWithPrecision,
            freeTrialExpiry: normalizeDate(item.freeTrialInfo.freeTrialExpiry)
          }
        : item.freeTrialUsage,
      bonuses: item.bonuses?.map((bonus) => ({
        ...bonus,
        expiresAt: normalizeDate(bonus.expiresAt)
      }))
    })),
    nextDateReset: normalizeDate(result.nextDateReset),
    subscriptionInfo: result.subscriptionInfo,
    overageConfiguration: result.overageConfiguration,
    userInfo: result.userInfo
  }
}

function formatCborError(status: number, errorBuffer: Buffer): string {
  try {
    const errorData = decode(errorBuffer) as { __type?: string; message?: string }
    if (errorData.__type && errorData.message) {
      const errorType = errorData.__type.split('#').pop() || errorData.__type
      return `HTTP ${status}: ${errorType}: ${errorData.message}`
    }
    if (errorData.message) return `HTTP ${status}: ${errorData.message}`
  } catch {
    const errorText = errorBuffer.toString('utf-8')
    if (errorText) return `HTTP ${status}: ${errorText}`
  }
  return `HTTP ${status}`
}

async function kiroPortalRequest<T>(
  operation: string,
  body: Record<string, unknown>,
  accessToken: string,
  idp: string,
  machineId?: string,
  email?: string,
  fetchOpts?: ServerFetchOptions
): Promise<T> {
  const logTag = email || `token:${accessToken.slice(-6) || '?'}`
  console.log(
    `[Standalone Kiro API] ${operation} [${logTag}] ${idp} machineId=${machineId?.slice(0, 8) || 'none'}`
  )

  const encodedBody = encode(body)
  const response = await serverFetch(
    `${KIRO_WEB_PORTAL_OPERATION_BASE}/${operation}`,
    {
      method: 'POST',
      headers: {
        accept: 'application/cbor',
        'content-type': 'application/cbor',
        'smithy-protocol': 'rpc-v2-cbor',
        'amz-sdk-invocation-id': randomUUID(),
        'amz-sdk-request': 'attempt=1; max=1',
        'x-amz-user-agent': getKiroAmzUserAgent(machineId),
        authorization: `Bearer ${accessToken}`,
        cookie: `Idp=${idp}; AccessToken=${accessToken}`
      },
      body: encodedBody as unknown as BodyInit
    },
    fetchOpts
  )

  const responseBuffer = Buffer.from(await response.arrayBuffer())
  if (!response.ok) {
    throw new Error(formatCborError(response.status, responseBuffer))
  }

  return decode(responseBuffer) as T
}

export async function getUsageAndLimits(
  accessToken: string,
  idp: string = 'BuilderId',
  machineId?: string,
  region?: string,
  email?: string,
  fetchOpts?: ServerFetchOptions
): Promise<Record<string, unknown>> {
  console.log(`[Standalone Kiro API] Using REST usage API for ${idp}`)
  const result = await getUsageLimitsRest(accessToken, machineId, region, email, fetchOpts)
  return normalizeUsageResult(result) as unknown as Record<string, unknown>
}

export async function getUserInfo(
  accessToken: string,
  idp: string = 'BuilderId',
  machineId?: string,
  email?: string,
  fetchOpts?: ServerFetchOptions
): Promise<Record<string, unknown>> {
  return kiroPortalRequest<UserInfoResponse>(
    'GetUserInfo',
    { origin: 'KIRO_IDE' },
    accessToken,
    idp,
    machineId,
    email,
    fetchOpts
  ) as Promise<Record<string, unknown>>
}

export async function checkKiroAccount(
  accessToken: string,
  idp: string = 'BuilderId',
  machineId?: string,
  region?: string,
  email?: string,
  fetchOpts?: ServerFetchOptions
): Promise<AccountCheckResult> {
  try {
    const [usageResult, userInfoResult] = await Promise.all([
      getUsageAndLimits(accessToken, idp, machineId, region, email, fetchOpts),
      getUserInfo(accessToken, idp, machineId, email, fetchOpts).catch(() => undefined)
    ])

    return {
      success: true,
      usage: usageResult,
      userInfo: userInfoResult
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '检查失败'
    }
  }
}
