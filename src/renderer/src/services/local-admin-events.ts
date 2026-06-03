import {
  getLocalAdminAccessToken,
  resolveLocalAdminUrl,
  type LocalAdminClientOptions
} from './local-admin-client'

export interface LocalAdminServerEvent<TPayload = unknown> {
  id: string
  type: string
  payload: TPayload
  createdAt: string
}

export interface BatchAccountResultPayload {
  id: string
  success: boolean
  data?: unknown
  error?: string
}

export interface ProxyWebhookTriggerPayload {
  event: string
  payload: Record<string, unknown>
}

export interface ProxyAccountSuspendedPayload {
  id: string
  email?: string
  reason: string
  message: string
  suspendedAt: number
}

export interface ProxyRequestPayload {
  requestId?: string
  path: string
  method: string
  apiKeyId?: string
  accountId?: string
}

export interface ProxyResponsePayload {
  requestId?: string
  path: string
  model?: string
  apiKeyId?: string
  accountId?: string
  status: number
  tokens?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  credits?: number
  responseTime?: number
  error?: string
}

export interface ProxyStatusChangePayload {
  running: boolean
  port: number
}

export interface KProxyRequestPayload {
  timestamp: number
  method: string
  host: string
  path: string
  isMitm: boolean
  deviceIdReplaced: boolean
}

export interface KProxyResponsePayload {
  timestamp: number
  host: string
  statusCode: number
  duration: number
}

export interface KProxyStatusChangePayload {
  running: boolean
  port: number
}

export interface KProxyMitmPayload {
  host: string
  modified: boolean
}

export interface RegistrationLogPayload {
  message: string
  taskId?: string
}

export interface RegistrationCompletePayload {
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

export interface SocialAuthCallbackPayload {
  code?: string
  state?: string
  error?: string
}

export interface SchedulerTaskPayload {
  task: unknown
  run?: unknown
}

export interface LocalAdminEventMap {
  test: { message?: string }
  'background-refresh-result': BatchAccountResultPayload
  'background-check-result': BatchAccountResultPayload
  'proxy-webhook-trigger': ProxyWebhookTriggerPayload
  'proxy-request': ProxyRequestPayload
  'proxy-response': ProxyResponsePayload
  'proxy-error': string
  'proxy-status-change': ProxyStatusChangePayload
  'proxy-account-suspended': ProxyAccountSuspendedPayload
  'kproxy-request': KProxyRequestPayload
  'kproxy-response': KProxyResponsePayload
  'kproxy-error': string
  'kproxy-status-change': KProxyStatusChangePayload
  'kproxy-mitm': KProxyMitmPayload
  'registration-log': RegistrationLogPayload
  'registration-complete': RegistrationCompletePayload
  'social-auth-callback': SocialAuthCallbackPayload
  'scheduler-task-started': SchedulerTaskPayload
  'scheduler-task-progress': unknown
  'scheduler-task-completed': SchedulerTaskPayload
  'scheduler-task-failed': SchedulerTaskPayload
  'scheduler-task-paused': SchedulerTaskPayload
}

export type LocalAdminEventPayload<TType extends string> =
  TType extends keyof LocalAdminEventMap ? LocalAdminEventMap[TType] : unknown

export type LocalAdminEventListener<TPayload = unknown> = (
  event: LocalAdminServerEvent<TPayload>
) => void

export interface LocalAdminEventsClientOptions extends LocalAdminClientOptions {
  reconnectDelayMs?: number
}

export interface LocalAdminEventsClient {
  connect(): void
  reconnect(): void
  close(): void
  on<TType extends string>(
    type: TType,
    listener: LocalAdminEventListener<LocalAdminEventPayload<TType>>
  ): () => void
  off<TType extends string>(
    type: TType,
    listener: LocalAdminEventListener<LocalAdminEventPayload<TType>>
  ): void
}

const DEFAULT_RECONNECT_DELAY_MS = 2000

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function createEventsUrl(options: LocalAdminEventsClientOptions): URL {
  const url = resolveLocalAdminUrl('/api/events', options.baseUrl)
  const token = options.token ?? getLocalAdminAccessToken()
  if (token) {
    url.searchParams.set('token', token)
  }
  return url
}

function parseServerEvent(message: MessageEvent<string>): LocalAdminServerEvent | null {
  try {
    const parsed = JSON.parse(message.data) as unknown
    if (!isObject(parsed)) return null
    const type = typeof parsed.type === 'string' ? parsed.type : message.type
    return {
      id: typeof parsed.id === 'string' ? parsed.id : '',
      type,
      payload: parsed.payload,
      createdAt:
        typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString()
    }
  } catch {
    return null
  }
}

export function createLocalAdminEventsClient(
  options: LocalAdminEventsClientOptions = {}
): LocalAdminEventsClient {
  const listeners = new Map<string, Set<LocalAdminEventListener<unknown>>>()
  const eventHandlers = new Map<string, EventListener>()
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS
  let source: EventSource | null = null
  let reconnectTimer: number | null = null
  let closed = true

  const clearReconnectTimer = (): void => {
    if (reconnectTimer === null) return
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const dispatchEvent = (event: LocalAdminServerEvent): void => {
    const typedListeners = listeners.get(event.type)
    if (!typedListeners) return
    for (const listener of typedListeners) {
      listener(event)
    }
  }

  const ensureEventHandler = (type: string): EventListener => {
    const existing = eventHandlers.get(type)
    if (existing) return existing

    const handler: EventListener = (rawEvent) => {
      const event = parseServerEvent(rawEvent as MessageEvent<string>)
      if (event) {
        dispatchEvent(event)
      }
    }
    eventHandlers.set(type, handler)
    source?.addEventListener(type, handler)
    return handler
  }

  const attachEventHandlers = (): void => {
    if (!source) return
    for (const [type, handler] of eventHandlers) {
      source.addEventListener(type, handler)
    }
  }

  const scheduleReconnect = (): void => {
    if (closed || reconnectTimer !== null) return
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      if (!closed) {
        client.reconnect()
      }
    }, reconnectDelayMs)
  }

