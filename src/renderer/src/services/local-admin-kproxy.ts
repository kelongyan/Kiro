import {
  LocalAdminClientError,
  getJson,
  postJson
} from './local-admin-client'

export interface KProxyConfig {
  enabled?: boolean
  port?: number
  host?: string
  mitmDomains?: string[]
  deviceId?: string
  autoStart?: boolean
  logRequests?: boolean
}

export interface KProxyStats {
  totalRequests: number
  mitmRequests: number
  bypassRequests: number
  modifiedRequests: number
  startTime: number
  lastRequestTime: number
}

export interface CACertInfo {
  certPath: string
  fingerprint: string
  validFrom: string
  validTo: string
}

export interface DeviceIdMapping {
  accountId: string
  deviceId: string
  description?: string
  createdAt: number
  lastUsed?: number
}

export interface LegacyResult {
  success: boolean
  error?: string
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

async function getLegacyResult<T extends LegacyResult>(
  path: string,
  fallback: string
): Promise<T> {
  try {
    return await getJson<HttpResult<T>>(path)
  } catch (error) {
    return toFailure<T>(error, fallback)
  }
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

function downloadTextFile(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function kproxyInit(): Promise<
  LegacyResult & {
    caInfo?: CACertInfo
  }
> {
  return postLegacyResult('/api/kproxy/init', undefined, '初始化 K-Proxy 失败')
}

export function kproxyStart(
  config?: KProxyConfig
): Promise<LegacyResult & { port?: number }> {
  return postLegacyResult('/api/kproxy/start', config, '启动 K-Proxy 失败')
}

export function kproxyStop(): Promise<LegacyResult> {
  return postLegacyResult('/api/kproxy/stop', undefined, '停止 K-Proxy 失败')
}

export function kproxyGetStatus(): Promise<{
  running: boolean
  config: unknown
  stats: unknown
  caInfo: unknown
}> {
  return getJson('/api/kproxy/status')
}

export function kproxyUpdateConfig(
  config: KProxyConfig
): Promise<LegacyResult & { config?: unknown }> {
  return postLegacyResult('/api/kproxy/config', config, '更新 K-Proxy 配置失败')
}

export function kproxySetDeviceId(deviceId: string): Promise<LegacyResult> {
  return postLegacyResult('/api/kproxy/device-id', { deviceId }, '设置设备 ID 失败')
}

export function kproxyGenerateDeviceId(): Promise<LegacyResult & { deviceId?: string }> {
  return getLegacyResult('/api/kproxy/device-id/random', '生成设备 ID 失败')
}

export function kproxyAddDeviceMapping(mapping: DeviceIdMapping): Promise<LegacyResult> {
  return postLegacyResult('/api/kproxy/device-mappings', mapping, '保存设备 ID 映射失败')
}

export function kproxyGetDeviceMappings(): Promise<{
  success: boolean
  mappings: DeviceIdMapping[]
  error?: string
}> {
  return getLegacyResult('/api/kproxy/device-mappings', '获取设备 ID 映射失败')
}

export function kproxySwitchToAccount(accountId: string): Promise<LegacyResult> {
  return postLegacyResult(
    '/api/kproxy/device-mappings/switch',
    { accountId },
    '切换设备 ID 映射失败'
  )
}

export function kproxyGetCaCert(): Promise<
  LegacyResult & {
    certPem?: string
    certPath?: string
    fingerprint?: string
  }
> {
  return getLegacyResult('/api/kproxy/ca-cert', '获取 CA 证书失败')
}

export async function kproxyExportCaCert(
  exportPath?: string
): Promise<LegacyResult & { path?: string }> {
  if (exportPath) {
    return postLegacyResult('/api/kproxy/ca-cert/export', { exportPath }, '导出 CA 证书失败')
  }

  const result = await kproxyGetCaCert()
  if (!result.success || !result.certPem) {
    return {
      success: false,
      error: result.error || 'CA certificate not available'
    }
  }

  downloadTextFile(result.certPem, 'kproxy-ca.crt', 'application/x-pem-file')
  return { success: true, path: 'kproxy-ca.crt' }
}

export function kproxyCheckCaCertInstalled(): Promise<
  LegacyResult & {
    installed: boolean
  }
> {
  return getLegacyResult('/api/kproxy/ca-cert/installed', '检测 CA 证书失败')
}

export function kproxyInstallCaCert(): Promise<LegacyResult & { message?: string }> {
  return postLegacyResult('/api/kproxy/ca-cert/install', undefined, '安装 CA 证书失败')
}

export function kproxyUninstallCaCert(): Promise<LegacyResult & { message?: string }> {
  return postLegacyResult('/api/kproxy/ca-cert/uninstall', undefined, '卸载 CA 证书失败')
}

export function kproxyResetStats(): Promise<{ success: boolean }> {
  return postLegacyResult('/api/kproxy/stats/reset', undefined, '重置 K-Proxy 统计失败')
}
