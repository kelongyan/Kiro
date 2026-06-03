import { createLocalAdminServer } from '../../src/server/http/local-admin-server'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

async function run(): Promise<void> {
  const server = createLocalAdminServer({
    host: '127.0.0.1',
    port: 0,
    accessToken: 'fixed-token'
  })
  const info = await server.listen()

  try {
    assert(info.accessToken === 'fixed-token', 'server should honor KIRO_ADMIN_TOKEN override')

    const health = await fetch(`${info.baseUrl}/api/health`)
    assert(health.status === 200, 'health should be public')

    const unauthorized = await fetch(`${info.baseUrl}/api/events/test`, { method: 'POST' })
    assert(unauthorized.status === 401, 'protected endpoints should reject missing token')

    const authorizedByHeader = await fetch(`${info.baseUrl}/api/events/test`, {
      method: 'POST',
      headers: { Authorization: 'Bearer fixed-token' }
    })
    assert(authorizedByHeader.status === 200, 'header bearer token should be accepted')

    const authorizedByQuery = await fetch(`${info.baseUrl}/api/events?token=fixed-token`)
    assert(authorizedByQuery.status === 200, 'query token should still be accepted for SSE')
    await authorizedByQuery.body?.cancel()

    const randomServer = createLocalAdminServer({ host: '127.0.0.1', port: 0 })
    const randomInfo = await randomServer.listen()
    try {
      assert(
        typeof randomInfo.accessToken === 'string' && randomInfo.accessToken.length >= 24,
        'server should generate random token by default'
      )
    } finally {
      await randomServer.close()
    }
  } finally {
    await server.close()
  }
}

await run()
