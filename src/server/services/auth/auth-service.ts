import { createHash, randomBytes, randomUUID } from 'crypto'
import { createServer, type Server } from 'http'
import { serverFetch, type ServerFetchOptions } from '../../runtime/fetch'
import { KIRO_AUTH_ENDPOINT } from '../accounts/token-refresh'

// ============ 类型 ============

export interface AuthDeps {
  /** 网络请求选项 */
  fetchOpts?: ServerFetchOptions
  /** 发布事件 */
  emitEvent: (type: string, payload: unknown) => void
  /** 打开外部 URL */
  openUrl: (url: string) => Promise<void>
  /** 隐私模式打开浏览器 */
  openInPrivate?: (url: string) => void
}

// ============ Builder ID 登录状态 ============

interface BuilderIdLoginState {
  type: 'builderid'
  clientId: string
  clientSecret: string
  deviceCode: string
  userCode: string
  verificationUri: string
  interval: number
  expiresAt: number
}

interface BuilderIdStartResult {
  success: boolean
  userCode?: string
  verificationUri?: string
  expiresIn?: number
  interval?: number
  error?: string
}

interface BuilderIdPollResult {
  success: boolean
  accessToken?: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  region?: string
  expiresIn?: number
  error?: string
}

// ============ IAM SSO 登录状态 ============

interface IamSsoLoginState {
  type: 'iam-sso'
  clientId: string
  clientSecret: string
  codeVerifier: string
  redirectUri: string
  region: string
  expiresAt: number
}

interface IamSsoStartResult {
  success: boolean
  authUrl?: string
  error?: string
}

interface IamSsoPollResult {
  success: boolean
  completed?: boolean
  accessToken?: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  region?: string
  expiresIn?: number
  error?: string
}

// ============ Social 登录状态 ============

interface SocialLoginState {
  type: 'social'
  codeVerifier: string
  codeChallenge: string
  oauthState: string
  provider: string
}

interface SocialStartResult {
  success: boolean
  loginUrl?: string
  state?: string
  error?: string
}

interface SocialTokenResult {
  success: boolean
  accessToken?: string
  refreshToken?: string
  profileArn?: string
  expiresIn?: number
  authMethod?: 'social'
  provider?: string
  error?: string
}

// ============ SSO Device Auth 结果 ============

interface SsoAuthResult {
  success: boolean
  accessToken?: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  region?: string
  expiresIn?: number
  error?: string
}

// ============ AuthService ============

const SCOPES = [
  'codewhisperer:completions',
  'codewhisperer:analysis',
  'codewhisperer:conversations',
  'codewhisperer:transformations',
  'codewhisperer:taskassist'
]

/**
 * Auth 登录服务。
 *
 * 封装 Builder ID Device Flow、IAM SSO (Authorization Code + PKCE)、
 * Social Login (Google/GitHub) 和 SSO Device Auth (import-from-sso-token)。
 *
 * 所有登录状态保存在服务实例内存中，无 Electron 依赖。
 */
export class AuthService {
  private deps: AuthDeps
  private builderIdState: BuilderIdLoginState | null = null
  private iamSsoState: IamSsoLoginState | null = null
  private iamSsoServer: Server | null = null
  private iamSsoResult: {
    completed: boolean
    success: boolean
    error?: string
    data?: Record<string, unknown>
  } | null = null
  private socialState: SocialLoginState | null = null

  constructor(deps: AuthDeps) {
    this.deps = deps
  }

  // ============ Builder ID Device Flow ============

