import { DiagnosticsService } from '../../src/server/services/diagnostics/diagnostics-service'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

async function exposesOverviewChecksAndCategories(): Promise<void> {
  const service = new DiagnosticsService({
    getOverview: async () => ({
      checks: [
        {
          id: 'local-admin',
          label: 'Local Admin',
          category: 'local',
          success: true,
          detail: 'ok'
        },
        {
          id: 'proxy-pool',
          label: 'Proxy Pool',
          category: 'proxy',
          success: false,
          detail: 'empty'
        }
      ]
    })
  })

  const result = await service.overview()
  assert(result.checks.length === 2, 'overview should return all checks')
  assert(result.checks[0]?.category === 'local', 'overview should preserve categories')
  assert(result.checks[1]?.success === false, 'overview should preserve failure status')
}

await exposesOverviewChecksAndCategories()
