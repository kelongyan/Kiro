import { ipcRenderer } from 'electron'

interface AdminRestartInfo {
  requiresAdmin: true
  canAutoRestart: false
  osType: 'windows' | 'macos' | 'linux' | 'unknown'
  executablePath: string
  command: string
  message: string
}

export const machineIdApi = {
  machineIdGetOSType: (): Promise<'windows' | 'macos' | 'linux' | 'unknown'> =>
    ipcRenderer.invoke('machine-id:get-os-type'),
  machineIdGetCurrent: (): Promise<{
    success: boolean
    machineId?: string
    error?: string
    requiresAdmin?: boolean
    adminRestart?: AdminRestartInfo
  }> => ipcRenderer.invoke('machine-id:get-current'),
  machineIdSet: (
    newMachineId: string
  ): Promise<{
    success: boolean
    machineId?: string
    error?: string
    requiresAdmin?: boolean
    adminRestart?: AdminRestartInfo
  }> => ipcRenderer.invoke('machine-id:set', newMachineId),
  machineIdGenerateRandom: (): Promise<string> => ipcRenderer.invoke('machine-id:generate-random'),
  machineIdCheckAdmin: (): Promise<boolean> => ipcRenderer.invoke('machine-id:check-admin'),
  machineIdRequestAdminRestart: (): Promise<AdminRestartInfo> =>
    ipcRenderer.invoke('machine-id:request-admin-restart'),
  machineIdBackupToFile: (machineId: string): Promise<boolean> =>
    ipcRenderer.invoke('machine-id:backup-to-file', machineId),
  machineIdRestoreFromFile: (): Promise<{ success: boolean; machineId?: string; error?: string }> =>
    ipcRenderer.invoke('machine-id:restore-from-file')
}
