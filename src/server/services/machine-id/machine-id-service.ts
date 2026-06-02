import {
  backupMachineIdToFile,
  checkAdminPrivilege,
  generateRandomMachineId,
  getAdminRestartInfo,
  getCurrentMachineId,
  getOSType,
  requestAdminRestart,
  restoreMachineIdFromFile,
  setMachineId,
  type AdminRestartInfo,
  type MachineIdResult,
  type OSType
} from '../../../main/machineId'

export class MachineIdService {
  getOSType(): OSType {
    return getOSType()
  }

  getCurrent(): Promise<MachineIdResult> {
    return getCurrentMachineId()
  }

  async set(newMachineId: string): Promise<MachineIdResult> {
    const result = await setMachineId(newMachineId)
    if (!result.success && result.requiresAdmin) {
      return {
        ...result,
        adminRestart: getAdminRestartInfo()
      }
    }
    return result
  }

  generateRandom(): string {
    return generateRandomMachineId()
  }

  checkAdmin(): Promise<boolean> {
    return checkAdminPrivilege()
  }

  requestAdminRestart(): Promise<AdminRestartInfo> {
    return requestAdminRestart()
  }

  backupToFile(machineId: string, filePath: string): Promise<boolean> {
    return backupMachineIdToFile(machineId, filePath)
  }

  restoreFromFile(filePath: string): Promise<MachineIdResult> {
    return restoreMachineIdFromFile(filePath)
  }
}
