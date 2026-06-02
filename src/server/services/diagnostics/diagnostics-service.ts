import type { Dispatcher, RequestInit as UndiciRequestInit } from 'undici'
import { fetch as undiciFetch } from 'undici'

export interface DiagnoseTarget {
  id: string
  label: string
  url: string
  timeoutMs?: number
  expectStatus?: number[]
}

export interface DiagnoseResult {
  id: string
  label: string
  url: string
  success: boolean
  httpStatus?: number
  latencyMs?: number
  error?: string
}

export interface DiagnosticsRunInput {
  proxyUrl?: string
  targets: DiagnoseTarget[]
}

export interface DiagnosticsHttpProbeInput {
  url: string
  method?: 'GET' | 'HEAD'
  timeoutMs?: number
}

export interface ProxyPoolValidateInput {
  url: string
  testUrl?: string
  timeoutMs?: number
}

export interface DiagnosticsServiceDeps {
  createProxyAgent?: (proxyUrl: string | undefined) => Dispatcher | undefined
  fetchWithAppProxy?: (url: string, init: RequestInit) => Promise<ProbeResponse>
}

interface ProbeResponse {
  ok: boolean
  status: number
  headers: {
    get(name: string): string | null
  }
  json(): Promise<unknown>
  text(): Promise<string>
}

export class DiagnosticsService {
  private deps: DiagnosticsServiceDeps

  constructor(deps: DiagnosticsServiceDeps = {}) {
    this.deps = deps
  }

  async run(params: DiagnosticsRunInput): Promise<{ results: DiagnoseResult[] }> {
    const { proxyUrl, targets } = params || { targets: [] }
    const agent = proxyUrl ? this.deps.createProxyAgent?.(proxyUrl) : undefined

    const results = await Promise.all(
      (targets || []).map((target) => this.checkTarget(target, agent))
    )
    return { results }
  }

  async httpProbe(params: DiagnosticsHttpProbeInput): Promise<{
    success: boolean
    latencyMs?: number
    status?: number
    error?: string
  }> {
    const { url, method = 'GET', timeoutMs = 5000 } = params || {}
    if (!url) return { success: false, error: 'Missing url' }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const start = Date.now()
    try {
      const fetcher =
        this.deps.fetchWithAppProxy ||
        ((targetUrl, init) =>
          undiciFetch(targetUrl, init as UndiciRequestInit) as Promise<ProbeResponse>)
      const resp = await fetcher(url, {
        method,
        signal: controller.signal,
        headers: { 'User-Agent': 'KiroAccountManager-Diagnose/1.0' }
      })
      const latencyMs = Date.now() - start
      return { success: resp.ok, latencyMs, status: resp.status }
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: controller.signal.aborted
          ? `Timeout (${timeoutMs}ms)`
          : error instanceof Error
            ? error.message
            : String(error)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async validateProxy(params: ProxyPoolValidateInput): Promise<{
    success: boolean
    latencyMs?: number
    externalIp?: string
    error?: string
  }> {
    const { url, testUrl = 'https://api.ipify.org?format=json', timeoutMs = 8000 } = params || {}
    if (!url) return { success: false, error: 'Missing proxy URL' }

    const agent = this.deps.createProxyAgent?.(url)
    if (!agent) {
      return {
        success: false,
        error: '代理协议不支持（仅支持 http/https）或 URL 无效'
      }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const start = Date.now()
    try {
      const resp = await undiciFetch(testUrl, {
        method: 'GET',
        dispatcher: agent,
        signal: controller.signal,
        headers: { 'User-Agent': 'KiroAccountManager-ProxyValidator/1.0' }
      } as UndiciRequestInit)
      const latencyMs = Date.now() - start
      if (resp.status >= 200 && resp.status < 400) {
        return { success: true, latencyMs, externalIp: await this.readExternalIp(resp) }
      }
      return { success: false, latencyMs, error: `HTTP ${resp.status}` }
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: controller.signal.aborted
          ? `请求超时 (${timeoutMs}ms)`
          : error instanceof Error
            ? error.message
            : String(error)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private async checkTarget(target: DiagnoseTarget, agent?: Dispatcher): Promise<DiagnoseResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), target.timeoutMs ?? 8000)
    const start = Date.now()
    try {
      const init: UndiciRequestInit = {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'KiroAccountManager-Diagnose/1.0' }
      }
      if (agent) init.dispatcher = agent
      const resp = await undiciFetch(target.url, init)
      const latencyMs = Date.now() - start
      const ok = target.expectStatus
        ? target.expectStatus.includes(resp.status)
        : resp.status >= 200 && resp.status < 400
      return {
        id: target.id,
        label: target.label,
        url: target.url,
        success: ok,
        httpStatus: resp.status,
        latencyMs,
        error: ok ? undefined : `HTTP ${resp.status}`
      }
    } catch (error) {
      return {
        id: target.id,
        label: target.label,
        url: target.url,
        success: false,
        latencyMs: Date.now() - start,
        error: controller.signal.aborted
          ? '超时'
          : error instanceof Error
            ? error.message
            : String(error)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private async readExternalIp(resp: ProbeResponse): Promise<string | undefined> {
    try {
      const contentType = resp.headers.get('content-type') || ''
      if (contentType.includes('json')) {
        const body = (await resp.json()) as { ip?: string; query?: string }
        return body.ip || body.query
      }
      const text = await resp.text()
      return text.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/)?.[0]
    } catch {
      return undefined
    }
  }
}
