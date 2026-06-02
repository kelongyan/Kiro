import { LocalAdminClientError, getJson, postJson } from './local-admin-client'

export interface AdminRestartInfo {
  requiresAdmin: true
  canAutoRestart: false
  osType: 'windows' | 'macos' | 'linux' | 'unknown'
  executablePath: string
  command: string
  message: string
}

export interface MachineIdResult {
  success: boolean
  machineId?: string
  error?: string
  requiresAdmin?: boolean
  adminRestart?: AdminRestartInfo
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

export async function machineIdGetOSType(): Promise<'windows' | 'macos' | 'linux' | 'unknown'> {
  const result = await getJson<{ ok?: boolean; osType: 'windows' | 'macos' | 'linux' | 'unknown' }>(
    '/api/machine-id/os'
  )
  return result.osType || 'unknown'
}

export function machineIdGetCurrent(): Promise<MachineIdResult> {
  return getLegacyResult('/api/machine-id/current', '获取机器码失败')
}

export function machineIdSet(newMachineId: string): Promise<MachineIdResult> {
  return postLegacyResult('/api/machine-id/set', { machineId: newMachineId }, '设置机器码失败')
}

export async function machineIdGenerateRandom(): Promise<string> {
  const result = await getJson<{ ok?: boolean; machineId: string }>('/api/machine-id/random')
  return result.machineId || ''
}

export async function machineIdCheckAdmin(): Promise<boolean> {
  const result = await getJson<{ ok?: boolean; isAdmin: boolean }>('/api/machine-id/admin')
  return result.isAdmin === true
}

export async function machineIdRequestAdminRestart(): Promise<AdminRestartInfo> {
  const result = await getJson<{ ok?: boolean; data: AdminRestartInfo }>(
    '/api/machine-id/admin-restart'
  )
  return result.data
}

export async function createMachineIdBackupData(machineId: string): Promise<{
  machineId: string
  backupTime: number
  osType: string
}> {
  return {
    machineId,
    backupTime: Date.now(),
    osType: await machineIdGetOSType()
  }
}

export function parseMachineIdBackupData(data: { machineId?: string }): MachineIdResult {
  if (!data.machineId) {
    return { success: false, error: '备份文件格式无效' }
  }
  return { success: true, machineId: data.machineId }
}
