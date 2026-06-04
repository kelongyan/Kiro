import { ProxyServer } from '../../src/core/proxy'
import type { ProxyAccount } from '../../src/core/proxy'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function makeAccount(id: string): ProxyAccount {
  return {
    id,
    email: `${id}@example.com`,
    accessToken: `access-${id}`,
    refreshToken: `refresh-${id}`,
    authMethod: 'social'
  }
}

async function transportErrorsTriggerFailoverAndPenalty(): Promise<void> {
  const server = new ProxyServer({
    enableMultiAccount: true,
    maxRetries: 2,
    retryDelayMs: 1
  })
  const primary = makeAccount('primary')
  const secondary = makeAccount('secondary')
  const pool = server.getAccountPool()
  pool.addAccount(primary)
  pool.addAccount(secondary)

  const attempts: string[] = []
  const callWithRetry = (
    server as unknown as {
      callWithRetry<T>(
        account: ProxyAccount,
        apiCall: (acc: ProxyAccount, endpointIndex: number) => Promise<T>,
        path: string
      ): Promise<{ result: T; account: ProxyAccount }>
    }
  ).callWithRetry.bind(server)

  const result = await callWithRetry(
    primary,
    async (account: ProxyAccount) => {
      attempts.push(account.id)
      if (account.id === primary.id) {
        throw new Error('fetch failed')
      }
      return { accountId: account.id }
    },
    '/v1/chat/completions'
  )

  assert(attempts.length === 2, 'transport error should trigger a retry on another account')
  assert(
    attempts[0] === primary.id && attempts[1] === secondary.id,
    'retry should move from the failing account to the next available account'
  )
  assert(result.account.id === secondary.id, 'successful retry should return the secondary account')
  assert(
    pool.getAccount(primary.id)?.errorCount === 1,
    'failing account should be penalized after a transport error'
  )
}

function transportErrorsStayRecoverableInFinalErrorHandling(): void {
  const server = new ProxyServer({
    enableMultiAccount: true
  })
  const account = makeAccount('primary')
  const pool = server.getAccountPool()
  pool.addAccount(account)

  const response = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    statusCode: 0,
    body: '',
    writeHead(status: number) {
      this.statusCode = status
      this.headersSent = true
    },
    end(payload?: string) {
      this.writableEnded = true
      this.body = payload || ''
    }
  }

  const handleApiError = (
    server as unknown as {
      handleApiError(
        res: typeof response,
        account: { id: string },
        error: Error,
        path: string,
        model?: string,
        startTime?: number
      ): void
    }
  ).handleApiError.bind(server)

  handleApiError(
    response,
    account,
    new Error('fetch failed'),
    '/v1/chat/completions',
    'claude-sonnet-4.5',
    Date.now()
  )

  assert(response.statusCode === 500, 'transport failures should still surface as HTTP 500 to clients')
  assert(
    pool.getAccount(account.id)?.errorCount === 1,
    'transport failure should be treated as recoverable for account penalty tracking'
  )
}

async function streamRecoveryPrefersFailoverForSuspendedAndTransportErrors(): Promise<void> {
  const server = new ProxyServer({
    enableMultiAccount: true
  })
  const primary = makeAccount('primary')
  const secondary = makeAccount('secondary')
  const pool = server.getAccountPool()
  pool.addAccount(primary)
  pool.addAccount(secondary)

  const recoverStreamError = (
    server as unknown as {
      recoverStreamError(
        account: ProxyAccount,
        error: Error,
        hasStreamedContent: boolean
      ): Promise<ProxyAccount | null>
    }
  ).recoverStreamError.bind(server)

  const suspendedNext = await recoverStreamError(
    primary,
    new Error(
      `Auth error 403: {"message":"Your User ID (6458c4a8-30f1-704e-2a43-28f80dca5cca) temporarily is suspended. We've locked your account as a security precaution.","reason":null}`
    ),
    false
  )

  assert(
    suspendedNext?.id === secondary.id,
    'suspended stream errors should fail over to the next available account'
  )
  assert(
    pool.getAccount(primary.id)?.suspendedAt,
    'suspended stream errors should mark the failing account as suspended'
  )

  const transportServer = new ProxyServer({
    enableMultiAccount: true
  })
  const transportPrimary = makeAccount('transport-primary')
  const transportSecondary = makeAccount('transport-secondary')
  const transportPool = transportServer.getAccountPool()
  transportPool.addAccount(transportPrimary)
  transportPool.addAccount(transportSecondary)

  const transportNext = await (
    transportServer as unknown as {
      recoverStreamError(
        account: ProxyAccount,
        error: Error,
        hasStreamedContent: boolean
      ): Promise<ProxyAccount | null>
    }
  ).recoverStreamError(
    transportPrimary,
    new Error('fetch failed'),
    false
  )

  assert(
    transportNext?.id === transportSecondary.id,
    'transport stream errors should fail over to the next available account'
  )
  assert(
    transportPool.getAccount(transportPrimary.id)?.errorCount === 1,
    'transport stream errors should penalize the failing account'
  )
}

