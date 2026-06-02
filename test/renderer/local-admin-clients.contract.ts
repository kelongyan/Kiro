import {
  createLocalAdminClient,
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

function eventsClientContract(): void {
  const events = createLocalAdminEventsClient({
    baseUrl: 'http://127.0.0.1:9527',
    token: 'local-token',
    reconnectDelayMs: 10
  })

  const unsubscribe = events.on('background-refresh-result', (event) => {
    const typedEvent: LocalAdminServerEvent<LocalAdminEventMap['background-refresh-result']> =
      event
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
  closeLocalAdminEvents()
  unsubscribeDefault()
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

void restClientContract
void eventsClientContract
void accountsClientContract
void kiroLocalClientContract
