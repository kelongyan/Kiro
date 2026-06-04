import {
  batchCheck,
  batchRefresh,
  type BatchCheckAccount,
  type BatchOperationDeps,
  type BatchRefreshAccount
} from '../../src/server/services/accounts/batch-operations'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function makeRefreshAccount(id: string): BatchRefreshAccount {
  return {
    id,
    email: `${id}@example.com`,
    credentials: {
      refreshToken: `refresh-${id}`,
      accessToken: `access-${id}`,
      authMethod: 'social'
    }
  }
}

function makeCheckAccount(id: string): BatchCheckAccount {
  return {
    id,
    email: `${id}@example.com`,
    credentials: {
      accessToken: `access-${id}`,
      authMethod: 'social'
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function refreshTimeoutMarksFailuresAndContinues(): Promise<void> {
  const events: Array<{ type: string; payload: unknown }> = []
  let refreshCalls = 0
  const deps: BatchOperationDeps = {
    tokenRefreshDeps: {},
    emitEvent: (type, payload) => {
      events.push({ type, payload })
    },
    checkAccount: async () => {
      return { success: true, status: 'active' }
    },
    refreshToken: async (account) => {
      refreshCalls++
      if (account.id === 'slow') {
        await wait(80)
        return { success: true, accessToken: 'slow-token', expiresIn: 3600 }
      }
      return { success: true, accessToken: `${account.id}-token`, expiresIn: 3600 }
    }
  } as BatchOperationDeps & {
    refreshToken: (account: BatchRefreshAccount) => Promise<{
      success: boolean
      accessToken?: string
      refreshToken?: string
      expiresIn?: number
      error?: string
    }>
  }

  const result = await batchRefresh(
    [makeRefreshAccount('slow'), makeRefreshAccount('fast')],
    2,
    false,
    deps,
    {
      perItemTimeoutMs: 20
    }
  )

  assert(refreshCalls === 2, 'batch refresh should still attempt every account')
  assert(result.completed === 2, 'timed out items should still count as completed')
  assert(result.failedCount === 1, 'timed out item should be counted as failure')
  assert(result.successCount === 1, 'healthy item should still succeed')
  assert(
    events.some(
      (event) =>
        event.type === 'background-refresh-result' &&
        (event.payload as { id?: string; success?: boolean; error?: string }).id === 'slow' &&
        (event.payload as { success?: boolean }).success === false
    ),
    'timed out refresh should emit a failed result event'
  )
}

async function checkCancellationStopsFutureWork(): Promise<void> {
  const controller = new AbortController()
  const started: string[] = []
  const deps: BatchOperationDeps = {
    tokenRefreshDeps: {},
    emitEvent: () => undefined,
    checkAccount: async (_accessToken, _idp, _machineId, _region, email) => {
      started.push(email || 'unknown')
      if (email === 'first@example.com') {
        controller.abort()
        await wait(30)
      }
      return { success: true, status: 'active' }
    }
  }

  const result = await batchCheck(
    [makeCheckAccount('first'), makeCheckAccount('second'), makeCheckAccount('third')],
    1,
    deps,
    {
      signal: controller.signal
    }
  )

  assert(started.length === 1, 'aborted batch check should not start additional accounts')
  assert(result.completed === 1, 'only the in-flight item should be counted after abort')
  assert(result.cancelled === true, 'aborted batch check should surface cancelled=true')
}

async function adaptiveConcurrencyShrinksAfterFailures(): Promise<void> {
  let maxObservedInFlight = 0
  let currentInFlight = 0
  const startedBatches: number[] = []
  const deps: BatchOperationDeps = {
    tokenRefreshDeps: {},
    emitEvent: () => undefined,
    checkAccount: async () => ({ success: true, status: 'active' }),
    refreshToken: async (account) => {
      currentInFlight++
      maxObservedInFlight = Math.max(maxObservedInFlight, currentInFlight)
      startedBatches.push(currentInFlight)
      await wait(10)
      currentInFlight--
      if (account.id === 'a' || account.id === 'b') {
        return { success: false, error: 'network failed' }
      }
      return { success: true, accessToken: `${account.id}-token`, expiresIn: 3600 }
    }
  } as BatchOperationDeps & {
    refreshToken: (account: BatchRefreshAccount) => Promise<{
      success: boolean
      accessToken?: string
      expiresIn?: number
      error?: string
    }>
  }

  await batchRefresh(
    [
      makeRefreshAccount('a'),
      makeRefreshAccount('b'),
      makeRefreshAccount('c'),
      makeRefreshAccount('d')
    ],
    2,
    false,
    deps,
    {
      adaptiveConcurrency: true
    }
  )

  assert(maxObservedInFlight === 2, 'initial concurrency should still be honored')
  assert(
    startedBatches.slice(2).every((value) => value === 1),
    'after an all-failure batch, later work should be throttled to concurrency 1'
  )
}

await refreshTimeoutMarksFailuresAndContinues()
await checkCancellationStopsFutureWork()
await adaptiveConcurrencyShrinksAfterFailures()
