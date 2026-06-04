import {
  createLocalAdminClient,
  LocalAdminClientError,
  deleteJson,
  getJson,
  getLocalAdminAccessToken,
  getLocalAdminBaseUrl,
  postJson,
  putJson,
  setLocalAdminAccessToken
} from '../../src/renderer/src/services/local-admin-client'
import {
  closeLocalAdminEvents,
  connectLocalAdminEvents,
  createLocalAdminEventsClient,
  type LocalAdminEventMap,
  type LocalAdminServerEvent,
  onLocalAdminEvent
} from '../../src/renderer/src/services/local-admin-events'
import {
  backgroundBatchCheck,
  backgroundBatchRefresh,
  cancelBuilderIdLogin,
  cancelIamSsoLogin,
  cancelSocialLogin,
  checkAccountStatus,
  exchangeSocialToken,
  importFromSsoToken,
  loadAccounts,
  pollBuilderIdAuth,
  pollIamSsoAuth,
  refreshAccountToken,
  saveAccounts,
  startBuilderIdLogin,
  startIamSsoLogin,
  startSocialLogin,
  verifyAccountCredentials
} from '../../src/renderer/src/services/local-admin-accounts'
import {
  getLocalActiveAccount,
  loadKiroCredentials,
  logoutAccount,
  switchAccount,
  switchAccountCli
} from '../../src/renderer/src/services/local-admin-kiro-local'
import {
  getSchedulerHealth,
  getSchedulerRuns,
  getSchedulerTasks,
  pauseSchedulerTask,
  resumeSchedulerTask,
  runSchedulerTask
} from '../../src/renderer/src/services/local-admin-scheduler'
import { proxyGetDashboard } from '../../src/renderer/src/services/local-admin-proxy'
import {
  kproxyCheckCaCertInstalled,
  kproxyGenerateDeviceId,
  kproxyGetDeviceMappings,
  kproxyGetStatus,
  kproxyGetSystemInfo,
  kproxyInit,
  kproxyInstallCaCert,
  kproxyRemoveDeviceMapping,
  kproxyResetCaCert,
  kproxyRestart,
  kproxySetDeviceId,
  kproxyStart,
  kproxyStop,
  kproxySwitchToAccount,
  kproxyUninstallCaCert
} from '../../src/renderer/src/services/local-admin-kproxy'
import {
  proxyPoolBindAccount,
  proxyPoolBindAccounts,
  proxyPoolClearBindings,
  proxyPoolDeleteProxy,
  proxyPoolGetAccountProxyUrl,
  proxyPoolGetSnapshot,
  proxyPoolImport,
  proxyPoolToggleProxy,
  proxyPoolUnbindAccount,
  proxyPoolUpdateConfig,
  proxyPoolUpdateProxy,
  proxyPoolValidateBatch,
  proxyPoolValidateProxy
} from '../../src/renderer/src/services/local-admin-proxy-pool'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

async function restClientContract(): Promise<void> {
  const client = createLocalAdminClient({
    baseUrl: 'http://127.0.0.1:9527',
    token: 'local-token'
  })

  const status = await client.getJson<{ ok: true; value: number }>('/api/example')
  status.value.toFixed()

  await getJson<{ ok: true }>('/api/health')
  await postJson<{ ok: true }>('/api/example', { name: 'demo' })
  await putJson<{ ok: true }>('/api/example', { enabled: true })
  await deleteJson<{ ok: true }>('/api/example')

  getLocalAdminBaseUrl().toString()
  setLocalAdminAccessToken('local-token')
  const token: string | null = getLocalAdminAccessToken()
  void token
}

async function localAdminClientErrorContract(): Promise<void> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: 'missing local token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })

  try {
    let thrown: unknown
    try {
      await createLocalAdminClient({
        baseUrl: 'http://127.0.0.1:9527',
        token: 'expired-token'
      }).getJson('/api/proxy/status')
    } catch (error) {
      thrown = error
    }

    assert(thrown instanceof LocalAdminClientError, 'HTTP failures should throw LocalAdminClientError')
    assert(
      (thrown as LocalAdminClientError).status === 401,
      'LocalAdminClientError should expose HTTP status'
    )
    assert(
      (thrown as LocalAdminClientError).message === 'missing local token',
      'LocalAdminClientError should surface API error messages'
    )
  } finally {
    globalThis.fetch = originalFetch
  }
}

