import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { homedir, type } from 'os'
import { join } from 'path'
import { mkdir, readFile, readdir, unlink, writeFile } from 'fs/promises'
import { refreshTokenByMethod, type TokenRefreshDeps } from '../accounts/token-refresh'

const DEFAULT_START_URL = 'https://view.awsapps.com/start'
const SOCIAL_PROFILE_ARN = 'arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK'
const BUILDER_ID_PROFILE_ARN = 'arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX'

interface KiroTokenFile {
  accessToken?: string
  refreshToken?: string
  clientIdHash?: string
  region?: string
  authMethod?: string
  provider?: string
}

interface KiroClientRegistration {
  clientId?: string
  clientSecret?: string
}

export interface KiroLocalCredentials {
  accessToken: string
  refreshToken: string
  clientId: string
  clientSecret: string
  region: string
  authMethod: string
  provider: string
}

export interface SwitchKiroAccountInput {
  accessToken: string
  refreshToken: string
  clientId: string
  clientSecret: string
  region?: string
  startUrl?: string
  authMethod?: 'IdC' | 'social'
  provider?: 'BuilderId' | 'Github' | 'Google' | 'Enterprise' | 'IAM_SSO'
  profileArn?: string
}

export interface SwitchKiroCliInput {
  accessToken: string
  refreshToken: string
  clientId?: string
  clientSecret?: string
  region?: string
  profileArn?: string
  provider?: string
  scopes?: string[]
}

export interface OperationResult<T = undefined> {
  success: boolean
  data?: T
  error?: string
}

export interface SwitchCliResult {
  dbPath: string
}

export interface LogoutResult {
  deletedCount: number
}

export interface KiroLocalServiceDeps {
  tokenRefreshDeps?: TokenRefreshDeps
  homeDir?: () => string
  platform?: NodeJS.Platform
  runSqlite?: (dbPath: string, sql: string) => void
}

export class KiroLocalService {
  private tokenRefreshDeps: TokenRefreshDeps
  private homeDir: () => string
  private platform: NodeJS.Platform
  private runSqlite?: (dbPath: string, sql: string) => void

  constructor(deps: KiroLocalServiceDeps = {}) {
    this.tokenRefreshDeps = deps.tokenRefreshDeps || {}
    this.homeDir = deps.homeDir || homedir
    this.platform = deps.platform || getDefaultPlatform()
    this.runSqlite = deps.runSqlite
  }

  getSsoCacheDir(): string {
    return join(this.homeDir(), '.aws', 'sso', 'cache')
  }

  getCliDataDir(): string {
    return this.platform === 'win32'
      ? join(this.homeDir(), 'AppData', 'Local', 'kiro-cli')
      : join(this.homeDir(), '.local', 'share', 'kiro-cli')
  }

  async getLocalActiveAccount(): Promise<
    OperationResult<{
      refreshToken: string
      accessToken?: string
      authMethod?: string
      provider?: string
    }>
  > {
    try {
      const tokenData = await this.readKiroTokenFile()

      if (!tokenData.refreshToken) {
        return { success: false, error: '本地缓存中没有 refreshToken' }
      }

      return {
        success: true,
        data: {
          refreshToken: tokenData.refreshToken,
          accessToken: tokenData.accessToken,
          authMethod: tokenData.authMethod,
          provider: tokenData.provider
        }
      }
    } catch {
      return { success: false, error: '无法读取本地 SSO 缓存' }
    }
  }

