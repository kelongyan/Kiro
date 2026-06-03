import { LocalAdminClientError, getJson, postJson } from './local-admin-client'

export interface LegacyResult {
  success: boolean
  error?: string
}

export interface ProxyPoolValidateInput {
  url: string
  testUrl?: string
  timeoutMs?: number
}

export interface ProxyPoolValidateResult extends LegacyResult {
  latencyMs?: number
  externalIp?: string
}

export interface DiagnosticsHttpProbeInput {
  url: string
  method?: 'GET' | 'HEAD'
  timeoutMs?: number
}

export interface DiagnosticsHttpProbeResult extends LegacyResult {
  latencyMs?: number
  status?: number
}

export interface DiagnosticsRunInput {
  proxyUrl?: string
  targets: Array<{
    id: string
    label: string
    url: string
    timeoutMs?: number
    expectStatus?: number[]
  }>
}

export interface DiagnosticsRunResult {
  results: Array<{
    id: string
    label: string
    url: string
    success: boolean
    httpStatus?: number
    latencyMs?: number
    error?: string
  }>
}

export interface DiagnosticsOverviewCheck {
  id: string
  label: string
  category: 'local' | 'proxy' | 'kiro' | 'storage' | 'webhook' | 'scheduler'
  success: boolean
  detail?: string
}

export interface DiagnosticsOverviewResult {
  checks: DiagnosticsOverviewCheck[]
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

function encodePath(value: string): string {
  return encodeURIComponent(value)
}

export function proxyPoolValidate(
  params: ProxyPoolValidateInput
): Promise<ProxyPoolValidateResult> {
  return postLegacyResult('/api/diagnostics/proxy-pool/validate', params, '代理验活失败')
}

export function diagnoseHttpProbe(
  params: DiagnosticsHttpProbeInput
): Promise<DiagnosticsHttpProbeResult> {
  return postLegacyResult('/api/diagnostics/http-probe', params, 'HTTP 探测失败')
}

export function diagnoseRun(params: DiagnosticsRunInput): Promise<DiagnosticsRunResult> {
  return postJson('/api/diagnostics/run', params)
}

export function diagnoseOverview(): Promise<DiagnosticsOverviewResult> {
  return getJson('/api/diagnostics/overview')
}

export function accountSetProxyBinding(
  accountId: string,
  proxyUrl: string | undefined
): Promise<{ success: boolean }> {
  return postLegacyResult(
    `/api/proxy/accounts/${encodePath(accountId)}/proxy-binding`,
    { proxyUrl },
    '同步账号代理绑定失败'
  )
}
