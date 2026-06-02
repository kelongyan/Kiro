import { serverFetch, type ServerFetchOptions } from '../../runtime/fetch'

// ============ 常量 ============

/** 社交登录 (GitHub/Google) 的 Token 刷新端点 */
export const KIRO_AUTH_ENDPOINT = 'https://prod.us-east-1.auth.desktop.kiro.dev'

/** Kiro 版本号和 User-Agent */
const KIRO_VERSION = '0.6.18'

// ============ 类型 ============

export interface OidcRefreshResult {
  success: boolean
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
  error?: string
}

export interface TokenRefreshDeps {
  /** 网络请求选项（代理 agent 等） */
  fetchOpts?: Omit<ServerFetchOptions, 'overrideProxyUrl'>
}

// ============ User-Agent 生成 ============

export function getKiroUserAgent(machineId?: string): string {
  const suffix = machineId ? `KiroIDE-${KIRO_VERSION}-${machineId}` : `KiroIDE-${KIRO_VERSION}`
  return `aws-sdk-js/1.0.18 ua/2.1 os/windows lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.18 m/E ${suffix}`
}

export function getKiroAmzUserAgent(machineId?: string): string {
  const suffix = machineId ? `KiroIDE ${KIRO_VERSION} ${machineId}` : `KiroIDE-${KIRO_VERSION}`
  return `aws-sdk-js/1.0.18 ${suffix}`
}

// ============ OIDC Token 刷新 ============

/**
 * IdC (BuilderId) 的 OIDC Token 刷新。
 *
 * 调用 `https://oidc.{region}.amazonaws.com/token` 端点，
 * 使用 refreshToken + clientId + clientSecret 换取新的 accessToken。
 */
export async function refreshOidcToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  region: string = 'us-east-1',
  deps: TokenRefreshDeps,
  proxyUrl?: string
): Promise<OidcRefreshResult> {
  console.log(
    `[OIDC] Refreshing token with clientId: ${clientId.substring(0, 20)}...${proxyUrl ? ' [via bound proxy]' : ''}`
  )

  const url = `https://oidc.${region}.amazonaws.com/token`

  const payload = {
    clientId,
    clientSecret,
    refreshToken,
    grantType: 'refresh_token'
  }

  try {
    const response = await serverFetch(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      },
      { ...deps.fetchOpts, overrideProxyUrl: proxyUrl }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[OIDC] Refresh failed: ${response.status} - ${errorText}`)
      return { success: false, error: `HTTP ${response.status}: ${errorText}` }
    }

    const data = (await response.json()) as {
      accessToken: string
      refreshToken?: string
      expiresIn: number
    }
    console.log(`[OIDC] Token refreshed successfully, expires in ${data.expiresIn}s`)

    return {
      success: true,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      expiresIn: data.expiresIn
    }
  } catch (error) {
    console.error('[OIDC] Refresh error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============ 社交登录 Token 刷新 ============

/**
 * 社交登录 (GitHub/Google) 的 Token 刷新。
 *
 * 调用 Kiro Auth Service 的 `/refreshToken` 端点。
 */
export async function refreshSocialToken(
  refreshToken: string,
  deps: TokenRefreshDeps,
  machineId?: string,
  proxyUrl?: string
): Promise<OidcRefreshResult> {
  console.log(`[Social] Refreshing token...${proxyUrl ? ' [via bound proxy]' : ''}`)

  const url = `${KIRO_AUTH_ENDPOINT}/refreshToken`

  try {
    const response = await serverFetch(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': getKiroUserAgent(machineId)
        },
        body: JSON.stringify({ refreshToken })
      },
      { ...deps.fetchOpts, overrideProxyUrl: proxyUrl }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Social] Refresh failed: ${response.status} - ${errorText}`)
      return { success: false, error: `HTTP ${response.status}: ${errorText}` }
    }

    const data = (await response.json()) as {
      accessToken: string
      refreshToken?: string
      expiresIn: number
    }
    console.log(`[Social] Token refreshed successfully, expires in ${data.expiresIn}s`)

    return {
      success: true,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      expiresIn: data.expiresIn
    }
  } catch (error) {
    console.error('[Social] Refresh error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============ 通用 Token 刷新分发器 ============

/**
 * 根据 authMethod 选择刷新方式。
 *
 * - `social` → refreshSocialToken (Kiro Auth Service)
 * - 其他 → refreshOidcToken (AWS OIDC)
 */
export async function refreshTokenByMethod(
  token: string,
  clientId: string,
  clientSecret: string,
  region: string = 'us-east-1',
  authMethod?: string,
  deps: TokenRefreshDeps = {},
  proxyUrl?: string
): Promise<OidcRefreshResult> {
  if (authMethod === 'social') {
    return refreshSocialToken(token, deps, undefined, proxyUrl)
  }
  return refreshOidcToken(token, clientId, clientSecret, region, deps, proxyUrl)
}
