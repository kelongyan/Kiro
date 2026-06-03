import { RegistrationService } from '../../src/server/services/registration/registration-service'
import type { RegistrationConfig, RegistrationResult } from '../../src/core/registration'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

interface Report {
  id: string
  success: boolean
  boundEmail?: string
  error?: string
}

async function autoRegistrationUsesProxyPoolWhenProxyIsMissing(): Promise<void> {
  const seenProxies: string[] = []
  const reports: Report[] = []

  const service = new RegistrationService({
    emitEvent: () => undefined,
    pickProxyForRegistration: () => ({
      id: 'proxy-1',
      url: 'http://127.0.0.1:8080',
      protocol: 'http',
      host: '127.0.0.1',
      port: 8080
    }),
    reportProxyResult: (id, success, boundEmail, error) => {
      reports.push({ id, success, boundEmail, error })
    },
    createRegistrar: (config: RegistrationConfig) => {
      seenProxies.push(config.proxy)
      return {
        run: async (): Promise<RegistrationResult> => ({
          status: 'success',
          email: 'auto@example.com'
        }),
        runManualPhase1: async () => ({ success: true }),
        runManualPhase2: async () => ({ success: true }),
        runManualPhase3: async (): Promise<RegistrationResult> => ({
          status: 'success',
          email: 'manual@example.com'
        }),
        abort: () => undefined,
        destroy: async () => undefined
      }
    }
  })

  const result = await service.startAuto({})
  assert(result.success, 'auto registration should succeed in fixture')
  assert(seenProxies[0] === 'http://127.0.0.1:8080', 'auto registration should receive pool proxy')
  assert(reports.length === 1, 'auto registration should report proxy result')
  assert(reports[0].id === 'proxy-1', 'proxy report should include selected proxy id')
  assert(reports[0].success === true, 'proxy report should mark successful registration')
  assert(
    reports[0].boundEmail === 'auto@example.com',
    'proxy report should include registered email'
  )
}

async function explicitProxyDoesNotConsumeProxyPool(): Promise<void> {
  let picked = 0
  const seenProxies: string[] = []

  const service = new RegistrationService({
    emitEvent: () => undefined,
    pickProxyForRegistration: () => {
      picked++
      return {
        id: 'proxy-1',
        url: 'http://127.0.0.1:8080',
        protocol: 'http',
        host: '127.0.0.1',
        port: 8080
      }
    },
    reportProxyResult: () => undefined,
    createRegistrar: (config: RegistrationConfig) => {
      seenProxies.push(config.proxy)
      return {
        run: async (): Promise<RegistrationResult> => ({
          status: 'success',
          email: 'explicit@example.com'
        }),
        runManualPhase1: async () => ({ success: true }),
        runManualPhase2: async () => ({ success: true }),
        runManualPhase3: async (): Promise<RegistrationResult> => ({
          status: 'success',
          email: 'manual@example.com'
        }),
        abort: () => undefined,
        destroy: async () => undefined
      }
    }
  })

  await service.startAuto({ proxy: 'http://explicit.test:8000' })
  assert(picked === 0, 'explicit proxy should not ask proxy pool for another proxy')
  assert(seenProxies[0] === 'http://explicit.test:8000', 'explicit proxy should be preserved')
}

async function manualRegistrationReportsSelectedProxyAfterOtp(): Promise<void> {
  const seenProxies: string[] = []
  const reports: Report[] = []

  const service = new RegistrationService({
    emitEvent: () => undefined,
    pickProxyForRegistration: () => ({
      id: 'proxy-manual',
      url: 'http://127.0.0.1:9090',
      protocol: 'http',
      host: '127.0.0.1',
      port: 9090
    }),
    reportProxyResult: (id, success, boundEmail, error) => {
      reports.push({ id, success, boundEmail, error })
    },
    createRegistrar: (config: RegistrationConfig) => {
      seenProxies.push(config.proxy)
      return {
        run: async (): Promise<RegistrationResult> => ({
          status: 'success',
          email: 'auto@example.com'
        }),
        runManualPhase1: async () => ({ success: true }),
        runManualPhase2: async () => ({ success: true }),
        runManualPhase3: async (): Promise<RegistrationResult> => ({
          status: 'success',
          email: 'manual@example.com'
        }),
        abort: () => undefined,
        destroy: async () => undefined
      }
    }
  })

  const phase1 = await service.manualPhase1({})
  assert(phase1.success, 'manual phase1 should succeed in fixture')
  assert(
    seenProxies[0] === 'http://127.0.0.1:9090',
    'manual registration should receive pool proxy'
  )

  await service.manualPhase2('manual@example.com')
  const result = await service.manualPhase3('123456')
  assert(result.success, 'manual phase3 should succeed in fixture')
  assert(reports[0].id === 'proxy-manual', 'manual flow should report selected proxy')
  assert(reports[0].success === true, 'manual proxy report should mark success')
  assert(reports[0].boundEmail === 'manual@example.com', 'manual proxy report should include email')
}

await autoRegistrationUsesProxyPoolWhenProxyIsMissing()
await explicitProxyDoesNotConsumeProxyPool()
await manualRegistrationReportsSelectedProxyAfterOtp()
