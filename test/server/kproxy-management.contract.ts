import { createLocalAdminServer } from '../../src/server/http/local-admin-server'
import { createKProxyRouter } from '../../src/server/http/controllers/kproxy-controller'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

async function run(): Promise<void> {
  const calls: string[] = []
  const fakeService = {
    getStatus() {
      return {
        running: true,
        config: { host: '127.0.0.1', port: 8899, deviceId: 'abc' },
        stats: { totalRequests: 2 },
        caInfo: { certPath: 'C:/tmp/kproxy-ca.crt', validTo: '2030-01-01T00:00:00.000Z' },
        currentDeviceId: 'abc',
        activeMapping: { accountId: 'acc-1', deviceId: 'abc', createdAt: 1 }
      }
    },
    async initialize() {
      return { success: true }
    },
    async start() {
      return { success: true, port: 8899 }
    },
    async stop() {
      return { success: true }
    },
    async restart() {
      calls.push('restart')
      return { success: true, port: 8899 }
    },
    updateConfig() {
      return { success: true, config: {} }
    },
    setDeviceId() {
      return { success: true }
    },
    generateDeviceId() {
      return { success: true, deviceId: 'abc' }
    },
    getDeviceMappings() {
      return { success: true, mappings: [] }
    },
    addDeviceMapping() {
      return { success: true }
    },
    removeDeviceMapping(accountId: string) {
      calls.push(`remove:${accountId}`)
      return { success: true }
    },
    switchToAccount() {
      return { success: true }
    },
    getCaCert() {
      return { success: true, certPem: 'pem', certPath: 'C:/tmp/kproxy-ca.crt' }
    },
    async exportCaCert() {
      return { success: true, path: 'C:/tmp/kproxy-ca.crt' }
    },
    async checkCaCertInstalled() {
      return { success: true, installed: true }
    },
    async installCaCert() {
      return { success: true, message: 'installed' }
    },
    async uninstallCaCert() {
      return { success: true, message: 'uninstalled' }
    },
    async resetCaCert() {
      calls.push('reset-ca')
      return {
        success: true,
        running: true,
        caInfo: { certPath: 'C:/tmp/kproxy-ca.crt', validTo: '2030-01-01T00:00:00.000Z' }
      }
    },
    async getSystemInfo() {
      return {
        success: true,
        platform: 'win32',
        caInstalled: true,
        adminRecommended: false,
        adminHint: 'hint'
      }
    },
    resetStats() {
      return { success: true }
    }
  }

  const server = createLocalAdminServer({
    host: '127.0.0.1',
    port: 0,
    accessToken: 'test-token',
    routers: [createKProxyRouter({ kproxyService: fakeService as never })]
  })
  const info = await server.listen()

  const headers = {
    Authorization: `Bearer ${info.accessToken}`,
    'Content-Type': 'application/json'
  }
  try {
    const statusResponse = await fetch(`${info.baseUrl}/api/kproxy/status`, { headers })
    assert(statusResponse.ok, 'status endpoint should exist')
    const statusBody = (await statusResponse.json()) as {
      currentDeviceId?: string
      activeMapping?: { accountId?: string }
    }
    assert(statusBody.currentDeviceId === 'abc', 'status should expose current device id')
    assert(statusBody.activeMapping?.accountId === 'acc-1', 'status should expose active mapping')

    const systemInfoResponse = await fetch(`${info.baseUrl}/api/kproxy/system-info`, { headers })
    assert(systemInfoResponse.ok, 'system info endpoint should exist')
    const systemInfoBody = (await systemInfoResponse.json()) as { adminHint?: string }
    assert(systemInfoBody.adminHint === 'hint', 'system info should expose admin hint')

    const restartResponse = await fetch(`${info.baseUrl}/api/kproxy/restart`, {
      method: 'POST',
      headers
    })
    assert(restartResponse.ok, 'restart endpoint should exist')

    const removeMappingResponse = await fetch(`${info.baseUrl}/api/kproxy/device-mappings/acc-1`, {
      method: 'DELETE',
      headers
    })
    assert(removeMappingResponse.ok, 'remove device mapping endpoint should exist')

    const resetCaResponse = await fetch(`${info.baseUrl}/api/kproxy/ca-cert/reset`, {
      method: 'POST',
      headers
    })
    assert(resetCaResponse.ok, 'reset CA endpoint should exist')

    assert(calls.includes('restart'), 'restart should delegate to service')
    assert(calls.includes('remove:acc-1'), 'remove mapping should delegate to service')
    assert(calls.includes('reset-ca'), 'reset CA should delegate to service')
  } finally {
    await server.close()
  }
}

await run()
