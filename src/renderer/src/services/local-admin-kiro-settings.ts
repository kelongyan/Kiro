import {
  LocalAdminClientError,
  deleteJson,
  getJson,
  postJson
} from './local-admin-client'

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface KiroSettingsData {
  settings?: Record<string, unknown>
  mcpConfig?: { mcpServers: Record<string, McpServerConfig> }
  steeringFiles?: string[]
  error?: string
}

export interface KiroModelSummary {
  id: string
  name: string
  description: string
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

async function deleteLegacyResult<T extends LegacyResult>(
  path: string,
  fallback = '请求失败'
): Promise<T> {
  try {
    return await deleteJson<HttpResult<T>>(path)
  } catch (error) {
    return toFailure<T>(error, fallback)
  }
}

function encodePath(value: string): string {
  return encodeURIComponent(value)
}

export function getKiroSettings(): Promise<KiroSettingsData> {
  return getJson('/api/kiro-settings')
}

export function getKiroAvailableModels(): Promise<{
  models: KiroModelSummary[]
  error?: string
}> {
  return getJson('/api/kiro-settings/models')
}

export function saveKiroSettings(settings: Record<string, unknown>): Promise<LegacyResult> {
  return postLegacyResult('/api/kiro-settings', settings, '保存 Kiro 设置失败')
}

export function openKiroMcpConfig(
  type: 'user' | 'workspace'
): Promise<LegacyResult> {
  return postLegacyResult('/api/kiro-settings/open/mcp-config', { type }, '打开 MCP 配置失败')
}

export function openKiroSteeringFolder(): Promise<LegacyResult> {
  return postLegacyResult(
    '/api/kiro-settings/open/steering-folder',
    undefined,
    '打开 Steering 目录失败'
  )
}

export function openKiroSettingsFile(): Promise<LegacyResult> {
  return postLegacyResult(
    '/api/kiro-settings/open/settings-file',
    undefined,
    '打开设置文件失败'
  )
}

export function openKiroSteeringFile(filename: string): Promise<LegacyResult> {
  return postLegacyResult(
    '/api/kiro-settings/open/steering-file',
    { filename },
    '打开 Steering 文件失败'
  )
}

export function createKiroDefaultRules(): Promise<LegacyResult> {
  return postLegacyResult(
    '/api/kiro-settings/default-rules',
    undefined,
    '创建默认规则失败'
  )
}

export function readKiroSteeringFile(
  filename: string
): Promise<{ success: boolean; content?: string; error?: string }> {
  return getLegacyResult(
    `/api/kiro-settings/steering/${encodePath(filename)}`,
    '读取 Steering 文件失败'
  )
}

export function saveKiroSteeringFile(
  filename: string,
  content: string
): Promise<LegacyResult> {
  return postLegacyResult(
    `/api/kiro-settings/steering/${encodePath(filename)}`,
    { content },
    '保存 Steering 文件失败'
  )
}

export function deleteKiroSteeringFile(filename: string): Promise<LegacyResult> {
  return deleteLegacyResult(
    `/api/kiro-settings/steering/${encodePath(filename)}`,
    '删除 Steering 文件失败'
  )
}

export function saveMcpServer(
  name: string,
  config: McpServerConfig,
  oldName?: string
): Promise<LegacyResult> {
  return postLegacyResult('/api/kiro-settings/mcp', { name, config, oldName }, '保存 MCP 失败')
}

export function deleteMcpServer(name: string): Promise<LegacyResult> {
  return deleteLegacyResult(`/api/kiro-settings/mcp/${encodePath(name)}`, '删除 MCP 失败')
}
