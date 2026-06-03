import { deleteJson, getJson, postJson, putJson } from './local-admin-client'
import type { ProxyEntry, ProxyPoolConfig } from '../types/proxy'

export interface ProxyPoolSnapshot {
  proxies: ProxyEntry[]
  config: ProxyPoolConfig
  cursor: number
  bindings: Record<string, string>
  counts: {
    total: number
    enabled: number
    alive: number
    slow: number
    dead: number
    untested: number
    boundAccounts: number
  }
}

export interface ProxyPoolImportResult {
  added: number
  skipped: number
  failed: number
  ids: string[]
  snapshot: ProxyPoolSnapshot
}

export interface ProxyPoolValidationResult {
  success: boolean
  latencyMs?: number
  externalIp?: string
  error?: string
}

function encodePath(value: string): string {
  return encodeURIComponent(value)
}

export async function proxyPoolGetSnapshot(): Promise<ProxyPoolSnapshot> {
  const result = await getJson<{ ok?: boolean } & ProxyPoolSnapshot>('/api/proxy-pool')
  return result
}

export function proxyPoolImport(text: string): Promise<ProxyPoolImportResult> {
  return postJson('/api/proxy-pool/import', { text })
}

export async function proxyPoolUpdateConfig(
  config: Partial<ProxyPoolConfig>
): Promise<ProxyPoolConfig> {
  const result = await postJson<{ ok?: boolean; config: ProxyPoolConfig }>(
    '/api/proxy-pool/config',
    config
  )
  return result.config
}

export async function proxyPoolUpdateProxy(
  id: string,
  updates: Partial<ProxyEntry>
): Promise<ProxyEntry> {
  const result = await putJson<{ ok?: boolean; proxy: ProxyEntry }>(
    `/api/proxy-pool/proxies/${encodePath(id)}`,
    updates
  )
  return result.proxy
}

export function proxyPoolDeleteProxy(id: string): Promise<{ success: boolean }> {
  return deleteJson(`/api/proxy-pool/proxies/${encodePath(id)}`)
}

export async function proxyPoolToggleProxy(id: string, enabled?: boolean): Promise<ProxyEntry> {
  const result = await postJson<{ ok?: boolean; proxy: ProxyEntry }>(
    `/api/proxy-pool/proxies/${encodePath(id)}/toggle`,
    { enabled }
  )
  return result.proxy
}

export function proxyPoolValidateProxy(id: string): Promise<ProxyPoolValidationResult> {
  return postJson(`/api/proxy-pool/proxies/${encodePath(id)}/validate`)
}

export function proxyPoolValidateBatch(
  ids: string[],
  concurrency?: number
): Promise<{ snapshot: ProxyPoolSnapshot }> {
  return postJson('/api/proxy-pool/validate', { ids, concurrency })
}

export function proxyPoolBindAccount(
  accountId: string,
  proxyId: string
): Promise<{ success: boolean; error?: string }> {
  return postJson(`/api/proxy-pool/accounts/${encodePath(accountId)}/binding`, { proxyId })
}

export function proxyPoolBindAccounts(
  accountIds: string[],
  proxyId: string
): Promise<{ success: boolean; count: number; error?: string }> {
  return postJson('/api/proxy-pool/accounts/bind', { accountIds, proxyId })
}

export function proxyPoolUnbindAccount(accountId: string): Promise<{ success: boolean }> {
  return deleteJson(`/api/proxy-pool/accounts/${encodePath(accountId)}/binding`)
}

export function proxyPoolClearBindings(): Promise<{ success: boolean; count: number }> {
  return deleteJson('/api/proxy-pool/accounts/bindings')
}

export async function proxyPoolGetAccountProxyUrl(accountId: string): Promise<string | undefined> {
  const result = await getJson<{ ok?: boolean; proxyUrl?: string }>(
    `/api/proxy-pool/accounts/${encodePath(accountId)}/proxy-url`
  )
  return result.proxyUrl
}
