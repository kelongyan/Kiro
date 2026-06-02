import type { IncomingMessage, ServerResponse } from 'http'

// ============ 类型 ============

export interface RouteContext {
  url: URL
  params: Record<string, string>
  query: URLSearchParams
  body: unknown
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
) => void | Promise<void>

interface RouteEntry {
  method: string
  pattern: string
  segments: string[]
  handler: RouteHandler
}

// ============ JSON Body 解析 ============

const MAX_BODY_SIZE = 1024 * 1024 // 1 MB

export function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers['content-type']
  if (!contentType || !contentType.includes('application/json')) {
    return Promise.resolve(undefined)
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_SIZE) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined)
        return
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf-8')
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })

    req.on('error', reject)
  })
}

// ============ Router ============

/**
 * 轻量级 HTTP 路由器。
 *
 * 支持路径参数（`:param`）和通配符（`*`）。
 * 按注册顺序匹配，先到先服务。
 */
export class Router {
  private routes: RouteEntry[] = []

  get(pattern: string, handler: RouteHandler): this {
    return this.add('GET', pattern, handler)
  }

  post(pattern: string, handler: RouteHandler): this {
    return this.add('POST', pattern, handler)
  }

  put(pattern: string, handler: RouteHandler): this {
    return this.add('PUT', pattern, handler)
  }

  delete(pattern: string, handler: RouteHandler): this {
    return this.add('DELETE', pattern, handler)
  }

  add(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      segments: pattern.split('/').filter(Boolean),
      handler
    })
    return this
  }

  /**
   * 匹配请求并调用对应 handler。
   * 返回 true 表示匹配成功，false 表示没有匹配路由。
   */
  async dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const method = (req.method || 'GET').toUpperCase()
    const pathSegments = url.pathname.split('/').filter(Boolean)

    for (const route of this.routes) {
      if (route.method !== method) continue

      const params = matchSegments(route.segments, pathSegments)
      if (!params) continue

      let body: unknown
      try {
        body = await parseJsonBody(req)
      } catch (err) {
        writeJsonResponse(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : 'Bad request'
        })
        return true
      }

      const ctx: RouteContext = {
        url,
        params,
        query: url.searchParams,
        body
      }

      try {
        await route.handler(req, res, ctx)
      } catch (err) {
        if (!res.writableEnded) {
          writeJsonResponse(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : 'Internal server error'
          })
        }
      }
      return true
    }

    return false
  }
}

// ============ 辅助函数 ============

function matchSegments(
  routeSegments: string[],
  pathSegments: string[]
): Record<string, string> | null {
  if (routeSegments.length !== pathSegments.length) return null

  const params: Record<string, string> = {}

  for (let i = 0; i < routeSegments.length; i++) {
    const routeSeg = routeSegments[i]
    const pathSeg = pathSegments[i]

    if (routeSeg.startsWith(':')) {
      params[routeSeg.slice(1)] = decodeURIComponent(pathSeg)
    } else if (routeSeg === '*') {
      // wildcard matches rest, but we require exact length match above
      params['*'] = pathSeg
    } else if (routeSeg !== pathSeg) {
      return null
    }
  }

  return params
}

export function writeJsonResponse(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  })
  res.end(JSON.stringify(body))
}
