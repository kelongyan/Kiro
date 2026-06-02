import { ipcMain } from 'electron'
import type { RegistrationService } from '../../server/services/registration/registration-service'
import type { RegistrationConfig } from './index'

export function registerIPCHandlers(registrationService: RegistrationService): void {
  ipcMain.handle(
    'registration-start-auto',
    async (_event, config: Partial<RegistrationConfig> & { taskId?: string }) => {
      return registrationService.startAuto(config)
    }
  )

  ipcMain.handle(
    'registration-manual-phase1',
    async (_event, config: Partial<RegistrationConfig>) => {
      return registrationService.manualPhase1(config)
    }
  )

  ipcMain.handle('registration-manual-phase2', async (_event, email: string, fullName?: string) => {
    return registrationService.manualPhase2(email, fullName)
  })

  ipcMain.handle('registration-manual-phase3', async (_event, otp: string) => {
    return registrationService.manualPhase3(otp)
  })

  ipcMain.handle('registration-cancel', async (_event, taskId?: string) => {
    return registrationService.cancel(taskId)
  })

  ipcMain.handle('registration-status', async () => {
    return registrationService.status()
  })
}
