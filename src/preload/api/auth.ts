import { ipcRenderer, type IpcRendererEvent } from 'electron'

export const authApi = {
  startBuilderIdLogin: (region?: string): Promise<{
    success: boolean
    userCode?: string
    verificationUri?: string
    expiresIn?: number
    interval?: number
    error?: string
  }> => ipcRenderer.invoke('start-builder-id-login', region || 'us-east-1'),

  pollBuilderIdAuth: (region?: string): Promise<{
    success: boolean
    completed?: boolean
    status?: string
    accessToken?: string
    refreshToken?: string
    clientId?: string
    clientSecret?: string
    region?: string
    expiresIn?: number
    error?: string
  }> => ipcRenderer.invoke('poll-builder-id-auth', region || 'us-east-1'),

  cancelBuilderIdLogin: (): Promise<{ success: boolean }> => ipcRenderer.invoke('cancel-builder-id-login'),

  startIamSsoLogin: (startUrl: string, region?: string): Promise<{
    success: boolean
    authorizeUrl?: string
    expiresIn?: number
    error?: string
  }> => ipcRenderer.invoke('start-iam-sso-login', startUrl, region || 'us-east-1'),

  pollIamSsoAuth: (region?: string): Promise<{
    success: boolean
    completed?: boolean
    status?: string
    accessToken?: string
    refreshToken?: string
    clientId?: string
    clientSecret?: string
    region?: string
    expiresIn?: number
    error?: string
  }> => ipcRenderer.invoke('poll-iam-sso-auth', region || 'us-east-1'),

  completeIamSsoLogin: (code: string): Promise<{
    success: boolean
    completed?: boolean
    accessToken?: string
    refreshToken?: string
    clientId?: string
    clientSecret?: string
    region?: string
    expiresIn?: number
    error?: string
  }> => ipcRenderer.invoke('complete-iam-sso-login', code),

  cancelIamSsoLogin: (): Promise<{ success: boolean }> => ipcRenderer.invoke('cancel-iam-sso-login'),

  startSocialLogin: (provider: 'Google' | 'Github', usePrivateMode?: boolean): Promise<{
    success: boolean
    loginUrl?: string
    state?: string
    error?: string
  }> => ipcRenderer.invoke('start-social-login', provider, usePrivateMode),

  exchangeSocialToken: (code: string, state: string): Promise<{
    success: boolean
    accessToken?: string
    refreshToken?: string
    profileArn?: string
    expiresIn?: number
    authMethod?: string
    provider?: string
    error?: string
  }> => ipcRenderer.invoke('exchange-social-token', code, state),

  cancelSocialLogin: (): Promise<{ success: boolean }> => ipcRenderer.invoke('cancel-social-login'),

  onSocialAuthCallback: (callback: (data: { code?: string; state?: string; error?: string }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: { code?: string; state?: string; error?: string }): void => callback(data)
    ipcRenderer.on('social-auth-callback', handler)
    return () => ipcRenderer.removeListener('social-auth-callback', handler)
  }
}
