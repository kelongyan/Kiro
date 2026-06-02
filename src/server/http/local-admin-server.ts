import { randomBytes } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { publishEvent, subscribeEvents, getEventHistory, type ServerEvent } from '../events'
import { Router } from './router'

export interface LocalAdminServerOptions {
  host?: string
  port?: number
  accessToken?: string
  /** 额外注册的路由器（账号、认证等控制器） */
  routers?: Router[]
}

export interface LocalAdminServerInfo {
  host: string
  port: number
  baseUrl: string
  adminUrl: string
  accessToken: string
}

export interface LocalAdminServer {
  readonly host: string
  readonly port: number
  readonly accessToken: string
  listen(): Promise<LocalAdminServerInfo>
  close(): Promise<void>
  getInfo(): LocalAdminServerInfo | null
}

const DEFAULT_HOST = '127.0.0.1'

function createAccessToken(): string {
  return randomBytes(24).toString('base64url')
}

function isLoopbackAddress(address?: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true
  try {
    const parsed = new URL(origin)
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  } catch {
    return false
  }
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  if (typeof origin === 'string' && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type')
}

function getBearerToken(req: IncomingMessage, url: URL): string | null {
  const queryToken = url.searchParams.get('token')
  if (queryToken) return queryToken

  const header = req.headers.authorization
  if (!header) return null

  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1] : null
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  })
  res.end(JSON.stringify(body))
}

function formatSseEvent(event: ServerEvent): string {
  return (
    [`id: ${event.id}`, `event: ${event.type}`, `data: ${JSON.stringify(event)}`, ''].join('\n') +
    '\n'
  )
}

export function createLocalAdminServer(options: LocalAdminServerOptions = {}): LocalAdminServer {
  const host = options.host || DEFAULT_HOST
  const port = options.port ?? 0
  const accessToken = options.accessToken || createAccessToken()
  const routers = options.routers || []
  let server: Server | null = null
  let info: LocalAdminServerInfo | null = null

  const ensureAuthorized = (req: IncomingMessage, url: URL, res: ServerResponse): boolean => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      writeJson(res, 403, { ok: false, error: 'Only local connections are allowed' })
      return false
    }

    const token = getBearerToken(req, url)
    if (token !== accessToken) {
      writeJson(res, 401, { ok: false, error: 'Invalid or missing local access token' })
      return false
    }

    return true
  }

  const handleEvents = (req: IncomingMessage, url: URL, res: ServerResponse): void => {
    if (!ensureAuthorized(req, url, res)) return

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    const lastEventId = req.headers['last-event-id']
    const history = getEventHistory(typeof lastEventId === 'string' ? lastEventId : undefined)
    for (const event of history) {
      res.write(formatSseEvent(event))
    }

    const unsubscribe = subscribeEvents((event) => {
      res.write(formatSseEvent(event))
    })

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n')
    }, 30000)

    req.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  }

  const requestHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    setCorsHeaders(req, res)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (!isAllowedOrigin(typeof req.headers.origin === 'string' ? req.headers.origin : undefined)) {
      writeJson(res, 403, { ok: false, error: 'Origin is not allowed' })
      return
    }

    const url = new URL(req.url || '/', `http://${host}`)

    // 内置端点：health 无需 token
    if (req.method === 'GET' && url.pathname === '/api/health') {
      writeJson(res, 200, {
        ok: true,
        service: 'kiro-local-admin',
        host,
        requiresToken: true
      })
      return
    }

    // 内置端点：events 需要授权
    if (req.method === 'GET' && url.pathname === '/api/events') {
      handleEvents(req, url, res)
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/events/test') {
      if (!ensureAuthorized(req, url, res)) return
      const event = publishEvent('test', { message: 'local admin event bus is ready' })
      writeJson(res, 200, { ok: true, event })
      return
    }

    // 控制器路由分发（需要授权）
    if (routers.length > 0) {
      if (!ensureAuthorized(req, url, res)) return
      for (const router of routers) {
        const matched = await router.dispatch(req, res, url)
        if (matched) return
      }
    }

    writeJson(res, 404, { ok: false, error: 'Not found' })
  }

  return {
    host,
    port,
    accessToken,
    async listen(): Promise<LocalAdminServerInfo> {
      if (server && info) return info

      server = createServer(requestHandler)

      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject)
        server!.listen(port, host, () => {
          server!.off('error', reject)
          resolve()
        })
      })

      const address = server.address()
      const actualPort = typeof address === 'object' && address ? address.port : port
      const baseUrl = `http://${host}:${actualPort}`
      info = {
        host,
        port: actualPort,
        baseUrl,
        adminUrl: `${baseUrl}/?token=${encodeURIComponent(accessToken)}`,
        accessToken
      }
      return info
    },
    async close(): Promise<void> {
      if (!server) return
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
      server = null
      info = null
    },
    getInfo(): LocalAdminServerInfo | null {
      return info
    }
  }
}