function eventsClientContract(): void {
  const events = createLocalAdminEventsClient({
    baseUrl: 'http://127.0.0.1:9527',
    token: 'local-token',
    reconnectDelayMs: 10
  })

  const unsubscribe = events.on('background-refresh-result', (event) => {
    const typedEvent: LocalAdminServerEvent<LocalAdminEventMap['background-refresh-result']> = event
    void typedEvent.payload
  })

  events.connect()
  events.reconnect()
  events.close()
  unsubscribe()

  connectLocalAdminEvents()
  const unsubscribeDefault = onLocalAdminEvent('registration-log', (event) => {
    event.payload.message.toString()
  })
  const unsubscribeKproxy = onLocalAdminEvent('kproxy-response', (event) => {
    event.payload.requestId.toString()
    event.payload.path.toString()
    event.payload.statusCode.toFixed()
    event.payload.duration.toFixed()
    event.payload.deviceIdReplaced.valueOf()
  })
  closeLocalAdminEvents()
  unsubscribeDefault()
  unsubscribeKproxy()
}

async function accountsClientContract(): Promise<void> {
  const loaded = await loadAccounts<{ accounts: Record<string, unknown> }>()
  void loaded?.accounts

  await saveAccounts({ accounts: {} })

  const refreshed = await refreshAccountToken({
    id: 'account-id',
    credentials: { refreshToken: 'refresh-token' }
  })
  if (refreshed.success && refreshed.data) {
    refreshed.data.accessToken?.toString()
  }

  const checked = await checkAccountStatus({ id: 'account-id' })
  if (checked.success && checked.data) {
    checked.data.status.toString()
  }

  const batchRefresh = await backgroundBatchRefresh(
    [{ id: 'account-id', email: 'a@example.com', credentials: { refreshToken: 'token' } }],
    2,
    true
  )
  batchRefresh.completed.toFixed()

  const batchCheck = await backgroundBatchCheck(
    [
      {
        id: 'account-id',
        email: 'a@example.com',
        idp: 'BuilderId',
        credentials: { accessToken: 'token' }
      }
    ],
    2
  )
  batchCheck.failedCount.toFixed()

  const verified = await verifyAccountCredentials({
    refreshToken: 'refresh-token',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    region: 'us-east-1'
  })
  if (verified.success && verified.data) {
    verified.data.email.toString()
  }

  const builderStart = await startBuilderIdLogin('us-east-1')
  builderStart.userCode?.toString()
  const builderPoll = await pollBuilderIdAuth('us-east-1')
  builderPoll.completed?.valueOf()
  await cancelBuilderIdLogin()

  const iamStart = await startIamSsoLogin('https://example.awsapps.com/start', 'us-east-1')
  iamStart.authorizeUrl?.toString()
  const iamPoll = await pollIamSsoAuth('us-east-1')
  iamPoll.completed?.valueOf()
  await cancelIamSsoLogin()

  const socialStart = await startSocialLogin('Google', true)
  socialStart.loginUrl?.toString()
  const socialToken = await exchangeSocialToken('code', 'state')
  socialToken.provider?.toString()
  await cancelSocialLogin()

  const ssoImport = await importFromSsoToken('bearer-token', 'us-east-1')
  if (ssoImport.success && ssoImport.data) {
    ssoImport.data.refreshToken.toString()
  }
}

async function kiroLocalClientContract(): Promise<void> {
  const active = await getLocalActiveAccount()
  active.data?.refreshToken.toString()

  const credentials = await loadKiroCredentials()
  credentials.data?.clientId.toString()

  const switched = await switchAccount({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    region: 'us-east-1',
    authMethod: 'IdC',
    provider: 'BuilderId'
  })
  switched.success.valueOf()

  const cliSwitched = await switchAccountCli({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    region: 'us-east-1',
    provider: 'BuilderId'
  })
  cliSwitched.dbPath?.toString()

  const logout = await logoutAccount()
  logout.deletedCount?.toFixed()
}

