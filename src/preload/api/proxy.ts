import { ipcRenderer, type IpcRendererEvent } from 'electron'

export const proxyApi = {
  proxyStart: (config?: { port?: number; host?: string; apiKey?: string; enableMultiAccount?: boolean; logRequests?: boolean; clientDrivenToolExecution?: boolean; disableTools?: boolean; modelThinkingMode?: Record<string, boolean>; thinkingOutputFormat?: 'auto' | 'reasoning_content' | 'thinking' | 'think' }): Promise<{ success: boolean; port?: number; error?: string }> => ipcRenderer.invoke('proxy-start', config),
  proxyStop: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('proxy-stop'),
  proxyGetStatus: (): Promise<{ running: boolean; config: unknown; stats: unknown }> => ipcRenderer.invoke('proxy-get-status'),
  proxyResetCredits: (): Promise<{ success: boolean }> => ipcRenderer.invoke('proxy-reset-credits'),
  proxyResetTokens: (): Promise<{ success: boolean }> => ipcRenderer.invoke('proxy-reset-tokens'),
  proxyResetRequestStats: (): Promise<{ success: boolean }> => ipcRenderer.invoke('proxy-reset-request-stats'),
  proxyGetLogs: (count?: number): Promise<Array<{ timestamp: string; level: string; category: string; message: string; data?: unknown }>> => ipcRenderer.invoke('proxy-get-logs', count),
  proxyClearLogs: (): Promise<{ success: boolean }> => ipcRenderer.invoke('proxy-clear-logs'),
  proxyGetLogsCount: (): Promise<number> => ipcRenderer.invoke('proxy-get-logs-count'),
  proxyUpdateConfig: (config: Record<string, unknown>): Promise<{ success: boolean; config?: unknown; error?: string }> => ipcRenderer.invoke('proxy-update-config', config),

  proxySelfSignedCertInfo: (): Promise<{ success: boolean; cert?: string; key?: string; fingerprint?: string; notBefore?: number; notAfter?: number; subject?: string; altNames?: string[]; error?: string }> => ipcRenderer.invoke('proxy-self-signed-cert-info'),
  proxySelfSignedCertRegenerate: (): Promise<{ success: boolean; cert?: string; key?: string; fingerprint?: string; notBefore?: number; notAfter?: number; subject?: string; altNames?: string[]; error?: string }> => ipcRenderer.invoke('proxy-self-signed-cert-regenerate'),
  proxyNeedsRestart: (): Promise<{ needsRestart: boolean }> => ipcRenderer.invoke('proxy-needs-restart'),
  proxyRestart: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('proxy-restart'),
  proxyAuditLog: (): Promise<{ entries: Array<{ ts: number; type: string; data: Record<string, unknown> }> }> => ipcRenderer.invoke('proxy-audit-log'),

  onProxyWebhookTrigger: (callback: (event: string, payload: Record<string, unknown>) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, data: { event: string; payload: Record<string, unknown> }): void => callback(data.event, data.payload)
    ipcRenderer.on('proxy-webhook-trigger', handler)
    return () => ipcRenderer.off('proxy-webhook-trigger', handler)
  },

  proxyAddAccount: (account: { id: string; email?: string; accessToken: string; refreshToken?: string; profileArn?: string; expiresAt?: number; clientId?: string; clientSecret?: string; region?: string; authMethod?: string; provider?: string; machineId?: string }): Promise<{ success: boolean; accountCount?: number; error?: string }> => ipcRenderer.invoke('proxy-add-account', account),
  proxyRemoveAccount: (accountId: string): Promise<{ success: boolean; accountCount?: number; error?: string }> => ipcRenderer.invoke('proxy-remove-account', accountId),
  proxySyncAccounts: (accounts: Array<{ id: string; email?: string; accessToken: string; refreshToken?: string; profileArn?: string; expiresAt?: number; clientId?: string; clientSecret?: string; region?: string; authMethod?: string; provider?: string; machineId?: string }>): Promise<{ success: boolean; accountCount?: number; error?: string }> => ipcRenderer.invoke('proxy-sync-accounts', accounts),
  proxyGetAccounts: (): Promise<{ accounts: unknown[]; availableCount: number }> => ipcRenderer.invoke('proxy-get-accounts'),
  proxyResetPool: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('proxy-reset-pool'),
  proxyClearAccountSuspended: (accountId: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('proxy-clear-account-suspended', accountId),
  proxyRefreshModels: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('proxy-refresh-models'),
  proxyGetModels: (): Promise<{ success: boolean; error?: string; models: Array<{ id: string; name: string; description: string; inputTypes?: string[]; maxInputTokens?: number | null; maxOutputTokens?: number | null; rateMultiplier?: number; rateUnit?: string }>; fromCache?: boolean }> => ipcRenderer.invoke('proxy-get-models'),
  proxyConfigureClients: (input: { clients: Array<'claudeCode' | 'opencode' | 'codex' | 'gemini' | 'hermes' | 'openclaw'>; modelId: string; modelName?: string; models?: Array<{ id: string; name?: string; inputTypes?: string[]; maxInputTokens?: number | null; maxOutputTokens?: number | null }> }): Promise<{ success: boolean; error?: string; proxyOrigin: string; openaiBaseUrl: string; results: Array<{ client: 'claudeCode' | 'opencode' | 'codex' | 'gemini' | 'hermes' | 'openclaw'; success: boolean; paths: string[]; backupPaths: string[]; error?: string }> }> => ipcRenderer.invoke('proxy-configure-clients', input),
  accountGetModels: (accessToken: string, region?: string, profileArn?: string, machineId?: string, provider?: string, authMethod?: string, accountId?: string): Promise<{ success: boolean; error?: string; models: Array<{ id: string; name: string; description: string; inputTypes?: string[]; maxInputTokens?: number | null; maxOutputTokens?: number | null; rateMultiplier?: number; rateUnit?: string }> }> => ipcRenderer.invoke('account-get-models', accessToken, region, profileArn, machineId, provider, authMethod, accountId),
  accountGetSubscriptions: (accessToken: string, region?: string, profileArn?: string, machineId?: string, provider?: string, authMethod?: string, accountId?: string): Promise<{ success: boolean; error?: string; plans: Array<{ name: string; qSubscriptionType: string; description: { title: string; billingInterval: string; featureHeader: string; features: string[] }; pricing: { amount: number; currency: string } }>; disclaimer?: string[] }> => ipcRenderer.invoke('account-get-subscriptions', accessToken, region, profileArn, machineId, provider, authMethod, accountId),
  accountGetSubscriptionUrl: (accessToken: string, subscriptionType?: string, region?: string, profileArn?: string, machineId?: string, provider?: string, authMethod?: string, accountId?: string): Promise<{ success: boolean; error?: string; url?: string; status?: string }> => ipcRenderer.invoke('account-get-subscription-url', accessToken, subscriptionType, region, profileArn, machineId, provider, authMethod, accountId),
  accountSetOverage: (accessToken: string, overageStatus: 'ENABLED' | 'DISABLED', region?: string, profileArn?: string, machineId?: string, provider?: string, authMethod?: string, accountId?: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('account-set-overage', accessToken, overageStatus, region, profileArn, machineId, provider, authMethod, accountId),
  openSubscriptionWindow: (url: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('open-subscription-window', url),
  proxySaveLogs: (logs: Array<{ time: string; path: string; status: number; tokens?: number }>): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('proxy-save-logs', logs),
  proxyLoadLogs: (): Promise<{ success: boolean; logs: Array<{ time: string; path: string; status: number; tokens?: number }> }> => ipcRenderer.invoke('proxy-load-logs'),
  onProxyRequest: (callback: (info: { path: string; method: string; accountId?: string }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, info: { path: string; method: string; accountId?: string }): void => callback(info)
    ipcRenderer.on('proxy-request', handler)
    return () => ipcRenderer.removeListener('proxy-request', handler)
  },
  onProxyResponse: (callback: (info: { path: string; model?: string; status: number; tokens?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number; credits?: number; responseTime?: number; error?: string }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, info: { path: string; model?: string; status: number; tokens?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number; credits?: number; responseTime?: number; error?: string }): void => callback(info)
    ipcRenderer.on('proxy-response', handler)
    return () => ipcRenderer.removeListener('proxy-response', handler)
  },
  onProxyError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, error: string): void => callback(error)
    ipcRenderer.on('proxy-error', handler)
    return () => ipcRenderer.removeListener('proxy-error', handler)
  },
  onProxyStatusChange: (callback: (status: { running: boolean; port: number }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, status: { running: boolean; port: number }): void => callback(status)
    ipcRenderer.on('proxy-status-change', handler)
    return () => ipcRenderer.removeListener('proxy-status-change', handler)
  },
  onProxyAccountSuspended: (callback: (info: { id: string; email?: string; reason: string; message: string; suspendedAt: number }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, info: { id: string; email?: string; reason: string; message: string; suspendedAt: number }): void => callback(info)
    ipcRenderer.on('proxy-account-suspended', handler)
    return () => ipcRenderer.removeListener('proxy-account-suspended', handler)
  },

  getUsageApiType: (): Promise<'rest' | 'cbor'> => ipcRenderer.invoke('get-usage-api-type'),
  setUsageApiType: (type: 'rest' | 'cbor'): Promise<{ success: boolean; type: string }> => ipcRenderer.invoke('set-usage-api-type', type),
  getUseKProxyForApi: (): Promise<boolean> => ipcRenderer.invoke('get-use-kproxy-for-api'),
  setUseKProxyForApi: (enabled: boolean): Promise<{ success: boolean; enabled: boolean }> => ipcRenderer.invoke('set-use-kproxy-for-api', enabled),

  setProxy: (enabled: boolean, url: string): Promise<{ success: boolean; error?: string; normalizedUrl?: string }> => ipcRenderer.invoke('set-proxy', enabled, url)
}
