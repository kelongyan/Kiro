import { ipcRenderer, type IpcRendererEvent } from 'electron'

export const registrationApi = {
  registrationStartAuto: (config: {
    proxy?: string
    moEmailBaseURL?: string
    moEmailAPIKey?: string
    useOutlook?: boolean
    outlookData?: string
    useTempMailPlus?: boolean
    tempMailPlusEmail?: string
    tempMailPlusEpin?: string
    tempMailPlusDomain?: string
    password?: string
    fullName?: string
    taskId?: string
  }): Promise<{ success: boolean; result?: unknown; error?: string }> => ipcRenderer.invoke('registration-start-auto', config),

  registrationManualPhase1: (config: {
    proxy?: string
    password?: string
    fullName?: string
  }): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('registration-manual-phase1', config),

  registrationManualPhase2: (email: string, fullName?: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('registration-manual-phase2', email, fullName),
  registrationManualPhase3: (otp: string): Promise<{ success: boolean; result?: unknown; error?: string }> => ipcRenderer.invoke('registration-manual-phase3', otp),
  registrationCancel: (): Promise<{ success: boolean }> => ipcRenderer.invoke('registration-cancel'),
  registrationStatus: (): Promise<{ inProgress: boolean }> => ipcRenderer.invoke('registration-status'),

  onRegistrationLog: (callback: (msg: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: string | { message: string; taskId?: string }): void => {
      const msg = typeof data === 'string' ? data : data.message
      callback(msg)
    }
    ipcRenderer.on('registration-log', handler)
    return () => ipcRenderer.removeListener('registration-log', handler)
  },

  onRegistrationComplete: (callback: (result: {
    status: 'success' | 'failed'
    email: string
    password?: string
    error?: string
    clientId?: string
    clientSecret?: string
    refreshToken?: string
    accessToken?: string
    region?: string
    provider?: string
    verify?: Record<string, unknown>
  }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, result: {
      status: 'success' | 'failed'
      email: string
      password?: string
      error?: string
      clientId?: string
      clientSecret?: string
      refreshToken?: string
      accessToken?: string
      region?: string
      provider?: string
      verify?: Record<string, unknown>
    }): void => callback(result)
    ipcRenderer.on('registration-complete', handler)
    return () => ipcRenderer.removeListener('registration-complete', handler)
  }
}