async function schedulerClientContract(): Promise<void> {
  const health = await getSchedulerHealth()
  health.tasks.length.toFixed()
  health.recentRuns.length.toFixed()

  const tasks = await getSchedulerTasks()
  tasks[0]?.policy.intervalMs.toFixed()

  const runs = await getSchedulerRuns('account-auto-refresh')
  runs[0]?.success.toFixed()

  const run = await runSchedulerTask('account-status-check')
  run.status.toString()

  const paused = await pauseSchedulerTask('account-status-check')
  paused.paused.valueOf()

  const resumed = await resumeSchedulerTask('account-status-check')
  resumed.enabled.valueOf()
}

async function proxyClientContract(): Promise<void> {
  const dashboard = await proxyGetDashboard()
  dashboard.accounts.available.toFixed()
  dashboard.apiKeys.restricted.toFixed()
  dashboard.requests.successRate.toFixed()
  dashboard.recentRequests[0]?.requestId?.toString()
  dashboard.recentRequests[0]?.apiKeyId?.toString()
  dashboard.recentRequests[0]?.accountId.toString()
  dashboard.recentRequests[0]?.model.toString()
  dashboard.recentRequests[0]?.status?.toFixed()
  dashboard.recentRequests[0]?.cacheWriteTokens?.toFixed()
  dashboard.recentRequests[0]?.reasoningTokens?.toFixed()
}

async function proxyPoolClientContract(): Promise<void> {
  const snapshot = await proxyPoolGetSnapshot()
  snapshot.counts.boundAccounts.toFixed()
  snapshot.config.strategy.toString()

  const imported = await proxyPoolImport('127.0.0.1:8080')
  imported.added.toFixed()
  imported.snapshot.proxies[0]?.url.toString()

  const config = await proxyPoolUpdateConfig({ enabled: true, strategy: 'least_used' })
  config.enabled.valueOf()

  const proxy = await proxyPoolUpdateProxy('proxy-id', { label: 'local' })
  proxy.label?.toString()

  const toggled = await proxyPoolToggleProxy('proxy-id', true)
  toggled.enabled.valueOf()

  const validation = await proxyPoolValidateProxy('proxy-id')
  validation.latencyMs?.toFixed()

  const batch = await proxyPoolValidateBatch(['proxy-id'], 2)
  batch.snapshot.counts.total.toFixed()

  await proxyPoolBindAccount('account-id', 'proxy-id')
  await proxyPoolBindAccounts(['account-id'], 'proxy-id')
  const proxyUrl = await proxyPoolGetAccountProxyUrl('account-id')
  proxyUrl?.toString()
  await proxyPoolUnbindAccount('account-id')
  await proxyPoolClearBindings()
  await proxyPoolDeleteProxy('proxy-id')
}

async function kproxyClientContract(): Promise<void> {
  const init = await kproxyInit()
  init.caInfo?.certPath.toString()

  const start = await kproxyStart({ port: 8899, deviceId: 'a'.repeat(64) })
  start.port?.toFixed()

  const status = await kproxyGetStatus()
  status.currentDeviceId?.toString()
  status.activeMapping?.accountId?.toString()

  const systemInfo = await kproxyGetSystemInfo()
  systemInfo.adminRecommended.valueOf()
  systemInfo.adminHint?.toString()

  const randomId = await kproxyGenerateDeviceId()
  randomId.deviceId?.toString()

  await kproxySetDeviceId('a'.repeat(64))
  await kproxySwitchToAccount('account-id')

  const mappings = await kproxyGetDeviceMappings()
  mappings.mappings[0]?.accountId.toString()
  await kproxyRemoveDeviceMapping('account-id')

  const installed = await kproxyCheckCaCertInstalled()
  installed.installed.valueOf()
  await kproxyInstallCaCert()
  await kproxyUninstallCaCert()
  await kproxyResetCaCert()
  await kproxyRestart()
  await kproxyStop()
}

void restClientContract
void localAdminClientErrorContract
void eventsClientContract
void accountsClientContract
void kiroLocalClientContract
void schedulerClientContract
void proxyClientContract
void proxyPoolClientContract
void kproxyClientContract
