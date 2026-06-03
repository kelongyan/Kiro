import type {
  Account,
  AccountExportData,
  AccountGroup,
  AccountImportItem,
  AccountTag,
  BatchOperationResult,
  IdpType
} from '../types/account'

type AccountProvider = NonNullable<Account['credentials']['provider']>

const IDP_ALIASES = new Map<string, IdpType>([
  ['google', 'Google'],
  ['github', 'Github'],
  ['builderid', 'BuilderId'],
  ['enterprise', 'Enterprise'],
  ['awsidc', 'AWSIdC'],
  ['internal', 'Internal'],
  ['iamsso', 'IAM_SSO']
])

const PROVIDER_BY_IDP: Partial<Record<IdpType, AccountProvider>> = {
  Google: 'Google',
  Github: 'Github',
  BuilderId: 'BuilderId',
  Enterprise: 'Enterprise',
  IAM_SSO: 'IAM_SSO'
}

export interface PrepareAccountImportBatchOptions {
  items: AccountImportItem[]
  existingAccounts: Iterable<Account>
  now: number
  createId: () => string
  createMachineId: () => string
}

export interface PreparedAccountImportBatch {
  accounts: Account[]
  result: BatchOperationResult
}

export interface PrepareExportDataImportOptions {
  data: AccountExportData
  existingAccounts: Iterable<Account>
}

export interface PreparedExportDataImport {
  accounts: Account[]
  groups: AccountGroup[]
  tags: AccountTag[]
  result: BatchOperationResult
}

function cleanText(value: string | undefined): string {
  return value?.trim() ?? ''
}

function cleanOptionalText(value: string | undefined): string | undefined {
  const cleaned = cleanText(value)
  return cleaned || undefined
}

function normalizeIdpToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
}

export function normalizeImportIdp(idp: string | undefined): IdpType | null {
  if (!idp) return 'Google'
  return IDP_ALIASES.get(normalizeIdpToken(idp)) ?? null
}

function providerForIdp(idp: IdpType): AccountProvider | undefined {
  return PROVIDER_BY_IDP[idp]
}

function duplicateProviderKey(account: Account): string {
  return account.credentials.provider ?? account.idp
}

function duplicateUserKey(userId: string): string {
  return userId.trim().toLowerCase()
}

function duplicateKey(email: string, provider: string): string {
  return `${email.toLowerCase()}::${provider.toLowerCase()}`
}

function addFailure(result: BatchOperationResult, id: string, error: string): void {
  result.failed++
  result.errors.push({ id, error })
}

export function prepareAccountImportBatch({
  items,
  existingAccounts,
  now,
  createId,
  createMachineId
}: PrepareAccountImportBatchOptions): PreparedAccountImportBatch {
  const result: BatchOperationResult = { success: 0, failed: 0, errors: [] }
  const existingKeys = new Set<string>()
  const importedKeys = new Set<string>()
  const accounts: Account[] = []

  for (const account of existingAccounts) {
    if (!account.email) continue
    existingKeys.add(duplicateKey(account.email, duplicateProviderKey(account)))
  }

  items.forEach((item, index) => {
    const email = cleanText(item.email)
    const rowId = email || `row-${index + 1}`
    const refreshToken = cleanText(item.refreshToken)
    const idp = normalizeImportIdp(item.idp)

    if (!email) {
      addFailure(result, rowId, '缺少邮箱')
      return
    }

    if (!refreshToken) {
      addFailure(result, rowId, '缺少 RefreshToken')
      return
    }

    if (!idp) {
      addFailure(result, rowId, `不支持的登录方式：${item.idp}`)
      return
    }

    const provider = providerForIdp(idp)
    const key = duplicateKey(email, provider ?? idp)
    if (existingKeys.has(key)) {
      addFailure(result, rowId, '账号已存在')
      return
    }

    if (importedKeys.has(key)) {
      addFailure(result, rowId, '导入文件中账号重复')
      return
    }

    importedKeys.add(key)
    result.success++

    accounts.push({
      id: createId(),
      createdAt: now,
      isActive: false,
      machineId: createMachineId(),
      email,
      password: cleanOptionalText(item.password),
      nickname: cleanOptionalText(item.nickname),
      idp,
      credentials: {
        accessToken: cleanText(item.accessToken),
        csrfToken: cleanText(item.csrfToken),
        refreshToken,
        clientId: cleanOptionalText(item.clientId),
        clientSecret: cleanOptionalText(item.clientSecret),
        region: cleanText(item.region) || 'us-east-1',
        provider,
        expiresAt: now + 3600 * 1000
      },
      subscription: {
        type: 'Free'
      },
      usage: {
        current: 0,
        limit: 25,
        percentUsed: 0,
        lastUpdated: now
      },
      groupId: cleanOptionalText(item.groupId),
      tags: item.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
      status: 'unknown',
      lastUsedAt: now
    })
  })

  return { accounts, result }
}

export function prepareExportDataImport({
  data,
  existingAccounts
}: PrepareExportDataImportOptions): PreparedExportDataImport {
  const result: BatchOperationResult = { success: 0, failed: 0, errors: [] }
  const existingEmailProviderKeys = new Set<string>()
  const existingUserIds = new Set<string>()
  const importedEmailProviderKeys = new Set<string>()
  const importedUserIds = new Set<string>()
  const accounts: Account[] = []

  for (const account of existingAccounts) {
    if (account.email) {
      existingEmailProviderKeys.add(duplicateKey(account.email, duplicateProviderKey(account)))
    }
    if (account.userId) {
      existingUserIds.add(duplicateUserKey(account.userId))
    }
  }

  for (const accountData of data.accounts) {
    const account: Account = { ...accountData, isActive: false }
    const rowId = account.id || account.email || account.userId || 'unknown'
    const providerKey = duplicateProviderKey(account)
    const emailProviderKey = account.email ? duplicateKey(account.email, providerKey) : undefined
    const userKey = account.userId ? duplicateUserKey(account.userId) : undefined

    if (
      (emailProviderKey && existingEmailProviderKeys.has(emailProviderKey)) ||
      (userKey && existingUserIds.has(userKey))
    ) {
      addFailure(result, rowId, '账号已存在')
      continue
    }

    if (
      (emailProviderKey && importedEmailProviderKeys.has(emailProviderKey)) ||
      (userKey && importedUserIds.has(userKey))
    ) {
      addFailure(result, rowId, '导入文件中账号重复')
      continue
    }

    if (emailProviderKey) importedEmailProviderKeys.add(emailProviderKey)
    if (userKey) importedUserIds.add(userKey)
    accounts.push(account)
    result.success++
  }

  return {
    accounts,
    groups: data.groups,
    tags: data.tags,
    result
  }
}
