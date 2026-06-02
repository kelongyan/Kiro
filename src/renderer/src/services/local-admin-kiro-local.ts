import { LocalAdminClientError, getJson, postJson } from './local-admin-client'

export interface KiroLocalResult<TData = undefined> {
  success: boolean
  data?: TData
  error?: string
}

export interface LocalActiveAccountData {
  refreshToken: string
  accessToken?: string
  authMethod?: string
  provider?: string
}

export interface KiroLocalCredentials {
  accessToken: string
  refreshToken: string
  clientId: string
  clientSecret: string
  region: string
  authMethod: string
  provider: string
}

export interface SwitchAccountInput {
  accessToken: string
  refreshToken: string
  clientId: string
  clientSecret: string
  region?: string
  startUrl?: string
  authMethod?: 'IdC' | 'social'
  provider?: 'BuilderId' | 'Github' | 'Google' | 'Enterprise' | 'IAM_SSO'
  profileArn?: string
}

export interface SwitchAccountCliInput {
  accessToken: string
  refreshToken: string
  clientId?: string
  clientSecret?: string
  region?: string
  profileArn?: string
  provider?: string
  scopes?: string[]
}

export interface SwitchAccountCliResult {
  success: boolean
  dbPath?: string
  error?: string
}

export interface LogoutAccountResult {
  success: boolean
  deletedCount?: number
  error?: string
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

async function getLegacyResult<T extends { success: boolean; error?: string }>(
  path: string,
  fallback: string
): Promise<T> {
  try {
    return await getJson<HttpResult<T>>(path)
  } catch (error) {
    return toFailure<T>(error, fallback)
  }
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

export function getLocalActiveAccount(): Promise<KiroLocalResult<LocalActiveAccountData>> {
  return getLegacyResult<KiroLocalResult<LocalActiveAccountData>>(
    '/api/kiro-local/active-account',
    '无法读取本地 SSO 缓存'
  )
}

export function loadKiroCredentials(): Promise<KiroLocalResult<KiroLocalCredentials>> {
  return getLegacyResult<KiroLocalResult<KiroLocalCredentials>>(
    '/api/kiro-local/credentials',
    '导入失败'
  )
}

export function switchAccount(credentials: SwitchAccountInput): Promise<KiroLocalResult> {
  return postLegacyResult<KiroLocalResult>(
    '/api/kiro-local/switch-account',
    credentials,
    '切换失败'
  )
}

export function switchAccountCli(
  credentials: SwitchAccountCliInput
): Promise<SwitchAccountCliResult> {
  return postLegacyResult<SwitchAccountCliResult>(
    '/api/kiro-local/switch-account-cli',
    credentials,
    '切换 CLI 账号失败'
  )
}

export function logoutAccount(): Promise<LogoutAccountResult> {
  return postLegacyResult<LogoutAccountResult>('/api/kiro-local/logout', undefined, '退出失败')
}