async function claudeStreamTransportErrorsFailOverBeforeAnyOutput(): Promise<void> {
  const server = new ProxyServer({
    enableMultiAccount: true,
    preferredEndpoint: 'amazonq'
  })
  const primary = makeAccount('claude-primary')
  const secondary = makeAccount('claude-secondary')
  const pool = server.getAccountPool()
  pool.addAccount(primary)
  pool.addAccount(secondary)

  const originalFetch = globalThis.fetch
  const originalDisableAutoProxy = process.env.KIRO_DISABLE_AUTO_PROXY
  const attempts: string[] = []
  const response = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    statusCode: 0,
    body: '',
    writeHead(status: number) {
      this.statusCode = status
      this.headersSent = true
    },
    write(payload: string) {
      this.body += payload
      return true
    },
    end(payload?: string) {
      this.writableEnded = true
      if (payload) this.body += payload
    }
  }

  process.env.KIRO_DISABLE_AUTO_PROXY = '1'
  globalThis.fetch = async (_url: string | URL | Request, options?: RequestInit) => {
    const headers = options?.headers as Record<string, string> | Headers | undefined
    const authHeader =
      headers instanceof Headers
        ? headers.get('authorization')
        : headers?.Authorization || headers?.authorization

    if (authHeader?.includes(primary.accessToken)) {
      attempts.push(primary.id)
      throw new Error('fetch failed')
    }

    if (authHeader?.includes(secondary.accessToken)) {
      attempts.push(secondary.id)
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.close()
          }
        }),
        { status: 200 }
      )
    }

    throw new Error(`Unexpected authorization header: ${authHeader || 'missing'}`)
  }

  try {
    const handleClaudeStream = (
      server as unknown as {
        handleClaudeStream(
          res: typeof response,
          account: ProxyAccount,
          buildPayload: (
            account: ProxyAccount
          ) => {
            conversationState: {
              chatTriggerType: 'MANUAL'
              conversationId: string
              currentMessage: {
                userInputMessage: {
                  content: string
                  modelId: string
                  origin: string
                }
              }
            }
          },
          model: string,
          startTime: number
        ): Promise<void>
      }
    ).handleClaudeStream.bind(server)

    await handleClaudeStream(
      response,
      primary,
      () => ({
        conversationState: {
          chatTriggerType: 'MANUAL',
          conversationId: 'claude-stream-retry',
          currentMessage: {
            userInputMessage: {
              content: 'hello',
              modelId: 'claude-sonnet-4.5',
              origin: 'AI_EDITOR'
            }
          }
        }
      }),
      'claude-sonnet-4.5',
      Date.now()
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalDisableAutoProxy === undefined) {
      delete process.env.KIRO_DISABLE_AUTO_PROXY
    } else {
      process.env.KIRO_DISABLE_AUTO_PROXY = originalDisableAutoProxy
    }
  }

  assert(
    attempts.length >= 2,
    'claude stream transport failure should retry against another account before failing'
  )
  assert(
    attempts.includes(primary.id) && attempts.includes(secondary.id),
    'claude stream retry should move from the failing account to the next available account'
  )
  assert(
    response.body.includes('event: message_stop'),
    'claude stream retry should finish the stream successfully'
  )
  assert(
    !response.body.includes('event: error'),
    'claude stream retry should not emit an error event when failover succeeds before output'
  )
  assert(
    (response.body.match(/event: message_start/g) || []).length === 1,
    'claude stream retry should not duplicate the initial message_start event'
  )
  assert(
    pool.getAccount(primary.id)?.errorCount === 1,
    'claude stream retry should penalize the failing primary account exactly once'
  )
}

await transportErrorsTriggerFailoverAndPenalty()
transportErrorsStayRecoverableInFinalErrorHandling()
await streamRecoveryPrefersFailoverForSuspendedAndTransportErrors()
await claudeStreamTransportErrorsFailOverBeforeAnyOutput()
