import { ipcRenderer } from 'electron'

export const machineIdApi = {
  machineIdGetOSType: (): Promise<'windows' | 'macos' | 'linux' | 'unknown'> => ipcRenderer.invoke('machine-id:get-os-type'),
  machineIdGetCurrent: (): Promise<{ success: boolean; machineId?: string; error?: string; requiresAdmin?: boolean }> => ipcRenderer.invoke('machine-id:get-current'),
  machineIdSet: (newMachineId: string): Promise<{ success: boolean; machineId?: string; error?: string; requiresAdmin?: boolean }> => ipcRenderer.invoke('machine-id:set', newMachineId),
  machineIdGenerateRandom: (): Promise<string> => ipcRenderer.invoke('machine-id:generate-random'),
  machineIdCheckAdmin: (): Promise<boolean> => ipcRenderer.invoke('machine-id:check-admin'),
  machineIdRequestAdminRestart: (): Promise<boolean> => ipcRenderer.invoke('machine-id:request-admin-restart'),
  machineIdBackupToFile: (machineId: string): Promise<boolean> => ipcRenderer.invoke('machine-id:backup-to-file', machineId),
  machineIdRestoreFromFile: (): Promise<{ success: boolean; machineId?: string; error?: string }> => ipcRenderer.invoke('machine-id:restore-from-file')
}
