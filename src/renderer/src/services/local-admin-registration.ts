import { LocalAdminClientError, getJson, postJson } from './local-admin-client'

export interface RegistrationStartConfig {
  proxy?: string
  moEmailBaseURL?: string
  moEmailAPIKey?: string
  useOutlook?: boolean
  outlookData?: string
  useTempMailPlus?: boolean
  tempMailPlusEmail?: string
  tempMailPlusEpin?: string
  tempMailPlusDomain?: string
  password?: string
  fullName?: string
  taskId?: string
}

export interface RegistrationResult {
  status: 'success' | 'failed'
  email: string
  password?: string
  error?: string
  clientId?: string
  clientSecret?: string
  refreshToken?: string
  accessToken?: string
  region?: string
  provider?: string
  verify?: Record<string, unknown>
}

export interface RegistrationServiceResult<T = unknown> {
  success: boolean
  result?: T
  error?: string
}

export interface RegistrationStatusResult {
  inProgress: boolean
  count?: number
}

type HttpResult<T> = T & { ok?: boolean }

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toFailure<T extends { success: boolean; error?: string }>(
  error: unknown,
  fallback: string
): T {
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

async function postLegacyResult<T extends { success: boolean; error?: string }>(
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

export function registrationStartAuto(
  config: RegistrationStartConfig
): Promise<RegistrationServiceResult<RegistrationResult>> {
  return postLegacyResult('/api/registration/auto', config, '启动注册失败')
}

export function registrationManualPhase1(
  config: Pick<RegistrationStartConfig, 'proxy' | 'password' | 'fullName'>
): Promise<{ success: boolean; error?: string }> {
  return postLegacyResult('/api/registration/manual/phase1', config, '初始化注册失败')
}

export function registrationManualPhase2(
  email: string,
  fullName?: string
): Promise<{ success: boolean; error?: string }> {
  return postLegacyResult(
    '/api/registration/manual/phase2',
    { email, fullName },
    '提交邮箱失败'
  )
}

export function registrationManualPhase3(
  otp: string
): Promise<RegistrationServiceResult<RegistrationResult>> {
  return postLegacyResult('/api/registration/manual/phase3', { otp }, '提交验证码失败')
}

export async function registrationCancel(taskId?: string): Promise<{ success: boolean }> {
  await postJson('/api/registration/cancel', taskId ? { taskId } : undefined)
  return { success: true }
}

export async function registrationStatus(): Promise<RegistrationStatusResult> {
  const result = await getJson<HttpResult<RegistrationStatusResult>>('/api/registration/status')
  return {
    inProgress: result.inProgress,
    count: result.count
  }
}
