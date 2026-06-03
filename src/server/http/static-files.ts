import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { extname, resolve, sep } from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

export interface StaticFileResult {
  handled: boolean
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`
  return child === parent || child.startsWith(normalizedParent)
}

function resolveStaticPath(staticRoot: string, pathname: string): string | null {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    return null
  }

  const normalizedUrlPath = decodedPath.replace(/\\/g, '/')
  const relativePath =
    normalizedUrlPath === '/' ? 'index.html' : normalizedUrlPath.replace(/^\/+/, '')
  const targetPath = resolve(staticRoot, relativePath)

  return isPathInside(staticRoot, targetPath) ? targetPath : null
}

function getContentType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function writeStatus(res: ServerResponse, statusCode: number, message: string): void {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8'
  })
  res.end(message)
}

async function tryServeFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string
): Promise<boolean> {
  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch {
    return false
  }

  if (!fileStat.isFile()) {
    return false
  }

  res.writeHead(200, {
    'Content-Type': getContentType(filePath),
    'Content-Length': fileStat.size,
    'Cache-Control':
      extname(filePath).toLowerCase() === '.html' ? 'no-cache' : 'public, max-age=3600'
  })

  if (req.method === 'HEAD') {
    res.end()
    return true
  }

  await new Promise<void>((resolveStream, rejectStream) => {
    const stream = createReadStream(filePath)
    stream.once('error', rejectStream)
    stream.once('end', resolveStream)
    stream.pipe(res)
  })
  return true
}

export async function serveStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  staticDir: string
): Promise<StaticFileResult> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return { handled: false }
  }

  const staticRoot = resolve(staticDir)
  const requestedPath = resolveStaticPath(staticRoot, url.pathname)
  if (!requestedPath) {
    writeStatus(res, 403, 'Forbidden')
    return { handled: true }
  }

  if (await tryServeFile(req, res, requestedPath)) {
    return { handled: true }
  }

  if (extname(requestedPath)) {
    writeStatus(res, 404, 'Not found')
    return { handled: true }
  }

  const indexPath = resolve(staticRoot, 'index.html')
  if (!isPathInside(staticRoot, indexPath) || !(await tryServeFile(req, res, indexPath))) {
    writeStatus(res, 404, 'Not found')
  }

  return { handled: true }
}
