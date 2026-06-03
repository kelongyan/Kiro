import { mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AccountStore, type AccountData } from '../../src/server/storage/account-store'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function makeAccountData(): AccountData {
  return {
    accounts: {
      'account-1': {
        id: 'account-1',
        email: 'secret@example.com',
        credentials: {
          accessToken: 'access-secret-token',
          refreshToken: 'refresh-secret-token',
          clientSecret: 'client-secret-value'
        }
      }
    },
    groups: {},
    tags: {},
    activeAccountId: 'account-1',
    autoRefreshEnabled: true,
    autoRefreshInterval: 30,
    autoRefreshConcurrency: 50,
    autoRefreshSyncInfo: true,
    statusCheckInterval: 30,
    privacyMode: false,
    usagePrecision: false,
    proxyEnabled: false,
    proxyUrl: '',
    autoSwitchEnabled: false,
    autoSwitchThreshold: 10,
    autoSwitchInterval: 5,
    switchTarget: 'ide',
    theme: 'default',
    darkMode: false,
    language: 'auto',
    machineIdConfig: {},
    accountMachineIds: {},
    machineIdHistory: [],
    proxyPool: {},
    proxyPoolConfig: {},
    proxyPoolCursor: 0,
    accountProxyBindings: {}
  }
}

function run(): void {
  const dataDir = mkdtempSync(join(tmpdir(), 'kiro-account-store-'))
  const store = new AccountStore({
    dataDir,
    encryptionKey: 'custom-encryption-key'
  })

  const input = makeAccountData()
  store.save(input)

  const raw = readFileSync(store.storePath, 'utf-8')
  assert(!raw.includes('secret@example.com'), 'encrypted file should not contain plaintext email')
  assert(!raw.includes('access-secret-token'), 'encrypted file should not contain access token')
  assert(!raw.includes('refresh-secret-token'), 'encrypted file should not contain refresh token')
  assert(!raw.includes('client-secret-value'), 'encrypted file should not contain client secret')

  const reloaded = new AccountStore({
    dataDir,
    encryptionKey: 'custom-encryption-key'
  })
  const output = reloaded.load()

  assert(output?.activeAccountId === 'account-1', 'reloaded store should preserve active account')
  assert(
    (output?.accounts['account-1'] as { email?: string })?.email === 'secret@example.com',
    'reloaded store should preserve account data'
  )
  assert(reloaded.dataDirPath === dataDir, 'account store should use the provided data directory')
}

run()