  const closeSource = (): void => {
    if (!source) return
    source.close()
    source = null
  }

  const client: LocalAdminEventsClient = {
    connect(): void {
      if (source || typeof EventSource === 'undefined') return
      closed = false
      clearReconnectTimer()
      source = new EventSource(createEventsUrl(options))
      attachEventHandlers()
      source.onerror = () => {
        if (!closed && source?.readyState === EventSource.CLOSED) {
          closeSource()
          scheduleReconnect()
        }
      }
    },
    reconnect(): void {
      clearReconnectTimer()
      closeSource()
      closed = false
      client.connect()
    },
    close(): void {
      closed = true
      clearReconnectTimer()
      closeSource()
    },
    on<TType extends string>(
      type: TType,
      listener: LocalAdminEventListener<LocalAdminEventPayload<TType>>
    ): () => void {
      const typedListener = listener as LocalAdminEventListener<unknown>
      const typeListeners = listeners.get(type) || new Set<LocalAdminEventListener<unknown>>()
      typeListeners.add(typedListener)
      listeners.set(type, typeListeners)
      ensureEventHandler(type)
      return () => client.off(type, listener)
    },
    off<TType extends string>(
      type: TType,
      listener: LocalAdminEventListener<LocalAdminEventPayload<TType>>
    ): void {
      const typedListener = listener as LocalAdminEventListener<unknown>
      const typeListeners = listeners.get(type)
      if (!typeListeners) return
      typeListeners.delete(typedListener)
      if (typeListeners.size === 0) {
        listeners.delete(type)
      }
    }
  }

  return client
}

const defaultEventsClient = createLocalAdminEventsClient()

export function connectLocalAdminEvents(): void {
  defaultEventsClient.connect()
}

export function reconnectLocalAdminEvents(): void {
  defaultEventsClient.reconnect()
}

export function closeLocalAdminEvents(): void {
  defaultEventsClient.close()
}

export function onLocalAdminEvent<TType extends string>(
  type: TType,
  listener: LocalAdminEventListener<LocalAdminEventPayload<TType>>
): () => void {
  return defaultEventsClient.on(type, listener)
}

export function offLocalAdminEvent<TType extends string>(
  type: TType,
  listener: LocalAdminEventListener<LocalAdminEventPayload<TType>>
): void {
  defaultEventsClient.off(type, listener)
}
