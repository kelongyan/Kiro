import type {
  Account,
  AccountExportData,
  AccountImportItem
} from '../../src/renderer/src/types/account'
import {
  prepareAccountImportBatch,
  prepareExportDataImport
} from '../../src/renderer/src/store/account-import'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function createExistingAccount(overrides: Partial<Account> = {}): Account {
  const now = 1_700_000_000_000
  return {
    id: 'existing-1',
    email: 'existing@example.com',
    idp: 'Google',
    credentials: {
      accessToken: '',
      csrfToken: '',
      refreshToken: 'existing-refresh-token',
      provider: 'Google',
      expiresAt: now + 3600 * 1000
    },
    subscription: { type: 'Free' },
    usage: {
      current: 0,
      limit: 25,
      percentUsed: 0,
      lastUpdated: now
    },
    tags: [],
    status: 'unknown',
    isActive: false,
    createdAt: now,
    lastUsedAt: now,
    ...overrides
  }
}

function runImport(items: AccountImportItem[], existingAccounts: Account[] = []) {
  let idSequence = 0
  return prepareAccountImportBatch({
    items,
    existingAccounts,
    now: 1_700_000_000_000,
    createId: () => `new-${++idSequence}`,
    createMachineId: () => `machine-${idSequence}`
  })
}

function toExportAccountForTest(account: Account): AccountExportData['accounts'][number] {
  const exported = { ...account }
  delete (exported as Partial<Account>).isActive
  return exported
}

function validatesRequiredImportFields(): void {
  const prepared = runImport([
    { email: '', refreshToken: 'token-a' },
    { email: 'missing-token@example.com', refreshToken: '' },
    { email: 'valid@example.com', refreshToken: 'token-b' }
  ])

  assert(prepared.result.success === 1, 'valid rows should be imported')
  assert(prepared.result.failed === 2, 'invalid rows should be reported as failures')
  assert(prepared.accounts.length === 1, 'only valid accounts should be created')
  assert(
    prepared.result.errors.some((error) => error.error.includes('缺少邮箱')),
    'missing email should be reported'
  )
  assert(
    prepared.result.errors.some((error) => error.error.includes('缺少 RefreshToken')),
    'missing refresh token should be reported'
  )
}

function rejectsDuplicateAccountsByEmailAndProvider(): void {
  const prepared = runImport(
    [
      { email: 'existing@example.com', idp: 'Google', refreshToken: 'duplicate-existing' },
      { email: 'batch@example.com', idp: 'Github', refreshToken: 'token-a' },
      { email: 'BATCH@example.com', idp: 'github', refreshToken: 'token-b' },
      { email: 'existing@example.com', idp: 'Github', refreshToken: 'different-provider' }
    ],
    [createExistingAccount()]
  )

  assert(prepared.result.success === 2, 'same email with different provider should be allowed')
  assert(prepared.result.failed === 2, 'existing and in-file duplicates should fail')
  assert(
    prepared.accounts.some(
      (account) => account.email === 'existing@example.com' && account.idp === 'Github'
    ),
    'different provider account should be created'
  )
  assert(
    prepared.result.errors.some((error) => error.error.includes('账号已存在')),
    'existing duplicate should be reported'
  )
  assert(
    prepared.result.errors.some((error) => error.error.includes('导入文件中账号重复')),
    'same-file duplicate should be reported'
  )
}

function normalizesImportFields(): void {
  const prepared = runImport([
    {
      email: '  User@Example.com  ',
      idp: 'builder-id',
      refreshToken: '  refresh-token  ',
      accessToken: '  access-token  ',
      csrfToken: '  csrf-token  ',
      clientId: '  client-id  ',
      clientSecret: '  client-secret  ',
      region: '  eu-west-1  ',
      nickname: '  Main account  ',
      tags: [' tag-a ', 'tag-b']
    }
  ])
  const account = prepared.accounts[0]

  assert(account.email === 'User@Example.com', 'email should be trimmed')
  assert(account.idp === 'BuilderId', 'idp aliases should be normalized')
  assert(account.credentials.provider === 'BuilderId', 'provider should follow normalized idp')
  assert(account.credentials.refreshToken === 'refresh-token', 'refresh token should be trimmed')
  assert(account.credentials.accessToken === 'access-token', 'access token should be trimmed')
  assert(account.credentials.region === 'eu-west-1', 'region should be trimmed')
  assert(account.nickname === 'Main account', 'nickname should be trimmed')
  assert(account.tags[0] === 'tag-a', 'tags should be trimmed')
}

function keepsJsonImportDuplicateRulesProviderAware(): void {
  const existing = createExistingAccount({
    id: 'existing-google',
    email: 'same@example.com',
    userId: 'user-existing',
    idp: 'Google',
    credentials: {
      accessToken: '',
      csrfToken: '',
      refreshToken: 'existing-refresh-token',
      provider: 'Google',
      expiresAt: 1_700_000_000_000
    }
  })

  const githubSameEmail = createExistingAccount({
    id: 'github-same-email',
    email: 'same@example.com',
    userId: 'user-github',
    idp: 'Github',
    credentials: {
      accessToken: '',
      csrfToken: '',
      refreshToken: 'github-refresh-token',
      provider: 'Github',
      expiresAt: 1_700_000_000_000
    }
  })
  const duplicateExistingProvider = createExistingAccount({
    id: 'duplicate-existing',
    email: 'same@example.com',
    userId: 'user-new-google',
    idp: 'Google',
    credentials: {
      accessToken: '',
      csrfToken: '',
      refreshToken: 'new-google-refresh-token',
      provider: 'Google',
      expiresAt: 1_700_000_000_000
    }
  })
  const duplicateUserId = createExistingAccount({
    id: 'duplicate-user-id',
    email: 'other@example.com',
    userId: 'user-existing',
    idp: 'BuilderId',
    credentials: {
      accessToken: '',
      csrfToken: '',
      refreshToken: 'builder-refresh-token',
      provider: 'BuilderId',
      expiresAt: 1_700_000_000_000
    }
  })
  const duplicateWithinFile = createExistingAccount({
    id: 'duplicate-within-file',
    email: 'SAME@example.com',
    userId: 'user-github-2',
    idp: 'Github',
    credentials: {
      accessToken: '',
      csrfToken: '',
      refreshToken: 'github-refresh-token-2',
      provider: 'Github',
      expiresAt: 1_700_000_000_000
    }
  })

  const data: AccountExportData = {
    version: '1.7.0',
    exportedAt: 1_700_000_000_000,
    accounts: [
      githubSameEmail,
      duplicateExistingProvider,
      duplicateUserId,
      duplicateWithinFile
    ].map(toExportAccountForTest),
    groups: [],
    tags: []
  }

  const prepared = prepareExportDataImport({
    data,
    existingAccounts: [existing]
  })

  assert(prepared.result.success === 1, 'same email with different provider should import')
  assert(prepared.result.failed === 3, 'duplicates should be counted as failures')
  assert(prepared.accounts[0].id === 'github-same-email', 'allowed account should be preserved')
  assert(prepared.accounts[0].isActive === false, 'imported accounts must not become active')
  assert(
    prepared.result.errors.some((error) => error.error.includes('账号已存在')),
    'existing duplicates should be reported'
  )
  assert(
    prepared.result.errors.some((error) => error.error.includes('导入文件中账号重复')),
    'same-file duplicates should be reported'
  )
}

validatesRequiredImportFields()
rejectsDuplicateAccountsByEmailAndProvider()
normalizesImportFields()
keepsJsonImportDuplicateRulesProviderAware()
