import { ipcRenderer, type IpcRendererEvent } from 'electron'

export const accountsApi = {
  loadAccounts: (): Promise<unknown> => ipcRenderer.invoke('load-accounts'),
  saveAccounts: (data: unknown): Promise<void> => ipcRenderer.invoke('save-accounts', data),
  refreshAccountToken: (account: unknown): Promise<unknown> =>
    ipcRenderer.invoke('refresh-account-token', account),
  checkAccountStatus: (account: unknown): Promise<unknown> =>
    ipcRenderer.invoke('check-account-status', account),

  backgroundBatchRefresh: (
    accounts: Array<{
      id: string
      email: string
      idp?: string
      needsTokenRefresh?: boolean
      machineId?: string
      credentials: {
        refreshToken: string
        clientId?: string
        clientSecret?: string
        region?: string
        authMethod?: string
        accessToken?: string
        provider?: string
      }
    }>,
    concurrency?: number,
    syncInfo?: boolean
  ): Promise<{
    success: boolean
    completed: number
    successCount: number
    failedCount: number
  }> => {
    return ipcRenderer.invoke('background-batch-refresh', accounts, concurrency, syncInfo)
  },

  onBackgroundRefreshProgress: (
    callback: (data: { completed: number; total: number; success: number; failed: number }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      data: { completed: number; total: number; success: number; failed: number }
    ): void => callback(data)
    ipcRenderer.on('background-refresh-progress', handler)
    return () => ipcRenderer.removeListener('background-refresh-progress', handler)
  },

  onBackgroundRefreshResult: (
    callback: (data: { id: string; success: boolean; data?: unknown; error?: string }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      data: { id: string; success: boolean; data?: unknown; error?: string }
    ): void => callback(data)
    ipcRenderer.on('background-refresh-result', handler)
    return () => ipcRenderer.removeListener('background-refresh-result', handler)
  },

  backgroundBatchCheck: (
    accounts: Array<{
      id: string
      email: string
      credentials: {
        accessToken: string
        refreshToken?: string
        clientId?: string
        clientSecret?: string
        region?: string
        authMethod?: string
        provider?: string
      }
      idp?: string
    }>,
    concurrency?: number
  ): Promise<{
    success: boolean
    completed: number
    successCount: number
    failedCount: number
  }> => {
    return ipcRenderer.invoke('background-batch-check', accounts, concurrency)
  },

  onBackgroundCheckProgress: (
    callback: (data: { completed: number; total: number; success: number; failed: number }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      data: { completed: number; total: number; success: number; failed: number }
    ): void => callback(data)
    ipcRenderer.on('background-check-progress', handler)
    return () => ipcRenderer.removeListener('background-check-progress', handler)
  },

  onBackgroundCheckResult: (
    callback: (data: { id: string; success: boolean; data?: unknown; error?: string }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      data: { id: string; success: boolean; data?: unknown; error?: string }
    ): void => callback(data)
    ipcRenderer.on('background-check-result', handler)
    return () => ipcRenderer.removeListener('background-check-result', handler)
  },

  switchAccount: (credentials: {
    accessToken: string
    refreshToken: string
    clientId: string
    clientSecret: string
    region?: string
    startUrl?: string
    authMethod?: 'IdC' | 'social'
    provider?: 'BuilderId' | 'Github' | 'Google' | 'Enterprise'
    profileArn?: string
  }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('switch-account', credentials),

  switchAccountCli: (credentials: {
    accessToken: string
    refreshToken: string
    clientId?: string
    clientSecret?: string
    region?: string
    profileArn?: string
    provider?: string
    scopes?: string[]
  }): Promise<{ success: boolean; error?: string; dbPath?: string }> =>
    ipcRenderer.invoke('switch-account-cli', credentials),

  logoutAccount: (): Promise<{ success: boolean; deletedCount?: number; error?: string }> =>
    ipcRenderer.invoke('logout-account'),
  exportToFile: (data: string, filename: string): Promise<boolean> =>
    ipcRenderer.invoke('export-to-file', data, filename),
  importFromFile: (): Promise<string | null> => ipcRenderer.invoke('import-from-file'),

  verifyAccountCredentials: (credentials: {
    refreshToken: string
    clientId: string
    clientSecret: string
    region?: string
    authMethod?: string
    provider?: string
  }): Promise<{
    success: boolean
    data?: {
      email: string
      userId: string
      accessToken: string
      refreshToken: string
      expiresIn?: number
      subscriptionType: string
      subscriptionTitle: string
      usage: { current: number; limit: number }
      daysRemaining?: number
      expiresAt?: number
    }
    error?: string
  }> => ipcRenderer.invoke('verify-account-credentials', credentials),

  getLocalActiveAccount: (): Promise<{
    success: boolean
    data?: {
      refreshToken: string
      accessToken?: string
      authMethod?: string
      provider?: string
    }
    error?: string
  }> => ipcRenderer.invoke('get-local-active-account'),

  loadKiroCredentials: (): Promise<{
    success: boolean
    data?: {
      accessToken: string
      refreshToken: string
      clientId: string
      clientSecret: string
      region: string
      authMethod: string
      provider: string
    }
    error?: string
  }> => ipcRenderer.invoke('load-kiro-credentials'),

  importFromSsoToken: (
    bearerToken: string,
    region?: string
  ): Promise<{
    success: boolean
    data?: {
      accessToken: string
      refreshToken: string
      clientId: string
      clientSecret: string
      region: string
      expiresIn?: number
      email?: string
      userId?: string
      idp?: string
      status?: string
    }
    error?: { message: string }
  }> => ipcRenderer.invoke('import-from-sso-token', bearerToken, region || 'us-east-1')
}
