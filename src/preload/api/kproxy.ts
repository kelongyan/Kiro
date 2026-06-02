import { ipcRenderer, type IpcRendererEvent } from 'electron'

export const kproxyApi = {
  kproxyInit: (): Promise<{ success: boolean; caInfo?: { certPath: string; fingerprint: string; validFrom: string; validTo: string }; error?: string }> => ipcRenderer.invoke('kproxy-init'),
  kproxyStart: (config?: { port?: number; host?: string; mitmDomains?: string[]; deviceId?: string }): Promise<{ success: boolean; port?: number; error?: string }> => ipcRenderer.invoke('kproxy-start', config),
  kproxyStop: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('kproxy-stop'),
  kproxyGetStatus: (): Promise<{ running: boolean; config: unknown; stats: unknown; caInfo: unknown }> => ipcRenderer.invoke('kproxy-get-status'),
  kproxyUpdateConfig: (config: { port?: number; host?: string; mitmDomains?: string[]; deviceId?: string; autoStart?: boolean; logRequests?: boolean }): Promise<{ success: boolean; config?: unknown; error?: string }> => ipcRenderer.invoke('kproxy-update-config', config),
  kproxySetDeviceId: (deviceId: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('kproxy-set-device-id', deviceId),
  kproxyGenerateDeviceId: (): Promise<{ success: boolean; deviceId?: string }> => ipcRenderer.invoke('kproxy-generate-device-id'),
  kproxyAddDeviceMapping: (mapping: { accountId: string; deviceId: string; description?: string; createdAt: number }): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('kproxy-add-device-mapping', mapping),
  kproxyGetDeviceMappings: (): Promise<{ success: boolean; mappings: Array<{ accountId: string; deviceId: string; description?: string; createdAt: number; lastUsed?: number }> }> => ipcRenderer.invoke('kproxy-get-device-mappings'),
  kproxySwitchToAccount: (accountId: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('kproxy-switch-to-account', accountId),
  kproxyGetCaCert: (): Promise<{ success: boolean; certPem?: string; certPath?: string; fingerprint?: string; error?: string }> => ipcRenderer.invoke('kproxy-get-ca-cert'),
  kproxyExportCaCert: (exportPath?: string): Promise<{ success: boolean; path?: string; error?: string }> => ipcRenderer.invoke('kproxy-export-ca-cert', exportPath),
  kproxyCheckCaCertInstalled: (): Promise<{ success: boolean; installed: boolean; error?: string }> => ipcRenderer.invoke('kproxy-check-ca-cert-installed'),
  kproxyInstallCaCert: (): Promise<{ success: boolean; message?: string; error?: string }> => ipcRenderer.invoke('kproxy-install-ca-cert'),
  kproxyUninstallCaCert: (): Promise<{ success: boolean; message?: string; error?: string }> => ipcRenderer.invoke('kproxy-uninstall-ca-cert'),
  kproxyResetStats: (): Promise<{ success: boolean }> => ipcRenderer.invoke('kproxy-reset-stats'),

  onKproxyRequest: (callback: (info: { timestamp: number; method: string; host: string; path: string; isMitm: boolean; deviceIdReplaced: boolean }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, info: { timestamp: number; method: string; host: string; path: string; isMitm: boolean; deviceIdReplaced: boolean }): void => callback(info)
    ipcRenderer.on('kproxy-request', handler)
    return () => ipcRenderer.removeListener('kproxy-request', handler)
  },

  onKproxyResponse: (callback: (info: { timestamp: number; host: string; statusCode: number; duration: number }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, info: { timestamp: number; host: string; statusCode: number; duration: number }): void => callback(info)
    ipcRenderer.on('kproxy-response', handler)
    return () => ipcRenderer.removeListener('kproxy-response', handler)
  },

  onKproxyError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, error: string): void => callback(error)
    ipcRenderer.on('kproxy-error', handler)
    return () => ipcRenderer.removeListener('kproxy-error', handler)
  },

  onKproxyStatusChange: (callback: (status: { running: boolean; port: number }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, status: { running: boolean; port: number }): void => callback(status)
    ipcRenderer.on('kproxy-status-change', handler)
    return () => ipcRenderer.removeListener('kproxy-status-change', handler)
  },

  onKproxyMitm: (callback: (info: { host: string; modified: boolean }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, info: { host: string; modified: boolean }): void => callback(info)
    ipcRenderer.on('kproxy-mitm', handler)
    return () => ipcRenderer.removeListener('kproxy-mitm', handler)
  }
}