  async loadKiroCredentials(): Promise<OperationResult<KiroLocalCredentials>> {
    try {
      const ssoCache = this.getSsoCacheDir()
      const tokenPath = join(ssoCache, 'kiro-auth-token.json')
      console.log('[Kiro Credentials] Reading token from:', tokenPath)

      let tokenData: KiroTokenFile
      try {
        tokenData = await this.readKiroTokenFile()
      } catch {
        return { success: false, error: '找不到 kiro-auth-token.json 文件，请先在 Kiro IDE 中登录' }
      }

      if (!tokenData.refreshToken) {
        return { success: false, error: 'kiro-auth-token.json 中缺少 refreshToken' }
      }

      const clientIdHash = tokenData.clientIdHash || createClientIdHash(DEFAULT_START_URL)
      if (!tokenData.clientIdHash) {
        console.log('[Kiro Credentials] Calculated clientIdHash:', clientIdHash)
      }

      const clientData = await this.loadClientRegistration(ssoCache, clientIdHash)
      const isSocialAuth = tokenData.authMethod === 'social'

      if (!isSocialAuth && (!clientData?.clientId || !clientData.clientSecret)) {
        return { success: false, error: '找不到客户端注册文件，请确保已在 Kiro IDE 中完成登录' }
      }

      console.log(
        `[Kiro Credentials] Successfully loaded credentials (authMethod: ${tokenData.authMethod || 'IdC'})`
      )

      return {
        success: true,
        data: {
          accessToken: tokenData.accessToken || '',
          refreshToken: tokenData.refreshToken,
          clientId: clientData?.clientId || '',
          clientSecret: clientData?.clientSecret || '',
          region: tokenData.region || 'us-east-1',
          authMethod: tokenData.authMethod || 'IdC',
          provider: tokenData.provider || 'BuilderId'
        }
      }
    } catch (error) {
      console.error('[Kiro Credentials] Error:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  async switchAccount(credentials: SwitchKiroAccountInput): Promise<OperationResult> {
    try {
      const {
        refreshToken,
        clientId,
        clientSecret,
        region = 'us-east-1',
        startUrl,
        authMethod = 'IdC',
        provider = 'BuilderId',
        profileArn
      } = credentials
      let { accessToken } = credentials

      if (refreshToken) {
        console.log(
          `[Switch Account] Refreshing token before switch (authMethod: ${authMethod})...`
        )
        const refreshResult = await refreshTokenByMethod(
          refreshToken,
          clientId,
          clientSecret,
          region,
          authMethod,
          this.tokenRefreshDeps
        )
        if (refreshResult.success && refreshResult.accessToken) {
          accessToken = refreshResult.accessToken
          console.log('[Switch Account] Token refreshed successfully')
        } else {
          console.warn(
            `[Switch Account] Token refresh failed: ${refreshResult.error}, using existing token`
          )
        }
      }

      const effectiveStartUrl = startUrl || DEFAULT_START_URL
      const clientIdHash = createClientIdHash(effectiveStartUrl)
      const ssoCache = this.getSsoCacheDir()
      await mkdir(ssoCache, { recursive: true })

      const resolvedProfileArn = resolveProfileArn(authMethod, provider, profileArn)
      const tokenPath = join(ssoCache, 'kiro-auth-token.json')
      const tokenData: Record<string, unknown> =
        authMethod === 'social'
          ? {
              accessToken,
              refreshToken,
              profileArn: resolvedProfileArn,
              expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
              authMethod,
              provider
            }
          : {
              accessToken,
              refreshToken,
              expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
              clientIdHash,
              authMethod,
              provider,
              region,
              profileArn: resolvedProfileArn
            }
      await writeFile(tokenPath, JSON.stringify(tokenData, null, 2))
      console.log('[Switch Account] Token saved to:', tokenPath)

      if (authMethod !== 'social' && clientId && clientSecret) {
        const clientRegPath = join(ssoCache, `${clientIdHash}.json`)
        const expiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000)
          .toISOString()
          .replace('Z', '')
        const clientData = {
          clientId,
          clientSecret,
          expiresAt,
          scopes: [
            'codewhisperer:completions',
            'codewhisperer:analysis',
            'codewhisperer:conversations',
            'codewhisperer:transformations',
            'codewhisperer:taskassist'
          ]
        }
        await writeFile(clientRegPath, JSON.stringify(clientData, null, 2))
        console.log('[Switch Account] Client registration saved to:', clientRegPath)
      }

      return { success: true }
    } catch (error) {
      console.error('[Switch Account] Error:', error)
      return { success: false, error: error instanceof Error ? error.message : '切换失败' }
    }
  }

  async switchAccountCli(
    credentials: SwitchKiroCliInput
  ): Promise<OperationResult<SwitchCliResult>> {
    try {
      const {
        refreshToken,
        clientId,
        clientSecret,
        region = 'us-east-1',
        profileArn,
        provider,
        scopes
      } = credentials
      let { accessToken } = credentials

      if (refreshToken) {
        const authMethod = isSocialProvider(provider) ? 'social' : undefined
        console.log(`[Switch CLI] Refreshing token before switch (provider: ${provider})...`)
        const refreshResult = await refreshTokenByMethod(
          refreshToken,
          clientId || '',
          clientSecret || '',
          region,
          authMethod,
          this.tokenRefreshDeps
        )
        if (refreshResult.success && refreshResult.accessToken) {
          accessToken = refreshResult.accessToken
          console.log('[Switch CLI] Token refreshed successfully')
        } else {
          console.warn(
            `[Switch CLI] Token refresh failed: ${refreshResult.error}, using existing token`
          )
        }
      }

      const dataDir = this.getCliDataDir()
      await mkdir(dataDir, { recursive: true })
      const dbPath = join(dataDir, 'data.sqlite3')

      const isSocial = isSocialProvider(provider)
      const preferredTokenKey = isSocial ? 'kirocli:social:token' : 'kirocli:odic:token'
      const preferredRegKey = 'kirocli:odic:device-registration'
      const resolvedProfileArn =
        profileArn || (isSocial ? SOCIAL_PROFILE_ARN : BUILDER_ID_PROFILE_ARN)
      const tokenData: Record<string, unknown> = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        region,
        profile_arn: resolvedProfileArn
      }
      if (scopes) tokenData.scopes = scopes

      const sqlStatements: string[] = [
        'CREATE TABLE IF NOT EXISTS auth_kv (key TEXT PRIMARY KEY, value TEXT);',
        `INSERT OR REPLACE INTO auth_kv (key, value) VALUES ('${preferredTokenKey}', '${escapeSqlValue(JSON.stringify(tokenData))}');`
      ]

      if (clientId && clientSecret && !isSocial) {
        const regData = { client_id: clientId, client_secret: clientSecret, region }
        sqlStatements.push(
          `INSERT OR REPLACE INTO auth_kv (key, value) VALUES ('${preferredRegKey}', '${escapeSqlValue(JSON.stringify(regData))}');`
        )
      }

      const cliTokenKeys = [
        'kirocli:social:token',
        'kirocli:odic:token',
        'codewhisperer:odic:token'
      ]
      for (const key of cliTokenKeys) {
        if (key !== preferredTokenKey) {
          sqlStatements.push(`DELETE FROM auth_kv WHERE key = '${key}';`)
        }
      }

      await this.executeSqlite(dbPath, sqlStatements.join('\n'))

      console.log(`[Switch CLI] Token saved to SQLite key: ${preferredTokenKey}`)
      console.log(`[Switch CLI] Account switched successfully in ${dbPath}`)
      return { success: true, data: { dbPath } }
    } catch (error) {
      console.error('[Switch CLI] Error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'CLI 切换失败' }
    }
  }

  async logoutAccount(): Promise<OperationResult<LogoutResult>> {
    try {
      const ssoCache = this.getSsoCacheDir()
      console.log('[Logout] Clearing SSO cache:', ssoCache)

      const files = await readdir(ssoCache).catch(() => [])
      for (const file of files) {
        const filePath = join(ssoCache, file)
        await unlink(filePath).catch((error: unknown) => {
          console.warn('[Logout] Failed to delete file:', filePath, error)
        })
      }

      console.log('[Logout] SSO cache cleared, deleted', files.length, 'files')
      return { success: true, data: { deletedCount: files.length } }
    } catch (error) {
      console.error('[Logout] Error:', error)
      return { success: false, error: error instanceof Error ? error.message : '退出失败' }
    }
  }

  private async readKiroTokenFile(): Promise<KiroTokenFile> {
    const tokenPath = join(this.getSsoCacheDir(), 'kiro-auth-token.json')
    const tokenContent = await readFile(tokenPath, 'utf-8')
    return JSON.parse(tokenContent) as KiroTokenFile
  }

  private async loadClientRegistration(
    ssoCache: string,
    clientIdHash: string
  ): Promise<KiroClientRegistration | null> {
    const clientRegPath = join(ssoCache, `${clientIdHash}.json`)
    console.log('[Kiro Credentials] Trying client registration from:', clientRegPath)

    try {
      const clientContent = await readFile(clientRegPath, 'utf-8')
      return JSON.parse(clientContent) as KiroClientRegistration
    } catch {
      console.log('[Kiro Credentials] Client file not found, searching cache directory...')
    }

    try {
      const files = await readdir(ssoCache)
      for (const file of files) {
        if (file.endsWith('.json') && file !== 'kiro-auth-token.json') {
          const clientData = await readClientRegistrationFile(join(ssoCache, file))
          if (clientData?.clientId && clientData.clientSecret) {
            console.log('[Kiro Credentials] Found client registration in:', file)
            return clientData
          }
        }
      }
    } catch {
      return null
    }

    return null
  }

  private async executeSqlite(dbPath: string, sql: string): Promise<void> {
    if (this.runSqlite) {
      this.runSqlite(dbPath, sql)
      return
    }

    const sqlite3Bin = this.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3'
    try {
      execFileSync(sqlite3Bin, [dbPath], {
        input: sql,
        timeout: 10000,
        encoding: 'utf-8'
      })
      return
    } catch (sqlite3Error) {
      console.log('[Switch CLI] sqlite3 command not available, trying Node.js built-in SQLite...')
      try {
        const { DatabaseSync } = (await import('node:sqlite')) as unknown as {
          DatabaseSync: new (path: string) => {
            exec: (statement: string) => void
            close: () => void
          }
        }
        const db = new DatabaseSync(dbPath)
        try {
          for (const statement of sql.split('\n')) {
            db.exec(statement)
          }
        } finally {
          db.close()
        }
      } catch {
        throw new Error(
          `SQLite 操作失败: sqlite3 命令不可用 (${(sqlite3Error as Error).message})，且 Node.js 内置 SQLite 不支持。请确保系统安装了 sqlite3 命令行工具。`
        )
      }
    }
  }
}

async function readClientRegistrationFile(path: string): Promise<KiroClientRegistration | null> {
  try {
    const content = await readFile(path, 'utf-8')
    return JSON.parse(content) as KiroClientRegistration
  } catch {
    return null
  }
}

function createClientIdHash(startUrl: string): string {
  return createHash('sha1').update(JSON.stringify({ startUrl })).digest('hex')
}

function getDefaultPlatform(): NodeJS.Platform {
  return type().toLowerCase().startsWith('windows') ? 'win32' : process.platform
}

function resolveProfileArn(
  authMethod: string | undefined,
  provider: string | undefined,
  profileArn?: string
): string {
  if (profileArn) return profileArn
  if (authMethod === 'social' || provider === 'Google' || provider === 'Github') {
    return SOCIAL_PROFILE_ARN
  }
  return BUILDER_ID_PROFILE_ARN
}

function isSocialProvider(provider: string | undefined): boolean {
  return provider === 'Google' || provider === 'Github'
}

function escapeSqlValue(value: string): string {
  return value.replace(/'/g, "''")
}
