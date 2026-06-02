import { ipcRenderer } from 'electron'

export const diagnosticsApi = {
  proxyPoolValidate: (params: {
    url: string
    testUrl?: string
    timeoutMs?: number
  }): Promise<{ success: boolean; latencyMs?: number; externalIp?: string; error?: string }> => ipcRenderer.invoke('proxy-pool:validate', params),

  diagnoseHttpProbe: (params: { url: string; method?: 'GET' | 'HEAD'; timeoutMs?: number }): Promise<{
    success: boolean
    latencyMs?: number
    status?: number
    error?: string
  }> => ipcRenderer.invoke('diagnose:http-probe', params),

  accountSetProxyBinding: (accountId: string, proxyUrl: string | undefined): Promise<{ success: boolean }> => ipcRenderer.invoke('account-set-proxy-binding', accountId, proxyUrl),

  diagnoseRun: (params: {
    proxyUrl?: string
    targets: Array<{ id: string; label: string; url: string; timeoutMs?: number; expectStatus?: number[] }>
  }): Promise<{ results: Array<{ id: string; label: string; url: string; success: boolean; httpStatus?: number; latencyMs?: number; error?: string }> }> => ipcRenderer.invoke('diagnose:run', params)
}
