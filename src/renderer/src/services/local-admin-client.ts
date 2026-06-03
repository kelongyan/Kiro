export interface LocalAdminClientOptions {
  baseUrl?: string | URL
  token?: string | null
}

export interface LocalAdminRequestOptions extends LocalAdminClientOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
}

export interface LocalAdminClient {
  getJson<TResponse = unknown>(path: string): Promise<TResponse>
  postJson<TResponse = unknown>(path: string, body?: unknown): Promise<TResponse>
  putJson<TResponse = unknown>(path: string, body?: unknown): Promise<TResponse>
  deleteJson<TResponse = unknown>(path: string): Promise<TResponse>
}

export interface LocalAdminClientErrorOptions {
  status: number
  path: string
  body: unknown
}

const ACCESS_TOKEN_STORAGE_KEY = 'kiro.localAdmin.accessToken'
const DEFAULT_LOCAL_ADMIN_BASE_URL = 'http://127.0.0.1:9527'

export class LocalAdminClientError extends Error {
  readonly status: number
  readonly path: string
  readonly body: unknown

  constructor(message: string, options: LocalAdminClientErrorOptions) {
    super(message)
    this.name = 'LocalAdminClientError'
    this.status = options.status
    this.path = options.path
    this.body = options.body
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getBrowserLocation(): Location | null {
  return typeof window === 'undefined' ? null : window.location
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function getCurrentOrigin(): string {
  const location = getBrowserLocation()
  return location?.origin && location.origin !== 'null'
    ? location.origin
    : DEFAULT_LOCAL_ADMIN_BASE_URL
}

function hasElectronBridge(): boolean {
  return typeof window !== 'undefined' && 'api' in window
}

function getConfiguredBaseUrl(): string {
  if (import.meta.env.VITE_KIRO_ADMIN_BASE_URL) {
    return import.meta.env.VITE_KIRO_ADMIN_BASE_URL
  }
  return hasElectronBridge() ? DEFAULT_LOCAL_ADMIN_BASE_URL : getCurrentOrigin()
}

function readTokenFromLocation(): string | null {
  const location = getBrowserLocation()
  if (!location) return null
  const token = new URLSearchParams(location.search).get('token')
  return token || null
}

function scrubTokenFromLocation(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return
  const location = getBrowserLocation()
  if (!location) return

  try {
    const base =
      location.origin && location.origin !== 'null' ? location.origin : DEFAULT_LOCAL_ADMIN_BASE_URL
    const url = new URL(`${base}${location.pathname}${location.search}${location.hash}`)
    if (!url.searchParams.has('token')) return
    url.searchParams.delete('token')
    const nextUrl = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState(window.history.state, '', nextUrl || '/')
  } catch {
    // Ignore URL rewrite failures and continue using the token from sessionStorage.
  }
}

function normalizeBaseUrl(baseUrl?: string | URL): URL {
  const rawBaseUrl = baseUrl ? baseUrl.toString() : getConfiguredBaseUrl()
  return new URL(rawBaseUrl)
}

function getResponseErrorMessage(body: unknown, fallback: string): string {
  if (isObject(body) && typeof body.error === 'string' && body.error.trim()) {
    return body.error
  }
  return fallback
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new LocalAdminClientError('Local admin response is not valid JSON', {
      status: response.status,
      path: response.url,
      body: text
    })
  }
}

export function getLocalAdminBaseUrl(baseUrl?: string | URL): URL {
  return normalizeBaseUrl(baseUrl)
}

export function resolveLocalAdminUrl(path: string, baseUrl?: string | URL): URL {
  const base = getLocalAdminBaseUrl(baseUrl)
  const normalizedBase = base.href.endsWith('/') ? base : new URL(`${base.href}/`)
  return new URL(path, normalizedBase)
}

export function setLocalAdminAccessToken(token: string | null): void {
  const storage = getSessionStorage()
  if (!storage) return
  if (token) {
    storage.setItem(ACCESS_TOKEN_STORAGE_KEY, token)
  } else {
    storage.removeItem(ACCESS_TOKEN_STORAGE_KEY)
  }
}

export function getLocalAdminAccessToken(): string | null {
  const tokenFromUrl = readTokenFromLocation()
  if (tokenFromUrl) {
    const storage = getSessionStorage()
    if (storage) {
      storage.setItem(ACCESS_TOKEN_STORAGE_KEY, tokenFromUrl)
      scrubTokenFromLocation()
    }
    return tokenFromUrl
  }

  return getSessionStorage()?.getItem(ACCESS_TOKEN_STORAGE_KEY) || null
}

export async function requestJson<TResponse = unknown>(
  path: string,
  options: LocalAdminRequestOptions = {}
): Promise<TResponse> {
  const method = options.method || 'GET'
  const url = resolveLocalAdminUrl(path, options.baseUrl)
  const token = options.token ?? getLocalAdminAccessToken()
  const headers = new Headers()

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
  const body = await readJsonBody(response)

  if (!response.ok) {
    throw new LocalAdminClientError(
      getResponseErrorMessage(body, `Local admin request failed: HTTP ${response.status}`),
      {
        status: response.status,
        path: url.pathname,
        body
      }
    )
  }

  if (isObject(body) && body.ok === false) {
    throw new LocalAdminClientError(getResponseErrorMessage(body, 'Local admin request failed'), {
      status: response.status,
      path: url.pathname,
      body
    })
  }

  return body as TResponse
}

export function createLocalAdminClient(options: LocalAdminClientOptions = {}): LocalAdminClient {
  return {
    getJson<TResponse = unknown>(path: string): Promise<TResponse> {
      return requestJson<TResponse>(path, {
        ...options,
        method: 'GET'
      })
    },
    postJson<TResponse = unknown>(path: string, body?: unknown): Promise<TResponse> {
      return requestJson<TResponse>(path, {
        ...options,
        method: 'POST',
        body
      })
    },
    putJson<TResponse = unknown>(path: string, body?: unknown): Promise<TResponse> {
      return requestJson<TResponse>(path, {
        ...options,
        method: 'PUT',
        body
      })
    },
    deleteJson<TResponse = unknown>(path: string): Promise<TResponse> {
      return requestJson<TResponse>(path, {
        ...options,
        method: 'DELETE'
      })
    }
  }
}

const defaultClient = createLocalAdminClient()

export function getJson<TResponse = unknown>(path: string): Promise<TResponse> {
  return defaultClient.getJson<TResponse>(path)
}

export function postJson<TResponse = unknown>(path: string, body?: unknown): Promise<TResponse> {
  return defaultClient.postJson<TResponse>(path, body)
}

export function putJson<TResponse = unknown>(path: string, body?: unknown): Promise<TResponse> {
  return defaultClient.putJson<TResponse>(path, body)
}

export function deleteJson<TResponse = unknown>(path: string): Promise<TResponse> {
  return defaultClient.deleteJson<TResponse>(path)
}