  async startBuilderIdLogin(region: string = 'us-east-1'): Promise<BuilderIdStartResult> {
    console.log('[AuthService] Starting Builder ID login...')

    const oidcBase = `https://oidc.${region}.amazonaws.com`
    const startUrl = 'https://view.awsapps.com/start'

    try {
      // Step 1: 注册 OIDC 客户端
      const regRes = await serverFetch(
        `${oidcBase}/client/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName: 'Kiro Account Manager',
            clientType: 'public',
            scopes: SCOPES,
            grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
            issuerUrl: startUrl
          })
        },
        this.deps.fetchOpts
      )

      if (!regRes.ok) {
        const errText = await regRes.text()
        return { success: false, error: `注册客户端失败: ${errText}` }
      }

      const regData = (await regRes.json()) as { clientId: string; clientSecret: string }
      const { clientId, clientSecret } = regData

      // Step 2: 发起设备授权
      const authRes = await serverFetch(
        `${oidcBase}/device_authorization`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, clientSecret, startUrl })
        },
        this.deps.fetchOpts
      )

      if (!authRes.ok) {
        const errText = await authRes.text()
        return { success: false, error: `设备授权失败: ${errText}` }
      }

      const authData = (await authRes.json()) as {
        deviceCode: string
        userCode: string
        verificationUri: string
        verificationUriComplete?: string
        interval?: number
        expiresIn?: number
      }

      this.builderIdState = {
        type: 'builderid',
        clientId,
        clientSecret,
        deviceCode: authData.deviceCode,
        userCode: authData.userCode,
        verificationUri: authData.verificationUriComplete || authData.verificationUri,
        interval: authData.interval || 5,
        expiresAt: Date.now() + (authData.expiresIn || 600) * 1000
      }

      return {
        success: true,
        userCode: authData.userCode,
        verificationUri: authData.verificationUriComplete || authData.verificationUri,
        expiresIn: authData.expiresIn,
        interval: authData.interval || 5
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '登录失败' }
    }
  }

  async pollBuilderIdAuth(region: string = 'us-east-1'): Promise<BuilderIdPollResult> {
    if (!this.builderIdState || this.builderIdState.type !== 'builderid') {
      return { success: false, error: '没有进行中的登录' }
    }

    if (Date.now() > this.builderIdState.expiresAt) {
      this.builderIdState = null
      return { success: false, error: '授权已过期，请重新开始' }
    }

    const oidcBase = `https://oidc.${region}.amazonaws.com`
    const { clientId, clientSecret, deviceCode } = this.builderIdState

    try {
      const tokenRes = await serverFetch(
        `${oidcBase}/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            clientSecret,
            grantType: 'urn:ietf:params:oauth:grant-type:device_code',
            deviceCode
          })
        },
        this.deps.fetchOpts
      )

      if (tokenRes.status === 200) {
        const tokenData = (await tokenRes.json()) as {
          accessToken: string
          refreshToken: string
          expiresIn: number
        }
        this.builderIdState = null

        return {
          success: true,
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          clientId,
          clientSecret,
          region,
          expiresIn: tokenData.expiresIn
        }
      }

      const errData = (await tokenRes.json()) as { error?: string }
      if (errData.error === 'authorization_pending') {
        return { success: false, error: '等待授权中...' }
      }
      if (errData.error === 'slow_down') {
        this.builderIdState.interval += 5
        return { success: false, error: '请求过于频繁，已增加间隔' }
      }
      return { success: false, error: `授权失败: ${errData.error}` }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '轮询失败'
      }
    }
  }

  cancelBuilderIdLogin(): void {
    this.builderIdState = null
  }

  // ============ IAM Identity Center SSO ============

  async startIamSsoLogin(
    startUrl: string,
    region: string = 'us-east-1',
    openBrowser: boolean = true
  ): Promise<IamSsoStartResult> {
    console.log('[AuthService] Starting IAM SSO login...')

    if (!startUrl || !startUrl.startsWith('https://')) {
      return { success: false, error: 'SSO Start URL 必须以 https:// 开头' }
    }

    const oidcBase = `https://oidc.${region}.amazonaws.com`

    try {
      // Step 1: 注册 OIDC 客户端
      const regRes = await serverFetch(
        `${oidcBase}/client/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName: 'Kiro Account Manager',
            clientType: 'public',
            scopes: SCOPES,
            grantTypes: ['authorization_code', 'refresh_token'],
            redirectUris: ['http://127.0.0.1/oauth/callback'],
            issuerUrl: startUrl
          })
        },
        this.deps.fetchOpts
      )

      if (!regRes.ok) {
        const errText = await regRes.text()
        return { success: false, error: `注册客户端失败: ${errText}` }
      }

      const regData = (await regRes.json()) as { clientId: string; clientSecret: string }

      // Step 2: 生成 PKCE
      const codeVerifier = randomBytes(32).toString('base64url')
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
      const state = randomUUID()

      // Step 3: 启动本地回调服务器
      await this.closeIamSsoServer()
      const port = await this.findAvailablePort()
      const redirectUri = `http://127.0.0.1:${port}/oauth/callback`

      this.iamSsoState = {
        type: 'iam-sso',
        clientId: regData.clientId,
        clientSecret: regData.clientSecret,
        codeVerifier,
        redirectUri,
        region,
        expiresAt: Date.now() + 600000
      }
      this.iamSsoResult = null

      // 创建回调服务器
      this.iamSsoServer = createServer(async (req, res) => {
        const url = new URL(req.url || '', `http://127.0.0.1:${port}`)
        if (url.pathname === '/oauth/callback') {
          await this.handleIamSsoCallback(url, regData, codeVerifier, state, region, res)
        }
      })

      await new Promise<void>((resolve, reject) => {
        this.iamSsoServer!.once('error', reject)
        this.iamSsoServer!.listen(port, '127.0.0.1', () => {
          this.iamSsoServer!.off('error', reject)
          resolve()
        })
      })

      // 构建授权 URL
      const authUrl = new URL(`${oidcBase}/authorize`)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('client_id', regData.clientId)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('scope', SCOPES.join(' '))

      const urlStr = authUrl.toString()

      if (openBrowser) {
        if (this.deps.openInPrivate) {
          this.deps.openInPrivate(urlStr)
        } else {
          await this.deps.openUrl(urlStr)
        }
      }

      return { success: true, authUrl: urlStr }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'IAM SSO 登录失败'
      }
    }
  }

  pollIamSsoAuth(): IamSsoPollResult {
    if (!this.iamSsoState) {
      return { success: false, error: '没有进行中的 IAM SSO 登录' }
    }
    if (Date.now() > this.iamSsoState.expiresAt) {
      void this.cancelIamSsoLogin()
      return { success: false, error: '授权已过期，请重新开始' }
    }
    if (!this.iamSsoResult) {
      return { success: false, completed: false }
    }
    if (!this.iamSsoResult.completed) {
      return { success: false, completed: false }
    }
    if (!this.iamSsoResult.success) {
      const error = this.iamSsoResult.error
      void this.cancelIamSsoLogin()
      return {
        success: false,
        completed: true,
        error
      }
    }
    const data = this.iamSsoResult.data as Record<string, unknown>
    void this.cancelIamSsoLogin()
    return {
      success: true,
      completed: true,
      ...data
    } as IamSsoPollResult
  }

  async cancelIamSsoLogin(): Promise<void> {
    await this.closeIamSsoServer()
    this.iamSsoResult = null
    this.iamSsoState = null
  }

  // ============ Social Login ============

  async startSocialLogin(
    provider: 'Google' | 'Github',
    usePrivateMode?: boolean
  ): Promise<SocialStartResult> {
    console.log(`[AuthService] Starting ${provider} Social Auth login...`)

    const codeVerifier = randomBytes(64).toString('base64url').substring(0, 128)
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const oauthState = randomBytes(32).toString('base64url')

    const redirectUri = 'kiro://kiro.kiroAgent/authenticate-success'
    const loginUrl = new URL(`${KIRO_AUTH_ENDPOINT}/login`)
    loginUrl.searchParams.set('idp', provider)
    loginUrl.searchParams.set('redirect_uri', redirectUri)
    loginUrl.searchParams.set('code_challenge', codeChallenge)
    loginUrl.searchParams.set('code_challenge_method', 'S256')
    loginUrl.searchParams.set('state', oauthState)

    this.socialState = {
      type: 'social',
      codeVerifier,
      codeChallenge,
      oauthState,
      provider
    }

    const urlStr = loginUrl.toString()

    if (usePrivateMode && this.deps.openInPrivate) {
      this.deps.openInPrivate(urlStr)
    } else {
      await this.deps.openUrl(urlStr)
    }

    return {
      success: true,
      loginUrl: urlStr,
      state: oauthState
    }
  }

  async exchangeSocialToken(code: string, state: string): Promise<SocialTokenResult> {
    if (!this.socialState || this.socialState.type !== 'social') {
      return { success: false, error: '没有进行中的社交登录' }
    }

    if (state !== this.socialState.oauthState) {
      this.socialState = null
      return { success: false, error: '状态参数不匹配，可能存在安全风险' }
    }

    const { codeVerifier, provider } = this.socialState
    const redirectUri = 'kiro://kiro.kiroAgent/authenticate-success'

    try {
      const tokenRes = await serverFetch(
        `${KIRO_AUTH_ENDPOINT}/oauth/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri
          })
        },
        this.deps.fetchOpts
      )

      if (!tokenRes.ok) {
        const errText = await tokenRes.text()
        this.socialState = null
        return { success: false, error: `Token 交换失败: ${errText}` }
      }

      const tokenData = (await tokenRes.json()) as {
        accessToken: string
        refreshToken: string
        profileArn: string
        expiresIn: number
      }

      const result: SocialTokenResult = {
        success: true,
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        profileArn: tokenData.profileArn,
        expiresIn: tokenData.expiresIn,
        authMethod: 'social',
        provider
      }

      this.socialState = null
      return result
    } catch (error) {
      this.socialState = null
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token 交换失败'
      }
    }
  }

  cancelSocialLogin(): void {
    this.socialState = null
  }

  // ============ SSO Device Auth (import-from-sso-token) ============

  async importFromSsoToken(
    bearerToken: string,
    region: string = 'us-east-1'
  ): Promise<SsoAuthResult> {
    const oidcBase = `https://oidc.${region}.amazonaws.com`
    const portalBase = 'https://portal.sso.us-east-1.amazonaws.com'
    const startUrl = 'https://view.awsapps.com/start'

    let clientId: string
    let clientSecret: string
    let deviceCode: string
    let interval = 1

    // Step 1: 注册 OIDC 客户端
    try {
      const regRes = await serverFetch(
        `${oidcBase}/client/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName: 'Kiro Account Manager',
            clientType: 'public',
            scopes: SCOPES,
            grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
            issuerUrl: startUrl
          })
        },
        this.deps.fetchOpts
      )
      if (!regRes.ok) throw new Error(`Register failed: ${regRes.status}`)
      const regData = (await regRes.json()) as { clientId: string; clientSecret: string }
      clientId = regData.clientId
      clientSecret = regData.clientSecret
    } catch (e) {
      return { success: false, error: `注册客户端失败: ${e}` }
    }

    // Step 2: 发起设备授权
    try {
      const devRes = await serverFetch(
        `${oidcBase}/device_authorization`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, clientSecret, startUrl })
        },
        this.deps.fetchOpts
      )
      if (!devRes.ok) throw new Error(`Device auth failed: ${devRes.status}`)
      const devData = (await devRes.json()) as {
        deviceCode: string
        userCode: string
        interval?: number
      }
      deviceCode = devData.deviceCode
      interval = devData.interval || 1
    } catch (e) {
      return { success: false, error: `设备授权失败: ${e}` }
    }

    // Step 3: 验证 Bearer Token
    try {
      const whoRes = await serverFetch(
        `${portalBase}/token/whoAmI`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${bearerToken}`, Accept: 'application/json' }
        },
        this.deps.fetchOpts
      )
      if (!whoRes.ok) throw new Error(`whoAmI failed: ${whoRes.status}`)
    } catch (e) {
      return { success: false, error: `Token 验证失败: ${e}` }
    }

    // Step 4: 获取设备会话令牌
    let deviceSessionToken: string
    try {
      const sessRes = await serverFetch(
        `${portalBase}/session/device`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${bearerToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        },
        this.deps.fetchOpts
      )
      if (!sessRes.ok) throw new Error(`Device session failed: ${sessRes.status}`)
      const sessData = (await sessRes.json()) as { token: string }
      deviceSessionToken = sessData.token
    } catch (e) {
      return { success: false, error: `获取设备会话失败: ${e}` }
    }

    // Step 5: 接受用户代码
    let deviceContext: { deviceContextId?: string; clientId?: string; clientType?: string } | null =
      null
    try {
      const acceptRes = await serverFetch(
        `${oidcBase}/device_authorization/accept_user_code`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Referer: 'https://view.awsapps.com/'
          },
          body: JSON.stringify({ userCode: '', userSessionId: deviceSessionToken })
        },
        this.deps.fetchOpts
      )
      if (!acceptRes.ok) throw new Error(`Accept user code failed: ${acceptRes.status}`)
      const acceptData = (await acceptRes.json()) as {
        deviceContext?: { deviceContextId?: string; clientId?: string; clientType?: string }
      }
      deviceContext = acceptData.deviceContext || null
    } catch (e) {
      return { success: false, error: `接受用户代码失败: ${e}` }
    }

    // Step 6: 批准授权
    if (deviceContext?.deviceContextId) {
      try {
        const approveRes = await serverFetch(
          `${oidcBase}/device_authorization/associate_token`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Referer: 'https://view.awsapps.com/'
            },
            body: JSON.stringify({
              deviceContext: {
                deviceContextId: deviceContext.deviceContextId,
                clientId: deviceContext.clientId || clientId,
                clientType: deviceContext.clientType || 'public'
              },
              userSessionId: deviceSessionToken
            })
          },
          this.deps.fetchOpts
        )
        if (!approveRes.ok) throw new Error(`Approve failed: ${approveRes.status}`)
      } catch (e) {
        return { success: false, error: `批准授权失败: ${e}` }
      }
    }

    // Step 7: 轮询获取 Token
    const startTime = Date.now()
    const timeout = 120000

    while (Date.now() - startTime < timeout) {
      await new Promise((r) => setTimeout(r, interval * 1000))

      try {
        const tokenRes = await serverFetch(
          `${oidcBase}/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId,
              clientSecret,
              grantType: 'urn:ietf:params:oauth:grant-type:device_code',
              deviceCode
            })
          },
          this.deps.fetchOpts
        )

        if (tokenRes.ok) {
          const tokenData = (await tokenRes.json()) as {
            accessToken: string
            refreshToken: string
            expiresIn?: number
          }
          return {
            success: true,
            accessToken: tokenData.accessToken,
            refreshToken: tokenData.refreshToken,
            clientId,
            clientSecret,
            region,
            expiresIn: tokenData.expiresIn
          }
        }

        if (tokenRes.status === 400) {
          const errData = (await tokenRes.json()) as { error?: string }
          if (errData.error === 'authorization_pending') continue
          if (errData.error === 'slow_down') {
            interval += 5
          } else {
            return { success: false, error: `Token 获取失败: ${errData.error}` }
          }
        }
      } catch (e) {
        console.error('[SSO] Token poll error:', e)
      }
    }

    return { success: false, error: '授权超时，请重试' }
  }

  // ============ 内部方法 ============

  private async handleIamSsoCallback(
    url: URL,
    regData: { clientId: string; clientSecret: string },
    codeVerifier: string,
    expectedState: string,
    region: string,
    res: import('http').ServerResponse
  ): Promise<void> {
    const code = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><body><h1>授权失败</h1><p>您可以关闭此窗口。</p></body></html>')
      this.iamSsoResult = { completed: true, success: false, error: `授权失败: ${error}` }
      return
    }

    if (returnedState !== expectedState) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><body><h1>授权失败</h1><p>状态不匹配，请重试。</p></body></html>')
      this.iamSsoResult = { completed: true, success: false, error: '状态不匹配' }
      return
    }

    if (code) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        '<html><body><h1>授权成功</h1><p>您可以关闭此窗口，回到应用继续操作。</p></body></html>'
      )

      try {
        const oidcBase = `https://oidc.${region}.amazonaws.com`
        const redirectUri = this.iamSsoState?.redirectUri || ''
        const tokenRes = await serverFetch(
          `${oidcBase}/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId: regData.clientId,
              clientSecret: regData.clientSecret,
              grantType: 'authorization_code',
              code,
              redirect_uri: redirectUri,
              code_verifier: codeVerifier
            })
          },
          this.deps.fetchOpts
        )

        if (tokenRes.ok) {
          const tokenData = (await tokenRes.json()) as {
            accessToken: string
            refreshToken: string
            expiresIn: number
          }
          this.iamSsoResult = {
            completed: true,
            success: true,
            data: {
              accessToken: tokenData.accessToken,
              refreshToken: tokenData.refreshToken,
              clientId: regData.clientId,
              clientSecret: regData.clientSecret,
              region,
              expiresIn: tokenData.expiresIn
            }
          }
        } else {
          const errText = await tokenRes.text()
          this.iamSsoResult = {
            completed: true,
            success: false,
            error: `Token 交换失败: ${errText}`
          }
        }
      } catch (e) {
        this.iamSsoResult = {
          completed: true,
          success: false,
          error: e instanceof Error ? e.message : 'Token 交换失败'
        }
      }
    }
  }

  private async closeIamSsoServer(): Promise<void> {
    if (this.iamSsoServer) {
      await new Promise<void>((resolve) => {
        this.iamSsoServer!.close(() => resolve())
      })
      this.iamSsoServer = null
    }
  }

  private async findAvailablePort(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          const port = addr.port
          server.close(() => resolve(port))
        } else {
          reject(new Error('无法获取端口'))
        }
      })
    })
  }

  // ============ 关闭 ============

  async shutdown(): Promise<void> {
    await this.closeIamSsoServer()
    this.builderIdState = null
    this.iamSsoState = null
    this.iamSsoResult = null
    this.socialState = null
  }
}
